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
    string Provider
);
