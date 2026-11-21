using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace RedBamboo.AppHost.Auth;

/// <summary>
/// Refresh tokens as <c>refresh-token</c> entities in RedLeaf: <c>token_hash</c>, <c>user_id</c>, <c>expires_at</c>,
/// and, since device sessions, <c>family</c> (the session id), <c>rotated_at</c> and <c>replaced_by_hash</c>.
/// RedLeaf validates only declared fields, so the session keys are written before its seeds declare them.
/// Lookups by hash, family and user are <c>"Data" @&gt;</c> filters, which the GIN index on <c>Data</c> serves.
/// </summary>
public sealed class RedLeafRefreshTokenStore : IRefreshTokenStore
{
    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };

    /// <summary>The entity list route clamps to 500.</summary>
    internal const int PageSize = 500;

    /// <summary>A hard stop for a sweep whose deletes keep failing: 100 pages is 50 000 rows.</summary>
    internal const int MaxPages = 100;

    private readonly HttpClient _http;
    private readonly TimeProvider _clock;

    public RedLeafRefreshTokenStore(JwtService jwtService, PermissionDataSourceOptions options)
        : this(new SystemAccessTokenHandler(jwtService), options.RedLeafBaseUrl)
    {
    }

    internal RedLeafRefreshTokenStore(HttpMessageHandler handler, string baseUrl, TimeProvider? clock = null)
    {
        _http = new HttpClient(handler) { BaseAddress = new Uri(baseUrl.TrimEnd('/') + "/") };
        _clock = clock ?? TimeProvider.System;
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
            ["expires_at"] = Stamp(expiresAt),
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
        await PruneAsync();
    }

    public async Task<RefreshTokenValidation?> ValidateAsync(string token)
        => await FindAsync(token) is { RotatedAt: null } live ? live : null;

    public Task<RefreshTokenValidation?> FindAsync(string token) => FindByHashAsync(RefreshTokenHash.Of(token));

    public async Task<RefreshTokenValidation?> FindByHashAsync(string tokenHash)
    {
        var entity = await FindEntityByHashAsync(tokenHash);
        if (entity is null) return null;

        var data = ParseData(entity.Data);
        if (data is not { } d) return null;

        if (d.TryGetProperty("expires_at", out var exp) &&
            DateTimeOffset.TryParse(exp.GetString(), out var expiresAt) &&
            expiresAt <= _clock.GetUtcNow())
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
            ReplacedByHash = Text(d, "replaced_by_hash"),
        };
    }

    public async Task<RotationMark> MarkRotatedAsync(string entityId, string replacedByHash, DateTimeOffset rotatedAt,
        string? familyId = null, string? tokenHash = null)
    {
        if (!Guid.TryParse(entityId, out var id)) return RotationMark.Deleted;
        var fields = new Dictionary<string, string>
        {
            ["rotated_at"] = Stamp(rotatedAt),
            ["replaced_by_hash"] = replacedByHash,
        };
        if (familyId is not null) fields["family"] = familyId;
        HttpResponseMessage? response = null;
        try
        {
            response = await _http.PatchAsync($"api/entities/{id}/data",
                new StringContent(JsonSerializer.Serialize(fields), Encoding.UTF8, "application/json"));
        }
        catch (HttpRequestException) { }
        if (response is { IsSuccessStatusCode: true }) return RotationMark.Marked;
        // A 404 can also come from the route (an older kernel, a path mismatch, a proxy): only a lookup that
        // no longer finds the row makes it Missing. Anything else would end every session at every renewal.
        if (response?.StatusCode == System.Net.HttpStatusCode.NotFound && tokenHash is not null
            && await RowIsGoneAsync(id, tokenHash))
            return RotationMark.Missing;
        // An unmarked old token would stay usable with no reuse detection: delete it instead, as before families.
        await DeleteEntityAsync(id);
        return RotationMark.Deleted;
    }

    /// <summary>True only when the list route answered and the row with this hash is not among its rows.</summary>
    private async Task<bool> RowIsGoneAsync(Guid id, string tokenHash)
    {
        try
        {
            var response = await _http.GetAsync($"api/entities?type=refresh-token&data.token_hash={Uri.EscapeDataString(tokenHash)}&limit=1");
            if (!response.IsSuccessStatusCode) return false;
            var list = JsonSerializer.Deserialize<EntityListResponse>(await response.Content.ReadAsStringAsync(), JsonOpts);
            return list?.Items is not null && list.Items.All(item => item.Id != id);
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException or TaskCanceledException)
        {
            return false;
        }
    }

    public async Task RevokeByIdAsync(string entityId)
    {
        if (Guid.TryParse(entityId, out var id))
            await DeleteEntityAsync(id);
    }

    public async Task RevokeByTokenAsync(string token)
    {
        var entity = await FindEntityByHashAsync(RefreshTokenHash.Of(token));
        if (entity is not null)
            await DeleteEntityAsync(entity.Id);
    }

    public Task<bool> RevokeFamilyAsync(string familyId) => DeleteAllAsync("family", familyId);

    public Task<bool> RevokeAllForUserAsync(string userId) => DeleteAllAsync("user_id", userId);

    /// <summary>
    /// Deletes every row whose data key matches, page by page. Deleting shifts the rows up, so a page is
    /// re-read from the same offset while it yields rows to delete; rows whose delete failed are skipped, and
    /// a full page of nothing but those moves the offset past it. True only when a list finally came back
    /// empty with no delete failed: a failed list, a failed delete or the page limit all report false.
    /// </summary>
    private async Task<bool> DeleteAllAsync(string key, string value)
    {
        var encoded = Uri.EscapeDataString(value);
        var failed = new HashSet<Guid>();
        var offset = 0;
        for (var page = 0; page < MaxPages; page++)
        {
            var list = await ListAsync($"api/entities?type=refresh-token&data.{key}={encoded}&limit={PageSize}&offset={offset}");
            if (list is null) return false;
            if (list.Items is not { Count: > 0 } items) return failed.Count == 0;

            var progressed = false;
            foreach (var item in items)
            {
                if (failed.Contains(item.Id)) continue;
                progressed = true;
                if (!await DeleteEntityAsync(item.Id)) failed.Add(item.Id);
            }
            if (progressed) continue;
            if (items.Count < PageSize) return false;
            offset += items.Count;
        }
        return false;
    }

    /// <summary>
    /// Deletes up to <see cref="RefreshTokenRetention.PrunePerStore"/> dead rows of any user: expired ones first,
    /// then tokens rotated longer ago than <see cref="RefreshTokenRetention.RotatedKeptFor"/>. Both dates are
    /// stored as round-trip UTC strings (<see cref="Stamp"/>), so the list route's text comparison orders them.
    /// Best effort: nothing here fails the store.
    /// </summary>
    private async Task PruneAsync()
    {
        var now = _clock.GetUtcNow();
        var budget = RefreshTokenRetention.PrunePerStore;
        foreach (var (key, before) in new[] { ("expires_at", now), ("rotated_at", now - RefreshTokenRetention.RotatedKeptFor) })
        {
            if (budget == 0) return;
            var list = await ListAsync(
                $"api/entities?type=refresh-token&data.{key}__lt={Uri.EscapeDataString(Stamp(before))}&limit={budget}");
            foreach (var item in list?.Items ?? [])
            {
                if (budget == 0) return;
                await DeleteEntityAsync(item.Id);
                budget--;
            }
        }
    }

    /// <summary>Every date this store writes: round-trip format, UTC, so text order is time order.</summary>
    private static string Stamp(DateTimeOffset at) => at.ToUniversalTime().ToString("o");

    private async Task<EntityListResponse?> ListAsync(string url)
    {
        try
        {
            var response = await _http.GetAsync(url);
            if (!response.IsSuccessStatusCode) return null;
            return JsonSerializer.Deserialize<EntityListResponse>(await response.Content.ReadAsStringAsync(), JsonOpts);
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException or TaskCanceledException)
        {
            return null;
        }
    }

    // A transport failure throws, as before: renewal answers 5xx and the browser keeps its cookie.
    private async Task<EntityDto?> FindEntityByHashAsync(string hash)
    {
        var response = await _http.GetAsync($"api/entities?type=refresh-token&data.token_hash={Uri.EscapeDataString(hash)}&limit=1");
        if (!response.IsSuccessStatusCode) return null;
        var list = JsonSerializer.Deserialize<EntityListResponse>(await response.Content.ReadAsStringAsync(), JsonOpts);
        return list?.Items is { Count: > 0 } items ? items[0] : null;
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
