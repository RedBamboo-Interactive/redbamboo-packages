namespace RedBamboo.AppHost.Auth;

public interface IPermissionDataSource
{
    Task<List<RolePermissions>> LoadRolesAsync();
}
