using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;

namespace RedBamboo.AppHost.Auth;

public sealed class RedLeafUserStore : IUserStore
{
    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };

    private readonly HttpClient _http;

    public RedLeafUserStore(JwtService jwtService, PermissionDataSourceOptions options)
    {
        var token = jwtService.GenerateAccessToken("system", "system@redsuite", "System", ["admin"]);
        _http = new HttpClient { BaseAddress = new Uri(options.RedLeafBaseUrl.TrimEnd('/') + "/") };
        _http.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", $"Bearer {token}");
    }

    public async Task<AuthUser?> FindByProviderAsync(string provider, string providerId)
    {
        var encoded = Uri.EscapeDataString(providerId);
        var provEncoded = Uri.EscapeDataString(provider);
        var response = await _http.GetAsync(
            $"api/entities?type=user&data.auth_provider={provEncoded}&data.provider_id={encoded}&limit=1");
        if (!response.IsSuccessStatusCode) return null;

        var json = await response.Content.ReadAsStringAsync();
        var list = JsonSerializer.Deserialize<EntityListResponse>(json, JsonOpts);
        if (list?.Items is not { Count: > 0 }) return null;

        return ToAuthUser(list.Items[0]);
    }

    public async Task<AuthUser?> FindByIdAsync(string id)
    {
        var response = await _http.GetAsync($"api/entities/{id}");
        if (!response.IsSuccessStatusCode) return null;

        var json = await response.Content.ReadAsStringAsync();
        var entity = JsonSerializer.Deserialize<EntityDto>(json, JsonOpts);
        if (entity is null || entity.TypeSlug != "user") return null;

        return ToAuthUser(entity);
    }

    public async Task<AuthUser> CreateOrUpdateFromExternalAsync(ExternalIdentity identity)
    {
        var existing = await FindByProviderAsync(identity.Provider, identity.ProviderId);
        if (existing is not null)
        {
            var updatePayload = new
            {
                name = identity.Name ?? existing.Name ?? identity.Email,
                data = new
                {
                    email = identity.Email,
                    display_name = identity.Name,
                    avatar_url = identity.AvatarUrl,
                    auth_provider = identity.Provider,
                    provider_id = identity.ProviderId,
                    roles = JsonSerializer.Serialize(existing.Roles),
                    status = "active",
                    last_login_at = DateTimeOffset.UtcNow.ToString("o"),
                }
            };
            await _http.PutAsJsonAsync($"api/entities/{existing.Id}", updatePayload);

            return existing with
            {
                Email = identity.Email,
                Name = identity.Name,
                AvatarUrl = identity.AvatarUrl,
            };
        }

        var isFirstUser = await IsFirstUserAsync();
        var roles = isFirstUser ? new[] { "admin" } : new[] { "viewer" };

        var createPayload = new
        {
            type_slug = "user",
            name = identity.Name ?? identity.Email,
            data = new
            {
                email = identity.Email,
                display_name = identity.Name,
                avatar_url = identity.AvatarUrl,
                auth_provider = identity.Provider,
                provider_id = identity.ProviderId,
                roles = JsonSerializer.Serialize(roles),
                status = "active",
                last_login_at = DateTimeOffset.UtcNow.ToString("o"),
            }
        };

        var response = await _http.PostAsJsonAsync("api/entities", createPayload);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        var created = JsonSerializer.Deserialize<EntityDto>(json, JsonOpts);

        return new AuthUser(
            created!.Id.ToString(),
            identity.Email,
            identity.Name,
            identity.AvatarUrl,
            roles
        );
    }

    private async Task<bool> IsFirstUserAsync()
    {
        var response = await _http.GetAsync("api/entities?type=user&limit=1");
        if (!response.IsSuccessStatusCode) return true;

        var json = await response.Content.ReadAsStringAsync();
        var list = JsonSerializer.Deserialize<EntityListResponse>(json, JsonOpts);
        return list is null || list.Total == 0;
    }

    private static AuthUser? ToAuthUser(EntityDto entity)
    {
        if (string.IsNullOrEmpty(entity.Data)) return null;

        try
        {
            var data = JsonDocument.Parse(entity.Data).RootElement;
            var email = data.TryGetProperty("email", out var e) ? e.GetString() ?? "" : "";
            var name = data.TryGetProperty("display_name", out var n) ? n.GetString() : entity.Name;
            var avatarUrl = data.TryGetProperty("avatar_url", out var a) ? a.GetString() : null;

            string[] roles = ["viewer"];
            if (data.TryGetProperty("roles", out var r))
            {
                var rolesStr = r.GetString();
                if (rolesStr is not null)
                {
                    var parsed = JsonSerializer.Deserialize<string[]>(rolesStr);
                    if (parsed is not null) roles = parsed;
                }
            }

            return new AuthUser(entity.Id.ToString(), email, name, avatarUrl, roles);
        }
        catch
        {
            return null;
        }
    }

    private record EntityDto(Guid Id, string? TypeSlug, string? Slug, string? Name, string? Data);
    private record EntityListResponse(List<EntityDto>? Items, int Total);
}
