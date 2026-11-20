using System.Net.WebSockets;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using RedBamboo.AppHost.Auth;
using RedBamboo.AppHost.Discovery;
using RedBamboo.AppHost.Extensions;
using RedBamboo.AppHost.Logging;
using RedBamboo.AppHost.Tunnel;
using RedBamboo.AppHost.WebSockets;
using Xunit;

namespace RedBamboo.AppHost.Tests.WebSockets;

public class WebSocketLogAuthorizationTests
{
    private const int LargePayloadSize = 5 * 1024 * 1024;
    private static readonly JwtOptions Jwt = new() { SigningKey = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)) };

    [Theory]
    [InlineData(null, false, true)]
    [InlineData("admin", false, true)]
    [InlineData("user", false, false)]
    [InlineData("user", true, false)]
    public async Task Operational_logs_require_local_or_admin_access_on_both_AppHost_hops(
        string? remoteRole, bool useBrowserCookie, bool allowsLogs)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        var ct = timeout.Token;
        var upgrade = new TaskCompletionSource<(string? Subject, bool AllowsLogs)>(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var tunnel = new CloudflareTunnelService();
        await using var upstream = CreateAppHost(tunnel, observeUpgrade: context =>
            upgrade.TrySetResult((context.User.FindFirstValue("sub"), WebSocketLogRelay.AllowsLogEvents(context))));
        await upstream.StartAsync(ct);
        await using var app = CreateAppHost(tunnel, upstream.Urls.Single());
        await app.StartAsync(ct);

        using var client = await ConnectAsync(app, remoteRole, useBrowserCookie, ct);
        Assert.Equal("upstream.connected", ReadType(await ReceiveAsync(client, WebSocketMessageType.Text, ct)));
        var observed = await upgrade.Task.WaitAsync(ct);
        Assert.Equal(remoteRole is null ? "local-user" : "synthetic-user", observed.Subject);
        Assert.Equal(allowsLogs, observed.AllowsLogs);

        var largePayload = new string('x', LargePayloadSize);
        upstream.Services.GetRequiredService<LogService>().Info("test", "synthetic upstream log");
        upstream.Services.GetRequiredService<WebSocketBroadcaster>()
            .Broadcast("test.relay", new { value = largePayload });
        if (allowsLogs)
            Assert.Equal("log.entry", ReadType(await ReceiveAsync(client, WebSocketMessageType.Text, ct)));
        using var relayed = JsonDocument.Parse(await ReceiveAsync(client, WebSocketMessageType.Text, ct));
        Assert.Equal("test.relay", relayed.RootElement.GetProperty("type").GetString());
        var value = relayed.RootElement.GetProperty("data").GetProperty("value").GetString();
        Assert.True(value == largePayload, "The large upstream payload should arrive intact.");

        app.Services.GetRequiredService<LogService>().Info("test", "synthetic local log");
        app.Services.GetRequiredService<WebSocketBroadcaster>().Broadcast("test.local", new { });
        if (allowsLogs)
            Assert.Equal("log.entry", ReadType(await ReceiveAsync(client, WebSocketMessageType.Text, ct)));
        Assert.Equal("test.local", ReadType(await ReceiveAsync(client, WebSocketMessageType.Text, ct)));
    }

    [Fact]
    public async Task Unacknowledged_upstream_filters_log_prefixes_and_streams_large_messages_without_interleaving()
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        var ct = timeout.Token;
        var resumeUpstream = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var largeEvent = JsonSerializer.SerializeToUtf8Bytes(new
        {
            type = "log.entry." + new string('x', 120),
            data = new { type = "log.entry", value = new string('x', LargePayloadSize) },
        });
        byte[] binary = [0x00, 0xFF, 0x42];
        await using var upstream = CreateBuilder().Build();
        upstream.UseWebSockets();
        upstream.Map("/ws", async (HttpContext context) =>
        {
            using var ws = await context.WebSockets.AcceptWebSocketAsync();
            var aborted = context.RequestAborted;
            var log = """{"type":"\u006c\u006f\u0067\u002e\u0065\u006e\u0074\u0072\u0079","data":{"message":"synthetic"}}"""u8.ToArray();
            await ws.SendAsync(log.AsMemory(0, 19), WebSocketMessageType.Text, false, aborted);
            await ws.SendAsync(log.AsMemory(19), WebSocketMessageType.Text, true, aborted);
            await ws.SendAsync("""{"data":{},"type":"log.entry"}"""u8.ToArray().AsMemory(), WebSocketMessageType.Text, true, aborted);
            await ws.SendAsync(binary.AsMemory(0, 1), WebSocketMessageType.Binary, false, aborted);
            await ws.SendAsync(binary.AsMemory(1), WebSocketMessageType.Binary, true, aborted);

            await ws.SendAsync(largeEvent.AsMemory(0, 12_000), WebSocketMessageType.Text, false, aborted);
            await resumeUpstream.Task.WaitAsync(ct);
            await ws.SendAsync(largeEvent.AsMemory(12_000), WebSocketMessageType.Text, true, aborted);

            var close = await ws.ReceiveAsync(new byte[64], aborted);
            if (close.MessageType == WebSocketMessageType.Close)
                await ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "", aborted);
        });
        await upstream.StartAsync(ct);
        await using var tunnel = new CloudflareTunnelService();
        await using var app = CreateAppHost(tunnel, upstream.Urls.Single());
        await app.StartAsync(ct);

        using var client = await ConnectAsync(app, "user", useBrowserCookie: true, ct);
        Assert.Equal("upstream.connected", ReadType(await ReceiveAsync(client, WebSocketMessageType.Text, ct)));
        Assert.Equal(binary, await ReceiveAsync(client, WebSocketMessageType.Binary, ct));
        var relayed = await ReceiveAsync(client, WebSocketMessageType.Text, ct, () =>
        {
            app.Services.GetRequiredService<WebSocketBroadcaster>().Broadcast("test.local", new { });
            resumeUpstream.TrySetResult();
        });
        Assert.True(largeEvent.AsSpan().SequenceEqual(relayed), "The large fragmented event should arrive intact.");
        Assert.Equal("test.local", ReadType(await ReceiveAsync(client, WebSocketMessageType.Text, ct)));
    }

    [Fact]
    public async Task Shutdown_can_send_a_close_while_the_relay_waits_for_a_continuation()
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        var ct = timeout.Token;
        await using var upstream = CreateBuilder().Build();
        upstream.UseWebSockets();
        upstream.Map("/ws", async (HttpContext context) =>
        {
            using var ws = await context.WebSockets.AcceptWebSocketAsync();
            await ws.SendAsync("{\"type\":\"test.relay\",\"data\":\""u8.ToArray().AsMemory(),
                WebSocketMessageType.Text, false, context.RequestAborted);
            var close = await ws.ReceiveAsync(new byte[64], context.RequestAborted);
            if (close.MessageType == WebSocketMessageType.Close)
                await ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "", context.RequestAborted);
        });
        await upstream.StartAsync(ct);
        await using var tunnel = new CloudflareTunnelService();
        await using var app = CreateAppHost(tunnel, upstream.Urls.Single());
        await app.StartAsync(ct);

        using var client = await ConnectAsync(app, "user", useBrowserCookie: true, ct);
        Assert.Equal("upstream.connected", ReadType(await ReceiveAsync(client, WebSocketMessageType.Text, ct)));
        var fragment = await client.ReceiveAsync(new byte[64], ct);
        Assert.Equal(WebSocketMessageType.Text, fragment.MessageType);
        Assert.False(fragment.EndOfMessage);

        var stopping = app.StopAsync(ct);
        var closed = await client.ReceiveAsync(new byte[64], ct);
        Assert.Equal(WebSocketMessageType.Close, closed.MessageType);
        Assert.Equal(WebSocketCloseStatus.EndpointUnavailable, closed.CloseStatus);
        await client.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "", ct);
        await stopping;
    }

    private static WebApplication CreateAppHost(CloudflareTunnelService tunnel, string? upstream = null,
        Action<HttpContext>? observeUpgrade = null)
    {
        var builder = CreateBuilder();
        builder.Services.AddAppHostLogging();
        builder.Services.AddAppHostAuth(new AuthOptions { Jwt = Jwt });
        var app = builder.Build();
        app.UseAppHostForwardedHeaders();
        app.UseAppHostJwtAuth();
        if (observeUpgrade is not null)
            app.Use((context, next) => { observeUpgrade(context); return next(context); });
        app.UseWebSockets();
        app.MapAppHostEndpoints(new TestDescriptor(app.CreateEndpointRegistry()), tunnel, "Test", () => new(),
            logService: app.Services.GetRequiredService<LogService>(), wsProxyUpstreams: upstream is null ? null : [upstream],
            mapRemoteAccess: false, mapAutoStart: false);
        return app;
    }

    private static WebApplicationBuilder CreateBuilder()
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        return builder;
    }

    private static async Task<ClientWebSocket> ConnectAsync(WebApplication app, string? remoteRole,
        bool useBrowserCookie, CancellationToken ct)
    {
        var client = new ClientWebSocket();
        if (remoteRole is not null)
        {
            client.Options.SetRequestHeader("Cf-Ray", "synthetic-test");
            var token = new JwtService(Jwt).GenerateBrowserAccessToken("synthetic-user", "user@example.test", "User", [remoteRole]);
            if (useBrowserCookie)
                client.Options.SetRequestHeader("Cookie", $"redsuite_token={token}");
            else
                client.Options.SetRequestHeader("Authorization", $"Bearer {token}");
        }
        try
        {
            await client.ConnectAsync(new UriBuilder(app.Urls.Single()) { Scheme = "ws", Path = "/ws" }.Uri, ct);
            return client;
        }
        catch
        {
            client.Dispose();
            throw;
        }
    }

    private static async Task<byte[]> ReceiveAsync(WebSocket ws, WebSocketMessageType messageType, CancellationToken ct,
        Action? onFirstFragment = null)
    {
        using var message = new MemoryStream();
        var buffer = new byte[8192];
        WebSocketReceiveResult result;
        do
        {
            result = await ws.ReceiveAsync(buffer, ct);
            Assert.Equal(messageType, result.MessageType);
            message.Write(buffer, 0, result.Count);
            onFirstFragment?.Invoke();
            onFirstFragment = null;
        } while (!result.EndOfMessage);
        return message.ToArray();
    }

    private static string? ReadType(byte[] message)
    {
        using var document = JsonDocument.Parse(message);
        return document.RootElement.GetProperty("type").GetString();
    }

    private sealed class TestDescriptor(EndpointRegistry registry) : RegistryServiceDescriptor(registry)
    {
        public override string ServiceName => "Test";
        public override string Version => "1.0";
        public override string Description => "AppHost WebSocket test";
        public override string ApiBase => "";
        public override Task<IReadOnlyList<CapabilityDescriptor>> GetCapabilitiesAsync() =>
            Task.FromResult<IReadOnlyList<CapabilityDescriptor>>([]);
    }
}
