using System.Security.Cryptography;
using System.Text;

namespace RedBamboo.AppHost.Auth;

/// <summary>
/// A stored refresh token. <see cref="FamilyId"/> is its device session (null on a row stored before
/// sessions existed); <see cref="RotatedAt"/> is set once the token was exchanged for its successor.
/// </summary>
public record RefreshTokenValidation(string UserId, string EntityId)
{
    public string? FamilyId { get; init; }
    public DateTimeOffset? RotatedAt { get; init; }
}

public interface IRefreshTokenStore
{
    /// <summary>A token with no session family (sign-in code written before sessions existed).</summary>
    Task StoreAsync(string token, string userId, DateTimeOffset expiresAt);

    /// <summary>A token in the refresh family <paramref name="familyId"/> (its device session).</summary>
    Task StoreAsync(string token, string userId, DateTimeOffset expiresAt, string? familyId);

    /// <summary>The live token: not expired, not rotated. Null otherwise.</summary>
    Task<RefreshTokenValidation?> ValidateAsync(string token);

    /// <summary>The token if it is not expired, rotated or not. Null when unknown or expired.</summary>
    Task<RefreshTokenValidation?> FindAsync(string token);

    /// <summary>
    /// The token was exchanged: keep it, marked, so a second use is recognised as reuse. A store that cannot
    /// mark it deletes it instead (reuse then looks like an unknown token, as before families).
    /// </summary>
    Task MarkRotatedAsync(string entityId, string replacedByHash, DateTimeOffset rotatedAt);

    Task RevokeByIdAsync(string entityId);
    Task RevokeByTokenAsync(string token);

    /// <summary>Every token of the family, rotated or live.</summary>
    Task RevokeFamilyAsync(string familyId);

    /// <summary>Every token of the user, however many there are.</summary>
    Task RevokeAllForUserAsync(string userId);
}

public static class RefreshTokenHash
{
    /// <summary>The hash stores keep instead of the token: lower-case hex SHA-256.</summary>
    public static string Of(string token) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}
