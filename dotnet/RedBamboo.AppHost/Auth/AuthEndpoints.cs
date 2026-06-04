using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
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

    public static void Map(EndpointRegistry registry)
    {
        registry.MapGet("/login", "Login page",
            (HttpContext context) =>
            {
                return Results.Content(LoginPage.Render(), "text/html");
            });

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

                AuthUser? user = null;
                try { user = await userStore.CreateOrUpdateFromExternalAsync(identity); }
                catch { /* RedLeaf may be unavailable */ }

                var userId = user?.Id ?? identity.ProviderId;
                var email = user?.Email ?? identity.Email;
                var name = user?.Name ?? identity.Name;
                var roles = user?.Roles ?? ["admin"];
                var avatarUrl = user?.AvatarUrl ?? identity.AvatarUrl;

                var accessToken = jwtService.GenerateAccessToken(userId, email, name, roles, avatarUrl);
                var refreshToken = jwtService.GenerateRefreshToken();

                var refreshExpiry = DateTimeOffset.UtcNow.Add(options.Jwt!.RefreshTokenLifetime);
                try { await refreshTokenStore.StoreAsync(refreshToken, userId, refreshExpiry); }
                catch { /* refresh won't work but login still proceeds */ }

                var isSecure = context.Request.IsHttps;

                context.Response.Cookies.Append(options.CookieName, accessToken, new CookieOptions
                {
                    HttpOnly = true,
                    Secure = isSecure,
                    SameSite = isSecure ? SameSiteMode.Lax : SameSiteMode.Lax,
                    Path = "/",
                    MaxAge = options.Jwt.AccessTokenLifetime
                });

                context.Response.Cookies.Append(options.RefreshCookieName, refreshToken, new CookieOptions
                {
                    HttpOnly = true,
                    Secure = isSecure,
                    SameSite = isSecure ? SameSiteMode.Strict : SameSiteMode.Lax,
                    Path = "/auth/refresh",
                    MaxAge = options.Jwt.RefreshTokenLifetime
                });

                context.Response.Cookies.Delete("redsuite_auth_state");
                context.Response.Cookies.Delete("redsuite_auth_return");

                var returnUrl = SanitizeReturnUrl(context.Request.Cookies["redsuite_auth_return"]);
                return Results.Redirect(returnUrl);
            });

        registry.MapPost("/auth/refresh", "Refresh access token",
            async (HttpContext context, IRefreshTokenStore refreshTokenStore,
                IUserStore userStore, JwtService jwtService, AuthOptions options) =>
            {
                var refreshToken = context.Request.Cookies[options.RefreshCookieName];
                if (string.IsNullOrEmpty(refreshToken))
                {
                    context.Response.Cookies.Delete(options.RefreshCookieName, new CookieOptions { Path = "/auth/refresh" });
                    return Results.Json(new { error = "no_token" }, statusCode: 401);
                }

                var userId = await refreshTokenStore.ValidateAndGetUserIdAsync(refreshToken);
                if (userId is null)
                {
                    context.Response.Cookies.Delete(options.RefreshCookieName, new CookieOptions { Path = "/auth/refresh" });
                    return Results.Json(new { error = "invalid_token" }, statusCode: 401);
                }

                var user = await userStore.FindByIdAsync(userId);
                if (user is null)
                {
                    await refreshTokenStore.RevokeAsync(refreshToken);
                    context.Response.Cookies.Delete(options.RefreshCookieName, new CookieOptions { Path = "/auth/refresh" });
                    return Results.Json(new { error = "user_not_found" }, statusCode: 401);
                }

                await refreshTokenStore.RevokeAsync(refreshToken);

                var newAccessToken = jwtService.GenerateAccessToken(user.Id, user.Email, user.Name, user.Roles, user.AvatarUrl);
                var newRefreshToken = jwtService.GenerateRefreshToken();

                var refreshExpiry = DateTimeOffset.UtcNow.Add(options.Jwt!.RefreshTokenLifetime);
                await refreshTokenStore.StoreAsync(newRefreshToken, user.Id, refreshExpiry);

                var isSecure = context.Request.IsHttps;

                context.Response.Cookies.Append(options.CookieName, newAccessToken, new CookieOptions
                {
                    HttpOnly = true,
                    Secure = isSecure,
                    SameSite = isSecure ? SameSiteMode.Lax : SameSiteMode.Lax,
                    Path = "/",
                    MaxAge = options.Jwt.AccessTokenLifetime
                });

                context.Response.Cookies.Append(options.RefreshCookieName, newRefreshToken, new CookieOptions
                {
                    HttpOnly = true,
                    Secure = isSecure,
                    SameSite = isSecure ? SameSiteMode.Strict : SameSiteMode.Lax,
                    Path = "/auth/refresh",
                    MaxAge = options.Jwt.RefreshTokenLifetime
                });

                return Results.Ok(new { expiresIn = options.Jwt.AccessTokenLifetime.TotalSeconds });
            });

        registry.MapPost("/auth/logout", "Log out and clear tokens",
            async (HttpContext context, IRefreshTokenStore refreshTokenStore, AuthOptions options) =>
            {
                var refreshToken = context.Request.Cookies[options.RefreshCookieName];
                if (!string.IsNullOrEmpty(refreshToken))
                    await refreshTokenStore.RevokeAsync(refreshToken);

                context.Response.Cookies.Delete(options.CookieName, new CookieOptions { Path = "/" });
                context.Response.Cookies.Delete(options.RefreshCookieName, new CookieOptions { Path = "/auth/refresh" });

                return Results.Ok(new { ok = true });
            });

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

                string? avatarUrl = context.User.FindFirst("picture")?.Value;
                var userStore = sp.GetService<IUserStore>();
                if (userStore is not null)
                {
                    var user = await userStore.FindByIdAsync(sub);
                    if (user?.AvatarUrl is not null)
                        avatarUrl = user.AvatarUrl;
                }

                return Results.Ok(new { id = sub, email, name, roles, avatarUrl });
            });
    }

    private static IResult ClearAuthCookiesAndReturn(HttpContext context, AuthOptions options, IResult result)
    {
        context.Response.Cookies.Delete(options.CookieName, new CookieOptions { Path = "/" });
        context.Response.Cookies.Delete(options.RefreshCookieName, new CookieOptions { Path = "/auth/refresh" });
        return result;
    }
}
