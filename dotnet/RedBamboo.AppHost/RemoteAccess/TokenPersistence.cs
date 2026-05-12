using System.Security.Cryptography;
using System.Text.Json;

namespace RedBamboo.AppHost.RemoteAccess;

public static class TokenPersistence
{
    public static string GenerateAccessToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(16);
        return Convert.ToHexStringLower(bytes);
    }

    public static void SaveToken(string configDir, string token)
    {
        Directory.CreateDirectory(configDir);
        var path = Path.Combine(configDir, "remote-access.json");
        var data = new { access_token = token };
        File.WriteAllText(path, JsonSerializer.Serialize(data, new JsonSerializerOptions { WriteIndented = true }));
    }

    public static string? LoadToken(string configDir)
    {
        var path = Path.Combine(configDir, "remote-access.json");
        if (!File.Exists(path)) return null;
        try
        {
            var json = File.ReadAllText(path);
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.GetProperty("access_token").GetString();
        }
        catch
        {
            return null;
        }
    }
}
