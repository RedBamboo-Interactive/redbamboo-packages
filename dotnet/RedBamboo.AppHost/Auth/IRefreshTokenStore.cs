namespace RedBamboo.AppHost.Auth;

public record RefreshTokenValidation(string UserId, string EntityId);

public interface IRefreshTokenStore
{
    Task StoreAsync(string token, string userId, DateTimeOffset expiresAt);
    Task<RefreshTokenValidation?> ValidateAsync(string token);
    Task RevokeByIdAsync(string entityId);
    Task RevokeByTokenAsync(string token);
    Task RevokeAllForUserAsync(string userId);
}
