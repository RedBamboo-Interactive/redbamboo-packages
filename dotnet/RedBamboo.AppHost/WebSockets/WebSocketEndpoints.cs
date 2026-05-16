using System.Net.WebSockets;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using RedBamboo.AppHost.Proxy;

namespace RedBamboo.AppHost.WebSockets;

public static class WebSocketEndpoints
{
    public static void MapWebSocketEndpoints(
        this WebApplication app,
        WebSocketBroadcaster broadcaster,
        IReadOnlyList<ProxyRouteConfig>? wsProxyRoutes = null)
    {
        app.Map("/ws", async (HttpContext ctx) =>
        {
            if (!ctx.WebSockets.IsWebSocketRequest)
            {
                ctx.Response.StatusCode = 400;
                return;
            }

            var ws = await ctx.WebSockets.AcceptWebSocketAsync();
            var id = Guid.NewGuid().ToString();
            broadcaster.AddClient(id, ws);

            var upstreamSockets = new List<ClientWebSocket>();
            if (wsProxyRoutes is { Count: > 0 })
            {
                foreach (var route in wsProxyRoutes)
                {
                    var upstream = new ClientWebSocket();
                    upstreamSockets.Add(upstream);
                    try
                    {
                        var wsUri = new Uri(
                            route.UpstreamBaseUrl
                                .Replace("http://", "ws://")
                                .Replace("https://", "wss://")
                                .TrimEnd('/') + "/ws");
                        await upstream.ConnectAsync(wsUri, ctx.RequestAborted);
                        _ = Task.Run(async () =>
                        {
                            var buf = new byte[8192];
                            while (upstream.State == WebSocketState.Open && ws.State == WebSocketState.Open)
                            {
                                var result = await upstream.ReceiveAsync(buf, ctx.RequestAborted);
                                if (result.MessageType == WebSocketMessageType.Close) break;
                                await ws.SendAsync(new ArraySegment<byte>(buf, 0, result.Count),
                                    result.MessageType, result.EndOfMessage, ctx.RequestAborted);
                            }
                        }, ctx.RequestAborted);
                    }
                    catch { /* upstream not available */ }
                }
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
                broadcaster.RemoveClient(id);
                foreach (var s in upstreamSockets)
                {
                    if (s.State == WebSocketState.Open)
                        try { await s.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None); } catch { }
                    s.Dispose();
                }
            }
        });

        app.MapGet("/ws/schema", () => Results.Ok(new
        {
            description = "WebSocket real-time event stream. Connect at ws://host:port/ws. " +
                          "All messages are JSON: { \"type\": \"<event-type>\", \"data\": { ... } }",
            events = broadcaster.GetEventSchemas()
        }));
    }
}
