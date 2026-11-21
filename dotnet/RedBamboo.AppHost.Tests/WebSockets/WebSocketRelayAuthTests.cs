using System.Net.WebSockets;
using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using RedBamboo.AppHost.Auth;
using RedBamboo.AppHost.Proxy;
using RedBamboo.AppHost.WebSockets;
using Xunit;

namespace RedBamboo.AppHost.Tests.WebSockets;

/// <summary>
/// The /ws relay reconnects upstream with what the upgrade carried. Before each reconnect it checks again:
/// an ended session closes the browser with 4401 and never reconnects; a badge that stopped validating
/// closes it with 1008 so the browser comes back with its current one (design ND 2.2).
/// </summary>
public class WebSocketRelayAuthTests
{
    private const string Key = "relay-auth-tests-signing-key-0123456789abcdef";

    private sealed class Hooks : IDeviceSessionHooks
    {
        public volatile bool Ended;
        public Task<DeviceSessionStatus> BeginAsync(HttpContext c, AuthUser u, string m, string s) => Task.FromResult(DeviceSessionStatus.Approved);
        public Task<DeviceSessionStatus> StatusAsync(string s, string u) => Task.FromResult(Ended ? DeviceSessionStatus.Ended : DeviceSessionStatus.Approved);
        public Task EndAsync(string s, string u, string r) => Task.CompletedTask;
    }

    /// <summary>An upstream /ws that accepts and closes at once, so the relay keeps reconnecting.</summary>
    private static async Task<(WebApplication App, Func<int> Connects)> StartUpstreamAsync()
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        var app = builder.Build();
        app.UseWebSockets();
        var connects = 0;
        app.Map("/ws", async (HttpContext ctx) =>
        {
            if (!ctx.WebSockets.IsWebSocketRequest) { ctx.Response.StatusCode = 400; return; }
            Interlocked.Increment(ref connects);
            using var ws = await ctx.WebSockets.AcceptWebSocketAsync();
            await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None);
        });
        await app.StartAsync();
        return (app, () => Volatile.Read(ref connects));
    }

    private static async Task<WebApplication> StartKernelAsync(Hooks hooks, JwtService jwt, string upstream)
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Services.AddSingleton<IDeviceSessionHooks>(hooks);
        builder.Services.AddSingleton(jwt);
        var app = builder.Build();
        app.UseWebSockets();
        app.Use((ctx, next) =>
        {
            // The test's "auth": the cookie badge, read as AuthMiddleware would.
            if (ctx.Request.Cookies["redsuite_token"] is { } badge && jwt.ValidateToken(badge) is { } principal)
                ctx.User = principal;
            return next(ctx);
        });
        app.MapWebSocketEndpoints(new WebSocketBroadcaster(), [new ProxyRouteConfig { PathPrefix = "/compute", UpstreamBaseUrl = upstream }]);
        await app.StartAsync();
        return app;
    }

    private static async Task<WebSocketReceiveResult> NextClose(ClientWebSocket client, TimeSpan within)
    {
        var buffer = new byte[1024];
        using var timeout = new CancellationTokenSource(within);
        while (true)
        {
            var result = await client.ReceiveAsync(buffer, timeout.Token);
            if (result.MessageType == WebSocketMessageType.Close) return result;
        }
    }

    private static async Task<ClientWebSocket> ConnectAsync(WebApplication kernel, string badge)
    {
        var client = new ClientWebSocket();
        client.Options.SetRequestHeader("Cookie", $"redsuite_token={badge}");
        await client.ConnectAsync(new Uri(new Uri(kernel.Urls.Single().Replace("http", "ws")), "/ws"), CancellationToken.None);
        return client;
    }

    [Fact]
    public async Task A_relay_whose_session_ended_closes_with_4401_and_never_reconnects()
    {
        var jwt = new JwtService(new JwtOptions { SigningKey = Key });
        var hooks = new Hooks();
        var (upstream, connects) = await StartUpstreamAsync();
        var kernel = await StartKernelAsync(hooks, jwt, upstream.Urls.Single());
        try
        {
            var badge = jwt.GenerateBrowserAccessToken("user-1", "u@example.test", "U", ["user"], null, "dev_01JD0000000000000000000000");
            using var client = await ConnectAsync(kernel, badge);
            var watch = System.Diagnostics.Stopwatch.StartNew();
            while (connects() < 1 && watch.Elapsed < TimeSpan.FromSeconds(5)) await Task.Delay(20);
            Assert.Equal(1, connects());

            hooks.Ended = true;  // signed out elsewhere; the upstream has already dropped the relay
            var close = await NextClose(client, TimeSpan.FromSeconds(8));

            Assert.Equal(WebSocketBroadcaster.SessionRevokedCloseStatus, close.CloseStatus);
            await Task.Delay(TimeSpan.FromSeconds(3));
            Assert.Equal(1, connects());  // the captured cookie was never used again
        }
        finally
        {
            await kernel.StopAsync(); await kernel.DisposeAsync();
            await upstream.StopAsync(); await upstream.DisposeAsync();
        }
    }

    [Fact]
    public async Task A_relay_whose_badge_expired_closes_with_1008_so_the_browser_reconnects_fresh()
    {
        var jwt = new JwtService(new JwtOptions { SigningKey = Key, ClockSkew = TimeSpan.Zero });
        var shortLived = new JwtService(new JwtOptions { SigningKey = Key, AccessTokenLifetime = TimeSpan.FromSeconds(1), ClockSkew = TimeSpan.Zero });
        var (upstream, connects) = await StartUpstreamAsync();
        var kernel = await StartKernelAsync(new Hooks(), jwt, upstream.Urls.Single());
        try
        {
            using var client = await ConnectAsync(kernel,
                shortLived.GenerateBrowserAccessToken("user-1", "u@example.test", "U", ["user"], null, "dev_01JD0000000000000000000000"));

            var close = await NextClose(client, TimeSpan.FromSeconds(8));

            Assert.Equal(WebSocketCloseStatus.PolicyViolation, close.CloseStatus);
            Assert.Equal(WebSocketEndpoints.CredentialsExpiredReason, close.CloseStatusDescription);
            Assert.Equal(1, connects());
        }
        finally
        {
            await kernel.StopAsync(); await kernel.DisposeAsync();
            await upstream.StopAsync(); await upstream.DisposeAsync();
        }
    }

    [Fact]
    public async Task A_live_session_keeps_reconnecting_as_before()
    {
        var jwt = new JwtService(new JwtOptions { SigningKey = Key });
        var (upstream, connects) = await StartUpstreamAsync();
        var kernel = await StartKernelAsync(new Hooks(), jwt, upstream.Urls.Single());
        try
        {
            using var client = await ConnectAsync(kernel,
                jwt.GenerateBrowserAccessToken("user-1", "u@example.test", "U", ["user"], null, "dev_01JD0000000000000000000000"));
            var watch = System.Diagnostics.Stopwatch.StartNew();
            while (connects() < 2 && watch.Elapsed < TimeSpan.FromSeconds(8)) await Task.Delay(50);
            Assert.True(connects() >= 2, $"connects: {connects()}");
            Assert.Equal(WebSocketState.Open, client.State);
        }
        finally
        {
            await kernel.StopAsync(); await kernel.DisposeAsync();
            await upstream.StopAsync(); await upstream.DisposeAsync();
        }
    }
}
