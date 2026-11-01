using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using RedBamboo.AppHost.Auth;
using Xunit;

namespace RedBamboo.AppHost.Tests.Auth;

/// <summary>
/// An install without a Google sign-in runs in LocalDefault. Through a tunnel its anonymous callers
/// used to reach the routes themselves (field report, 2026-11-01).
/// </summary>
public class RemoteAnonymousAccessTests
{
    private static readonly JwtOptions Jwt = new() { SigningKey = new string('k', 64) };

    private static DefaultHttpContext Request(
        string path = "/api/entities", string accept = "application/json", string peer = "127.0.0.1", bool tunnel = true)
    {
        var context = new DefaultHttpContext();
        context.Request.Path = path;
        context.Request.Headers.Accept = accept;
        if (tunnel) context.Request.Headers["Cf-Connecting-Ip"] = "203.0.113.9";
        context.Connection.RemoteIpAddress = IPAddress.Parse(peer);
        context.Connection.LocalIpAddress = IPAddress.Loopback;
        context.Response.Body = new MemoryStream();
        return context;
    }

    private static async Task<(bool Reached, string? Sub)> Send(AuthMode mode, DefaultHttpContext context)
    {
        var reached = false;
        string? sub = null;
        var options = new AuthOptions { Mode = mode, Jwt = Jwt };
        var middleware = new AuthMiddleware(c =>
        {
            reached = true;
            sub = c.User.FindFirstValue("sub");
            return Task.CompletedTask;
        }, options, new JwtService(Jwt));
        await middleware.InvokeAsync(context);
        return (reached, sub);
    }

    [Theory]
    [InlineData(AuthMode.LocalDefault)]
    [InlineData(AuthMode.Required)]
    public async Task A_tunnel_request_without_sign_in_is_refused_in_every_mode(AuthMode mode)
    {
        var context = Request();
        var (reached, _) = await Send(mode, context);
        Assert.False(reached);
        Assert.Equal(StatusCodes.Status401Unauthorized, context.Response.StatusCode);
    }

    [Fact]
    public async Task A_non_loopback_peer_without_sign_in_is_refused_without_a_provider()
    {
        var context = Request(peer: "192.168.1.20", tunnel: false);
        var (reached, _) = await Send(AuthMode.LocalDefault, context);
        Assert.False(reached);
        Assert.Equal(StatusCodes.Status401Unauthorized, context.Response.StatusCode);
    }

    [Theory]
    [InlineData(AuthMode.LocalDefault, "/?returnUrl=")]
    [InlineData(AuthMode.Required, "/login?returnUrl=")]
    public async Task A_browser_is_sent_where_it_can_sign_in(AuthMode mode, string target)
    {
        var context = Request(path: "/apps/nova", accept: "text/html");
        var (reached, _) = await Send(mode, context);
        Assert.False(reached);
        Assert.Equal(StatusCodes.Status302Found, context.Response.StatusCode);
        Assert.StartsWith(target, context.Response.Headers.Location.ToString());
    }

    [Fact]
    public async Task Asking_for_html_never_opens_an_api_route()
    {
        var context = Request(accept: "text/html");
        var (reached, _) = await Send(AuthMode.LocalDefault, context);
        Assert.False(reached);
    }

    [Fact]
    public async Task The_local_caller_stays_the_default_identity()
    {
        var (reached, sub) = await Send(AuthMode.LocalDefault, Request(tunnel: false));
        Assert.True(reached);
        Assert.Equal("local-user", sub);
    }

    [Theory]
    [InlineData("/ping")]
    [InlineData("/discover")]
    [InlineData("/login")]
    [InlineData("/")]
    public async Task Public_paths_stay_public_through_a_tunnel(string path)
    {
        var (reached, _) = await Send(AuthMode.LocalDefault, Request(path: path));
        Assert.True(reached);
    }

    private static ClaimsPrincipal Signed(string roles)
        => new(new ClaimsIdentity([new Claim("sub", "user-1"), new Claim("roles", roles)], "test"));

    [Theory]
    [InlineData("[\"admin\"]", true)]
    [InlineData("admin", true)]
    [InlineData("[\"user\"]", false)]
    [InlineData("user", false)]
    [InlineData("[not json", false)]
    public void Remote_operating_routes_answer_only_an_admin(string roles, bool allowed)
    {
        var context = Request();
        context.User = Signed(roles);
        Assert.Equal(allowed, InfrastructureAccess.Allows(context));
    }

    [Fact]
    public void Remote_operating_routes_refuse_an_unauthenticated_admin_claim()
    {
        var context = Request();
        context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("roles", "admin")]));
        Assert.False(InfrastructureAccess.Allows(context));
    }

    [Fact]
    public void Operating_routes_stay_open_to_this_machine()
        => Assert.True(InfrastructureAccess.Allows(Request(tunnel: false)));
}
