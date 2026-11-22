using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using RedBamboo.AppHost.Auth;
using Xunit;

namespace RedBamboo.AppHost.Tests.Auth;

/// <summary>
/// A valid badge in the Authorization header speaks for the request alone. An expired or invalid one is ignored, as
/// before 0.1.50: the request goes on as its session cookie (marked HeaderBadgeFallback, so the host still judges it
/// as a cookie session and never as person-present, logged ND-F7), or without one as LocalDefault on loopback
/// (ND-F5) and 401 elsewhere.
/// </summary>
public class BearerHeaderPrecedenceTests
{
    private const string Key = "bearer-precedence-signing-key-0123456789abcdef";

    private static (JwtService Jwt, AuthOptions Options) Setup(TimeSpan? lifetime = null)
    {
        var jwtOptions = new JwtOptions
        {
            SigningKey = Key,
            AccessTokenLifetime = lifetime ?? TimeSpan.FromDays(365),
            ExecutionTokenLifetime = lifetime ?? TimeSpan.FromMinutes(30),
            ClockSkew = TimeSpan.Zero,
        };
        return (new JwtService(jwtOptions), new AuthOptions { Mode = AuthMode.Required, Jwt = jwtOptions });
    }

    private static DefaultHttpContext Request(AuthOptions options, string? bearer, string? cookie, string peer = "203.0.113.7")
    {
        var ctx = new DefaultHttpContext();
        ctx.Request.Path = "/api/entities";
        ctx.Request.Headers.Accept = "application/json";
        if (bearer is not null) ctx.Request.Headers.Authorization = "Bearer " + bearer;
        if (cookie is not null) ctx.Request.Headers.Cookie = $"{options.CookieName}={cookie}";
        ctx.Connection.RemoteIpAddress = IPAddress.Parse(peer);
        ctx.Connection.LocalIpAddress = IPAddress.Parse("192.168.1.2");
        ctx.Response.Body = new MemoryStream();
        return ctx;
    }

    private sealed class CapturingLogger : Microsoft.Extensions.Logging.ILogger<AuthMiddleware>
    {
        public readonly List<string> Lines = [];
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(Microsoft.Extensions.Logging.LogLevel logLevel) => true;
        public void Log<TState>(Microsoft.Extensions.Logging.LogLevel logLevel, Microsoft.Extensions.Logging.EventId eventId,
            TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            lock (Lines) Lines.Add(formatter(state, exception));
        }
    }

    private static async Task<(int Status, string? Sub)> Send(JwtService jwt, AuthOptions options, DefaultHttpContext ctx,
        CapturingLogger? logger = null)
    {
        string? sub = null;
        var reached = false;
        var middleware = new AuthMiddleware(c => { reached = true; sub = c.User.FindFirstValue("sub"); return Task.CompletedTask; }, options, jwt, logger);
        await middleware.InvokeAsync(ctx);
        return (reached ? 200 : ctx.Response.StatusCode, sub);
    }

    private static async Task<(int Status, ClaimsPrincipal? User)> SendFor(JwtService jwt, AuthOptions options,
        DefaultHttpContext ctx, CapturingLogger? logger = null)
    {
        ClaimsPrincipal? user = null;
        var middleware = new AuthMiddleware(c => { user = c.User; return Task.CompletedTask; }, options, jwt, logger);
        await middleware.InvokeAsync(ctx);
        return (user is not null ? 200 : ctx.Response.StatusCode, user);
    }

    private static string Person(JwtService jwt) =>
        jwt.GenerateBrowserAccessToken("user-1", "owner@example.test", "Owner", ["admin"], null, "dev_01JD0000000000000000000000");

    [Fact]
    public async Task An_expired_badge_in_the_header_is_ignored_next_to_a_valid_session_cookie_marked_and_logged()
    {
        var (jwt, options) = Setup();
        var (shortLived, _) = Setup(TimeSpan.FromSeconds(1));
        var expired = shortLived.GenerateServiceAccessToken("agent");
        await Task.Delay(TimeSpan.FromMilliseconds(1500));
        Assert.Null(jwt.ValidateToken(expired));
        var logger = new CapturingLogger();
        var ctx = Request(options, expired, Person(jwt));
        ctx.Request.Path = "/api/entities/" + Guid.NewGuid().ToString("N");
        ctx.Request.Headers.UserAgent = "SomeApp/2.0";

        var (status, user) = await SendFor(jwt, options, ctx, logger);

        // As before 0.1.50: the cookie's session, with its sid for the host's device gate to judge.
        Assert.Equal(200, status);
        Assert.Equal("user-1", user!.FindFirstValue("sub"));
        Assert.Equal("dev_01JD0000000000000000000000", user.FindFirstValue(SessionClaims.SessionId));
        Assert.True(HeaderBadgeFallback.Applied(user));
        var line = Assert.Single(logger.Lines);
        Assert.Contains("(ND-F7)", line);
        Assert.Contains("app=agent", line);
        Assert.Contains("ua=SomeApp/2.0", line);
        Assert.Contains(ctx.Request.Path.Value!, line);
        Assert.DoesNotContain(expired.Split('.')[2], line);
    }

    [Fact]
    public async Task A_badge_signed_by_another_key_in_the_header_is_ignored_next_to_a_valid_cookie_which_is_left_alone()
    {
        var (jwt, options) = Setup();
        var forged = new JwtService(new JwtOptions { SigningKey = "some-other-signing-key-0123456789abcdef" })
            .GenerateServiceAccessToken("agent");

        var ctx = Request(options, forged, Person(jwt));
        var (status, user) = await SendFor(jwt, options, ctx);

        Assert.Equal(200, status);
        Assert.Equal("user-1", user!.FindFirstValue("sub"));
        Assert.True(HeaderBadgeFallback.Applied(user));
        Assert.DoesNotContain(ctx.Response.Headers.SetCookie.ToArray(), h => h!.StartsWith(options.CookieName + "="));  // the session is left alone
    }

    [Fact]
    public async Task An_expired_execution_badge_next_to_an_invalid_cookie_is_refused_remotely_and_names_its_app_on_loopback()
    {
        var (jwt, options) = Setup();
        var (shortLived, _) = Setup(TimeSpan.FromSeconds(1));
        var execution = shortLived.GenerateExecutionToken(
            new ExecutionIdentity(ExecutionIdentity.CurrentSchemaVersion, Guid.NewGuid().ToString(),
                new ExecutionAppIdentity("leaf-pixoo", "Pixoo"), new ExecutionActorIdentity("app", "leaf-pixoo", "Pixoo"),
                new ExecutionBeneficiaryIdentity("user", "user-1", "Owner"), [new ExecutionContextReference("browser", Route: "/apps/leaf-pixoo")]),
            new ExecutionPrincipal("user-1", "owner@example.test", "Owner", ["admin"]), DateTimeOffset.UtcNow.AddSeconds(1));
        await Task.Delay(TimeSpan.FromMilliseconds(1500));
        var staleCookie = await Expired();

        // Remote: nothing valid is left, so 401 as before.
        var (status, user) = await SendFor(jwt, options, Request(options, execution, staleCookie));
        Assert.Equal(401, status);
        Assert.Null(user);

        // Loopback: LocalDefault, logged as ND-F5 with the badge's app, never marked.
        var logger = new CapturingLogger();
        var ctx = Request(options, execution, staleCookie, peer: "127.0.0.1");
        ctx.Connection.LocalIpAddress = IPAddress.Loopback;
        ctx.Request.Path = "/api/apps/leaf-pixoo/" + Guid.NewGuid().ToString("N");
        (status, user) = await SendFor(jwt, options, ctx, logger);
        Assert.Equal(200, status);
        Assert.Equal("local-user", user!.FindFirstValue("sub"));
        Assert.False(HeaderBadgeFallback.Applied(user));
        var line = Assert.Single(logger.Lines, l => l.Contains("(ND-F5)"));
        Assert.Contains("app=leaf-pixoo", line);
    }

    [Fact]
    public async Task The_cookie_fallback_warning_is_written_once_per_window_for_the_same_caller()
    {
        var (jwt, options) = Setup();
        var expired = await Expired();
        var logger = new CapturingLogger();
        var path = "/api/apps/nova/messages/" + Guid.NewGuid().ToString("N");
        for (var i = 0; i < 3; i++)
        {
            var ctx = Request(options, expired, Person(jwt));
            ctx.Request.Path = path;
            Assert.Equal("user-1", (await Send(jwt, options, ctx, logger)).Sub);
        }
        Assert.Single(logger.Lines);
    }

    [Fact]
    public async Task A_valid_badge_in_the_header_speaks_for_the_request_not_the_cookie()
    {
        var (jwt, options) = Setup();
        var (status, sub) = await Send(jwt, options, Request(options, jwt.GenerateServiceAccessToken("redleaf"), Person(jwt), peer: "127.0.0.1"));
        Assert.Equal(200, status);
        Assert.Equal("service:redleaf", sub);
    }

    [Theory]
    [InlineData("tunnel-shared-secret-value")]
    [InlineData("a.b")]
    public async Task A_header_that_is_not_a_badge_still_leaves_the_cookie_in_charge(string notABadge)
    {
        var (jwt, options) = Setup();
        var (status, sub) = await Send(jwt, options, Request(options, notABadge, Person(jwt)));
        Assert.Equal(200, status);
        Assert.Equal("user-1", sub);
    }

    [Fact]
    public async Task Without_a_header_the_cookie_session_is_used_as_before()
    {
        var (jwt, options) = Setup();
        var (status, sub) = await Send(jwt, options, Request(options, null, Person(jwt)));
        Assert.Equal(200, status);
        Assert.Equal("user-1", sub);
    }

    private static async Task<string> Expired(TimeSpan? wait = null)
    {
        var (shortLived, _) = Setup(TimeSpan.FromSeconds(1));
        var expired = shortLived.GenerateServiceAccessToken("release-manager");
        await Task.Delay(wait ?? TimeSpan.FromMilliseconds(1500));
        return expired;
    }

    [Fact]
    public async Task Without_a_session_cookie_an_expired_header_badge_on_loopback_still_falls_back_to_LocalDefault_and_is_logged()
    {
        // ND-F5: Release Manager, Pixoo and stale REDLEAF_EXECUTION_TOKEN processes reuse badges past their lifetime.
        var (jwt, options) = Setup();
        var expired = await Expired();
        var logger = new CapturingLogger();
        var ctx = Request(options, expired, null, peer: "127.0.0.1");
        ctx.Connection.LocalIpAddress = IPAddress.Loopback;
        ctx.Request.Path = "/api/apps/release-manager/nightly/" + Guid.NewGuid().ToString("N");
        ctx.Request.Headers.UserAgent = "ReleaseManager-Nightly/1.0";

        var (status, sub) = await Send(jwt, options, ctx, logger);

        Assert.Equal(200, status);
        Assert.Equal("local-user", sub);
        var line = Assert.Single(logger.Lines);
        Assert.Contains(ctx.Request.Path.Value!, line);
        Assert.Contains("ReleaseManager-Nightly/1.0", line);
        Assert.Contains("sub=service:release-manager", line);
        Assert.DoesNotContain(expired, line);
        Assert.DoesNotContain(expired.Split('.')[2], line);
    }

    [Fact]
    public async Task The_fallback_warning_is_written_once_per_window_for_the_same_caller()
    {
        var (jwt, options) = Setup();
        var expired = await Expired();
        var logger = new CapturingLogger();
        var path = "/api/apps/leaf-pixoo/portraits/" + Guid.NewGuid().ToString("N");
        for (var i = 0; i < 3; i++)
        {
            var ctx = Request(options, expired, null, peer: "127.0.0.1");
            ctx.Connection.LocalIpAddress = IPAddress.Loopback;
            ctx.Request.Path = path;
            Assert.Equal("local-user", (await Send(jwt, options, ctx, logger)).Sub);
        }
        Assert.Single(logger.Lines);
    }

    [Fact]
    public async Task Without_a_session_cookie_an_expired_header_badge_from_another_machine_is_refused()
    {
        var (jwt, options) = Setup();
        var expired = await Expired();
        var logger = new CapturingLogger();
        var (status, sub) = await Send(jwt, options, Request(options, expired, null), logger);
        Assert.Equal(401, status);
        Assert.Null(sub);
        Assert.Empty(logger.Lines);
    }

    [Fact]
    public async Task On_loopback_an_expired_header_badge_next_to_a_session_cookie_goes_on_as_that_cookie_not_LocalDefault()
    {
        var (jwt, options) = Setup();
        var expired = await Expired();
        var ctx = Request(options, expired, Person(jwt), peer: "127.0.0.1");
        ctx.Connection.LocalIpAddress = IPAddress.Loopback;
        var (status, user) = await SendFor(jwt, options, ctx);
        Assert.Equal(200, status);
        Assert.Equal("user-1", user!.FindFirstValue("sub"));
        Assert.True(HeaderBadgeFallback.Applied(user));
    }

    [Fact]
    public async Task A_valid_cookie_alone_or_a_valid_header_badge_is_never_marked()
    {
        var (jwt, options) = Setup();
        Assert.False(HeaderBadgeFallback.Applied((await SendFor(jwt, options, Request(options, null, Person(jwt)))).User!));
        Assert.False(HeaderBadgeFallback.Applied((await SendFor(jwt, options, Request(options, Person(jwt), Person(jwt)))).User!));
    }

    [Fact]
    public async Task Among_several_valid_badge_cookies_the_one_with_a_device_session_wins()
    {
        var (jwt, options) = Setup();
        var old = jwt.GenerateBrowserAccessToken("user-1", "owner@example.test", "Owner", ["admin"]);  // before sessions
        var ctx = Request(options, null, null);
        ctx.Request.Headers.Cookie = $"{options.CookieName}={old}; {options.CookieName}={Person(jwt)}";
        string? sid = null;
        var middleware = new AuthMiddleware(c => { sid = c.User.FindFirstValue(SessionClaims.SessionId); return Task.CompletedTask; }, options, jwt);
        await middleware.InvokeAsync(ctx);
        Assert.Equal("dev_01JD0000000000000000000000", sid);
    }
}
