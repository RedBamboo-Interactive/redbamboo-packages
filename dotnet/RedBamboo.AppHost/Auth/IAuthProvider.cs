namespace RedBamboo.AppHost.Auth;

public interface IAuthProvider
{
    string Name { get; }
    string GetAuthorizeUrl(string redirectUri, string state);
    Task<ExternalIdentity> ExchangeCodeAsync(string code, string redirectUri);
}

public record ExternalIdentity(
    string ProviderId,
    string Email,
    string? Name,
    string? AvatarUrl,
    string Provider,
    string? AccessToken = null,
    string? RefreshToken = null,
    int ExpiresIn = 0,
    // Whether the provider vouches that the account owns Email. Only a verified email can claim a
    // user entity an administrator created ahead of time.
    bool EmailVerified = false
);
