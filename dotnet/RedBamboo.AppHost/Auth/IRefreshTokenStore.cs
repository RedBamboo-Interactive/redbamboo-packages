using System.Security.Cryptography;
using System.Text;

namespace RedBamboo.AppHost.Auth;

/// <summary>
/// A stored refresh token. <see cref="FamilyId"/> is its device session (null on a row stored before
/// sessions existed); <see cref="RotatedAt"/> is set once the token was exchanged for its successor, whose
/// hash is <see cref="ReplacedByHash"/>.
/// </summary>
public record RefreshTokenValidation(string UserId, string EntityId)
{
    public string? FamilyId { get; init; }
    public DateTimeOffset? RotatedAt { get; init; }
    public string? ReplacedByHash { get; init; }
}

/// <summary>What <see cref="IRefreshTokenStore.MarkRotatedAsync"/> did with the old token.</summary>
public enum RotationMark
{
    /// <summary>Kept and marked rotated.</summary>
    Marked,

    /// <summary>The store could not mark it and deleted it instead (reuse then looks like an unknown token).</summary>
    Deleted,

    /// <summary>
    /// The row is confirmed gone: its family was revoked while the renewal was in flight. A store reports this
    /// only when it knows the row no longer exists, never from an error that could mean anything else.
    /// </summary>
    Missing,
}

public interface IRefreshTokenStore
{
    /// <summary>A token with no session family (sign-in code written before sessions existed).</summary>
    Task StoreAsync(string token, string userId, DateTimeOffset expiresAt);

    /// <summary>
    /// A token in the refresh family <paramref name="familyId"/> (its device session). A store may also
    /// delete a bounded number of dead rows here (see <see cref="RefreshTokenRetention"/>).
    /// </summary>
    Task StoreAsync(string token, string userId, DateTimeOffset expiresAt, string? familyId);

    /// <summary>The live token: not expired, not rotated. Null otherwise.</summary>
    Task<RefreshTokenValidation?> ValidateAsync(string token);

    /// <summary>The token if it is not expired, rotated or not. Null when unknown or expired.</summary>
    Task<RefreshTokenValidation?> FindAsync(string token);

    /// <summary><see cref="FindAsync"/> by the stored hash (<see cref="RefreshTokenHash.Of"/>), for a successor.</summary>
    Task<RefreshTokenValidation?> FindByHashAsync(string tokenHash);

    /// <summary>
    /// The token was exchanged: keep it, marked, so a second use is recognised as reuse. A store that cannot
    /// mark it deletes it instead. <paramref name="familyId"/>, when given, is written on the row too: the
    /// family a token from before sessions was adopted into, so its own reuse ends that family.
    /// <paramref name="tokenHash"/> is the marked token's own hash, for a store that must confirm a row is gone
    /// before it reports <see cref="RotationMark.Missing"/>.
    /// </summary>
    Task<RotationMark> MarkRotatedAsync(string entityId, string replacedByHash, DateTimeOffset rotatedAt,
        string? familyId = null, string? tokenHash = null);

    Task RevokeByIdAsync(string entityId);
    Task RevokeByTokenAsync(string token);

    /// <summary>Every token of the family, rotated or live. False when some may remain (a list or delete failed).</summary>
    Task<bool> RevokeFamilyAsync(string familyId);

    /// <summary>Every token of the user, however many there are. False when some may remain.</summary>
    Task<bool> RevokeAllForUserAsync(string userId);
}

public static class RefreshTokenHash
{
    /// <summary>The hash stores keep instead of the token: lower-case hex SHA-256.</summary>
    public static string Of(string token) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}

/// <summary>How long stores keep rows that can no longer renew anything.</summary>
public static class RefreshTokenRetention
{
    /// <summary>
    /// A rotated token is kept this long after its rotation so presenting it again is recognised (reuse, or a
    /// lost response); after that it is pruned, and presenting it is an unknown token: it still renews nothing.
    /// </summary>
    public static readonly TimeSpan RotatedKeptFor = TimeSpan.FromDays(7);

    /// <summary>At most this many dead rows (expired, or rotated longer ago than <see cref="RotatedKeptFor"/>) are deleted per store.</summary>
    public const int PrunePerStore = 20;
}
