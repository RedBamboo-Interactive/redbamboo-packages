namespace RedBamboo.AppHost.Security;

public interface ISecretProtector
{
    string Protect(SecretAddress address, string plaintext);
    string Unprotect(SecretAddress address, string envelope);
    bool IsProtected(string? value);
    string? TryGetKeyId(string? envelope);
}

public enum SecretProtectionFailure
{
    InvalidEnvelope,
    UnsupportedVersion,
    MissingKey,
    AuthenticationFailed,
}

public sealed class SecretProtectionException : Exception
{
    public SecretProtectionFailure Failure { get; }

    public SecretProtectionException(SecretProtectionFailure failure, string message, Exception? inner = null)
        : base(message, inner)
    {
        Failure = failure;
    }
}
