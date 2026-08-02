using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using RedBamboo.AppHost.Security;

namespace RedBamboo.AppHost.Auth;

public class GoogleTokenStore
{
    private readonly string _filePath;
    private readonly GoogleAuthOptions _googleOptions;
    private readonly HttpClient _httpClient;
    private readonly PortableSecretFileStore _secrets;
    private readonly SemaphoreSlim _lock = new(1, 1);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
    };

    private record TokenEntry(string? AccessToken, string? RefreshToken, DateTimeOffset ExpiresAt);
    private record RefreshResponse(string AccessToken, int ExpiresIn);

    public GoogleTokenStore(GoogleAuthOptions googleOptions, HttpClient httpClient)
    {
        _googleOptions = googleOptions;
        _httpClient = httpClient;

        var dir = googleOptions.DataDirectory
            ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "redsuite");
        Directory.CreateDirectory(dir);
        _filePath = Path.Combine(dir, "google-api-tokens.json");
        _secrets = PortableSecretStores.ForDirectory(dir);
    }

    public async Task StoreTokensAsync(string userId, string accessToken, string? refreshToken, DateTimeOffset expiresAt)
    {
        await _lock.WaitAsync();
        try
        {
            var store = Load();
            // Preserve existing refresh token if Google didn't issue a new one (happens on re-consent with same account)
            _secrets.Write(TokenAddress(userId, "access-token"), accessToken);
            if (refreshToken is not null)
                _secrets.Write(TokenAddress(userId, "refresh-token"), refreshToken);
            store[userId] = new TokenEntry(null, null, expiresAt);
            Save(store);
        }
        finally { _lock.Release(); }
    }

    public async Task<string?> GetValidAccessTokenAsync(string userId)
    {
        await _lock.WaitAsync();
        try
        {
            var store = Load();
            if (!store.TryGetValue(userId, out var entry)) return null;

            if (entry.ExpiresAt > DateTimeOffset.UtcNow.AddMinutes(2))
                return _secrets.Read(TokenAddress(userId, "access-token"));

            var refreshToken = _secrets.Read(TokenAddress(userId, "refresh-token"));
            if (refreshToken is null) return null;

            var refreshed = await RefreshInternalAsync(refreshToken);
            if (refreshed is null) return null;

            _secrets.Write(TokenAddress(userId, "access-token"), refreshed.AccessToken);
            var newEntry = new TokenEntry(null, null,
                DateTimeOffset.UtcNow.AddSeconds(refreshed.ExpiresIn - 60));
            store[userId] = newEntry;
            Save(store);
            return refreshed.AccessToken;
        }
        finally { _lock.Release(); }
    }

    private Dictionary<string, TokenEntry> Load()
    {
        if (!File.Exists(_filePath)) return new();
        try
        {
            var json = File.ReadAllText(_filePath);
            var store = JsonSerializer.Deserialize<Dictionary<string, TokenEntry>>(json, JsonOptions) ?? new();
            var migrated = false;
            foreach (var (userId, entry) in store.ToList())
            {
                if (!string.IsNullOrEmpty(entry.AccessToken))
                {
                    _secrets.Write(TokenAddress(userId, "access-token"), entry.AccessToken);
                    migrated = true;
                }
                if (!string.IsNullOrEmpty(entry.RefreshToken))
                {
                    _secrets.Write(TokenAddress(userId, "refresh-token"), entry.RefreshToken);
                    migrated = true;
                }
                if (migrated)
                    store[userId] = new TokenEntry(null, null, entry.ExpiresAt);
            }
            if (migrated) Save(store);
            return store;
        }
        catch { return new(); }
    }

    private static SecretAddress TokenAddress(string userId, string name)
        => SecretAddress.Bootstrap("google-token-" + Convert.ToHexStringLower(
            System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(userId))), name);

    private void Save(Dictionary<string, TokenEntry> store)
    {
        File.WriteAllText(_filePath, JsonSerializer.Serialize(store, JsonOptions));
    }

    private async Task<RefreshResponse?> RefreshInternalAsync(string refreshToken)
    {
        var payload = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["client_id"] = _googleOptions.ClientId,
            ["client_secret"] = _googleOptions.ClientSecret,
            ["refresh_token"] = refreshToken,
            ["grant_type"] = "refresh_token"
        });
        try
        {
            var response = await _httpClient.PostAsync("https://oauth2.googleapis.com/token", payload);
            response.EnsureSuccessStatusCode();
            var json = await response.Content.ReadFromJsonAsync<JsonElement>();
            var accessToken = json.TryGetProperty("access_token", out var at) ? at.GetString() : null;
            var expiresIn = json.TryGetProperty("expires_in", out var ei) ? ei.GetInt32() : 3600;
            return accessToken is null ? null : new RefreshResponse(accessToken, expiresIn);
        }
        catch { return null; }
    }
}
