using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using RedBamboo.AppHost.Logging;

namespace RedBamboo.AppHost.Proxy;

public static class ProxyEndpoints
{
    public static void MapProxyEndpoints(
        this WebApplication app,
        IReadOnlyList<ProxyRouteConfig> routes,
        LogService? logService = null)
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

        var wsRoutes = routes.Where(r => r.ProxyWebSocket).ToList();
        if (logService is null && wsRoutes.Count == 0) return;

        app.Map("/ws", async (HttpContext ctx) =>
        {
            if (!ctx.WebSockets.IsWebSocketRequest)
            {
                ctx.Response.StatusCode = 400;
                return;
            }
            var ws = await ctx.WebSockets.AcceptWebSocketAsync();

            Action<LogEntry>? logHandler = null;
            if (logService is not null)
            {
                logHandler = (LogEntry entry) =>
                {
                    var json = JsonSerializer.Serialize(new { type = "log.entry", data = entry.ToWireFormat() });
                    var bytes = Encoding.UTF8.GetBytes(json);
                    _ = ws.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);
                };
                logService.OnLogEntry += logHandler;
            }

            var upstreamSockets = new List<ClientWebSocket>();
            foreach (var route in wsRoutes)
            {
                var rcWs = new ClientWebSocket();
                upstreamSockets.Add(rcWs);
                try
                {
                    var wsUri = new Uri(
                        route.UpstreamBaseUrl
                            .Replace("http://", "ws://")
                            .Replace("https://", "wss://")
                            .TrimEnd('/') + "/ws");
                    await rcWs.ConnectAsync(wsUri, ctx.RequestAborted);
                    _ = Task.Run(async () =>
                    {
                        var buf = new byte[8192];
                        while (rcWs.State == WebSocketState.Open && ws.State == WebSocketState.Open)
                        {
                            var result = await rcWs.ReceiveAsync(buf, ctx.RequestAborted);
                            if (result.MessageType == WebSocketMessageType.Close) break;
                            await ws.SendAsync(new ArraySegment<byte>(buf, 0, result.Count),
                                result.MessageType, result.EndOfMessage, ctx.RequestAborted);
                        }
                    }, ctx.RequestAborted);
                }
                catch { /* upstream not available */ }
            }

            try
            {
                var buf = new byte[256];
                while (ws.State == WebSocketState.Open)
                    await ws.ReceiveAsync(buf, ctx.RequestAborted);
            }
            catch (WebSocketException) { }
            catch (OperationCanceledException) { }
            finally
            {
                if (logHandler is not null)
                    logService!.OnLogEntry -= logHandler;
                foreach (var s in upstreamSockets)
                {
                    if (s.State == WebSocketState.Open)
                        try { await s.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None); } catch { }
                    s.Dispose();
                }
            }
        });
    }
}
