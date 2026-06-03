namespace RedBamboo.AppHost.Auth;

public record AuthUser(
    string Id,
    string Email,
    string? Name,
    string? AvatarUrl,
    string[] Roles
);
