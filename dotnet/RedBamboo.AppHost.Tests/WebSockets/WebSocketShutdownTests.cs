using System.Diagnostics;
using System.Net.WebSockets;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using RedBamboo.AppHost.WebSockets;
using Xunit;

namespace RedBamboo.AppHost.Tests.WebSockets;

/// <summary>
/// An open browser tab used to hold every stop and in-process restart for Kestrel's whole
/// shutdown timeout (30 s): the /ws receive loop only watched RequestAborted, which Kestrel
/// fires after that timeout (Linux preview e2e, 2026-11-09). Stopping now closes the socket.
/// </summary>
public class WebSocketShutdownTests
{
    private static async Task<(WebApplication App, Uri Ws)> StartAsync()
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        var app = builder.Build();
        app.UseWebSockets();
        app.MapWebSocketEndpoints(new WebSocketBroadcaster());
        await app.StartAsync();
        var http = new Uri(app.Urls.Single());
        return (app, new Uri($"ws://{http.Authority}/ws"));
    }

    [Fact]
    public async Task Stopping_closes_an_open_socket_with_1001_instead_of_waiting_out_the_timeout()
    {
        var (app, uri) = await StartAsync();
        using var client = new ClientWebSocket();
        await client.ConnectAsync(uri, CancellationToken.None);
        // A browser answers the server's close frame; so does this client.
        var receive = Task.Run(async () =>
        {
            var result = await client.ReceiveAsync(new byte[64], CancellationToken.None);
            if (result.MessageType == WebSocketMessageType.Close)
                await client.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None);
            return result;
        });

        var watch = Stopwatch.StartNew();
        await app.StopAsync();
        watch.Stop();
        await app.DisposeAsync();

        var closed = await receive.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(WebSocketMessageType.Close, closed.MessageType);
        Assert.Equal(WebSocketCloseStatus.EndpointUnavailable, closed.CloseStatus);
        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(5), $"stop took {watch.Elapsed.TotalSeconds:F1} s");
    }

    [Fact]
    public async Task A_client_that_never_acknowledges_the_close_holds_the_stop_only_for_the_grace()
    {
        var (app, uri) = await StartAsync();
        using var client = new ClientWebSocket();
        await client.ConnectAsync(uri, CancellationToken.None);

        var watch = Stopwatch.StartNew();
        await app.StopAsync();
        watch.Stop();
        await app.DisposeAsync();

        Assert.True(watch.Elapsed < WebSocketEndpoints.ShutdownCloseGrace + TimeSpan.FromSeconds(3),
            $"stop took {watch.Elapsed.TotalSeconds:F1} s");
    }
}
