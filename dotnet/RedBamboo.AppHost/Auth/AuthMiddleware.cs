using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace RedBamboo.AppHost.Auth;

public sealed class AuthMiddleware
{
    private readonly RequestDelegate _next;
    private readonly AuthOptions _options;
    private readonly JwtService _jwtService;
    private readonly ILogger? _logger;

    public AuthMiddleware(RequestDelegate next, AuthOptions options, JwtService jwtService,
        ILogger<AuthMiddleware>? logger = null)
    {
        _next = next;
        _options = options;
        _jwtService = jwtService;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path.Value ?? "";

        // Authentication state is cookie-dependent and changes during login, refresh, logout,
        // and key rotation. A cached /auth/me response can otherwise keep an installed PWA on
        // its pre-login LocalDefault identity after OAuth has successfully replaced the cookies.
        if (path.StartsWith("/auth/", StringComparison.OrdinalIgnoreCase))
        {
            context.Response.Headers.CacheControl = "no-store";
            context.Response.Headers.Pragma = "no-cache";
        }

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

        if (context.User.Identity?.IsAuthenticated == true)
        {
            await ContinueAsync(context);
            return;
        }

        string? headerToken = null;
        var authHeader = context.Request.Headers.Authorization.FirstOrDefault();
        if (authHeader != null && authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            headerToken = authHeader["Bearer ".Length..];

        // Every cookie of that name, not only the first: a browser can hold more than one (different
        // path or domain), it sends the oldest first, and Request.Cookies keeps only that one. An old
        // badge from a retired key must not hide the one a fresh sign-in just set.
        var cookieTokens = CookieValues(context.Request, _options.CookieName);
        var cookieToken = cookieTokens.FirstOrDefault();

        foreach (var token in cookieTokens.Prepend(headerToken))
        {
            if (token is null) continue;
            var principal = _jwtService.ValidateToken(token);
            // Vault mode: a local badge (agent, service, plugin, execution) is no good on a request that came
            // through the tunnel or from a non-loopback peer. Treated exactly like an invalid badge.
            if (principal is not null && !RequestOrigin.BadgeReachAllows(principal, context))
                principal = null;
            if (principal is not null)
            {
                context.User = principal;
                await ContinueAsync(context);
                return;
            }
        }

        if (cookieToken is not null)
        {
            if (_logger?.IsEnabled(LogLevel.Warning) == true)
            {
                var reasons = cookieTokens.Select((t, i) =>
                    $"#{i + 1}: {_jwtService.DescribeRejection(t) ?? "valid, but refused for this request's reach"}");
                _logger.LogWarning("Sign-in cookie refused on {Method} {Path} (tunnel={Tunnel}, cookies={Count}). {Reasons}",
                    context.Request.Method, path, RequestOrigin.ArrivedThroughTunnel(context), cookieTokens.Count,
                    string.Join(" | ", reasons));
            }
            context.Response.Cookies.Delete(_options.CookieName);
        }

        if (IsLocalRequest(context))
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
            await ContinueAsync(context);
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

        await ContinueAsync(context);
    }

    private async Task ContinueAsync(HttpContext context)
    {
        if (!string.Equals(context.User.FindFirstValue(ExecutionIdentityClaims.TokenUseClaim),
                ExecutionIdentityClaims.TokenUse, StringComparison.OrdinalIgnoreCase))
        {
            await _next(context);
            return;
        }

        if (!ExecutionIdentityClaims.TryRead(context.User, out var identity, out var error)
            || identity is null)
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsJsonAsync(new
            {
                error = "invalid_execution_identity",
                message = error ?? "The execution identity is invalid.",
            });
            return;
        }

        context.Items[ExecutionIdentityClaims.HttpContextItemKey] = identity;
        using var scope = ExecutionContextScope.Push(identity);
        await _next(context);
    }

    private static bool IsStaticAssetRequest(HttpContext context)
    {
        var path = context.Request.Path.Value ?? "";
        if (path is "/" or "") return true;
        if (path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase)) return false;
        if (path.StartsWith("/auth/", StringComparison.OrdinalIgnoreCase)) return false;
        var ext = Path.GetExtension(path);
        return !string.IsNullOrEmpty(ext);
    }

    private static bool IsLocalRequest(HttpContext context) => RequestOrigin.IsLocal(context);

    internal static List<string> CookieValues(HttpRequest request, string name)
    {
        var values = new List<string>();
        foreach (var header in request.Headers.Cookie)
        {
            if (header is null) continue;
            foreach (var pair in header.Split(';'))
            {
                var eq = pair.IndexOf('=');
                if (eq <= 0 || !pair.AsSpan(0, eq).Trim().SequenceEqual(name)) continue;
                var value = Uri.UnescapeDataString(pair[(eq + 1)..].Trim().Trim('"'));
                if (value.Length > 0 && !values.Contains(value)) values.Add(value);
            }
        }
        return values;
    }
}
