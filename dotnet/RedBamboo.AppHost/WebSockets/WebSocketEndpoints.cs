using System.Net.WebSockets;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using RedBamboo.AppHost.Proxy;

namespace RedBamboo.AppHost.WebSockets;

public static class WebSocketEndpoints
{
    private static readonly byte[] UpstreamConnectedMsg =
        Encoding.UTF8.GetBytes("{\"type\":\"upstream.connected\",\"data\":{}}");

    private static readonly byte[] UpstreamDisconnectedMsg =
        Encoding.UTF8.GetBytes("{\"type\":\"upstream.disconnected\",\"data\":{}}");

    public static void MapWebSocketEndpoints(
        this WebApplication app,
        WebSocketBroadcaster broadcaster,
        IReadOnlyList<ProxyRouteConfig>? wsProxyRoutes = null)
    {
        broadcaster.RegisterEvent(new WsEventSchema("upstream.connected",
            "Fired when the upstream WebSocket relay (re)connects to a proxy target"));
        broadcaster.RegisterEvent(new WsEventSchema("upstream.disconnected",
            "Fired when the upstream WebSocket relay loses its connection to a proxy target"));

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

            var relayCts = CancellationTokenSource.CreateLinkedTokenSource(ctx.RequestAborted);
            var relayTasks = new List<Task>();

            if (wsProxyRoutes is { Count: > 0 })
            {
                var authHeader = ctx.Request.Headers.Authorization.FirstOrDefault();
                var cookie = authHeader == null ? ctx.Request.Cookies["redsuite_token"] : null;

                foreach (var route in wsProxyRoutes)
                {
                    var wsUri = new Uri(
                        route.UpstreamBaseUrl
                            .Replace("http://", "ws://")
                            .Replace("https://", "wss://")
                            .TrimEnd('/') + "/ws");

                    relayTasks.Add(Task.Run(
                        () => RelayWithReconnect(ws, wsUri, authHeader, cookie, relayCts.Token),
                        relayCts.Token));
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
                relayCts.Cancel();
                broadcaster.RemoveClient(id);
                try { await Task.WhenAll(relayTasks); } catch { }
                relayCts.Dispose();
            }
        });

        app.MapGet("/ws/schema", () => Results.Ok(new
        {
            description = "WebSocket real-time event stream. Connect at ws://host:port/ws. " +
                          "All messages are JSON: { \"type\": \"<event-type>\", \"data\": { ... } }",
            events = broadcaster.GetEventSchemas()
        }));
    }

    private static async Task RelayWithReconnect(
        WebSocket browser,
        Uri upstreamUri,
        string? authHeader,
        string? authCookie,
        CancellationToken ct)
    {
        var buf = new byte[8192];
        var retryDelay = TimeSpan.FromSeconds(2);
        const double maxRetrySeconds = 15;

        while (browser.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            var upstream = new ClientWebSocket();
            try
            {
                if (authHeader != null)
                    upstream.Options.SetRequestHeader("Authorization", authHeader);
                else if (authCookie != null)
                    upstream.Options.SetRequestHeader("Authorization", $"Bearer {authCookie}");

                await upstream.ConnectAsync(upstreamUri, ct);
                retryDelay = TimeSpan.FromSeconds(2);

                await browser.SendAsync(UpstreamConnectedMsg, WebSocketMessageType.Text, true, ct);

                while (upstream.State == WebSocketState.Open && browser.State == WebSocketState.Open)
                {
                    var result = await upstream.ReceiveAsync(buf, ct);
                    if (result.MessageType == WebSocketMessageType.Close) break;
                    await browser.SendAsync(new ArraySegment<byte>(buf, 0, result.Count),
                        result.MessageType, result.EndOfMessage, ct);
                }
            }
            catch (OperationCanceledException) { return; }
            catch { /* upstream unavailable or dropped */ }
            finally
            {
                if (upstream.State == WebSocketState.Open)
                    try { await upstream.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None); } catch { }
                upstream.Dispose();
            }

            if (browser.State != WebSocketState.Open || ct.IsCancellationRequested) return;

            try
            {
                await browser.SendAsync(UpstreamDisconnectedMsg, WebSocketMessageType.Text, true, ct);
            }
            catch { return; }

            try { await Task.Delay(retryDelay, ct); }
            catch (OperationCanceledException) { return; }

            retryDelay = TimeSpan.FromSeconds(
                Math.Min(retryDelay.TotalSeconds * 1.5, maxRetrySeconds));
        }
    }
}
