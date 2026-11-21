using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using RedBamboo.AppHost.Discovery;

namespace RedBamboo.AppHost.Auth;

public static class AuthEndpoints
{
    private static string SanitizeReturnUrl(string? returnUrl)
    {
        if (string.IsNullOrEmpty(returnUrl)) return "/";
        if (!returnUrl.StartsWith('/')) return "/";
        if (returnUrl.StartsWith("//")) return "/";
        if (returnUrl.Contains("://")) return "/";
        return returnUrl;
    }

    public static void Map(EndpointRegistry registry) => Map(registry, serveLoginPage: true);

    /// <param name="serveLoginPage">
    /// False when the app renders its own sign-in screen at /login. The built-in page offers only the
    /// external provider, so an app with password accounts must not let it answer /login: a signed-out
    /// password user would be sent to a page with no way back in (field report, RedLeaf 0.1.49).
    /// </param>
    public static void Map(EndpointRegistry registry, bool serveLoginPage)
    {
        if (serveLoginPage)
        {
            registry.MapGet("/login", "Login page",
                (HttpContext context) =>
                {
                    return Results.Content(LoginPage.Render(), "text/html");
                });
        }

        registry.MapGet("/auth/login", "Initiate OAuth login flow",
            (HttpContext context, IServiceProvider sp, AuthOptions options) =>
            {
                var provider = sp.GetService<IAuthProvider>();
                if (provider is null)
                    return Results.Content("<html><body><h1>OAuth not configured</h1><p>No authentication provider is available. Running in local-only mode.</p></body></html>", "text/html");

                var returnUrl = SanitizeReturnUrl(context.Request.Query["returnUrl"].FirstOrDefault());
                var state = Guid.NewGuid().ToString("N");

                var cookieOptions = new CookieOptions
                {
                    HttpOnly = true,
                    Secure = true,
                    SameSite = SameSiteMode.Lax,
                    MaxAge = TimeSpan.FromMinutes(10)
                };
                context.Response.Cookies.Append("redsuite_auth_state", state, cookieOptions);
                context.Response.Cookies.Append("redsuite_auth_return", returnUrl, cookieOptions);

                var scheme = context.Request.Scheme;
                var host = context.Request.Host;
                var redirectUri = $"{scheme}://{host}/auth/callback";
                var authorizeUrl = provider.GetAuthorizeUrl(redirectUri, state);

                return Results.Redirect(authorizeUrl);
            })
            .WithParam("returnUrl", "string", description: "URL to redirect to after login");

        registry.MapGet("/auth/callback", "OAuth callback handler",
            async (HttpContext context, IServiceProvider sp, IUserStore userStore,
                JwtService jwtService, IRefreshTokenStore refreshTokenStore, AuthOptions options) =>
            {
                var provider = sp.GetService<IAuthProvider>();
                if (provider is null)
                    return Results.BadRequest(new { error = "not_configured", message = "No authentication provider is available." });
                var code = context.Request.Query["code"].FirstOrDefault();
                var state = context.Request.Query["state"].FirstOrDefault();
                var expectedState = context.Request.Cookies["redsuite_auth_state"];

                if (string.IsNullOrEmpty(code) || string.IsNullOrEmpty(state) ||
                    !string.Equals(state, expectedState, StringComparison.Ordinal))
                {
                    return Results.BadRequest(new { error = "invalid_state", message = "State mismatch or missing code." });
                }

                var scheme = context.Request.Scheme;
                var host = context.Request.Host;
                var redirectUri = $"{scheme}://{host}/auth/callback";

                var identity = await provider.ExchangeCodeAsync(code, redirectUri);
                return await CompleteExternalSignInAsync(context, identity, sp, userStore, jwtService,
                    refreshTokenStore, options);
            });

        registry.MapPost("/auth/refresh", "Refresh access token",
            (HttpContext context, IRefreshTokenStore refreshTokenStore,
                IUserStore userStore, JwtService jwtService, AuthOptions options, IServiceProvider sp) =>
                RefreshAsync(context, refreshTokenStore, userStore, jwtService, options,
                    sp.GetService<IDeviceSessionHooks>(), logger: sp.GetService<ILoggerFactory>()?.CreateLogger("auth")));

        registry.MapPost("/auth/logout", "Log out and clear tokens",
            (HttpContext context, IRefreshTokenStore refreshTokenStore, AuthOptions options, IServiceProvider sp) =>
                LogoutAsync(context, refreshTokenStore, options, sp.GetService<IDeviceSessionHooks>()));

        registry.MapGet("/auth/me", "Get current user info",
            async (HttpContext context, IServiceProvider sp) =>
            {
                var sub = context.User.FindFirstValue("sub");
                if (sub is null)
                    return Results.Json(new { error = "not_authenticated" }, statusCode: 401);

                var email = context.User.FindFirstValue("email") ?? "";
                var name = context.User.FindFirstValue("name");
                var roleClaims = context.User.FindAll("roles").Select(c => c.Value).ToList();
                string[] roles;
                if (roleClaims.Count == 1 && roleClaims[0].StartsWith('['))
                    roles = System.Text.Json.JsonSerializer.Deserialize<string[]>(roleClaims[0]) ?? [];
                else if (roleClaims.Count > 0)
                    roles = roleClaims.ToArray();
                else
                    roles = [];

                var avatarUrl = context.User.FindFirst("picture")?.Value;
                var device = await DeviceAsync(context, sub, sp.GetService<IDeviceSessionHooks>());

                return Results.Ok(new { id = sub, email, name, roles, avatarUrl, device });
            });

        registry.MapGet("/auth/execution-context",
            "Inspect the current request's verified suite execution identity. Returns identity: null for an ordinary user or service token; signed app, actor, beneficiary, context, parent, and expiry for an execution token.",
            (HttpContext context) =>
            {
                var expiresAt = long.TryParse(
                    context.User.FindFirstValue(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Exp),
                    out var exp)
                    ? DateTimeOffset.FromUnixTimeSeconds(exp)
                    : (DateTimeOffset?)null;
                return Results.Ok(new
                {
                    authenticated = context.User.Identity?.IsAuthenticated == true,
                    subjectId = context.User.FindFirstValue(
                        System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub),
                    tokenUse = context.User.FindFirstValue(ExecutionIdentityClaims.TokenUseClaim)
                        ?? "user",
                    expiresAt,
                    identity = ExecutionContextScope.Current,
                });
            })
            .WithAuth("jwt");

        registry.MapGet("/auth/google/calendar", "Get Google Calendar events for the current user",
            async (HttpContext context, IServiceProvider sp) =>
            {
                var proxy = sp.GetService<GoogleApiProxy>();
                if (proxy is null)
                    return Results.Json(new { error = "not_configured" }, statusCode: 503);

                var userId = context.User.FindFirstValue("sub");
                if (userId is null)
                    return Results.Json(new { error = "not_authenticated" }, statusCode: 401);

                DateTimeOffset timeMin, timeMax;
                if (!DateTimeOffset.TryParse(context.Request.Query["timeMin"].FirstOrDefault(), out timeMin))
                    timeMin = DateTimeOffset.UtcNow;
                if (!DateTimeOffset.TryParse(context.Request.Query["timeMax"].FirstOrDefault(), out timeMax))
                    timeMax = timeMin.AddDays(7);

                try
                {
                    var events = await proxy.GetCalendarEventsAsync(userId, timeMin, timeMax);
                    return Results.Ok(events);
                }
                catch (Exception ex)
                {
                    return Results.Json(new { error = "upstream_error", message = ex.Message }, statusCode: 502);
                }
            })
            .WithParam("timeMin", "string", description: "ISO 8601 start time (defaults to now)")
            .WithParam("timeMax", "string", description: "ISO 8601 end time (defaults to now + 7 days)");

        registry.MapGet("/auth/google/fitness/steps", "Get step count from Google Fit for a given date",
            async (HttpContext context, IServiceProvider sp) =>
            {
                var proxy = sp.GetService<GoogleApiProxy>();
                if (proxy is null)
                    return Results.Json(new { error = "not_configured" }, statusCode: 503);

                var userId = context.User.FindFirstValue("sub");
                if (userId is null)
                    return Results.Json(new { error = "not_authenticated" }, statusCode: 401);

                if (!DateOnly.TryParse(context.Request.Query["date"].FirstOrDefault(), out var date))
                    date = DateOnly.FromDateTime(DateTime.UtcNow);

                try
                {
                    var steps = await proxy.GetStepsAsync(userId, date);
                    return Results.Ok(new { date = date.ToString("yyyy-MM-dd"), steps });
                }
                catch (Exception ex)
                {
                    return Results.Json(new { error = "upstream_error", message = ex.Message }, statusCode: 502);
                }
            })
            .WithParam("date", "string", description: "Date in YYYY-MM-DD format (defaults to today)");
    }

    /// <summary>
    /// Turns a provider-verified identity into a session, failing closed. The user store decides who
    /// may enter (see <see cref="IUserStore.CreateOrUpdateFromExternalAsync"/>); a refusal is a 403 and
    /// a store error is a 503, and neither issues a cookie. Creating the very first account is only
    /// offered to a request made on this machine, the same rule as the local first-admin setup, so a
    /// fresh installation reachable through the tunnel cannot be claimed from outside.
    /// </summary>
    internal static async Task<IResult> CompleteExternalSignInAsync(HttpContext context, ExternalIdentity identity,
        IServiceProvider sp, IUserStore userStore, JwtService jwtService, IRefreshTokenStore refreshTokenStore,
        AuthOptions options)
    {
        var logger = sp.GetService<ILoggerFactory>()?.CreateLogger("auth");
        var host = context.Request.Host;
        var throughTunnel = RequestOrigin.ArrivedThroughTunnel(context);

        AuthUser user;
        try
        {
            user = await userStore.CreateOrUpdateFromExternalAsync(identity,
                mayBootstrapFirstUser: RequestOrigin.IsLocal(context));
        }
        catch (ExternalSignInDeniedException denied)
        {
            logger?.LogWarning(
                "{Provider} sign-in refused for {Email} ({Sub}) on {Host} (tunnel={Tunnel}): {Reason}. {Detail}",
                identity.Provider, identity.Email, identity.ProviderId, host, throughTunnel, denied.Reason, denied.Message);
            ClearSignInCookies(context, options);
            return denied.Reason == ExternalSignInDeniedException.AccountDisabled
                ? AccountDisabledPage()
                : SignInPage(StatusCodes.Status403Forbidden, "This account is not allowed here",
                    "This Google account has no access to this Leaf installation. Ask its owner to add you, then sign in again.");
        }
        catch (Exception ex)
        {
            logger?.LogError(ex, "{Provider} sign-in for {Sub} on {Host} failed closed: the user store could not decide",
                identity.Provider, identity.ProviderId, host);
            ClearSignInCookies(context, options);
            return SignInPage(StatusCodes.Status503ServiceUnavailable, "Sign-in is unavailable",
                "Leaf could not check your account just now. Nothing was signed in. Try again in a moment.");
        }

        // Defence in depth: whatever store is plugged in, a disabled account never gets a session.
        if (!user.IsActive)
        {
            logger?.LogWarning("{Provider} sign-in refused for {Sub}: the store returned an account with status {Status}",
                identity.Provider, user.Id, user.Status);
            ClearSignInCookies(context, options);
            return AccountDisabledPage();
        }

        var userId = user.Id;

        if (identity.AccessToken is not null)
        {
            var tokenStore = sp.GetService<GoogleTokenStore>();
            if (tokenStore is not null)
            {
                var expiresAt = DateTimeOffset.UtcNow.AddSeconds(
                    identity.ExpiresIn > 0 ? identity.ExpiresIn - 60 : 3540);
                try { await tokenStore.StoreTokensAsync(userId, identity.AccessToken, identity.RefreshToken, expiresAt); }
                catch { /* non-fatal: Google API access waits for the next sign-in */ }
            }
        }

        var (session, failure) = await SignInSessions.IssueAsync(context, user, SignInMethods.Google,
            jwtService, refreshTokenStore, options, sp.GetService<IDeviceSessionHooks>(), logger);
        if (failure is not null) return failure;
        var isSecure = context.Request.IsHttps;

        context.Response.Cookies.Delete("redsuite_auth_state");
        context.Response.Cookies.Delete("redsuite_auth_return");

        var returnUrl = SanitizeReturnUrl(context.Request.Cookies["redsuite_auth_return"]);
        logger?.LogInformation(
            "Google sign-in issued session {Session} ({Status}) for {Sub} on {Host} (https={Https}, tunnel={Tunnel}, return={Return})",
            session!.SessionId, session.Status, userId, host, isSecure, throughTunnel, returnUrl);
        return Results.Redirect(returnUrl);
    }

    /// <summary>A refused or failed sign-in leaves no half-session behind: no state, no badge, no refresh cookie.</summary>
    private static void ClearSignInCookies(HttpContext context, AuthOptions options)
    {
        context.Response.Cookies.Delete("redsuite_auth_state");
        context.Response.Cookies.Delete("redsuite_auth_return");
        context.Response.Cookies.Delete(options.CookieName, new CookieOptions { Path = "/" });
        context.Response.Cookies.Delete(options.RefreshCookieName, new CookieOptions { Path = "/auth/refresh" });
    }

    private static IResult AccountDisabledPage()
        => SignInPage(StatusCodes.Status403Forbidden, "This account is disabled",
            "An administrator has disabled this account on this Leaf installation.");

    private static IResult SignInPage(int statusCode, string title, string message)
    {
        var safeTitle = System.Net.WebUtility.HtmlEncode(title);
        var safeMessage = System.Net.WebUtility.HtmlEncode(message);
        var html = "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
            + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
            + "<title>" + safeTitle + "</title>"
            + "<style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;display:grid;place-items:center;"
            + "min-height:100vh;margin:0}main{max-width:28rem;padding:2rem;text-align:center}a{color:#f0a060}</style>"
            + "</head><body><main><h1>" + safeTitle + "</h1><p>" + safeMessage + "</p>"
            + "<p><a href=\"/login\">Back to sign-in</a></p></main></body></html>";
        return Results.Content(html, "text/html; charset=utf-8", System.Text.Encoding.UTF8, statusCode);
    }

    /// <summary>How long after a rotation the token it replaced may still arrive without counting as reuse:
    /// tabs that renew at the same moment, or a response lost on the way back.</summary>
    public static readonly TimeSpan RotationGrace = TimeSpan.FromSeconds(30);

    /// <summary>
    /// Rotating refresh: a valid refresh cookie is swapped for a new one in the same family (device session)
    /// and a fresh browser access badge carrying that session (one hour in vault mode). The replacement is
    /// stored before the old token is marked, so a failure in between never leaves the browser holding a dead
    /// cookie. The old token is kept, marked rotated:
    /// <list type="bullet">
    /// <item>within <see cref="RotationGrace"/> it is a 401 <c>invalid_token</c> that leaves the cookies alone
    /// (the browser already holds its successor; the web client treats it as a multi-tab race);</item>
    /// <item>after it, presenting it again is reuse: the whole family ends, the cookies are cleared, and the
    /// answer is 401 <c>session_revoked</c>.</item>
    /// </list>
    /// A family the host says has ended is refused the same way. A token stored before sessions existed is
    /// adopted into a new family. An expired or unknown token is a 401 <c>invalid_token</c> and the cookie is cleared.
    /// </summary>
    internal static async Task<IResult> RefreshAsync(HttpContext context, IRefreshTokenStore refreshTokenStore,
        IUserStore userStore, JwtService jwtService, AuthOptions options, IDeviceSessionHooks? hooks = null,
        TimeProvider? clock = null, ILogger? logger = null)
    {
        hooks ??= DefaultDeviceSessionHooks.Instance;
        var now = (clock ?? TimeProvider.System).GetUtcNow();

        // Every refresh cookie the browser sent, not only the first (see AuthMiddleware.CookieValues).
        var refreshTokens = AuthMiddleware.CookieValues(context.Request, options.RefreshCookieName);
        if (refreshTokens.Count == 0)
        {
            context.Response.Cookies.Delete(options.RefreshCookieName, new CookieOptions { Path = "/auth/refresh" });
            return Results.Json(new { error = "no_token" }, statusCode: 401);
        }

        // A live token wins over a rotated one sent alongside it.
        RefreshTokenValidation? validation = null;
        RefreshTokenValidation? rotated = null;
        foreach (var candidate in refreshTokens)
        {
            var found = await refreshTokenStore.FindAsync(candidate);
            if (found is null) continue;
            if (found.RotatedAt is null) { validation = found; break; }
            rotated ??= found;
        }

        if (validation is null && rotated is { RotatedAt: { } rotatedAt })
        {
            if (now - rotatedAt <= RotationGrace)
                return Results.Json(new { error = "invalid_token" }, statusCode: 401);

            // Reuse: whoever holds this token is not the browser that rotated it, or that browser lost its successor.
            if (rotated.FamilyId is { } reusedFamily)
            {
                await refreshTokenStore.RevokeFamilyAsync(reusedFamily);
                await hooks.EndAsync(reusedFamily, rotated.UserId, SessionEndReasons.RefreshReused);
            }
            else
            {
                await refreshTokenStore.RevokeByIdAsync(rotated.EntityId);
            }
            logger?.LogWarning("A rotated refresh token was used again {Age} s after rotation: session {Session} of {Sub} ended",
                (int)(now - rotatedAt).TotalSeconds, rotated.FamilyId ?? "(none)", rotated.UserId);
            return ClearAuthCookiesAndReturn(context, options,
                Results.Json(new { error = "session_revoked", reason = SessionEndReasons.RefreshReused }, statusCode: 401));
        }

        if (validation is null)
        {
            context.Response.Cookies.Delete(options.RefreshCookieName, new CookieOptions { Path = "/auth/refresh" });
            return Results.Json(new { error = "invalid_token" }, statusCode: 401);
        }

        var user = await userStore.FindByIdAsync(validation.UserId);
        if (user is null)
        {
            return ClearAuthCookiesAndReturn(context, options,
                Results.Json(new { error = "user_not_found" }, statusCode: 401));
        }
        if (!user.IsActive)
        {
            // A disabled account loses its sessions: this session dies with the refusal.
            if (validation.FamilyId is { } disabledFamily)
            {
                await refreshTokenStore.RevokeFamilyAsync(disabledFamily);
                await hooks.EndAsync(disabledFamily, user.Id, SessionEndReasons.AccountDisabled);
            }
            else
            {
                await refreshTokenStore.RevokeByIdAsync(validation.EntityId);
            }
            return ClearAuthCookiesAndReturn(context, options,
                Results.Json(new { error = "account_disabled" }, statusCode: 401));
        }

        if (validation.FamilyId is { } family
            && await hooks.StatusAsync(family, user.Id) == DeviceSessionStatus.Ended)
        {
            await refreshTokenStore.RevokeFamilyAsync(family);
            return ClearAuthCookiesAndReturn(context, options,
                Results.Json(new { error = "session_revoked", reason = "ended" }, statusCode: 401));
        }

        var sessionId = validation.FamilyId ?? DeviceSessionIds.New(now);
        string newAccessToken;
        try
        {
            // Signed before anything is stored or retired: a vault outage leaves the session exactly as it was.
            newAccessToken = jwtService.GenerateBrowserAccessToken(user.Id, user.Email, user.Name, user.Roles,
                user.AvatarUrl, sessionId);
        }
        catch (Vault.VaultUnavailableException)
        {
            return SignInSessions.VaultUnavailable();
        }
        if (validation.FamilyId is null)
            await hooks.BeginAsync(context, user, SignInMethods.Adopted, sessionId);

        var newRefreshToken = jwtService.GenerateRefreshToken();

        // Store the replacement before retiring the token it replaces. Retiring
        // first means any failure past that point (a store that throws, a dropped
        // response) leaves the client holding a cookie whose token no longer
        // works, and the session is dead with no way back but a re-login.
        var refreshExpiry = now.Add(options.Jwt!.RefreshTokenLifetime);
        await refreshTokenStore.StoreAsync(newRefreshToken, user.Id, refreshExpiry, sessionId);
        await refreshTokenStore.MarkRotatedAsync(validation.EntityId, RefreshTokenHash.Of(newRefreshToken), now);

        SignInSessions.AppendCookies(context, options, jwtService, newAccessToken, newRefreshToken);
        return Results.Ok(new { expiresIn = jwtService.BrowserAccessTokenLifetime.TotalSeconds });
    }

    /// <summary>
    /// The device session of a browser badge, for <c>/auth/me</c>: <c>{sessionId, status}</c> with status
    /// <c>approved</c>, <c>pending</c> or <c>ended</c> as the host reports it. Null for anything without a
    /// session (LocalDefault, services, Agents, execution badges, badges issued before sessions).
    /// </summary>
    internal static async Task<object?> DeviceAsync(HttpContext context, string sub, IDeviceSessionHooks? hooks)
    {
        var sessionId = context.User.FindFirstValue(SessionClaims.SessionId);
        if (string.IsNullOrEmpty(sessionId)) return null;
        if (string.Equals(context.User.FindFirstValue(ExecutionIdentityClaims.TokenUseClaim), ExecutionIdentityClaims.TokenUse,
                StringComparison.OrdinalIgnoreCase))
            return null;
        var status = await (hooks ?? DefaultDeviceSessionHooks.Instance).StatusAsync(sessionId, sub);
        return new { sessionId, status = status.ToString().ToLowerInvariant() };
    }

    /// <summary>
    /// Ends this browser's session: every refresh token of its family, and the host is told. A token stored
    /// before sessions existed is revoked on its own. The cookies are cleared either way.
    /// </summary>
    internal static async Task<IResult> LogoutAsync(HttpContext context, IRefreshTokenStore refreshTokenStore,
        AuthOptions options, IDeviceSessionHooks? hooks = null)
    {
        hooks ??= DefaultDeviceSessionHooks.Instance;
        foreach (var refreshToken in AuthMiddleware.CookieValues(context.Request, options.RefreshCookieName))
        {
            if (string.IsNullOrEmpty(refreshToken)) continue;
            var found = await refreshTokenStore.FindAsync(refreshToken);
            if (found?.FamilyId is { } family)
            {
                await refreshTokenStore.RevokeFamilyAsync(family);
                await hooks.EndAsync(family, found.UserId, SessionEndReasons.SignedOut);
            }
            else
            {
                await refreshTokenStore.RevokeByTokenAsync(refreshToken);
            }
        }

        SignInSessions.ClearCookies(context, options);
        return Results.Ok(new { ok = true });
    }

    private static IResult ClearAuthCookiesAndReturn(HttpContext context, AuthOptions options, IResult result)
    {
        SignInSessions.ClearCookies(context, options);
        return result;
    }
}
