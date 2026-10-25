using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.IdentityModel.Tokens;
using RedBamboo.AppHost.Auth.Vault;

namespace RedBamboo.AppHost.Tests.Auth;

/// <summary>
/// An in-process stand-in for Leaf Vault with a throwaway software P-256 key. It enforces the same
/// rules as the real signer: <c>net</c> required, the vault owns iat/exp, local badges last at most
/// 365 days and remote badges at most an hour. No real key material is involved anywhere in the tests.
/// </summary>
internal sealed class FakeBadgeVault : IBadgeVault
{
    private ECDsa _key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    private string _kid = "kid-1";
    private int _generation = 1;
    private readonly TimeProvider _time;

    public FakeBadgeVault(TimeProvider? time = null) => _time = time ?? TimeProvider.System;

    public bool Down { get; set; }
    public VaultReachability Reachability { get; set; } = VaultReachability.Reachable;
    public int SignCalls { get; private set; }
    public int JwksCalls { get; private set; }
    public string Kid => _kid;

    public void Rotate()
    {
        _generation++;
        _kid = $"kid-{_generation}";
        _key.Dispose();
        _key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    }

    public Task<VaultReachability> ProbeAsync(CancellationToken ct)
        => Task.FromResult(Down ? VaultReachability.Unavailable : Reachability);

    public Task<VaultSignedBadge> SignAsync(JsonElement claims, int lifetimeSeconds, CancellationToken ct)
    {
        if (Down) throw new VaultUnavailableException("Leaf Vault unavailable");
        SignCalls++;
        string? net = null;
        foreach (var c in claims.EnumerateObject())
        {
            if (c.Name is "iat" or "nbf" or "exp") throw new VaultUnavailableException($"'{c.Name}' is set by the vault", "invalid_claims");
            if (c.Name == "net") net = c.Value.GetString();
        }
        var cap = net switch { "local" => 365 * 24 * 3600, "remote" => 3600, _ => throw new VaultUnavailableException("claim 'net' is required", "invalid_claims") };
        if (lifetimeSeconds > cap) throw new VaultUnavailableException($"a '{net}' badge may last at most {cap} seconds", "lifetime_exceeds_cap");
        var now = _time.GetUtcNow().ToUnixTimeSeconds();
        var token = SignRaw(claims, now, now + lifetimeSeconds);
        return Task.FromResult(new VaultSignedBadge(token, _kid, DateTimeOffset.FromUnixTimeSeconds(now + lifetimeSeconds)));
    }

    /// <summary>Signs with the current key and no vault rules, to craft badges a real vault would refuse.</summary>
    public string SignRaw(JsonElement claims, long iat, long exp, string? alg = "ES256", string? kid = null)
    {
        var payload = new Dictionary<string, JsonElement>();
        foreach (var c in claims.EnumerateObject()) payload[c.Name] = c.Value.Clone();
        payload["iat"] = JsonSerializer.SerializeToElement(iat);
        payload["exp"] = JsonSerializer.SerializeToElement(exp);
        var header = Base64UrlEncoder.Encode(JsonSerializer.SerializeToUtf8Bytes(new { alg, typ = "JWT", kid = kid ?? _kid }));
        var input = header + "." + Base64UrlEncoder.Encode(JsonSerializer.SerializeToUtf8Bytes(payload));
        var sig = _key.SignData(Encoding.ASCII.GetBytes(input), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        return input + "." + Base64UrlEncoder.Encode(sig);
    }

    public Task<IReadOnlyList<VaultJwk>> JwksAsync(CancellationToken ct)
    {
        JwksCalls++;
        if (Down) throw new VaultUnavailableException("Leaf Vault unavailable");
        var p = _key.ExportParameters(false);
        IReadOnlyList<VaultJwk> keys = [new VaultJwk("EC", "P-256", Base64UrlEncoder.Encode(p.Q.X!), Base64UrlEncoder.Encode(p.Q.Y!), _kid, "sig", "ES256")];
        return Task.FromResult(keys);
    }
}

/// <summary>A clock the tests move by hand.</summary>
internal sealed class ManualTime : TimeProvider
{
    private DateTimeOffset _now = new(2026, 10, 25, 12, 0, 0, TimeSpan.Zero);
    public override DateTimeOffset GetUtcNow() => _now;
    public void Advance(TimeSpan by) => _now += by;
}
