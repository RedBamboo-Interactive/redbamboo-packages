using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace RedBamboo.AppHost.Auth;

/// <summary>
/// Refresh tokens as <c>refresh-token</c> entities in RedLeaf: <c>token_hash</c>, <c>user_id</c>, <c>expires_at</c>,
/// and, since device sessions, <c>family</c> (the session id), <c>rotated_at</c> and <c>replaced_by_hash</c>.
/// RedLeaf validates only declared fields, so the session keys are written before its seeds declare them.
/// </summary>
public sealed class RedLeafRefreshTokenStore : IRefreshTokenStore
{
    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };

    /// <summary>The entity list route clamps to 500.</summary>
    internal const int PageSize = 500;

    /// <summary>A hard stop for a sweep whose deletes keep failing: 100 pages is 50 000 rows.</summary>
    internal const int MaxPages = 100;

    private readonly HttpClient _http;

    public RedLeafRefreshTokenStore(JwtService jwtService, PermissionDataSourceOptions options)
        : this(new SystemAccessTokenHandler(jwtService), options.RedLeafBaseUrl)
    {
    }

    internal RedLeafRefreshTokenStore(HttpMessageHandler handler, string baseUrl)
    {
        _http = new HttpClient(handler) { BaseAddress = new Uri(baseUrl.TrimEnd('/') + "/") };
    }

    public Task StoreAsync(string token, string userId, DateTimeOffset expiresAt)
        => StoreAsync(token, userId, expiresAt, null);

    public async Task StoreAsync(string token, string userId, DateTimeOffset expiresAt, string? familyId)
    {
        var hash = RefreshTokenHash.Of(token);
        var data = new Dictionary<string, object?>
        {
            ["token_hash"] = hash,
            ["user_id"] = userId,
            ["expires_at"] = expiresAt.ToString("o"),
        };
        if (familyId is not null) data["family"] = familyId;
        var payload = new
        {
            type_slug = "refresh-token",
            name = $"rt-{hash[..12]}",
            data,
        };
        var response = await _http.PostAsJsonAsync("api/entities", payload);
        response.EnsureSuccessStatusCode();
    }

    public async Task<RefreshTokenValidation?> ValidateAsync(string token)
        => await FindAsync(token) is { RotatedAt: null } live ? live : null;

    public async Task<RefreshTokenValidation?> FindAsync(string token)
    {
        var hash = RefreshTokenHash.Of(token);
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

        var userId = d.TryGetProperty("user_id", out var uid) ? uid.GetString() : null;
        if (userId is null) return null;
        return new RefreshTokenValidation(userId, entity.Id.ToString())
        {
            FamilyId = Text(d, "family"),
            RotatedAt = Text(d, "rotated_at") is { } rotated && DateTimeOffset.TryParse(rotated, out var at) ? at : null,
        };
    }

    public async Task MarkRotatedAsync(string entityId, string replacedByHash, DateTimeOffset rotatedAt)
    {
        if (!Guid.TryParse(entityId, out var id)) return;
        var patch = JsonSerializer.Serialize(new Dictionary<string, string>
        {
            ["rotated_at"] = rotatedAt.ToString("o"),
            ["replaced_by_hash"] = replacedByHash,
        });
        HttpResponseMessage? response = null;
        try
        {
            response = await _http.PatchAsync($"api/entities/{id}/data",
                new StringContent(patch, Encoding.UTF8, "application/json"));
        }
        catch (HttpRequestException) { }
        // An unmarked old token would stay usable with no reuse detection: delete it instead, as before families.
        if (response is not { IsSuccessStatusCode: true })
            await DeleteEntityAsync(id);
    }

    public async Task RevokeByIdAsync(string entityId)
    {
        if (Guid.TryParse(entityId, out var id))
            await DeleteEntityAsync(id);
    }

    public async Task RevokeByTokenAsync(string token)
    {
        var entity = await FindByHashAsync(RefreshTokenHash.Of(token));
        if (entity is not null)
            await DeleteEntityAsync(entity.Id);
    }

    public Task RevokeFamilyAsync(string familyId) => DeleteAllAsync("family", familyId);

    public Task RevokeAllForUserAsync(string userId) => DeleteAllAsync("user_id", userId);

    /// <summary>
    /// Deletes every row whose data key matches, page by page. Deleting shifts the rows up, so a page is
    /// re-read from the same offset while it yields rows to delete; rows whose delete failed are skipped, and
    /// a full page of nothing but those moves the offset past it.
    /// </summary>
    private async Task DeleteAllAsync(string key, string value)
    {
        var encoded = Uri.EscapeDataString(value);
        var failed = new HashSet<Guid>();
        var offset = 0;
        for (var page = 0; page < MaxPages; page++)
        {
            var response = await _http.GetAsync(
                $"api/entities?type=refresh-token&data.{key}={encoded}&limit={PageSize}&offset={offset}");
            if (!response.IsSuccessStatusCode) return;

            var list = JsonSerializer.Deserialize<EntityListResponse>(await response.Content.ReadAsStringAsync(), JsonOpts);
            if (list?.Items is not { Count: > 0 } items) return;

            var progressed = false;
            foreach (var item in items)
            {
                if (failed.Contains(item.Id)) continue;
                progressed = true;
                if (!await DeleteEntityAsync(item.Id)) failed.Add(item.Id);
            }
            if (progressed) continue;
            if (items.Count < PageSize) return;
            offset += items.Count;
        }
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

    private async Task<bool> DeleteEntityAsync(Guid id)
    {
        try
        {
            var response = await _http.DeleteAsync($"api/entities/{id}");
            return response.IsSuccessStatusCode || response.StatusCode == System.Net.HttpStatusCode.NotFound;
        }
        catch (HttpRequestException)
        {
            return false;
        }
    }

    private static string? Text(JsonElement data, string key)
        => data.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

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

    private record EntityDto(Guid Id, string? TypeSlug, string? Slug, string? Name, string? Data);
    private record EntityListResponse(List<EntityDto>? Items, int Total);
}
