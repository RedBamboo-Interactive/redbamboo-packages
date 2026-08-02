using System.Security.Cryptography;
using System.Text.Json;

namespace RedBamboo.AppHost.Security;

/// <summary>
/// Portable application keyring. Key material is deliberately outside application
/// databases; moving the key directory together with encrypted data is an explicit
/// installation migration operation.
/// </summary>
public sealed class PortableKeyRing
{
    private const int KeySize = 32;
    private readonly string _directory;
    private readonly string _manifestPath;
    private readonly string _lockPath;
    private readonly object _gate = new();

    private sealed record Manifest(int Version, string ActiveKeyId, DateTimeOffset UpdatedAt);

    public PortableKeyRing(string directory)
    {
        _directory = Path.GetFullPath(directory);
        _manifestPath = Path.Combine(_directory, "keyring.json");
        _lockPath = Path.Combine(_directory, ".keyring.lock");
        EnsureDirectory();
    }

    public (string KeyId, byte[] Key) GetActiveKey()
    {
        lock (_gate)
        {
            using var crossProcessLock = AcquireCrossProcessLock();
            var manifest = LoadManifest() ?? CreateActiveKey();
            return (manifest.ActiveKeyId, ReadKey(manifest.ActiveKeyId));
        }
    }

    public byte[] ReadKey(string keyId)
    {
        if (!Guid.TryParse(keyId, out var parsed))
            throw new SecretProtectionException(SecretProtectionFailure.InvalidEnvelope, "The secret key identifier is invalid.");

        var path = KeyPath(parsed.ToString("D"));
        if (!File.Exists(path))
            throw new SecretProtectionException(SecretProtectionFailure.MissingKey, $"Secret key '{keyId}' is unavailable.");

        var key = File.ReadAllBytes(path);
        if (key.Length != KeySize)
        {
            CryptographicOperations.ZeroMemory(key);
            throw new SecretProtectionException(SecretProtectionFailure.MissingKey, $"Secret key '{keyId}' is corrupt.");
        }
        return key;
    }

    private Manifest CreateActiveKey()
    {
        var id = Guid.NewGuid().ToString("D");
        var key = RandomNumberGenerator.GetBytes(KeySize);
        try
        {
            var keyPath = KeyPath(id);
            using (var stream = new FileStream(keyPath, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                       bufferSize: KeySize, FileOptions.WriteThrough))
            {
                stream.Write(key);
                stream.Flush(flushToDisk: true);
            }
            RestrictFile(keyPath);

            var manifest = new Manifest(1, id, DateTimeOffset.UtcNow);
            WriteManifest(manifest);
            return manifest;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(key);
        }
    }

    private Manifest? LoadManifest()
    {
        if (!File.Exists(_manifestPath)) return null;
        try
        {
            var manifest = JsonSerializer.Deserialize<Manifest>(File.ReadAllText(_manifestPath));
            if (manifest is null || manifest.Version != 1 || !Guid.TryParse(manifest.ActiveKeyId, out _))
                throw new JsonException("Invalid keyring manifest.");
            return manifest;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        {
            throw new SecretProtectionException(SecretProtectionFailure.MissingKey,
                "The secret keyring manifest is unreadable or corrupt.", ex);
        }
    }

    private void WriteManifest(Manifest manifest)
    {
        var tempPath = _manifestPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(tempPath, JsonSerializer.Serialize(manifest, new JsonSerializerOptions { WriteIndented = true }));
            RestrictFile(tempPath);
            File.Move(tempPath, _manifestPath, overwrite: true);
        }
        finally
        {
            if (File.Exists(tempPath)) File.Delete(tempPath);
        }
    }

    private string KeyPath(string id) => Path.Combine(_directory, id + ".key");

    private FileStream AcquireCrossProcessLock()
    {
        for (var attempt = 0; attempt < 100; attempt++)
        {
            try
            {
                var stream = new FileStream(_lockPath, FileMode.OpenOrCreate, FileAccess.ReadWrite,
                    FileShare.None, bufferSize: 1, FileOptions.WriteThrough);
                RestrictFile(_lockPath);
                return stream;
            }
            catch (IOException) when (attempt < 99)
            {
                Thread.Sleep(50);
            }
        }

        throw new SecretProtectionException(SecretProtectionFailure.MissingKey,
            "The secret keyring is busy and could not be locked.");
    }

    private void EnsureDirectory()
    {
        Directory.CreateDirectory(_directory);
        if (!OperatingSystem.IsWindows())
            File.SetUnixFileMode(_directory,
                UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        // On Windows this directory inherits the current user's LocalApplicationData ACL.
    }

    private static void RestrictFile(string path)
    {
        if (!OperatingSystem.IsWindows())
            File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
    }
}
