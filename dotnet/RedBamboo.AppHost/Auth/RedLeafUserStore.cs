using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;

namespace RedBamboo.AppHost.Auth;

public sealed class RedLeafUserStore : IUserStore
{
    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };

    /// <summary>RedLeaf's list clamp. Sign-in reads every user in one page or refuses to decide.</summary>
    private const int UserPageLimit = 500;

    private readonly HttpClient _http;

    public RedLeafUserStore(JwtService jwtService, PermissionDataSourceOptions options)
        : this(new HttpClient(new SystemAccessTokenHandler(jwtService))
        {
            BaseAddress = new Uri(options.RedLeafBaseUrl.TrimEnd('/') + "/"),
        })
    {
    }

    internal RedLeafUserStore(HttpClient http)
    {
        _http = http;
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

    public async Task<AuthUser> CreateOrUpdateFromExternalAsync(ExternalIdentity identity, bool mayBootstrapFirstUser = false)
    {
        // One strict read of every user decides the whole sign-in. Any failure here throws: an
        // unreadable user list must never look like an empty one.
        var users = await ReadAllUsersAsync();

        var existing = users.FirstOrDefault(u =>
            string.Equals(u.Provider, identity.Provider, StringComparison.Ordinal)
            && string.Equals(u.ProviderId, identity.ProviderId, StringComparison.Ordinal));
        if (existing is not null)
            return await RecordLoginAsync(existing, identity, bindProvider: false);

        // An administrator lets someone in by creating their user entity with the email they sign in
        // with; only administrators can write user entities. The first sign-in binds the provider
        // account to it, so the email is trusted once, and only when the provider verified it.
        if (identity.EmailVerified && !string.IsNullOrWhiteSpace(identity.Email))
        {
            var provisioned = users
                .Where(u => string.IsNullOrEmpty(u.ProviderId)
                    && (string.IsNullOrEmpty(u.Provider) || string.Equals(u.Provider, identity.Provider, StringComparison.Ordinal))
                    && string.Equals(u.User.Email.Trim(), identity.Email.Trim(), StringComparison.OrdinalIgnoreCase))
                .ToList();
            if (provisioned.Count > 1)
                throw new ExternalSignInDeniedException(ExternalSignInDeniedException.NotAllowed,
                    $"{provisioned.Count} user entities wait for {identity.Email}; an administrator must remove the duplicates.");
            if (provisioned.Count == 1)
                return await RecordLoginAsync(provisioned[0], identity, bindProvider: true);
        }

        if (users.Count > 0 || !mayBootstrapFirstUser)
            throw new ExternalSignInDeniedException(ExternalSignInDeniedException.NotAllowed,
                $"No account on this installation is set up for {identity.Email}.");

        return await CreateFirstAdminAsync(identity);
    }

    private async Task<AuthUser> RecordLoginAsync(StoredUser stored, ExternalIdentity identity, bool bindProvider)
    {
        // Checked before anything is written: a disabled account stays exactly as its administrator
        // left it, status included.
        if (!stored.User.IsActive)
            throw new ExternalSignInDeniedException(ExternalSignInDeniedException.AccountDisabled,
                $"The account for {identity.Email} is {stored.User.Status}.");

        // Merge only the fields sign-in owns. A whole-data PUT would erase fields other owners keep
        // on the User, such as a plugin's discord_user_id link. Roles and status stay with their
        // administrators.
        var loginFields = new Dictionary<string, object?>
        {
            ["email"] = identity.Email,
            ["display_name"] = identity.Name,
            ["avatar_url"] = identity.AvatarUrl,
            ["last_login_at"] = DateTimeOffset.UtcNow.ToString("o"),
        };
        if (bindProvider)
        {
            loginFields["auth_provider"] = identity.Provider;
            loginFields["provider_id"] = identity.ProviderId;
        }
        (await _http.PatchAsJsonAsync($"api/entities/{stored.User.Id}/data", loginFields)).EnsureSuccessStatusCode();

        // A name-only PUT leaves data untouched.
        (await _http.PutAsJsonAsync($"api/entities/{stored.User.Id}",
            new { name = identity.Name ?? stored.User.Name ?? identity.Email })).EnsureSuccessStatusCode();

        return stored.User with
        {
            Email = identity.Email,
            Name = identity.Name,
            AvatarUrl = identity.AvatarUrl,
        };
    }

    private async Task<AuthUser> CreateFirstAdminAsync(ExternalIdentity identity)
    {
        string[] roles = ["admin"];
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
                status = AuthUser.ActiveStatus,
                last_login_at = DateTimeOffset.UtcNow.ToString("o"),
            }
        };

        var response = await _http.PostAsJsonAsync("api/entities", createPayload);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        var created = JsonSerializer.Deserialize<EntityDto>(json, JsonOpts)
            ?? throw new InvalidOperationException("RedLeaf returned no entity for the created user.");

        return new AuthUser(created.Id.ToString(), identity.Email, identity.Name, identity.AvatarUrl, roles,
            AuthUser.ActiveStatus);
    }

    private async Task<List<StoredUser>> ReadAllUsersAsync()
    {
        var response = await _http.GetAsync($"api/entities?type=user&limit={UserPageLimit}");
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        var list = JsonSerializer.Deserialize<EntityListResponse>(json, JsonOpts)
            ?? throw new InvalidOperationException("RedLeaf returned no user list.");
        var items = list.Items ?? throw new InvalidOperationException("RedLeaf returned a user list without items.");
        if (list.Total != items.Count)
            throw new InvalidOperationException(
                $"RedLeaf listed {items.Count} of {list.Total} users; sign-in needs all of them in one read.");

        var users = new List<StoredUser>(items.Count);
        foreach (var entity in items)
        {
            if (entity.TypeSlug is not null && entity.TypeSlug != "user") continue;
            var user = ToAuthUser(entity)
                ?? throw new InvalidOperationException($"User entity {entity.Id} has unreadable data.");
            using var data = JsonDocument.Parse(entity.Data!);
            users.Add(new StoredUser(user,
                ReadString(data.RootElement, "auth_provider"),
                ReadString(data.RootElement, "provider_id")));
        }
        return users;
    }

    private static string? ReadString(JsonElement data, string property)
        => data.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

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

            return new AuthUser(entity.Id.ToString(), email, name, avatarUrl, roles, ReadString(data, "status"));
        }
        catch
        {
            return null;
        }
    }

    private sealed record StoredUser(AuthUser User, string? Provider, string? ProviderId);
    private record EntityDto(Guid Id, string? TypeSlug, string? Slug, string? Name, string? Data);
    private record EntityListResponse(List<EntityDto>? Items, int Total);
}
