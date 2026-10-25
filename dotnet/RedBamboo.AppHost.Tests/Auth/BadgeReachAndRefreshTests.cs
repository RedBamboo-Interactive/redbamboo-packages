using Xunit;
using System.Net;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using RedBamboo.AppHost.Auth;
using RedBamboo.AppHost.Auth.Vault;

namespace RedBamboo.AppHost.Tests.Auth;

/// <summary>The <c>net</c> claim rule at the HTTP boundary, and the rotating refresh cookie.</summary>
public class BadgeReachAndRefreshTests
{
    private static (JwtService Jwt, FakeBadgeVault Vault, AuthOptions Options) Setup()
    {
        var vault = new FakeBadgeVault();
        var authority = new VaultBadgeAuthority(vault);
        authority.RefreshKeysAsync().GetAwaiter().GetResult();
        var jwtOptions = new JwtOptions { Vault = authority };
        return (new JwtService(jwtOptions), vault, new AuthOptions { Mode = AuthMode.Required, Jwt = jwtOptions });
    }

    private static DefaultHttpContext Request(string? bearer, string? peer = "127.0.0.1", string local = "127.0.0.1",
        params (string, string)[] headers)
    {
        var ctx = new DefaultHttpContext();
        ctx.Request.Path = "/api/entities";
        ctx.Request.Headers.Accept = "application/json";
        if (bearer is not null) ctx.Request.Headers.Authorization = "Bearer " + bearer;
        foreach (var (k, v) in headers) ctx.Request.Headers[k] = v;
        ctx.Connection.RemoteIpAddress = peer is null ? null : IPAddress.Parse(peer);
        ctx.Connection.LocalIpAddress = IPAddress.Parse(local);
        ctx.Response.Body = new MemoryStream();
        return ctx;
    }

    /// <summary>Runs the real middleware; returns the HTTP status (200 when the pipeline reached the endpoint) and the identity it saw.</summary>
    private static async Task<(int Status, string? Sub)> Send(JwtService jwt, AuthOptions options, DefaultHttpContext ctx)
    {
        string? sub = null;
        var reached = false;
        var middleware = new AuthMiddleware(c => { reached = true; sub = c.User.FindFirstValue("sub"); return Task.CompletedTask; }, options, jwt);
        await middleware.InvokeAsync(ctx);
        return (reached ? 200 : ctx.Response.StatusCode, sub);
    }

    private static string LocalBadge(JwtService jwt) => jwt.GenerateServiceAccessToken("redleaf");
    private static string RemoteBadge(JwtService jwt) => jwt.GenerateBrowserAccessToken("user-1", "u@example.test", "U", ["user"]);

    [Fact]
    public async Task Local_badge_over_loopback_is_accepted()
    {
        var (jwt, _, options) = Setup();
        var (status, sub) = await Send(jwt, options, Request(LocalBadge(jwt)));
        Assert.Equal(200, status);
        Assert.Equal("service:redleaf", sub);
    }

    [Theory]
    [InlineData("Cf-Connecting-Ip", "203.0.113.9")]
    [InlineData("Cf-Ray", "8abc-CDG")]
    public async Task Local_badge_with_tunnel_headers_is_refused_even_from_a_loopback_peer(string header, string value)
    {
        var (jwt, _, options) = Setup();
        var (status, sub) = await Send(jwt, options, Request(LocalBadge(jwt), headers: [(header, value)]));
        Assert.Equal(401, status);
        Assert.Null(sub);
    }

    [Fact]
    public async Task Local_badge_from_a_non_loopback_peer_is_refused()
    {
        var (jwt, _, options) = Setup();
        var (status, _) = await Send(jwt, options, Request(LocalBadge(jwt), peer: "192.168.1.50", local: "192.168.1.2"));
        Assert.Equal(401, status);
    }

    [Fact]
    public async Task Local_badge_behind_the_tunnel_after_forwarded_headers_rewrote_the_peer_is_refused()
    {
        var (jwt, _, options) = Setup();
        // UseAppHostForwardedHeaders replaces the peer with the X-Forwarded-For client for a loopback proxy.
        var (status, _) = await Send(jwt, options, Request(LocalBadge(jwt), peer: "203.0.113.9"));
        Assert.Equal(401, status);
    }

    [Theory]
    [InlineData("127.0.0.1", false)]
    [InlineData("::1", false)]
    [InlineData("203.0.113.9", false)]
    [InlineData("192.168.1.50", false)]
    [InlineData("127.0.0.1", true)]
    [InlineData("203.0.113.9", true)]
    public async Task Remote_badge_is_accepted_on_every_path(string peer, bool tunnel)
    {
        var (jwt, _, options) = Setup();
        var headers = tunnel ? new[] { ("Cf-Ray", "x"), ("Cf-Connecting-Ip", "203.0.113.9") } : [];
        var (status, sub) = await Send(jwt, options, Request(RemoteBadge(jwt), peer: peer, local: "192.168.1.2", headers: headers));
        Assert.Equal(200, status);
        Assert.Equal("user-1", sub);
    }

    [Fact]
    public async Task Cookie_badge_follows_the_same_rule()
    {
        var (jwt, _, options) = Setup();
        var ctx = Request(null, headers: [("Cf-Ray", "x")]);
        ctx.Request.Headers.Cookie = $"{options.CookieName}={LocalBadge(jwt)}";
        Assert.Equal(401, (await Send(jwt, options, ctx)).Status);
    }

    [Fact]
    public async Task Legacy_badges_without_net_keep_todays_behaviour_on_every_path()
    {
        var legacy = new JwtService(new JwtOptions { SigningKey = new string('k', 64) });
        var options = new AuthOptions { Mode = AuthMode.Required, Jwt = new JwtOptions { SigningKey = new string('k', 64) } };
        var token = legacy.GenerateServiceAccessToken("redleaf");

        Assert.Equal(200, (await Send(legacy, options, Request(token))).Status);
        Assert.Equal(200, (await Send(legacy, options, Request(token, headers: [("Cf-Ray", "x")]))).Status);
        Assert.Equal(200, (await Send(legacy, options, Request(token, peer: "203.0.113.9"))).Status);
    }

    // ----- /auth/refresh -----

    private sealed class Fixture
    {
        public required JwtService Jwt { get; init; }
        public required FakeBadgeVault Vault { get; init; }
        public required AuthOptions Options { get; init; }
        public InMemoryRefreshTokenStore Tokens { get; } = new();
        public InMemoryUserStore Users { get; } = new();
        public string UserId { get; set; } = "";
    }

    private static async Task<Fixture> RefreshFixture()
    {
        var (jwt, vault, options) = Setup();
        var f = new Fixture { Jwt = jwt, Vault = vault, Options = options };
        var user = await f.Users.CreateOrUpdateFromExternalAsync(new ExternalIdentity("g-1", "owner@example.test", "Owner", null, "google"));
        f.UserId = user.Id;
        return f;
    }

    private static async Task<string> Login(Fixture f)
    {
        var token = f.Jwt.GenerateRefreshToken();
        await f.Tokens.StoreAsync(token, f.UserId, DateTimeOffset.UtcNow.AddDays(30));
        return token;
    }

    private static async Task<(int Status, DefaultHttpContext Ctx)> Refresh(Fixture f, string? cookie)
    {
        var ctx = new DefaultHttpContext();
        ctx.Response.Body = new MemoryStream();
        if (cookie is not null) ctx.Request.Headers.Cookie = $"{f.Options.RefreshCookieName}={cookie}";
        var result = await AuthEndpoints.RefreshAsync(ctx, f.Tokens, f.Users, f.Jwt, f.Options);
        return (((IStatusCodeHttpResult)result).StatusCode ?? 200, ctx);
    }

    private static string? SetCookieValue(DefaultHttpContext ctx, string name)
    {
        foreach (var header in ctx.Response.Headers.SetCookie)
        {
            if (header is null || !header.StartsWith(name + "=", StringComparison.Ordinal)) continue;
            return header[(name.Length + 1)..].Split(';')[0];
        }
        return null;
    }

    [Fact]
    public async Task Refresh_rotates_the_cookie_and_issues_a_fresh_one_hour_remote_badge()
    {
        var f = await RefreshFixture();
        var first = await Login(f);

        var (status, ctx) = await Refresh(f, first);

        Assert.Equal(200, status);
        var access = SetCookieValue(ctx, f.Options.CookieName)!;
        var rotated = SetCookieValue(ctx, f.Options.RefreshCookieName)!;
        Assert.NotEqual(first, rotated);
        var principal = f.Jwt.ValidateToken(access)!;
        Assert.Equal("remote", principal.FindFirstValue("net"));
        Assert.Equal(f.UserId, principal.FindFirstValue("sub"));
        Assert.Equal(3600, long.Parse(principal.FindFirstValue("exp")!) - long.Parse(principal.FindFirstValue("iat")!));
        Assert.Contains("max-age=3600", string.Join(';', ctx.Response.Headers.SetCookie.ToArray()).ToLowerInvariant());
    }

    [Fact]
    public async Task A_refresh_token_works_once_then_the_next_one_works_and_the_old_one_is_revoked()
    {
        var f = await RefreshFixture();
        var first = await Login(f);

        var (s1, c1) = await Refresh(f, first);
        var second = SetCookieValue(c1, f.Options.RefreshCookieName)!;
        var (s2, c2) = await Refresh(f, second);
        var third = SetCookieValue(c2, f.Options.RefreshCookieName)!;

        Assert.Equal([200, 200], [s1, s2]);
        Assert.Equal(3, new[] { first, second, third }.Distinct().Count());
        Assert.Equal(401, (await Refresh(f, first)).Status);  // replay of a rotated-away token
        Assert.Equal(401, (await Refresh(f, second)).Status);
        Assert.Equal(200, (await Refresh(f, third)).Status);
    }

    [Fact]
    public async Task Refresh_without_a_cookie_or_with_an_expired_or_revoked_token_is_401_and_clears_the_cookie()
    {
        var f = await RefreshFixture();
        Assert.Equal(401, (await Refresh(f, null)).Status);

        var expired = f.Jwt.GenerateRefreshToken();
        await f.Tokens.StoreAsync(expired, f.UserId, DateTimeOffset.UtcNow.AddMinutes(-1));
        var (status, ctx) = await Refresh(f, expired);
        Assert.Equal(401, status);
        Assert.Contains(ctx.Response.Headers.SetCookie.ToArray(), h => h!.StartsWith(f.Options.RefreshCookieName + "=;", StringComparison.Ordinal) || h.Contains("expires=Thu, 01 Jan 1970"));

        var revoked = await Login(f);
        await f.Tokens.RevokeByTokenAsync(revoked);
        Assert.Equal(401, (await Refresh(f, revoked)).Status);
    }

    [Fact]
    public async Task Refresh_during_a_vault_outage_fails_without_revoking_the_refresh_token_so_the_next_try_succeeds()
    {
        var f = await RefreshFixture();
        var token = await Login(f);
        f.Vault.Down = true;

        var (status, ctx) = await Refresh(f, token);

        Assert.Equal(503, status); // transient for the web client: it retries, it never logs out
        Assert.Null(SetCookieValue(ctx, f.Options.RefreshCookieName));

        f.Vault.Down = false;
        Assert.Equal(200, (await Refresh(f, token)).Status); // the badge is minted before the swap, so nothing was lost
    }

    [Fact]
    public async Task Revoking_all_refresh_tokens_of_a_user_ends_the_session()
    {
        var f = await RefreshFixture();
        var token = await Login(f);
        await f.Tokens.RevokeAllForUserAsync(f.UserId);
        Assert.Equal(401, (await Refresh(f, token)).Status);
    }
}
