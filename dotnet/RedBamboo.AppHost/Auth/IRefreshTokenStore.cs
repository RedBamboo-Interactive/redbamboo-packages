namespace RedBamboo.AppHost.Auth;

public interface IRefreshTokenStore
{
    Task StoreAsync(string token, string userId, DateTimeOffset expiresAt);
    Task<string?> ValidateAndGetUserIdAsync(string token);
    Task RevokeAsync(string token);
    Task RevokeAllForUserAsync(string userId);
}
