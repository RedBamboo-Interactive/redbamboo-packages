using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;

namespace RedBamboo.AppHost.Auth;

public sealed class BearerAuthMiddleware
{
    /// <summary>Set on a request whose shared secret passed the door in <see cref="BearerAuthOptions.DoorOnly"/> mode.</summary>
    public const string DoorPassedItemKey = "redsuite.tunnel_door_passed";

    public static bool DoorPassed(HttpContext context)
        => context.Items.TryGetValue(DoorPassedItemKey, out var value) && value is true;

    private readonly RequestDelegate _next;
    private readonly BearerAuthOptions _options;

    public BearerAuthMiddleware(RequestDelegate next, BearerAuthOptions options)
    {
        _next = next;
        _options = options;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var accessToken = _options.GetAccessToken();
        if (string.IsNullOrEmpty(accessToken))
        {
            await _next(context);
            return;
        }

        if (IsLocalRequest(context))
        {
            await _next(context);
            return;
        }

        if (IsStaticAssetRequest(context))
        {
            await _next(context);
            return;
        }

        var path = context.Request.Path.Value ?? "";
        if (_options.ExactBypassPaths.Contains(path, StringComparer.OrdinalIgnoreCase))
        {
            await _next(context);
            return;
        }

        foreach (var bypass in _options.BypassPaths)
        {
            if (path.StartsWith(bypass, StringComparison.OrdinalIgnoreCase))
            {
                await _next(context);
                return;
            }
        }

        string? provided = null;

        var authHeader = context.Request.Headers.Authorization.FirstOrDefault();
        if (authHeader != null && authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            provided = authHeader["Bearer ".Length..];

        provided ??= context.Request.Cookies[_options.CookieName];

        // Door mode keeps the secret out of page URLs, so it never lands in history, logs or a shared link.
        if (provided == null && _options.AllowQueryParamToken && !(_options.DoorOnly && IsPageRequest(context)))
            provided = context.Request.Query["token"].FirstOrDefault();

        if (provided == null || !string.Equals(provided, accessToken, StringComparison.Ordinal))
        {
            if (_options.FallThroughOnFailure)
            {
                await _next(context);
                return;
            }

            context.Response.StatusCode = 401;
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsJsonAsync(new
            {
                error = "unauthorized",
                message = "Valid access token required. Provide via Authorization: Bearer <token>"
            });
            return;
        }

        if (_options.DoorOnly)
        {
            context.Items[DoorPassedItemKey] = true;
            await _next(context);
            return;
        }

        var claims = new[]
        {
            new Claim("sub", "service"),
            new Claim("email", "service@bearer"),
            new Claim("name", "Service Account"),
            new Claim("roles", "[\"admin\"]", System.IdentityModel.Tokens.Jwt.JsonClaimValueTypes.JsonArray)
        };
        context.User = new ClaimsPrincipal(new ClaimsIdentity(claims, "BearerToken"));

        await _next(context);
    }

    private static bool IsStaticAssetRequest(HttpContext context)
    {
        var path = context.Request.Path.Value ?? "";
        if (path is "/" or "") return true;
        if (path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase)) return false;
        var ext = Path.GetExtension(path);
        return !string.IsNullOrEmpty(ext);
    }

    private static bool IsLocalRequest(HttpContext context) => RequestOrigin.IsLocal(context);

    private static bool IsPageRequest(HttpContext context)
        => context.Request.Headers.Accept.ToString().Contains("text/html", StringComparison.OrdinalIgnoreCase);
}
