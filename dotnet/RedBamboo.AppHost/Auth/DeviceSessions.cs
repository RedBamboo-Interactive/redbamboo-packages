using System.Security.Cryptography;
using Microsoft.AspNetCore.Http;

namespace RedBamboo.AppHost.Auth;

/// <summary>
/// The session claim a browser badge carries. Its value is the device session id, which is also the
/// refresh-token family: every refresh token a sign-in rotates through belongs to it, and ending it ends
/// them all. Agents, services, automations and execution badges never carry one.
/// </summary>
public static class SessionClaims
{
    public const string SessionId = "sid";
}

/// <summary>
/// A request whose Authorization badge was expired or invalid and that went on as its session cookie (AuthMiddleware,
/// as before 0.1.50). The marked principal is the cookie's: hosts judge it as a cookie session, and it is never
/// person-present, because the caller meant to speak as its own badge.
/// </summary>
public static class HeaderBadgeFallback
{
    public const string Claim = "header_badge_ignored";

    public static bool Applied(System.Security.Claims.ClaimsPrincipal user)
        => user.HasClaim(claim => claim.Type == Claim);

    internal static void Mark(System.Security.Claims.ClaimsPrincipal user)
    {
        if (!Applied(user) && user.Identity is System.Security.Claims.ClaimsIdentity identity)
            identity.AddClaim(new System.Security.Claims.Claim(Claim, "true"));
    }
}

/// <summary>How a device session began. Recorded by the host's <see cref="IDeviceSessionHooks"/>.</summary>
public static class SignInMethods
{
    public const string Google = "google";
    public const string Password = "password";
    public const string FirstAdmin = "first-admin";
    public const string SetupCode = "setup-code";

    /// <summary>
    /// A refresh token stored before sessions existed, given a session the first time it renews. The host
    /// decides what that means (RedLeaf grandfathers it as approved).
    /// </summary>
    public const string Adopted = "adopted";
}

/// <summary>Why a device session ended. Passed to <see cref="IDeviceSessionHooks.EndAsync"/>.</summary>
public static class SessionEndReasons
{
    public const string SignedOut = "signed-out";
    public const string RefreshReused = "refresh-reused";
    public const string AccountDisabled = "account-disabled";
}

public enum DeviceSessionStatus
{
    /// <summary>The device may use the app.</summary>
    Approved,

    /// <summary>Signed in, waiting for approval from a device already in use. The host's gate limits it.</summary>
    Pending,

    /// <summary>Signed out, rejected, revoked or expired. Its badge and refresh tokens are dead.</summary>
    Ended,
}

/// <summary>Device session ids: <c>dev_</c> plus a ULID (time-ordered, 80 random bits).</summary>
public static class DeviceSessionIds
{
    public const string Prefix = "dev_";
    private const string Crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

    public static string New(DateTimeOffset? now = null)
    {
        var ms = (ulong)(now ?? DateTimeOffset.UtcNow).ToUnixTimeMilliseconds();
        Span<byte> random = stackalloc byte[10];
        RandomNumberGenerator.Fill(random);
        Span<char> chars = stackalloc char[26];
        for (var i = 9; i >= 0; i--)
        {
            chars[i] = Crockford[(int)(ms & 31)];
            ms >>= 5;
        }
        // 80 random bits as 16 base-32 digits.
        UInt128 bits = 0;
        foreach (var b in random) bits = (bits << 8) | b;
        for (var i = 25; i >= 10; i--)
        {
            chars[i] = Crockford[(int)(bits & 31)];
            bits >>= 5;
        }
        return Prefix + new string(chars);
    }

    public static bool IsSessionId(string? value)
    {
        if (value is null || value.Length != Prefix.Length + 26 || !value.StartsWith(Prefix, StringComparison.Ordinal))
            return false;
        foreach (var c in value.AsSpan(Prefix.Length))
            if (!Crockford.Contains(c)) return false;
        return true;
    }
}

/// <summary>
/// What the host knows about device sessions. AppHost issues badges and rotates refresh tokens; the host
/// keeps the session record, decides whether a new sign-in starts approved or pending, and learns when one
/// ends. A host that registers nothing gets <see cref="DefaultDeviceSessionHooks"/>: every session approved,
/// nothing recorded, which is exactly how sign-in behaved before sessions existed.
/// </summary>
public interface IDeviceSessionHooks
{
    /// <summary>
    /// A sign-in (or an <see cref="SignInMethods.Adopted"/> legacy refresh token) became session
    /// <paramref name="sessionId"/>. Called after the badge is signed and before any cookie is set.
    /// </summary>
    Task<DeviceSessionStatus> BeginAsync(HttpContext context, AuthUser user, string method, string sessionId);

    /// <summary>The session's state at renewal. <see cref="DeviceSessionStatus.Ended"/> refuses the refresh.</summary>
    Task<DeviceSessionStatus> StatusAsync(string sessionId, string userId);

    /// <summary>AppHost ended the session (sign-out, refresh-token reuse, disabled account).</summary>
    Task EndAsync(string sessionId, string userId, string reason);
}

/// <summary>No session records: every sign-in is approved, nothing is tracked. RedCompute runs on this.</summary>
public sealed class DefaultDeviceSessionHooks : IDeviceSessionHooks
{
    public static readonly DefaultDeviceSessionHooks Instance = new();

    public Task<DeviceSessionStatus> BeginAsync(HttpContext context, AuthUser user, string method, string sessionId)
        => Task.FromResult(DeviceSessionStatus.Approved);

    public Task<DeviceSessionStatus> StatusAsync(string sessionId, string userId)
        => Task.FromResult(DeviceSessionStatus.Approved);

    public Task EndAsync(string sessionId, string userId, string reason) => Task.CompletedTask;
}
