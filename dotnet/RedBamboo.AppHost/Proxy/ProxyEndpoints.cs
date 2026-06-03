using System.Net.Http;
using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace RedBamboo.AppHost.Proxy;

public static class ProxyEndpoints
{
    public static void MapProxyEndpoints(
        this WebApplication app,
        IReadOnlyList<ProxyRouteConfig> routes,
        string? callerInfo = null)
    {
        var clients = new Dictionary<string, HttpClient>();
        foreach (var route in routes)
        {
            if (!clients.ContainsKey(route.UpstreamBaseUrl))
            {
                clients[route.UpstreamBaseUrl] = new HttpClient
                {
                    BaseAddress = new Uri(route.UpstreamBaseUrl),
                    Timeout = route.Timeout,
                };
            }

            var client = clients[route.UpstreamBaseUrl];
            app.Map($"{route.PathPrefix}/{{**path}}", async (HttpContext ctx) =>
            {
                var targetPath = ctx.Request.Path.Value ?? "";
                var query = ctx.Request.QueryString.Value ?? "";
                using var req = new HttpRequestMessage(new HttpMethod(ctx.Request.Method), $"{targetPath}{query}");
                if (callerInfo != null)
                    req.Headers.TryAddWithoutValidation("X-Caller-Info", callerInfo);
                var userId = ctx.User?.FindFirstValue("sub");
                if (userId != null)
                    req.Headers.TryAddWithoutValidation("X-User-Id", userId);
                var authHeader = ctx.Request.Headers.Authorization.FirstOrDefault();
                if (authHeader != null)
                    req.Headers.TryAddWithoutValidation("Authorization", authHeader);
                else
                {
                    var cookie = ctx.Request.Cookies["redsuite_token"];
                    if (cookie != null)
                        req.Headers.TryAddWithoutValidation("Authorization", $"Bearer {cookie}");
                }
                if (ctx.Request.ContentLength > 0 || ctx.Request.ContentType != null)
                {
                    req.Content = new StreamContent(ctx.Request.Body);
                    if (ctx.Request.ContentType != null)
                        req.Content.Headers.TryAddWithoutValidation("Content-Type", ctx.Request.ContentType);
                }
                try
                {
                    using var res = await client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ctx.RequestAborted);
                    ctx.Response.StatusCode = (int)res.StatusCode;
                    if (res.Content.Headers.ContentType != null)
                        ctx.Response.ContentType = res.Content.Headers.ContentType.ToString();
                    await res.Content.CopyToAsync(ctx.Response.Body, ctx.RequestAborted);
                }
                catch (HttpRequestException)
                {
                    ctx.Response.StatusCode = 502;
                    await ctx.Response.WriteAsJsonAsync(new { error = "upstream unavailable" });
                }
            });
        }
    }
}
