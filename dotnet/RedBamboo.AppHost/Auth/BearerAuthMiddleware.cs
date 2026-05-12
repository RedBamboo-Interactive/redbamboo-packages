using System.Net;
using Microsoft.AspNetCore.Http;

namespace RedBamboo.AppHost.Auth;

public sealed class BearerAuthMiddleware
{
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

        if (provided == null && _options.AllowQueryParamToken)
            provided = context.Request.Query["token"].FirstOrDefault();

        if (provided == null || !string.Equals(provided, accessToken, StringComparison.Ordinal))
        {
            context.Response.StatusCode = 401;
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsJsonAsync(new
            {
                error = "unauthorized",
                message = "Valid access token required. Provide via Authorization: Bearer <token>"
            });
            return;
        }

        await _next(context);
    }

    private static bool IsStaticAssetRequest(HttpContext context)
    {
        var path = context.Request.Path.Value ?? "";
        if (path is "/" or "") return true;
        var ext = Path.GetExtension(path);
        return !string.IsNullOrEmpty(ext);
    }

    private static bool IsLocalRequest(HttpContext context)
    {
        if (context.Request.Headers.ContainsKey("Cf-Connecting-Ip") ||
            context.Request.Headers.ContainsKey("Cf-Ray"))
            return false;

        var remote = context.Connection.RemoteIpAddress;
        if (remote == null) return true;
        if (IPAddress.IsLoopback(remote)) return true;
        if (remote.Equals(context.Connection.LocalIpAddress)) return true;
        return false;
    }
}
