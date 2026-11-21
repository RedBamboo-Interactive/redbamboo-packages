using System.Net.WebSockets;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using RedBamboo.AppHost.Auth;
using RedBamboo.AppHost.Proxy;

namespace RedBamboo.AppHost.WebSockets;

public static class WebSocketEndpoints
{
    private static readonly byte[] UpstreamConnectedMsg =
        Encoding.UTF8.GetBytes("{\"type\":\"upstream.connected\",\"data\":{}}");

    private static readonly byte[] UpstreamDisconnectedMsg =
        Encoding.UTF8.GetBytes("{\"type\":\"upstream.disconnected\",\"data\":{}}");

    /// <summary>The close a relay sends when the badge it was opened with stopped validating: reconnect with a fresh one.</summary>
    internal const string CredentialsExpiredReason = "credentials_expired";

    /// <summary>Whether a relay may (re)connect upstream with the credentials captured at the upgrade.</summary>
    internal enum RelayAuth { Valid, SessionEnded, CredentialsExpired }

    public static void MapWebSocketEndpoints(
        this WebApplication app,
        WebSocketBroadcaster broadcaster,
        IReadOnlyList<ProxyRouteConfig>? wsProxyRoutes = null)
    {
        var hooks = app.Services.GetService<IDeviceSessionHooks>() ?? DefaultDeviceSessionHooks.Instance;
        var jwt = app.Services.GetService<JwtService>();
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

            var allowsLogEvents = WebSocketLogRelay.AllowsLogEvents(ctx);
            WebSocketLogRelay.AcknowledgeSuppression(ctx);
            var ws = await ctx.WebSockets.AcceptWebSocketAsync();
            var id = Guid.NewGuid().ToString();
            // The receive loop ends when the request is aborted, on shutdown, or when the session is revoked.
            using var receiveCts = CancellationTokenSource.CreateLinkedTokenSource(ctx.RequestAborted);
            broadcaster.AddClientFor(id, ws, allowsLogEvents, WebSocketPrincipal.From(ctx.User), receiveCts);

            var relayCts = CancellationTokenSource.CreateLinkedTokenSource(ctx.RequestAborted);
            var relayTasks = new List<Task>();

            if (wsProxyRoutes is { Count: > 0 })
            {
                var authHeader = ctx.Request.Headers.Authorization.FirstOrDefault();
                var cookie = authHeader == null ? ctx.Request.Cookies["redsuite_token"] : null;
                var principal = WebSocketPrincipal.From(ctx.User);
                var badge = authHeader is not null && authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
                    ? authHeader["Bearer ".Length..]
                    : cookie;
                // Only a badge that validated at the upgrade is re-checked: a tunnel secret or LocalDefault has none.
                var recheckBadge = jwt is not null && badge is not null && jwt.ValidateToken(badge) is not null;
                // Every reconnect reuses what the upgrade carried, so it is checked again first: a session that
                // ended never reconnects, and a badge that expired makes the browser reconnect with its fresh one.
                async Task<RelayAuth> CheckAsync()
                {
                    if (principal is { Kind: WebSocketPrincipalKind.Person, SessionId: { } sid, UserId: { } user }
                        && await hooks.StatusAsync(sid, user) == DeviceSessionStatus.Ended)
                        return RelayAuth.SessionEnded;
                    if (recheckBadge && jwt!.ValidateToken(badge!) is null) return RelayAuth.CredentialsExpired;
                    return RelayAuth.Valid;
                }

                foreach (var route in wsProxyRoutes)
                {
                    var wsUri = new Uri(
                        route.UpstreamBaseUrl
                            .Replace("http://", "ws://")
                            .Replace("https://", "wss://")
                            .TrimEnd('/') + "/ws");

                    relayTasks.Add(Task.Run(
                        () => RelayWithReconnect(ws, broadcaster, id, wsUri, authHeader, cookie,
                            allowsLogEvents, CheckAsync, receiveCts, relayCts.Token),
                        relayCts.Token));
                }
            }

            // Kestrel's graceful stop waits for every open connection, and RequestAborted only
            // fires once its shutdown timeout (30 s) runs out. So on ApplicationStopping, close
            // the socket ourselves (1001, the browser reconnects to the next server) and give
            // the client a moment to acknowledge before the receive is abandoned.
            using var onStopping = app.Lifetime.ApplicationStopping.Register(
                () => _ = CloseForShutdownAsync(broadcaster, id, receiveCts));

            try
            {
                var buf = new byte[256];
                while (ws.State == WebSocketState.Open)
                    await ws.ReceiveAsync(buf, receiveCts.Token);
            }
            catch (WebSocketException) { }
            catch (OperationCanceledException) { }
            catch (ObjectDisposedException) { }
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

    internal static readonly TimeSpan ShutdownCloseGrace = TimeSpan.FromSeconds(2);

    private static async Task CloseForShutdownAsync(
        WebSocketBroadcaster broadcaster,
        string id,
        CancellationTokenSource receiveCts)
    {
        try
        {
            using var sendTimeout = new CancellationTokenSource(ShutdownCloseGrace);
            var closing = await broadcaster.CloseClientAsync(
                id, WebSocketCloseStatus.EndpointUnavailable, "Server is stopping", sendTimeout.Token);
            if (closing) receiveCts.CancelAfter(ShutdownCloseGrace);
            else receiveCts.Cancel();
        }
        catch (ObjectDisposedException)
        {
            // The handler already finished and disposed its token source.
        }
    }

    private static async Task RelayWithReconnect(
        WebSocket browser,
        WebSocketBroadcaster broadcaster,
        string browserId,
        Uri upstreamUri,
        string? authHeader,
        string? authCookie,
        bool allowsLogEvents,
        Func<Task<RelayAuth>> checkAuth,
        CancellationTokenSource browserLifetime,
        CancellationToken ct)
    {
        var retryDelay = TimeSpan.FromSeconds(2);
        const double maxRetrySeconds = 15;

        while (browser.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            RelayAuth auth;
            try { auth = await checkAuth(); }
            catch (Exception) { auth = RelayAuth.Valid; }  // a host that cannot answer: as before, the upstream decides
            if (auth != RelayAuth.Valid)
            {
                await EndBrowserAsync(broadcaster, browserId, browserLifetime, auth);
                return;
            }

            var upstream = new ClientWebSocket();
            try
            {
                if (authHeader != null)
                    upstream.Options.SetRequestHeader("Authorization", authHeader);
                else if (authCookie != null)
                    upstream.Options.SetRequestHeader("Authorization", $"Bearer {authCookie}");
                if (!allowsLogEvents && upstreamUri.IsLoopback)
                    WebSocketLogRelay.RequestSuppression(upstream.Options);

                await upstream.ConnectAsync(upstreamUri, ct);
                retryDelay = TimeSpan.FromSeconds(2);

                if (!await broadcaster.SendToClientAsync(browserId,
                        new ArraySegment<byte>(UpstreamConnectedMsg), WebSocketMessageType.Text, true, ct))
                    return;

                var relay = new WebSocketLogRelay.MessageReader(upstream, restrictLogEvents: !allowsLogEvents);
                while (browser.State == WebSocketState.Open && await relay.ReadMessageStartAsync(ct))
                {
                    if (!await broadcaster.SendToClientAsync(browserId, relay, ct)) return;
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
                if (!await broadcaster.SendToClientAsync(browserId,
                        new ArraySegment<byte>(UpstreamDisconnectedMsg), WebSocketMessageType.Text, true, ct))
                    return;
            }
            catch { return; }

            try { await Task.Delay(retryDelay, ct); }
            catch (OperationCanceledException) { return; }

            retryDelay = TimeSpan.FromSeconds(
                Math.Min(retryDelay.TotalSeconds * 1.5, maxRetrySeconds));
        }
    }

    /// <summary>
    /// The relay may not go on: close the browser's socket so it stops waiting on a relay that will not come
    /// back. An ended session closes with 4401 (the browser stops reconnecting); expired credentials with
    /// 1008 <see cref="CredentialsExpiredReason"/>, so the browser reconnects with its current badge.
    /// </summary>
    private static async Task EndBrowserAsync(WebSocketBroadcaster broadcaster, string browserId,
        CancellationTokenSource browserLifetime, RelayAuth auth)
    {
        var (status, reason) = auth == RelayAuth.SessionEnded
            ? (WebSocketBroadcaster.SessionRevokedCloseStatus, "session_revoked")
            : (WebSocketCloseStatus.PolicyViolation, CredentialsExpiredReason);
        bool sent;
        using (var timeout = new CancellationTokenSource(WebSocketBroadcaster.SessionCloseGrace))
            sent = await broadcaster.CloseClientAsync(browserId, status, reason, timeout.Token);
        try
        {
            if (sent) browserLifetime.CancelAfter(WebSocketBroadcaster.SessionCloseGrace);
            else browserLifetime.Cancel();
        }
        catch (ObjectDisposedException) { }
    }
}
