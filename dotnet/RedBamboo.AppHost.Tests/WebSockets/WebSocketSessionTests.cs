using System.Diagnostics;
using System.Net.WebSockets;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using RedBamboo.AppHost.Auth;
using RedBamboo.AppHost.WebSockets;
using Xunit;

namespace RedBamboo.AppHost.Tests.WebSockets;

/// <summary>
/// Who holds each /ws connection, closing one device session's sockets, and events sent only to a user's own
/// browsers. The test host's "auth" reads the identity from test headers.
/// </summary>
public class WebSocketSessionTests
{
    private static async Task<(WebApplication App, WebSocketBroadcaster Broadcaster, Uri Ws)> StartAsync()
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        var app = builder.Build();
        app.UseWebSockets();
        app.Use((ctx, next) =>
        {
            var kind = ctx.Request.Headers["X-Test-Kind"].ToString();
            var sub = ctx.Request.Headers["X-Test-Sub"].ToString();
            var sid = ctx.Request.Headers["X-Test-Sid"].ToString();
            if (kind.Length > 0)
            {
                var claims = new List<Claim> { new("sub", sub) };
                if (sid.Length > 0) claims.Add(new(SessionClaims.SessionId, sid));
                if (kind == "execution") claims.Add(new(ExecutionIdentityClaims.TokenUseClaim, ExecutionIdentityClaims.TokenUse));
                var authType = kind switch { "local" => "LocalDefault", "bearer" => "BearerToken", _ => "Jwt" };
                ctx.User = new ClaimsPrincipal(new ClaimsIdentity(claims, authType));
            }
            return next(ctx);
        });
        var broadcaster = new WebSocketBroadcaster();
        app.MapWebSocketEndpoints(broadcaster);
        await app.StartAsync();
        var http = new Uri(app.Urls.Single());
        return (app, broadcaster, new Uri($"ws://{http.Authority}/ws"));
    }

    private static async Task<ClientWebSocket> Connect(Uri uri, string kind, string sub, string? sid = null)
    {
        var client = new ClientWebSocket();
        client.Options.SetRequestHeader("X-Test-Kind", kind);
        client.Options.SetRequestHeader("X-Test-Sub", sub);
        if (sid is not null) client.Options.SetRequestHeader("X-Test-Sid", sid);
        await client.ConnectAsync(uri, CancellationToken.None);
        return client;
    }

    private static async Task WaitForClients(WebSocketBroadcaster broadcaster, int count)
    {
        var watch = Stopwatch.StartNew();
        while (broadcaster.ClientCount < count && watch.Elapsed < TimeSpan.FromSeconds(5)) await Task.Delay(10);
        Assert.Equal(count, broadcaster.ClientCount);
    }

    /// <summary>The next message, or null when nothing arrives within <paramref name="wait"/>.</summary>
    private static async Task<WebSocketReceiveResult?> Next(ClientWebSocket client, byte[] buffer, TimeSpan wait)
    {
        try { return await client.ReceiveAsync(buffer, CancellationToken.None).WaitAsync(wait); }
        catch (TimeoutException) { return null; }
    }

    [Fact]
    public void AddClient_stays_one_three_argument_method_for_consumers_that_find_it_by_reflection()
    {
        // RedCompute's tests look it up by name (SessionRollbackTests, HostThreadingTests, PermissionContractAlignmentTests).
        var addClient = typeof(WebSocketBroadcaster).GetMethod("AddClient",
            System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!;
        Assert.Equal([typeof(string), typeof(WebSocket), typeof(bool)], addClient.GetParameters().Select(p => p.ParameterType));
    }

    [Theory]
    [InlineData("person", "user-1", "dev_A", WebSocketPrincipalKind.Person, "dev_A")]
    [InlineData("local", "local-user", null, WebSocketPrincipalKind.LocalAccess, null)]
    [InlineData("execution", "agent-1", null, WebSocketPrincipalKind.Execution, null)]
    [InlineData("bearer", "service", null, WebSocketPrincipalKind.Service, null)]
    [InlineData("jwt", "service:redcompute", null, WebSocketPrincipalKind.Service, null)]
    public void The_principal_is_read_from_the_upgrade_identity(string kind, string sub, string? sid,
        WebSocketPrincipalKind expected, string? expectedSession)
    {
        var claims = new List<Claim> { new("sub", sub) };
        if (sid is not null) claims.Add(new(SessionClaims.SessionId, sid));
        if (kind == "execution") claims.Add(new(ExecutionIdentityClaims.TokenUseClaim, ExecutionIdentityClaims.TokenUse));
        var authType = kind switch { "local" => "LocalDefault", "bearer" => "BearerToken", _ => "Jwt" };

        var principal = WebSocketPrincipal.From(new ClaimsPrincipal(new ClaimsIdentity(claims, authType)));

        Assert.Equal(expected, principal.Kind);
        Assert.Equal(sub, principal.UserId);
        Assert.Equal(expectedSession, principal.SessionId);
        Assert.Equal(WebSocketPrincipalKind.Anonymous, WebSocketPrincipal.From(new ClaimsPrincipal(new ClaimsIdentity())).Kind);
    }

    [Fact]
    public async Task Closing_a_session_closes_only_its_sockets_with_4401_and_quickly()
    {
        var (app, broadcaster, uri) = await StartAsync();
        try
        {
            using var a1 = await Connect(uri, "person", "user-1", "dev_A");
            using var a2 = await Connect(uri, "person", "user-1", "dev_A");
            using var b = await Connect(uri, "person", "user-1", "dev_B");
            await WaitForClients(broadcaster, 3);

            var watch = Stopwatch.StartNew();
            var closing = await broadcaster.CloseSessionAsync("dev_A");
            var buffer = new byte[256];
            var r1 = await Next(a1, buffer, TimeSpan.FromSeconds(2));
            var r2 = await Next(a2, buffer, TimeSpan.FromSeconds(2));
            watch.Stop();

            Assert.Equal(2, closing);
            Assert.Equal(WebSocketBroadcaster.SessionRevokedCloseStatus, r1!.CloseStatus);
            Assert.Equal(WebSocketBroadcaster.SessionRevokedCloseStatus, r2!.CloseStatus);
            Assert.Equal("session_revoked", r1.CloseStatusDescription);
            Assert.True(watch.Elapsed < TimeSpan.FromSeconds(1), $"closing took {watch.ElapsedMilliseconds} ms");
            Assert.Equal(WebSocketState.Open, b.State);
            broadcaster.Broadcast("still.here", new { });
            Assert.Equal(WebSocketMessageType.Text, (await Next(b, buffer, TimeSpan.FromSeconds(2)))!.MessageType);
        }
        finally
        {
            await app.StopAsync();
            await app.DisposeAsync();
        }
    }

    [Fact]
    public async Task A_revoked_socket_that_never_acknowledges_is_dropped_after_the_grace()
    {
        var (app, broadcaster, uri) = await StartAsync();
        try
        {
            using var a = await Connect(uri, "person", "user-1", "dev_A");
            await WaitForClients(broadcaster, 1);

            await broadcaster.CloseSessionAsync("dev_A");  // the client never reads, so it never answers

            var watch = Stopwatch.StartNew();
            while (broadcaster.ClientCount > 0 && watch.Elapsed < TimeSpan.FromSeconds(6)) await Task.Delay(20);
            Assert.Equal(0, broadcaster.ClientCount);
            Assert.True(watch.Elapsed < WebSocketBroadcaster.SessionCloseGrace + TimeSpan.FromSeconds(2),
                $"dropped after {watch.Elapsed.TotalSeconds:F1} s");
        }
        finally
        {
            await app.StopAsync();
            await app.DisposeAsync();
        }
    }

    [Fact]
    public async Task Events_for_a_user_reach_only_that_users_browsers()
    {
        var (app, broadcaster, uri) = await StartAsync();
        try
        {
            using var mine = await Connect(uri, "person", "user-1", "dev_A");
            using var other = await Connect(uri, "person", "user-2", "dev_C");
            using var agent = await Connect(uri, "execution", "user-1", "dev_A");
            using var service = await Connect(uri, "bearer", "service");
            using var local = await Connect(uri, "local", "local-user");
            await WaitForClients(broadcaster, 5);

            Assert.Equal(1, broadcaster.SendToUser("user-1", "device.waiting", new { sid = "dev_X" }));
            Assert.Equal(2, broadcaster.SendToUser("user-1", "device.updated", new { sid = "dev_X" }, includeLocalAccess: true));

            var buffer = new byte[512];
            var first = await Next(mine, buffer, TimeSpan.FromSeconds(2));
            Assert.Contains("device.waiting", Encoding.UTF8.GetString(buffer, 0, first!.Count));
            Assert.NotNull(await Next(local, buffer, TimeSpan.FromSeconds(2)));
            Assert.Null(await Next(other, buffer, TimeSpan.FromMilliseconds(300)));
            Assert.Null(await Next(agent, buffer, TimeSpan.FromMilliseconds(300)));
            Assert.Null(await Next(service, buffer, TimeSpan.FromMilliseconds(300)));
        }
        finally
        {
            await app.StopAsync();
            await app.DisposeAsync();
        }
    }
}
