using System.Security.Claims;

namespace RedBamboo.AppHost.Auth;

public interface IPermissionService
{
    bool CanAccess(ClaimsPrincipal user, string entityType, string action);
    bool CanAccessOwned(ClaimsPrincipal user, string entityType, string action, string? entityCreatedBy);
    Task RefreshAsync();
    bool IsLoaded { get; }
}
