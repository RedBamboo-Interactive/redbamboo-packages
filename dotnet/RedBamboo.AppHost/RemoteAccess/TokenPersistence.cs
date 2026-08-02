using System.Security.Cryptography;
using System.Text.Json;
using RedBamboo.AppHost.Security;

namespace RedBamboo.AppHost.RemoteAccess;

public static class TokenPersistence
{
    private static readonly SecretAddress TokenAddress = SecretAddress.Bootstrap("remote-access", "access-token");

    public static string GenerateAccessToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(16);
        return Convert.ToHexStringLower(bytes);
    }

    public static void SaveToken(string configDir, string token)
    {
        PortableSecretStores.ForDirectory(configDir).Write(TokenAddress, token);
    }

    public static string? LoadToken(string configDir)
    {
        var store = PortableSecretStores.ForDirectory(configDir);
        var protectedValue = store.Read(TokenAddress);
        if (protectedValue is not null) return protectedValue;

        var path = Path.Combine(configDir, "remote-access.json");
        if (!File.Exists(path)) return null;
        try
        {
            var json = File.ReadAllText(path);
            using var doc = JsonDocument.Parse(json);
            var legacy = doc.RootElement.GetProperty("access_token").GetString();
            if (string.IsNullOrEmpty(legacy)) return null;
            store.Write(TokenAddress, legacy);
            File.Delete(path);
            return legacy;
        }
        catch
        {
            return null;
        }
    }
}
