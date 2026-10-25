using System.IO.Pipes;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

namespace RedBamboo.AppHost.Auth.Vault;

/// <summary>What the badge code needs from Leaf Vault. A fake implements this in tests.</summary>
public interface IBadgeVault
{
    Task<VaultSignedBadge> SignAsync(JsonElement claims, int lifetimeSeconds, CancellationToken ct);
    Task<IReadOnlyList<VaultJwk>> JwksAsync(CancellationToken ct);

    /// <summary>Whether the vault answers on its control pipe and the pipe belongs to the Leaf Vault service.</summary>
    Task<VaultReachability> ProbeAsync(CancellationToken ct);
}

public sealed record VaultSignedBadge(string Token, string Kid, DateTimeOffset ExpiresAt);

public sealed record VaultJwk(string Kty, string Crv, string X, string Y, string Kid, string Use, string Alg);

public enum VaultReachability
{
    /// <summary>Answered, and the pipe is owned by the Leaf Vault service.</summary>
    Reachable,
    /// <summary>Nothing is listening on the pipe (not installed, stopped, or restarting).</summary>
    Unavailable,
    /// <summary>Something else created the pipe; it is never talked to.</summary>
    Impostor,
}

/// <summary>
/// A vault call failed. The message is plain words fit for a health page and never carries a
/// badge, a claim value or key material.
/// </summary>
public sealed class VaultUnavailableException(string message, string code = "vault_unavailable") : Exception(message)
{
    public string Code { get; } = code;
}

/// <summary>
/// The three control-pipe operations badges need (<c>sign-jwt</c>, <c>jwks</c>, <c>health</c>),
/// speaking Leaf Vault's protocol version 1: a 4-byte little-endian length then UTF-8 JSON, one
/// connection per call. Before sending anything the client checks that the pipe is owned by the
/// <c>NT SERVICE\LeafVault</c> service SID, so a process that squatted the pipe name never sees a
/// claim. This is a deliberate minimal copy of <c>Leaf.Vault.Client</c> (T:/Projects/leaf-vault),
/// kept inside AppHost so the suite needs no new project reference or package; the wire constants
/// are pinned against the vault's by a contract test.
/// </summary>
public sealed class VaultPipeClient : IBadgeVault
{
    public const int ProtocolVersion = 1;
    public const string DefaultPipeName = "leaf-vault";
    public const string ServiceName = "LeafVault";
    private const int MaxFrameBytes = 64 * 1024;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly string _pipeName;
    private readonly SecurityIdentifier? _expectedOwner;
    private readonly TimeSpan _timeout;

    public VaultPipeClient(string pipeName = DefaultPipeName, SecurityIdentifier? expectedOwner = null, TimeSpan? timeout = null)
    {
        _pipeName = pipeName;
        _expectedOwner = expectedOwner;
        _timeout = timeout ?? TimeSpan.FromSeconds(5);
    }

    /// <summary>
    /// The per-service SID Windows gives <c>NT SERVICE\{serviceName}</c>: S-1-5-80 followed by the
    /// SHA-1 of the upper-cased UTF-16LE name as five little-endian integers.
    /// </summary>
    [SupportedOSPlatform("windows")]
    public static SecurityIdentifier ServiceSid(string serviceName)
    {
        var hash = SHA1.HashData(Encoding.Unicode.GetBytes(serviceName.ToUpperInvariant()));
        var parts = new uint[5];
        for (var i = 0; i < 5; i++) parts[i] = BitConverter.ToUInt32(hash, i * 4);
        return new SecurityIdentifier("S-1-5-80-" + string.Join("-", parts));
    }

    public async Task<VaultSignedBadge> SignAsync(JsonElement claims, int lifetimeSeconds, CancellationToken ct)
    {
        var result = await CallAsync("sign-jwt", new { claims, lifetimeSeconds }, ct).ConfigureAwait(false);
        var token = result.TryGetProperty("token", out var t) ? t.GetString() : null;
        var kid = result.TryGetProperty("kid", out var k) ? k.GetString() : null;
        if (string.IsNullOrEmpty(token) || string.IsNullOrEmpty(kid) || !result.TryGetProperty("expiresAt", out var exp))
            throw new VaultUnavailableException("Leaf Vault returned an unusable badge", "bad_response");
        return new VaultSignedBadge(token, kid, exp.GetDateTimeOffset());
    }

    public async Task<IReadOnlyList<VaultJwk>> JwksAsync(CancellationToken ct)
    {
        var result = await CallAsync("jwks", new { }, ct).ConfigureAwait(false);
        var keys = new List<VaultJwk>();
        if (!result.TryGetProperty("keys", out var array) || array.ValueKind != JsonValueKind.Array)
            throw new VaultUnavailableException("Leaf Vault returned an unusable key list", "bad_response");
        foreach (var key in array.EnumerateArray())
        {
            string Text(string name) => key.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : "";
            keys.Add(new VaultJwk(Text("kty"), Text("crv"), Text("x"), Text("y"), Text("kid"), Text("use"), Text("alg")));
        }
        return keys;
    }

    public async Task<VaultReachability> ProbeAsync(CancellationToken ct)
    {
        try
        {
            await CallAsync("health", new { }, ct).ConfigureAwait(false);
            return VaultReachability.Reachable;
        }
        catch (VaultUnavailableException e) when (e.Code == "vault_impostor")
        {
            return VaultReachability.Impostor;
        }
        catch (VaultUnavailableException)
        {
            return VaultReachability.Unavailable;
        }
    }

    private Task<JsonElement> CallAsync(string op, object args, CancellationToken ct)
        => OperatingSystem.IsWindows()
            ? CallWindowsAsync(op, args, ct)
            : throw new VaultUnavailableException("Leaf Vault is only available on Windows");

    [SupportedOSPlatform("windows")]
    private async Task<JsonElement> CallWindowsAsync(string op, object args, CancellationToken ct)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(_timeout);
        await using var pipe = new NamedPipeClientStream(".", _pipeName, PipeDirection.InOut,
            PipeOptions.Asynchronous, TokenImpersonationLevel.Identification);
        try
        {
            await pipe.ConnectAsync(cts.Token).ConfigureAwait(false);
        }
        catch (Exception e) when (e is TimeoutException or IOException or UnauthorizedAccessException
                                      or OperationCanceledException && !ct.IsCancellationRequested)
        {
            throw new VaultUnavailableException("Leaf Vault unavailable");
        }

        var owner = pipe.GetAccessControl().GetOwner(typeof(SecurityIdentifier));
        if (owner is null || !owner.Equals(_expectedOwner ?? ServiceSid(ServiceName)))
            throw new VaultUnavailableException(
                "the vault pipe is not owned by the Leaf Vault service; refusing to talk to it", "vault_impostor");

        try
        {
            var request = JsonSerializer.SerializeToUtf8Bytes(new { v = ProtocolVersion, op, args }, Json);
            await WriteFrameAsync(pipe, request, cts.Token).ConfigureAwait(false);
            var frame = await ReadFrameAsync(pipe, cts.Token).ConfigureAwait(false)
                ?? throw new VaultUnavailableException("Leaf Vault closed the connection");
            using var doc = JsonDocument.Parse(frame);
            var root = doc.RootElement;
            if (root.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True
                && root.TryGetProperty("result", out var result))
                return result.Clone();

            // The vault's own refusal text is plain words and never echoes a claim value.
            string? code = null, message = null;
            if (root.TryGetProperty("error", out var error) && error.ValueKind == JsonValueKind.Object)
            {
                code = error.TryGetProperty("code", out var c) ? c.GetString() : null;
                message = error.TryGetProperty("message", out var m) ? m.GetString() : null;
            }
            throw new VaultUnavailableException(message ?? "Leaf Vault refused the request", code ?? "vault_refused");
        }
        catch (Exception e) when (e is IOException or OperationCanceledException or JsonException
                                      && !ct.IsCancellationRequested)
        {
            throw new VaultUnavailableException("Leaf Vault unavailable");
        }
    }

    private static async Task WriteFrameAsync(Stream stream, byte[] payload, CancellationToken ct)
    {
        if (payload.Length > MaxFrameBytes)
            throw new VaultUnavailableException("the badge request is too large for the vault", "frame_too_large");
        var header = new byte[4];
        BitConverter.TryWriteBytes(header, (uint)payload.Length);
        if (!BitConverter.IsLittleEndian) Array.Reverse(header);
        await stream.WriteAsync(header, ct).ConfigureAwait(false);
        await stream.WriteAsync(payload, ct).ConfigureAwait(false);
        await stream.FlushAsync(ct).ConfigureAwait(false);
    }

    private static async Task<byte[]?> ReadFrameAsync(Stream stream, CancellationToken ct)
    {
        var header = new byte[4];
        var got = await ReadAtMostAsync(stream, header, ct).ConfigureAwait(false);
        if (got == 0) return null;
        if (got < 4) throw new VaultUnavailableException("Leaf Vault sent a truncated reply", "bad_frame");
        if (!BitConverter.IsLittleEndian) Array.Reverse(header);
        var length = BitConverter.ToUInt32(header);
        if (length > MaxFrameBytes) throw new VaultUnavailableException("Leaf Vault sent an oversized reply", "bad_frame");
        var payload = new byte[length];
        if (await ReadAtMostAsync(stream, payload, ct).ConfigureAwait(false) < length)
            throw new VaultUnavailableException("Leaf Vault sent a truncated reply", "bad_frame");
        return payload;
    }

    private static async Task<int> ReadAtMostAsync(Stream stream, byte[] buffer, CancellationToken ct)
    {
        var total = 0;
        while (total < buffer.Length)
        {
            var n = await stream.ReadAsync(buffer.AsMemory(total), ct).ConfigureAwait(false);
            if (n == 0) break;
            total += n;
        }
        return total;
    }
}
