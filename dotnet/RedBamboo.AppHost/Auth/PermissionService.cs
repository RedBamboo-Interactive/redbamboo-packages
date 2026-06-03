using System.Collections.Concurrent;
using System.Security.Claims;
using System.Text.Json;

namespace RedBamboo.AppHost.Auth;

public sealed class PermissionService : IPermissionService
{
    private static readonly HashSet<string> AdminImpliedActions = ["read", "write", "delete"];

    private readonly IPermissionDataSource _dataSource;
    private readonly ConcurrentDictionary<string, PermissionGrant[]> _cache = new(StringComparer.OrdinalIgnoreCase);

    public bool IsLoaded { get; private set; }

    public PermissionService(IPermissionDataSource dataSource)
    {
        _dataSource = dataSource;
    }

    public async Task RefreshAsync()
    {
        var roles = await _dataSource.LoadRolesAsync();
        _cache.Clear();
        foreach (var role in roles)
            _cache[role.RoleSlug] = role.Grants;
        IsLoaded = true;
    }

    public bool CanAccess(ClaimsPrincipal user, string entityType, string action)
    {
        if (IsLocalDevUser(user))
            return true;

        if (!IsLoaded)
            return false;

        var roleSlugs = GetRoles(user);
        if (roleSlugs is null)
            return false;

        foreach (var slug in roleSlugs)
        {
            if (!_cache.TryGetValue(slug, out var grants))
                continue;

            foreach (var grant in grants)
            {
                if (grant.Scope is not null)
                    continue;

                if (GrantMatchesTypeAndAction(grant, entityType, action))
                    return true;
            }
        }

        return false;
    }

    public bool CanAccessOwned(ClaimsPrincipal user, string entityType, string action, string? entityCreatedBy)
    {
        if (CanAccess(user, entityType, action))
            return true;

        if (!IsLoaded)
            return false;

        var roleSlugs = GetRoles(user);
        if (roleSlugs is null)
            return false;

        var userId = user.FindFirstValue("sub");
        if (userId is null || entityCreatedBy is null || userId != entityCreatedBy)
            return false;

        foreach (var slug in roleSlugs)
        {
            if (!_cache.TryGetValue(slug, out var grants))
                continue;

            foreach (var grant in grants)
            {
                if (grant.Scope is not "own")
                    continue;

                if (GrantMatchesTypeAndAction(grant, entityType, action))
                    return true;
            }
        }

        return false;
    }

    private static bool GrantMatchesTypeAndAction(PermissionGrant grant, string entityType, string action)
    {
        if (grant.Type != "*" && !grant.Type.Equals(entityType, StringComparison.OrdinalIgnoreCase))
            return false;

        if (grant.Actions.Contains(action, StringComparer.OrdinalIgnoreCase))
            return true;

        if (grant.Actions.Contains("admin", StringComparer.OrdinalIgnoreCase)
            && AdminImpliedActions.Contains(action))
            return true;

        return false;
    }

    private static bool IsLocalDevUser(ClaimsPrincipal user)
    {
        return user.FindFirstValue("sub") == "local-user";
    }

    private static string[]? GetRoles(ClaimsPrincipal user)
    {
        var rolesClaim = user.FindFirstValue("roles");
        if (rolesClaim is null)
            return null;

        try
        {
            return JsonSerializer.Deserialize<string[]>(rolesClaim);
        }
        catch
        {
            return null;
        }
    }
}
