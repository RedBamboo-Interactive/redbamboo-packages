using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;

namespace RedBamboo.AppHost.Auth;

public class GoogleTokenStore
{
    private readonly string _filePath;
    private readonly GoogleAuthOptions _googleOptions;
    private readonly HttpClient _httpClient;
    private readonly SemaphoreSlim _lock = new(1, 1);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
    };

    private record TokenEntry(string AccessToken, string? RefreshToken, DateTimeOffset ExpiresAt);
    private record RefreshResponse(string AccessToken, int ExpiresIn);

    public GoogleTokenStore(GoogleAuthOptions googleOptions, HttpClient httpClient)
    {
        _googleOptions = googleOptions;
        _httpClient = httpClient;

        var dir = googleOptions.DataDirectory
            ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "redsuite");
        Directory.CreateDirectory(dir);
        _filePath = Path.Combine(dir, "google-api-tokens.json");
    }

    public async Task StoreTokensAsync(string userId, string accessToken, string? refreshToken, DateTimeOffset expiresAt)
    {
        await _lock.WaitAsync();
        try
        {
            var store = Load();
            // Preserve existing refresh token if Google didn't issue a new one (happens on re-consent with same account)
            if (refreshToken is null && store.TryGetValue(userId, out var existing))
                refreshToken = existing.RefreshToken;
            store[userId] = new TokenEntry(accessToken, refreshToken, expiresAt);
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
                return entry.AccessToken;

            if (entry.RefreshToken is null) return null;

            var refreshed = await RefreshInternalAsync(entry.RefreshToken);
            if (refreshed is null) return null;

            var newEntry = new TokenEntry(
                refreshed.AccessToken,
                entry.RefreshToken,
                DateTimeOffset.UtcNow.AddSeconds(refreshed.ExpiresIn - 60)
            );
            store[userId] = newEntry;
            Save(store);
            return newEntry.AccessToken;
        }
        finally { _lock.Release(); }
    }

    private Dictionary<string, TokenEntry> Load()
    {
        if (!File.Exists(_filePath)) return new();
        try
        {
            var json = File.ReadAllText(_filePath);
            return JsonSerializer.Deserialize<Dictionary<string, TokenEntry>>(json, JsonOptions) ?? new();
        }
        catch { return new(); }
    }

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
