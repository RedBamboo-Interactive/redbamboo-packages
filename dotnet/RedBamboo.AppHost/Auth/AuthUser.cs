namespace RedBamboo.AppHost.Auth;

public record AuthUser(
    string Id,
    string Email,
    string? Name,
    string? AvatarUrl,
    string[] Roles,
    string? Status = null
)
{
    /// <summary>The user entity's <c>status</c> value that allows sign-in.</summary>
    public const string ActiveStatus = "active";

    /// <summary>Whether this account may sign in; see <see cref="IsActiveStatus"/>.</summary>
    public bool IsActive => IsActiveStatus(Status);

    /// <summary>
    /// The one sign-in rule for a user entity's <c>status</c>, shared by every login path. A user
    /// entity an administrator created without a status counts as active; any explicit value other
    /// than <c>active</c> (suspended, deleted, or anything unknown) does not.
    /// </summary>
    public static bool IsActiveStatus(string? status)
        => string.IsNullOrEmpty(status) || string.Equals(status, ActiveStatus, StringComparison.Ordinal);
}
