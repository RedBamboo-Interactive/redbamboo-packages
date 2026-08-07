using System.Security.Cryptography;
using System.Text.Json;
using RedBamboo.AppHost.Security;

namespace RedBamboo.AppHost.RemoteAccess;

public static class TokenPersistence
{
    private static readonly SecretAddress AccessTokenAddress = SecretAddress.Bootstrap("remote-access", "access-token");
    private static readonly SecretAddress TunnelTokenAddress = SecretAddress.Bootstrap("remote-access", "tunnel-token");

    public static string GenerateAccessToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(16);
        return Convert.ToHexStringLower(bytes);
    }

    public static void SaveToken(string configDir, string token)
    {
        PortableSecretStores.ForDirectory(configDir).Write(AccessTokenAddress, token);
    }

    public static string? LoadToken(string configDir)
    {
        var store = PortableSecretStores.ForDirectory(configDir);
        var protectedValue = store.Read(AccessTokenAddress);
        if (protectedValue is not null) return protectedValue;

        var path = Path.Combine(configDir, "remote-access.json");
        if (!File.Exists(path)) return null;
        try
        {
            var json = File.ReadAllText(path);
            using var doc = JsonDocument.Parse(json);
            var legacy = doc.RootElement.GetProperty("access_token").GetString();
            if (string.IsNullOrEmpty(legacy)) return null;
            store.Write(AccessTokenAddress, legacy);
            File.Delete(path);
            return legacy;
        }
        catch
        {
            return null;
        }
    }

    public static void SaveTunnelToken(string configDir, string token)
        => PortableSecretStores.ForDirectory(configDir).Write(TunnelTokenAddress, token);

    public static string? LoadTunnelToken(string configDir)
        => PortableSecretStores.ForDirectory(configDir).Read(TunnelTokenAddress);

    public static void DeleteTunnelToken(string configDir)
        => PortableSecretStores.ForDirectory(configDir).Delete(TunnelTokenAddress);
}
