using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.IdentityModel.Tokens;

namespace RedBamboo.AppHost.Auth.Vault;

/// <summary>The two kinds of reach a badge can carry, stamped by the vault in the <c>net</c> claim.</summary>
public static class BadgeNet
{
    public const string Claim = "net";
    public const string Local = "local";
    public const string Remote = "remote";

    public static bool IsValid(string? value) => value is Local or Remote;
}

/// <summary>What a health page shows about badge signing.</summary>
public sealed record VaultBadgeStatus(bool Available, string Message, DateTimeOffset? LastSuccess);

/// <summary>
/// Vault-mode badge signing and verification for one process. Signing is a
/// <c>sign-jwt</c> call over the vault pipe. Verification uses the vault's public keys (JWKS)
/// held in memory only: refreshed when a badge names an unknown kid (at most every
/// <see cref="UnknownKidRefreshInterval"/>) and in the background every
/// <see cref="PeriodicRefreshInterval"/>. The keys are never written to disk, because a swapped
/// public key means forged badges. The key set is replaced wholesale on every refresh, so when the
/// vault rotates its signing key (the kill switch) the old badges stop verifying here too.
/// A refresh that fails keeps the keys already held: a vault outage never invalidates badges.
/// </summary>
public sealed class VaultBadgeAuthority
{
    public static readonly TimeSpan UnknownKidRefreshInterval = TimeSpan.FromSeconds(10);
    public static readonly TimeSpan PeriodicRefreshInterval = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan SyncCallBudget = TimeSpan.FromSeconds(8);

    private readonly IBadgeVault _vault;
    private readonly TimeProvider _time;
    private readonly object _refreshGate = new();
    private readonly ConcurrentDictionary<string, CachedBadge> _cache = new(StringComparer.Ordinal);

    private volatile IReadOnlyDictionary<string, SecurityKey> _keys = new Dictionary<string, SecurityKey>();
    private DateTimeOffset _keysFetchedAt = DateTimeOffset.MinValue;
    private DateTimeOffset _lastUnknownKidRefresh = DateTimeOffset.MinValue;
    private int _backgroundRefreshing;
    private volatile VaultBadgeStatus _status = new(false, "Leaf Vault has not been contacted yet", null);

    private sealed record CachedBadge(string Token, string Kid, DateTimeOffset IssuedAt, DateTimeOffset ExpiresAt);

    public VaultBadgeAuthority(IBadgeVault vault, TimeProvider? time = null)
    {
        _vault = vault;
        _time = time ?? TimeProvider.System;
    }

    public VaultBadgeStatus Status => _status;

    /// <summary>The kids currently trusted for verification.</summary>
    public IReadOnlyCollection<string> TrustedKids => _keys.Keys.ToArray();

    // ----- signing -----

    public async Task<string> SignAsync(IReadOnlyDictionary<string, object?> claims, string net, TimeSpan lifetime,
        CancellationToken ct = default)
    {
        var badge = await SignRawAsync(claims, net, lifetime, ct).ConfigureAwait(false);
        return badge.Token;
    }

    /// <summary>Synchronous wrapper for the many sync call sites; never captures a sync context.</summary>
    public string Sign(IReadOnlyDictionary<string, object?> claims, string net, TimeSpan lifetime)
        => Sync(ct => SignAsync(claims, net, lifetime, ct));

    /// <summary>
    /// Like <see cref="Sign"/> but reuses a badge minted earlier in this process for the same claims
    /// until 80% of its lifetime has passed, so hot paths (service tokens on every request) cost one
    /// vault round trip per lifetime instead of one per call. A cached badge is dropped as soon as its
    /// kid is no longer trusted.
    /// </summary>
    public string SignCached(IReadOnlyDictionary<string, object?> claims, string net, TimeSpan lifetime)
    {
        var key = CacheKey(claims, net, lifetime);
        var now = _time.GetUtcNow();
        if (_cache.TryGetValue(key, out var hit)
            && _keys.ContainsKey(hit.Kid)
            && now < hit.IssuedAt + (hit.ExpiresAt - hit.IssuedAt) * 0.8)
            return hit.Token;

        var badge = Sync(ct => SignRawAsync(claims, net, lifetime, ct));
        _cache[key] = new CachedBadge(badge.Token, badge.Kid, now, badge.ExpiresAt);
        return badge.Token;
    }

    private async Task<VaultSignedBadge> SignRawAsync(IReadOnlyDictionary<string, object?> claims, string net,
        TimeSpan lifetime, CancellationToken ct)
    {
        if (!BadgeNet.IsValid(net)) throw new ArgumentException("net must be local or remote", nameof(net));
        var body = new Dictionary<string, object?>(claims) { [BadgeNet.Claim] = net };
        var element = JsonSerializer.SerializeToElement(body);
        VaultSignedBadge badge;
        try
        {
            badge = await _vault.SignAsync(element, (int)Math.Ceiling(lifetime.TotalSeconds), ct).ConfigureAwait(false);
        }
        catch (VaultUnavailableException e)
        {
            Fail(e);
            throw;
        }
        Succeed();
        // A badge we just signed must verify here: learn the key if the vault rotated it.
        if (!_keys.ContainsKey(badge.Kid))
            await RefreshKeysAsync(ct, force: true).ConfigureAwait(false);
        return badge;
    }

    private static string CacheKey(IReadOnlyDictionary<string, object?> claims, string net, TimeSpan lifetime)
    {
        var sorted = new SortedDictionary<string, object?>(StringComparer.Ordinal);
        foreach (var (k, v) in claims) sorted[k] = v;
        return net + "|" + (long)lifetime.TotalSeconds + "|" + JsonSerializer.Serialize(sorted);
    }

    // ----- verification keys -----

    /// <summary>
    /// Keys to try for a badge naming <paramref name="kid"/>. A missing kid yields nothing: in vault mode
    /// every badge names the vault key that signed it.
    /// </summary>
    public IEnumerable<SecurityKey> ResolveKeys(string? kid)
    {
        if (string.IsNullOrEmpty(kid)) return [];
        var keys = _keys;
        if (keys.TryGetValue(kid, out var known))
        {
            MaybeRefreshInBackground();
            return [known];
        }

        // Unknown kid: maybe the vault rotated. Ask once per interval, so a stream of forged kids
        // cannot turn into a stream of pipe calls.
        var now = _time.GetUtcNow();
        bool allowed;
        lock (_refreshGate)
        {
            allowed = now - _lastUnknownKidRefresh >= UnknownKidRefreshInterval;
            if (allowed) _lastUnknownKidRefresh = now;
        }
        if (allowed)
        {
            try { Sync(ct => RefreshKeysAsync(ct, force: true)); }
            catch (VaultUnavailableException) { /* status already records it; keep what we have */ }
        }
        return _keys.TryGetValue(kid, out var fresh) ? [fresh] : [];
    }

    /// <summary>Fetch the vault's public keys now. Throws <see cref="VaultUnavailableException"/> when it cannot.</summary>
    public async Task RefreshKeysAsync(CancellationToken ct = default, bool force = true)
    {
        IReadOnlyList<VaultJwk> jwks;
        try
        {
            jwks = await _vault.JwksAsync(ct).ConfigureAwait(false);
        }
        catch (VaultUnavailableException e)
        {
            Fail(e);
            throw;
        }

        var next = new Dictionary<string, SecurityKey>(StringComparer.Ordinal);
        foreach (var jwk in jwks)
        {
            if (jwk is not { Kty: "EC", Crv: "P-256", Alg: "ES256" } || jwk.Use is not ("sig" or "") || string.IsNullOrEmpty(jwk.Kid))
                continue;
            try
            {
                var ecdsa = ECDsa.Create(new ECParameters
                {
                    Curve = ECCurve.NamedCurves.nistP256,
                    Q = new ECPoint { X = Base64UrlEncoder.DecodeBytes(jwk.X), Y = Base64UrlEncoder.DecodeBytes(jwk.Y) },
                });
                next[jwk.Kid] = new ECDsaSecurityKey(ecdsa) { KeyId = jwk.Kid };
            }
            catch (Exception e) when (e is CryptographicException or FormatException or ArgumentException)
            {
                // A malformed key is skipped; it can only make fewer badges verify, never more.
            }
        }

        // Replace wholesale: a key the vault no longer publishes stops being trusted.
        _keys = next;
        _keysFetchedAt = _time.GetUtcNow();
        foreach (var (k, v) in _cache)
            if (!next.ContainsKey(v.Kid)) _cache.TryRemove(k, out _);
        Succeed();
    }

    private void MaybeRefreshInBackground()
    {
        if (_time.GetUtcNow() - _keysFetchedAt < PeriodicRefreshInterval) return;
        if (Interlocked.CompareExchange(ref _backgroundRefreshing, 1, 0) != 0) return;
        _ = Task.Run(async () =>
        {
            try
            {
                using var cts = new CancellationTokenSource(SyncCallBudget);
                await RefreshKeysAsync(cts.Token).ConfigureAwait(false);
            }
            catch (Exception)
            {
                // Outage: keep the keys held. Retry on a later request.
                _keysFetchedAt = _time.GetUtcNow() - PeriodicRefreshInterval + TimeSpan.FromMinutes(1);
            }
            finally
            {
                Interlocked.Exchange(ref _backgroundRefreshing, 0);
            }
        });
    }

    // ----- state -----

    private void Succeed() => _status = new VaultBadgeStatus(true, "Leaf Vault is signing badges", _time.GetUtcNow());

    private void Fail(VaultUnavailableException e)
        => _status = new VaultBadgeStatus(false,
            e.Code == "vault_unavailable" ? "Leaf Vault unavailable" : $"Leaf Vault unavailable: {e.Message}",
            _status.LastSuccess);

    private T Sync<T>(Func<CancellationToken, Task<T>> call)
    {
        // The thread pool, not the caller's context: the UI dispatcher must never be what waits here.
        using var cts = new CancellationTokenSource(SyncCallBudget);
        try
        {
            return Task.Run(() => call(cts.Token)).GetAwaiter().GetResult();
        }
        catch (OperationCanceledException)
        {
            var e = new VaultUnavailableException("Leaf Vault unavailable");
            Fail(e);
            throw e;
        }
    }

    private void Sync(Func<CancellationToken, Task> call) => Sync<bool>(async ct => { await call(ct).ConfigureAwait(false); return true; });
}
