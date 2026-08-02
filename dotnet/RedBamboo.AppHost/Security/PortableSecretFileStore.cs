using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;

namespace RedBamboo.AppHost.Security;

/// <summary>
/// Small pre-database secret store. Every address is an independent atomic file,
/// avoiding a shared JSON read/modify/write race between suite processes.
/// </summary>
public sealed class PortableSecretFileStore
{
    private readonly string _valuesDirectory;
    private readonly ISecretProtector _protector;

    public PortableSecretFileStore(string dataDirectory)
    {
        var securityDirectory = Path.Combine(Path.GetFullPath(dataDirectory), "security");
        _valuesDirectory = Path.Combine(securityDirectory, "values");
        Directory.CreateDirectory(_valuesDirectory);
        if (!OperatingSystem.IsWindows())
            File.SetUnixFileMode(_valuesDirectory,
                UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        _protector = new AesGcmSecretProtector(
            new PortableKeyRing(Path.Combine(securityDirectory, "keys")));
    }

    public bool Exists(SecretAddress address) => File.Exists(PathFor(address));

    public string? Read(SecretAddress address)
    {
        var path = PathFor(address);
        if (!File.Exists(path)) return null;
        return _protector.Unprotect(address, File.ReadAllText(path));
    }

    public void Write(SecretAddress address, string plaintext)
    {
        ArgumentNullException.ThrowIfNull(plaintext);
        var path = PathFor(address);
        var temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temp, _protector.Protect(address, plaintext));
            if (!OperatingSystem.IsWindows())
                File.SetUnixFileMode(temp, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            File.Move(temp, path, overwrite: true);
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
        }
    }

    public void Delete(SecretAddress address)
    {
        var path = PathFor(address);
        if (File.Exists(path)) File.Delete(path);
    }

    private string PathFor(SecretAddress address)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(address.Canonical));
        return Path.Combine(_valuesDirectory, Convert.ToHexStringLower(hash) + ".secret");
    }
}

/// <summary>Process-local reuse of file stores and their keyrings.</summary>
public static class PortableSecretStores
{
    private static readonly ConcurrentDictionary<string, Lazy<PortableSecretFileStore>> Stores =
        new(StringComparer.OrdinalIgnoreCase);

    public static PortableSecretFileStore ForDirectory(string dataDirectory)
    {
        var fullPath = Path.GetFullPath(dataDirectory);
        return Stores.GetOrAdd(fullPath,
            path => new Lazy<PortableSecretFileStore>(() => new PortableSecretFileStore(path),
                LazyThreadSafetyMode.ExecutionAndPublication)).Value;
    }
}
