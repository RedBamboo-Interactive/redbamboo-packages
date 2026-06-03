using System.Security.Cryptography;
using System.Text.Json;

namespace RedBamboo.AppHost.Auth;

public static class SigningKeyPersistence
{
    public static string EnsureSigningKey(string configDir)
    {
        var existing = LoadSigningKey(configDir);
        if (existing is not null)
            return existing;

        var bytes = RandomNumberGenerator.GetBytes(64);
        var key = Convert.ToBase64String(bytes);
        SaveSigningKey(configDir, key);
        return key;
    }

    public static string? LoadSigningKey(string configDir)
    {
        var path = Path.Combine(configDir, "auth-signing-key.json");
        if (!File.Exists(path)) return null;
        try
        {
            var json = File.ReadAllText(path);
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.GetProperty("signing_key").GetString();
        }
        catch
        {
            return null;
        }
    }

    public static void SaveSigningKey(string configDir, string key)
    {
        Directory.CreateDirectory(configDir);
        var path = Path.Combine(configDir, "auth-signing-key.json");
        var data = new { signing_key = key };
        File.WriteAllText(path, JsonSerializer.Serialize(data, new JsonSerializerOptions { WriteIndented = true }));
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
            var clientSecret = doc.RootElement.GetProperty("client_secret").GetString();
            if (clientId is null || clientSecret is null) return null;
            return new GoogleAuthOptions { ClientId = clientId, ClientSecret = clientSecret };
        }
        catch
        {
            return null;
        }
    }
}
