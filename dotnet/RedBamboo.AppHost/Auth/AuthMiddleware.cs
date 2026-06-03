using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;

namespace RedBamboo.AppHost.Auth;

public sealed class AuthMiddleware
{
    private readonly RequestDelegate _next;
    private readonly AuthOptions _options;
    private readonly JwtService _jwtService;

    public AuthMiddleware(RequestDelegate next, AuthOptions options, JwtService jwtService)
    {
        _next = next;
        _options = options;
        _jwtService = jwtService;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path.Value ?? "";

        foreach (var bypass in _options.BypassPaths)
        {
            if (path.StartsWith(bypass, StringComparison.OrdinalIgnoreCase))
            {
                await _next(context);
                return;
            }
        }

        if (IsStaticAssetRequest(context))
        {
            await _next(context);
            return;
        }

        string? token = null;

        var authHeader = context.Request.Headers.Authorization.FirstOrDefault();
        if (authHeader != null && authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            token = authHeader["Bearer ".Length..];

        token ??= context.Request.Cookies[_options.CookieName];

        if (token is not null)
        {
            var principal = _jwtService.ValidateToken(token);
            if (principal is not null)
            {
                context.User = principal;
                await _next(context);
                return;
            }

            context.Response.Cookies.Delete(_options.CookieName);
        }

        if (_options.Mode == AuthMode.LocalDefault && IsLocalRequest(context))
        {
            var claims = new[]
            {
                new Claim("sub", "local-user"),
                new Claim("email", "local@localhost"),
                new Claim("name", "Local User"),
                new Claim("roles", "[\"admin\"]", System.IdentityModel.Tokens.Jwt.JsonClaimValueTypes.JsonArray)
            };
            var identity = new ClaimsIdentity(claims, "LocalDefault");
            context.User = new ClaimsPrincipal(identity);
            await _next(context);
            return;
        }

        if (_options.Mode == AuthMode.Required)
        {
            var accept = context.Request.Headers.Accept.ToString();
            if (accept.Contains("text/html", StringComparison.OrdinalIgnoreCase))
            {
                var request = context.Request;
                var rawPath = request.Path.Value ?? "/";
                var rawQuery = request.QueryString.Value ?? "";
                var returnUrl = Uri.EscapeDataString(rawPath + rawQuery);
                context.Response.Redirect($"/login?returnUrl={returnUrl}");
                return;
            }

            context.Response.StatusCode = 401;
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsJsonAsync(new
            {
                error = "unauthorized",
                message = "Authentication required."
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
