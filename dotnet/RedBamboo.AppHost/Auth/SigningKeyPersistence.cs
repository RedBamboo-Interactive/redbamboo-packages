using System.Security.Cryptography;
using System.Text.Json;
using RedBamboo.AppHost.Security;

namespace RedBamboo.AppHost.Auth;

public static class SigningKeyPersistence
{
    private static readonly SecretAddress SigningKeyAddress = SecretAddress.Bootstrap("auth", "jwt-signing-key");
    private static readonly SecretAddress GoogleSecretAddress = SecretAddress.Bootstrap("google-oauth", "client-secret");

    /// <summary>
    /// Legacy mode only. On a machine that has run in vault mode, or where the LeafVault service is
    /// installed, the shared key is retired for good: this refuses rather than read or regenerate it, so
    /// a vault outage can never turn into a silent new HS256 key.
    /// </summary>
    public static string EnsureSigningKey(string configDir, Func<bool>? serviceRegistered = null)
    {
        if (!Vault.BadgeSigningBootstrap.IsBypassed(configDir)
            && (Vault.BadgeSigningBootstrap.HasVaultModeMarker(configDir)
                || (serviceRegistered ?? Vault.BadgeSigningBootstrap.IsVaultServiceRegistered)()))
            throw new InvalidOperationException(
                "The shared badge key is retired on this machine: Leaf Vault signs badges. Start Leaf Vault instead of creating a key.");

        var existing = LoadSigningKey(configDir);
        if (existing is not null)
            return existing;

        var bytes = RandomNumberGenerator.GetBytes(64);
        var key = Convert.ToBase64String(bytes);
        SaveSigningKey(configDir, key);
        return key;
    }

    /// <summary>The shared key, or null when there is none or this machine has moved to vault mode.</summary>
    public static string? LoadSigningKey(string configDir)
    {
        if (Vault.BadgeSigningBootstrap.HasVaultModeMarker(configDir)) return null;
        var store = PortableSecretStores.ForDirectory(configDir);
        var protectedValue = store.Read(SigningKeyAddress);
        if (protectedValue is not null) return protectedValue;

        var path = Path.Combine(configDir, "auth-signing-key.json");
        if (!File.Exists(path)) return null;
        try
        {
            var json = File.ReadAllText(path);
            using var doc = JsonDocument.Parse(json);
            var legacy = doc.RootElement.GetProperty("signing_key").GetString();
            if (string.IsNullOrEmpty(legacy)) return null;
            store.Write(SigningKeyAddress, legacy);
            File.Delete(path);
            return legacy;
        }
        catch
        {
            return null;
        }
    }

    public static void SaveSigningKey(string configDir, string key)
    {
        PortableSecretStores.ForDirectory(configDir).Write(SigningKeyAddress, key);
    }

    public static GoogleAuthOptions? LoadGoogleOAuth(string configDir)
    {
        var path = Path.Combine(configDir, "google-oauth.json");
        if (!File.Exists(path)) return null;
        try
        {
            var json = File.ReadAllText(path);
            using var doc = JsonDocument.Parse(json);
            var clientId = doc.RootElement.GetProperty("client_id").GetString();
            var store = PortableSecretStores.ForDirectory(configDir);
            var clientSecret = store.Read(GoogleSecretAddress);
            if (clientSecret is null && doc.RootElement.TryGetProperty("client_secret", out var legacySecret))
            {
                clientSecret = legacySecret.GetString();
                if (!string.IsNullOrEmpty(clientSecret))
                {
                    store.Write(GoogleSecretAddress, clientSecret);
                    WriteGoogleMetadata(path, clientId);
                }
            }
            if (clientId is null || clientSecret is null) return null;
            return new GoogleAuthOptions { ClientId = clientId, ClientSecret = clientSecret };
        }
        catch
        {
            return null;
        }
    }

    public static void SaveGoogleOAuth(string configDir, string clientId, string clientSecret)
    {
        Directory.CreateDirectory(configDir);
        PortableSecretStores.ForDirectory(configDir).Write(GoogleSecretAddress, clientSecret);
        WriteGoogleMetadata(Path.Combine(configDir, "google-oauth.json"), clientId);
    }

    public static void DeleteGoogleOAuth(string configDir)
    {
        PortableSecretStores.ForDirectory(configDir).Delete(GoogleSecretAddress);
        var path = Path.Combine(configDir, "google-oauth.json");
        if (File.Exists(path)) File.Delete(path);
    }

    private static void WriteGoogleMetadata(string path, string? clientId)
    {
        var temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temp, JsonSerializer.Serialize(
                new { client_id = clientId }, new JsonSerializerOptions { WriteIndented = true }));
            File.Move(temp, path, overwrite: true);
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
        }
    }
}
