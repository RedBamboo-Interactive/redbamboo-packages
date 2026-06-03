namespace RedBamboo.AppHost.Auth;

public record PermissionGrant(string Type, string[] Actions, string? Scope = null);

public record PermissionSet(PermissionGrant[] Grants);

public record RolePermissions(string RoleSlug, PermissionGrant[] Grants);
