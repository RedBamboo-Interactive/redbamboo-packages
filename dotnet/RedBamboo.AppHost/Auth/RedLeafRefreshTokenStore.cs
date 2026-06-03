using System.Net.Http;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace RedBamboo.AppHost.Auth;

public sealed class RedLeafRefreshTokenStore : IRefreshTokenStore
{
    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };

    private readonly HttpClient _http;

    public RedLeafRefreshTokenStore(JwtService jwtService, PermissionDataSourceOptions options)
    {
        var token = jwtService.GenerateAccessToken("system", "system@redsuite", "System", ["admin"]);
        _http = new HttpClient { BaseAddress = new Uri(options.RedLeafBaseUrl.TrimEnd('/') + "/") };
        _http.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", $"Bearer {token}");
    }

    public async Task StoreAsync(string token, string userId, DateTimeOffset expiresAt)
    {
        var hash = HashToken(token);
        var payload = new
        {
            type_slug = "refresh-token",
            name = $"rt-{hash[..12]}",
            data = new
            {
                token_hash = hash,
                user_id = userId,
                expires_at = expiresAt.ToString("o"),
            }
        };
        var response = await _http.PostAsJsonAsync("api/entities", payload);
        response.EnsureSuccessStatusCode();
    }

    public async Task<string?> ValidateAndGetUserIdAsync(string token)
    {
        var hash = HashToken(token);
        var entity = await FindByHashAsync(hash);
        if (entity is null) return null;

        var data = ParseData(entity.Data);
        if (data is not { } d) return null;

        if (d.TryGetProperty("expires_at", out var exp) &&
            DateTimeOffset.TryParse(exp.GetString(), out var expiresAt) &&
            expiresAt <= DateTimeOffset.UtcNow)
        {
            await DeleteEntityAsync(entity.Id);
            return null;
        }

        return d.TryGetProperty("user_id", out var uid) ? uid.GetString() : null;
    }

    public async Task RevokeAsync(string token)
    {
        var hash = HashToken(token);
        var entity = await FindByHashAsync(hash);
        if (entity is not null)
            await DeleteEntityAsync(entity.Id);
    }

    public async Task RevokeAllForUserAsync(string userId)
    {
        var encoded = Uri.EscapeDataString(userId);
        var response = await _http.GetAsync($"api/entities?type=refresh-token&data.user_id={encoded}&limit=100");
        if (!response.IsSuccessStatusCode) return;

        var json = await response.Content.ReadAsStringAsync();
        var list = JsonSerializer.Deserialize<EntityListResponse>(json, JsonOpts);
        if (list?.Items is null) return;

        foreach (var item in list.Items)
            await DeleteEntityAsync(item.Id);
    }

    private async Task<EntityDto?> FindByHashAsync(string hash)
    {
        var encoded = Uri.EscapeDataString(hash);
        var response = await _http.GetAsync($"api/entities?type=refresh-token&data.token_hash={encoded}&limit=1");
        if (!response.IsSuccessStatusCode) return null;

        var json = await response.Content.ReadAsStringAsync();
        var list = JsonSerializer.Deserialize<EntityListResponse>(json, JsonOpts);
        return list?.Items is { Count: > 0 } ? list.Items[0] : null;
    }

    private async Task DeleteEntityAsync(Guid id) =>
        await _http.DeleteAsync($"api/entities/{id}");

    private static JsonElement? ParseData(string? data)
    {
        if (string.IsNullOrEmpty(data)) return null;
        try
        {
            return JsonDocument.Parse(data).RootElement;
        }
        catch
        {
            return null;
        }
    }

    private static string HashToken(string token)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(token));
        return Convert.ToHexStringLower(bytes);
    }

    private record EntityDto(Guid Id, string? TypeSlug, string? Slug, string? Name, string? Data);
    private record EntityListResponse(List<EntityDto>? Items, int Total);
}
