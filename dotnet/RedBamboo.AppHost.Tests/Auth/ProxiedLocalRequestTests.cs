using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using RedBamboo.AppHost.Auth;
using RedBamboo.AppHost.Extensions;
using Xunit;

namespace RedBamboo.AppHost.Tests.Auth;

/// <summary>
/// A proxy on this machine other than cloudflared (nginx, Caddy, ngrok, tailscale serve) also reaches
/// Kestrel over loopback. A tokenless request carrying only <c>Forwarded: for=203.0.113.9</c> used to be
/// the local admin (security audit, 2026-11-06). Every case here runs the real forwarded-headers
/// middleware with the AppHost options before the auth middleware, as the services do.
/// </summary>
public class ProxiedLocalRequestTests
{
    private static readonly JwtOptions Jwt = new() { SigningKey = new string('k', 64) };

    private static DefaultHttpContext Request(string peer = "127.0.0.1", params (string Name, string Value)[] headers)
    {
        var context = new DefaultHttpContext();
        context.Request.Path = "/api/entities";
        context.Request.Headers.Accept = "application/json";
        foreach (var (name, value) in headers) context.Request.Headers[name] = value;
        context.Connection.RemoteIpAddress = IPAddress.Parse(peer);
        context.Connection.LocalIpAddress = IPAddress.Loopback;
        context.Response.Body = new MemoryStream();
        return context;
    }

    /// <summary>UseAppHostForwardedHeaders, then the endpoint; returns whether the request came out local.</summary>
    private static async Task<bool> IsLocalAfterForwarding(DefaultHttpContext context)
    {
        var local = false;
        var forwarding = new ForwardedHeadersMiddleware(c =>
        {
            local = RequestOrigin.IsLocal(c);
            return Task.CompletedTask;
        }, NullLoggerFactory.Instance, Options.Create(AppHostExtensions.CreateForwardedHeadersOptions()));
        await forwarding.Invoke(context);
        return local;
    }

    /// <summary>UseAppHostForwardedHeaders, then AuthMiddleware, then the endpoint: the services' order.</summary>
    private static async Task<(int Status, string? Sub)> Send(AuthMode mode, DefaultHttpContext context)
    {
        var reached = false;
        string? sub = null;
        var options = new AuthOptions { Mode = mode, Jwt = Jwt };
        var auth = new AuthMiddleware(c =>
        {
            reached = true;
            sub = c.User.FindFirstValue("sub");
            return Task.CompletedTask;
        }, options, new JwtService(Jwt));
        var forwarding = new ForwardedHeadersMiddleware(auth.InvokeAsync, NullLoggerFactory.Instance,
            Options.Create(AppHostExtensions.CreateForwardedHeadersOptions()));
        await forwarding.Invoke(context);
        return (reached ? 200 : context.Response.StatusCode, sub);
    }

    [Fact]
    public async Task A_plain_loopback_request_stays_local()
    {
        Assert.True(await IsLocalAfterForwarding(Request()));
        Assert.True(await IsLocalAfterForwarding(Request("::1")));
    }

    [Theory]
    [InlineData("127.0.0.1")]
    [InlineData("::1")]
    [InlineData("[::1]:51234")]
    public async Task A_forwarded_for_that_resolves_to_loopback_stays_local(string client)
    {
        var context = Request(headers: [("X-Forwarded-For", client)]);
        Assert.True(await IsLocalAfterForwarding(context));
        // Consumed: the header is gone and the original peer is kept aside.
        Assert.False(context.Request.Headers.ContainsKey("X-Forwarded-For"));
        Assert.True(context.Request.Headers.ContainsKey("X-Original-For"));
    }

    [Fact]
    public async Task A_forwarded_for_naming_a_remote_client_is_not_local()
        => Assert.False(await IsLocalAfterForwarding(Request(headers: [("X-Forwarded-For", "203.0.113.9")])));

    [Theory]
    [InlineData("for=203.0.113.9")]
    [InlineData("for=127.0.0.1")]
    [InlineData("for=\"[2001:db8::1]:4711\";proto=https")]
    [InlineData("for=unknown")]
    public async Task An_rfc7239_forwarded_header_is_never_local(string forwarded)
        => Assert.False(await IsLocalAfterForwarding(Request(headers: [("Forwarded", forwarded)])));

    [Fact]
    public async Task A_forwarded_header_is_not_local_even_beside_a_loopback_forwarded_for()
        => Assert.False(await IsLocalAfterForwarding(
            Request(headers: [("X-Forwarded-For", "127.0.0.1"), ("Forwarded", "for=203.0.113.9")])));

    [Theory]
    [InlineData("not-an-address")]
    [InlineData("unknown")]
    [InlineData("203.0.113.9, 127.0.0.1")] // a chain longer than the one hop we trust: the client stays unresolved
    public async Task A_forwarded_for_the_middleware_did_not_consume_is_not_local(string value)
    {
        var context = Request(headers: [("X-Forwarded-For", value)]);
        Assert.False(await IsLocalAfterForwarding(context));
        Assert.True(context.Request.Headers.ContainsKey("X-Forwarded-For"));
    }

    [Fact]
    public void Without_the_forwarding_middleware_any_forwarded_for_is_not_local()
        => Assert.False(RequestOrigin.IsLocal(Request(headers: [("X-Forwarded-For", "127.0.0.1")])));

    [Fact]
    public async Task The_tunnel_headers_still_mean_remote()
    {
        Assert.False(await IsLocalAfterForwarding(Request(headers: [("Cf-Ray", "8abc-CDG")])));
        Assert.False(await IsLocalAfterForwarding(Request(headers: [("Cf-Connecting-Ip", "203.0.113.9")])));
    }

    [Theory]
    [InlineData(AuthMode.LocalDefault)]
    [InlineData(AuthMode.Required)]
    public async Task A_tokenless_request_with_a_forwarded_header_is_refused_on_an_api_route(AuthMode mode)
    {
        var (status, sub) = await Send(mode, Request(headers: [("Forwarded", "for=203.0.113.9")]));
        Assert.Equal(StatusCodes.Status401Unauthorized, status);
        Assert.Null(sub);
    }

    [Theory]
    [InlineData("not-an-address")]
    [InlineData("203.0.113.9, 127.0.0.1")]
    public async Task A_tokenless_request_with_an_unconsumed_forwarded_for_is_refused_on_an_api_route(string value)
    {
        var (status, sub) = await Send(AuthMode.LocalDefault, Request(headers: [("X-Forwarded-For", value)]));
        Assert.Equal(StatusCodes.Status401Unauthorized, status);
        Assert.Null(sub);
    }

    [Fact]
    public async Task A_tokenless_request_forwarded_for_loopback_stays_the_default_identity()
    {
        var (status, sub) = await Send(AuthMode.LocalDefault, Request(headers: [("X-Forwarded-For", "127.0.0.1")]));
        Assert.Equal(200, status);
        Assert.Equal("local-user", sub);
    }

    [Fact]
    public async Task A_plain_tokenless_loopback_request_stays_the_default_identity()
    {
        var (status, sub) = await Send(AuthMode.LocalDefault, Request());
        Assert.Equal(200, status);
        Assert.Equal("local-user", sub);
    }

    [Fact]
    public void Operating_routes_refuse_a_forwarded_anonymous_caller()
        => Assert.False(InfrastructureAccess.Allows(Request(headers: [("Forwarded", "for=203.0.113.9")])));
}
