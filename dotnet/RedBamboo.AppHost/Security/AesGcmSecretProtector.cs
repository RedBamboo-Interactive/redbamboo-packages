using System.Security.Cryptography;
using System.Text;

namespace RedBamboo.AppHost.Security;

public sealed class AesGcmSecretProtector : ISecretProtector
{
    private const string Prefix = "rls1:";
    private const int NonceSize = 12;
    private const int TagSize = 16;
    private readonly PortableKeyRing _keyRing;

    public AesGcmSecretProtector(PortableKeyRing keyRing) => _keyRing = keyRing;

    public bool IsProtected(string? value) => value?.StartsWith(Prefix, StringComparison.Ordinal) == true;

    public string? TryGetKeyId(string? envelope)
    {
        if (!IsProtected(envelope)) return null;
        var separator = envelope!.IndexOf(':', Prefix.Length);
        return separator > Prefix.Length ? envelope[Prefix.Length..separator] : null;
    }

    public string Protect(SecretAddress address, string plaintext)
    {
        ArgumentNullException.ThrowIfNull(plaintext);
        var (keyId, key) = _keyRing.GetActiveKey();
        var plainBytes = Encoding.UTF8.GetBytes(plaintext);
        var aad = Encoding.UTF8.GetBytes(address.Canonical);
        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var ciphertext = new byte[plainBytes.Length];
        var tag = new byte[TagSize];

        try
        {
            using var aes = new AesGcm(key, TagSize);
            aes.Encrypt(nonce, plainBytes, ciphertext, tag, aad);
            var payload = new byte[nonce.Length + ciphertext.Length + tag.Length];
            nonce.CopyTo(payload, 0);
            ciphertext.CopyTo(payload, nonce.Length);
            tag.CopyTo(payload, nonce.Length + ciphertext.Length);
            return $"{Prefix}{keyId}:{Base64UrlEncode(payload)}";
        }
        finally
        {
            CryptographicOperations.ZeroMemory(key);
            CryptographicOperations.ZeroMemory(plainBytes);
        }
    }

    public string Unprotect(SecretAddress address, string envelope)
    {
        var parsed = Parse(envelope);
        var key = _keyRing.ReadKey(parsed.KeyId);
        var aad = Encoding.UTF8.GetBytes(address.Canonical);
        var plaintext = new byte[parsed.Ciphertext.Length];
        try
        {
            using var aes = new AesGcm(key, TagSize);
            aes.Decrypt(parsed.Nonce, parsed.Ciphertext, parsed.Tag, plaintext, aad);
            return Encoding.UTF8.GetString(plaintext);
        }
        catch (AuthenticationTagMismatchException ex)
        {
            throw new SecretProtectionException(SecretProtectionFailure.AuthenticationFailed,
                "The protected value failed authentication.", ex);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(key);
            CryptographicOperations.ZeroMemory(plaintext);
        }
    }

    private static (string KeyId, byte[] Nonce, byte[] Ciphertext, byte[] Tag) Parse(string envelope)
    {
        if (!envelope.StartsWith(Prefix, StringComparison.Ordinal))
            throw new SecretProtectionException(SecretProtectionFailure.InvalidEnvelope, "The value is not a protected secret envelope.");

        var separator = envelope.IndexOf(':', Prefix.Length);
        if (separator < 0)
            throw new SecretProtectionException(SecretProtectionFailure.InvalidEnvelope, "The protected secret envelope is malformed.");

        var keyId = envelope[Prefix.Length..separator];
        if (!Guid.TryParse(keyId, out _))
            throw new SecretProtectionException(SecretProtectionFailure.InvalidEnvelope, "The protected secret key identifier is invalid.");

        byte[] payload;
        try { payload = Base64UrlDecode(envelope[(separator + 1)..]); }
        catch (FormatException ex)
        {
            throw new SecretProtectionException(SecretProtectionFailure.InvalidEnvelope, "The protected secret payload is malformed.", ex);
        }
        if (payload.Length < NonceSize + TagSize)
            throw new SecretProtectionException(SecretProtectionFailure.InvalidEnvelope, "The protected secret payload is truncated.");

        return (
            keyId,
            payload[..NonceSize],
            payload[NonceSize..^TagSize],
            payload[^TagSize..]);
    }

    private static string Base64UrlEncode(byte[] value)
        => Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] Base64UrlDecode(string value)
    {
        var padded = value.Replace('-', '+').Replace('_', '/');
        padded += (padded.Length % 4) switch { 2 => "==", 3 => "=", _ => "" };
        return Convert.FromBase64String(padded);
    }
}
