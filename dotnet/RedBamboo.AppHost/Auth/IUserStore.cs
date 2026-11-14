namespace RedBamboo.AppHost.Auth;

public interface IUserStore
{
    Task<AuthUser?> FindByProviderAsync(string provider, string providerId);
    Task<AuthUser?> FindByIdAsync(string id);

    /// <summary>
    /// Resolves an external sign-in to an existing account and records the login. It fails closed:
    /// an identity with no account is let in only when an administrator created a user entity for its
    /// verified email ahead of time, or when there are no users at all and
    /// <paramref name="mayBootstrapFirstUser"/> is set (the first-user setup, from this machine). It
    /// throws <see cref="ExternalSignInDeniedException"/> for a refusal or a disabled account, and lets
    /// any store error propagate; neither may produce a session.
    /// </summary>
    Task<AuthUser> CreateOrUpdateFromExternalAsync(ExternalIdentity identity, bool mayBootstrapFirstUser = false);
}
