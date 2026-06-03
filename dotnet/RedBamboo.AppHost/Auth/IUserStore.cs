namespace RedBamboo.AppHost.Auth;

public interface IUserStore
{
    Task<AuthUser?> FindByProviderAsync(string provider, string providerId);
    Task<AuthUser?> FindByIdAsync(string id);
    Task<AuthUser> CreateOrUpdateFromExternalAsync(ExternalIdentity identity);
}
