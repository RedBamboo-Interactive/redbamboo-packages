using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace RedBamboo.AppHost.Auth;

/// <summary>
/// The one place a browser session is issued: a new device session for a sign-in, and the cookies for
/// it and for each renewal. Every sign-in route (external provider, local password, first admin) goes
/// through <see cref="IssueAsync"/>, so the session id, the refresh family and the cookie rules cannot drift
/// between copies.
/// </summary>
public static class SignInSessions
{
    public sealed record Issued(string SessionId, DeviceSessionStatus Status);

    /// <summary>
    /// Signs the badge for a new session, tells the host about the session, stores the first refresh token
    /// of its family and sets both cookies. A vault outage refuses before anything is recorded (503,
    /// <paramref name="failure"/> set). A refresh store that throws still signs the person in, without
    /// renewal, as before.
    /// </summary>
    public static async Task<(Issued? Session, IResult? Failure)> IssueAsync(HttpContext context, AuthUser user,
        string method, JwtService jwt, IRefreshTokenStore refreshTokens, AuthOptions options,
        IDeviceSessionHooks? hooks = null, ILogger? logger = null)
    {
        hooks ??= DefaultDeviceSessionHooks.Instance;
        var sessionId = DeviceSessionIds.New();

        string accessToken;
        try
        {
            accessToken = jwt.GenerateBrowserAccessToken(user.Id, user.Email, user.Name, user.Roles, user.AvatarUrl, sessionId);
        }
        catch (Vault.VaultUnavailableException)
        {
            return (null, VaultUnavailable());
        }

        var status = await hooks.BeginAsync(context, user, method, sessionId);

        var refreshToken = jwt.GenerateRefreshToken();
        try
        {
            await refreshTokens.StoreAsync(refreshToken, user.Id, DateTimeOffset.UtcNow.Add(options.Jwt!.RefreshTokenLifetime), sessionId);
        }
        catch (Exception ex)
        {
            // Renewal won't work for this session, but the sign-in itself still proceeds.
            logger?.LogWarning("Sign-in for {Sub} could not store its refresh token: {Error}", user.Id, ex.GetType().Name);
        }

        AppendCookies(context, options, jwt, accessToken, refreshToken);
        return (new Issued(sessionId, status), null);
    }

    /// <summary>The access and refresh cookies, with the rules every issue and renewal shares.</summary>
    internal static void AppendCookies(HttpContext context, AuthOptions options, JwtService jwt,
        string accessToken, string refreshToken)
    {
        var isSecure = context.Request.IsHttps;

        context.Response.Cookies.Append(options.CookieName, accessToken, new CookieOptions
        {
            HttpOnly = true,
            Secure = isSecure,
            SameSite = SameSiteMode.Lax,
            Path = "/",
            MaxAge = jwt.BrowserAccessTokenLifetime
        });

        context.Response.Cookies.Append(options.RefreshCookieName, refreshToken, new CookieOptions
        {
            HttpOnly = true,
            Secure = isSecure,
            SameSite = isSecure ? SameSiteMode.Strict : SameSiteMode.Lax,
            Path = "/auth/refresh",
            MaxAge = options.Jwt!.RefreshTokenLifetime
        });
    }

    internal static void ClearCookies(HttpContext context, AuthOptions options)
    {
        context.Response.Cookies.Delete(options.CookieName, new CookieOptions { Path = "/" });
        context.Response.Cookies.Delete(options.RefreshCookieName, new CookieOptions { Path = "/auth/refresh" });
    }

    /// <summary>Plain words, and a 5xx so the web client treats it as transient rather than as a logout.</summary>
    internal static IResult VaultUnavailable()
        => Results.Json(new { error = "vault_unavailable", message = "Leaf Vault unavailable. Sign-in works again as soon as it is back." }, statusCode: 503);
}
