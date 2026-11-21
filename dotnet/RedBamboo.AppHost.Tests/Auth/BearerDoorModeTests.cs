using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using RedBamboo.AppHost.Auth;
using Xunit;

namespace RedBamboo.AppHost.Tests.Auth;

/// <summary>The tunnel shared secret: a service identity by default, only a door in door mode.</summary>
public class BearerDoorModeTests
{
    private const string Secret = "tunnel-secret-for-tests";

    private static DefaultHttpContext Remote(string path = "/api/entities", string? bearer = null, string? query = null,
        bool page = false)
    {
        var ctx = new DefaultHttpContext();
        ctx.Request.Path = path;
        if (query is not null) ctx.Request.QueryString = new QueryString(query);
        ctx.Request.Headers.Accept = page ? "text/html" : "application/json";
        if (bearer is not null) ctx.Request.Headers.Authorization = "Bearer " + bearer;
        ctx.Request.Headers["Cf-Connecting-Ip"] = "203.0.113.9";
        ctx.Connection.RemoteIpAddress = IPAddress.Loopback;
        ctx.Connection.LocalIpAddress = IPAddress.Loopback;
        ctx.Response.Body = new MemoryStream();
        return ctx;
    }

    private static async Task<(bool Reached, string? Sub, bool Door, int Status)> Send(DefaultHttpContext ctx, bool doorOnly,
        bool fallThrough = false)
    {
        var reached = false;
        string? sub = null;
        var middleware = new BearerAuthMiddleware(c =>
        {
            reached = true;
            sub = c.User.FindFirstValue("sub");
            return Task.CompletedTask;
        }, new BearerAuthOptions { GetAccessToken = () => Secret, DoorOnly = doorOnly, FallThroughOnFailure = fallThrough });
        await middleware.InvokeAsync(ctx);
        return (reached, sub, BearerAuthMiddleware.DoorPassed(ctx), ctx.Response.StatusCode);
    }

    [Fact]
    public async Task By_default_the_secret_still_makes_the_request_a_service_as_before()
    {
        var (reached, sub, door, _) = await Send(Remote(bearer: Secret), doorOnly: false);
        Assert.True(reached);
        Assert.Equal("service", sub);
        Assert.False(door);
    }

    [Fact]
    public async Task In_door_mode_the_secret_lets_the_request_through_with_no_identity()
    {
        var (reached, sub, door, _) = await Send(Remote(bearer: Secret), doorOnly: true);
        Assert.True(reached);
        Assert.Null(sub);
        Assert.True(door);
    }

    [Fact]
    public async Task In_door_mode_a_page_may_not_carry_the_secret_in_its_url()
    {
        var page = await Send(Remote(path: "/workspace", query: "?token=" + Secret, page: true), doorOnly: true);
        Assert.False(page.Reached);
        Assert.Equal(401, page.Status);

        var api = await Send(Remote(query: "?token=" + Secret), doorOnly: true);
        Assert.True(api.Reached);
        Assert.True(api.Door);
    }

    [Fact]
    public async Task A_wrong_secret_is_refused_in_both_modes_unless_the_host_falls_through()
    {
        Assert.Equal(401, (await Send(Remote(bearer: "wrong"), doorOnly: true)).Status);
        Assert.Equal(401, (await Send(Remote(bearer: "wrong"), doorOnly: false)).Status);
        var fallThrough = await Send(Remote(bearer: "wrong"), doorOnly: true, fallThrough: true);
        Assert.True(fallThrough.Reached);
        Assert.False(fallThrough.Door);
        Assert.Null(fallThrough.Sub);
    }
}
