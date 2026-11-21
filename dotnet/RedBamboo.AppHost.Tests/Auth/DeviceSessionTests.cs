using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Extensions.DependencyInjection;
using RedBamboo.AppHost.Auth;
using RedBamboo.AppHost.Auth.Vault;
using RedBamboo.AppHost.Extensions;
using Xunit;

namespace RedBamboo.AppHost.Tests.Auth;

/// <summary>
/// Device sessions as AppHost sees them: one issuer that puts the session id (<c>sid</c>) in the badge and
/// the refresh family, rotation that keeps the family and detects reuse, logout that ends the family, and
/// the default hooks a host without session records (RedCompute) runs on.
/// </summary>
public class DeviceSessionTests
{
    private sealed class RecordingHooks : IDeviceSessionHooks
    {
        public List<(string Method, string Session)> Begun { get; } = [];
        public List<(string Session, string Reason)> Ended { get; } = [];
        public HashSet<string> EndedSessions { get; } = [];
        public DeviceSessionStatus StartAs { get; set; } = DeviceSessionStatus.Approved;

        /// <summary>Runs inside EndAsync, before it returns (to see what the store still holds then).</summary>
        public Action? OnEnd { get; set; }

        public Task<DeviceSessionStatus> BeginAsync(HttpContext context, AuthUser user, string method, string sessionId)
        {
            Begun.Add((method, sessionId));
            return Task.FromResult(StartAs);
        }

        public Task<DeviceSessionStatus> StatusAsync(string sessionId, string userId)
            => Task.FromResult(EndedSessions.Contains(sessionId) ? DeviceSessionStatus.Ended : DeviceSessionStatus.Approved);

        public Task EndAsync(string sessionId, string userId, string reason)
        {
            Ended.Add((sessionId, reason));
            EndedSessions.Add(sessionId);
            OnEnd?.Invoke();
            return Task.CompletedTask;
        }
    }

    /// <summary>
    /// A store that lets a test act in the middle of a renewal: around the replacement being stored, and by
    /// slowing that store down so two renewals overlap.
    /// </summary>
    private sealed class InterleavingStore(IRefreshTokenStore inner) : IRefreshTokenStore
    {
        public Func<Task>? BeforeStore { get; set; }
        public Func<Task>? AfterStore { get; set; }
        public TimeSpan StoreDelay { get; set; }

        public Task StoreAsync(string token, string userId, DateTimeOffset expiresAt)
            => StoreAsync(token, userId, expiresAt, null);

        public async Task StoreAsync(string token, string userId, DateTimeOffset expiresAt, string? familyId)
        {
            if (BeforeStore is not null) await BeforeStore();
            if (StoreDelay > TimeSpan.Zero) await Task.Delay(StoreDelay);
            await inner.StoreAsync(token, userId, expiresAt, familyId);
            if (AfterStore is not null) await AfterStore();
        }

        public Task<RefreshTokenValidation?> ValidateAsync(string token) => inner.ValidateAsync(token);
        public Task<RefreshTokenValidation?> FindAsync(string token) => inner.FindAsync(token);
        public Task<RefreshTokenValidation?> FindByHashAsync(string tokenHash) => inner.FindByHashAsync(tokenHash);
        public Task<RotationMark> MarkRotatedAsync(string entityId, string replacedByHash, DateTimeOffset rotatedAt,
            string? familyId = null, string? tokenHash = null)
            => inner.MarkRotatedAsync(entityId, replacedByHash, rotatedAt, familyId, tokenHash);
        public Task RevokeByIdAsync(string entityId) => inner.RevokeByIdAsync(entityId);
        public Task RevokeByTokenAsync(string token) => inner.RevokeByTokenAsync(token);
        public bool FailRevokes { get; set; }
        public Task<bool> RevokeFamilyAsync(string familyId)
            => FailRevokes ? throw new HttpRequestException("store down") : inner.RevokeFamilyAsync(familyId);
        public Task<bool> RevokeAllForUserAsync(string userId) => inner.RevokeAllForUserAsync(userId);
    }

    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private sealed class Fixture
    {
        public required JwtService Jwt { get; init; }
        public required FakeBadgeVault Vault { get; init; }
        public required AuthOptions Options { get; init; }
        public Clock Clock { get; } = new();
        public InMemoryRefreshTokenStore Tokens => _tokens ??= new InMemoryRefreshTokenStore(Clock);
        private InMemoryRefreshTokenStore? _tokens;
        public InMemoryUserStore Users { get; } = new();
        public RecordingHooks Hooks { get; } = new();
        public AuthUser User { get; set; } = null!;
    }

    private static async Task<Fixture> Setup(bool legacy = false)
    {
        var vault = new FakeBadgeVault();
        JwtOptions jwtOptions;
        if (legacy)
        {
            jwtOptions = new JwtOptions { SigningKey = "device-session-tests-signing-key-0123456789abcdef" };
        }
        else
        {
            var authority = new VaultBadgeAuthority(vault);
            await authority.RefreshKeysAsync();
            jwtOptions = new JwtOptions { Vault = authority };
        }
        var f = new Fixture
        {
            Jwt = new JwtService(jwtOptions),
            Vault = vault,
            Options = new AuthOptions { Mode = AuthMode.Required, Jwt = jwtOptions },
        };
        f.User = await f.Users.CreateOrUpdateFromExternalAsync(
            new ExternalIdentity("g-1", "owner@example.test", "Owner", null, "google"), mayBootstrapFirstUser: true);
        return f;
    }

    private static DefaultHttpContext Context(Fixture f, string? refreshCookie = null)
    {
        var ctx = new DefaultHttpContext();
        ctx.Response.Body = new MemoryStream();
        if (refreshCookie is not null) ctx.Request.Headers.Cookie = $"{f.Options.RefreshCookieName}={refreshCookie}";
        return ctx;
    }

    private static string? SetCookieValue(HttpContext ctx, string name)
    {
        foreach (var header in ctx.Response.Headers.SetCookie)
        {
            if (header is null || !header.StartsWith(name + "=", StringComparison.Ordinal)) continue;
            var value = header[(name.Length + 1)..].Split(';')[0];
            return value.Length == 0 ? null : value;
        }
        return null;
    }

    private static bool ClearsCookie(HttpContext ctx, string name)
        => ctx.Response.Headers.SetCookie.ToArray().Any(h => h!.StartsWith(name + "=;", StringComparison.Ordinal)
            || (h.StartsWith(name + "=", StringComparison.Ordinal) && h.Contains("expires=Thu, 01 Jan 1970")));

    private static async Task<(string Session, string Access, string Refresh)> SignIn(Fixture f)
    {
        var ctx = Context(f);
        var (session, failure) = await SignInSessions.IssueAsync(ctx, f.User, SignInMethods.Google, f.Jwt, f.Tokens,
            f.Options, f.Hooks);
        Assert.Null(failure);
        return (session!.SessionId, SetCookieValue(ctx, f.Options.CookieName)!, SetCookieValue(ctx, f.Options.RefreshCookieName)!);
    }

    private static async Task<(int Status, string? Error, DefaultHttpContext Ctx)> Refresh(Fixture f, string cookie,
        IRefreshTokenStore? store = null, params string[] moreCookies)
    {
        var ctx = Context(f, cookie);
        // A browser can hold more than one refresh cookie (an older path or domain); it sends them all.
        if (moreCookies.Length > 0)
            ctx.Request.Headers.Cookie = string.Join("; ", new[] { cookie }.Concat(moreCookies)
                .Select(value => $"{f.Options.RefreshCookieName}={value}"));
        var result = await AuthEndpoints.RefreshAsync(ctx, store ?? f.Tokens, f.Users, f.Jwt, f.Options, f.Hooks, f.Clock);
        var status = ((IStatusCodeHttpResult)result).StatusCode ?? 200;
        string? error = null;
        if (result is IValueHttpResult { Value: { } value })
            error = value.GetType().GetProperty("error")?.GetValue(value) as string;
        return (status, error, ctx);
    }

    [Fact]
    public void Session_ids_are_dev_ulids_and_unique()
    {
        var ids = Enumerable.Range(0, 1000).Select(_ => DeviceSessionIds.New()).ToList();
        Assert.All(ids, id => Assert.True(DeviceSessionIds.IsSessionId(id), id));
        Assert.Equal(1000, ids.Distinct().Count());
        Assert.False(DeviceSessionIds.IsSessionId("dev_short"));
        Assert.False(DeviceSessionIds.IsSessionId("node_01M7EJZ24NMVC2HZFEM4S4ANAH"));
        // Time-ordered: a later id sorts after an earlier one.
        var early = DeviceSessionIds.New(DateTimeOffset.UnixEpoch.AddDays(1));
        var late = DeviceSessionIds.New(DateTimeOffset.UnixEpoch.AddDays(2));
        Assert.True(string.CompareOrdinal(early, late) < 0);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task A_sign_in_puts_its_session_in_the_badge_and_in_the_refresh_family(bool legacy)
    {
        var f = await Setup(legacy);
        var (session, access, refresh) = await SignIn(f);

        Assert.True(DeviceSessionIds.IsSessionId(session));
        Assert.Equal(session, f.Jwt.ValidateToken(access)!.FindFirstValue(SessionClaims.SessionId));
        Assert.Equal(session, (await f.Tokens.FindAsync(refresh))!.FamilyId);
        Assert.Equal([(SignInMethods.Google, session)], f.Hooks.Begun);
    }

    [Fact]
    public async Task Legacy_badges_keep_their_365_day_lifetime_with_a_session()
    {
        var f = await Setup(legacy: true);
        var (_, access, _) = await SignIn(f);
        var principal = f.Jwt.ValidateToken(access)!;
        var exp = DateTimeOffset.FromUnixTimeSeconds(long.Parse(principal.FindFirstValue("exp")!));
        Assert.InRange(exp - DateTimeOffset.UtcNow, TimeSpan.FromDays(364), TimeSpan.FromDays(366));
    }

    [Fact]
    public async Task The_host_decides_whether_a_new_session_starts_pending()
    {
        var f = await Setup();
        f.Hooks.StartAs = DeviceSessionStatus.Pending;
        var (session, failure) = await SignInSessions.IssueAsync(Context(f), f.User, SignInMethods.Password, f.Jwt,
            f.Tokens, f.Options, f.Hooks);
        Assert.Null(failure);
        Assert.Equal(DeviceSessionStatus.Pending, session!.Status);
    }

    [Fact]
    public async Task A_vault_outage_refuses_the_sign_in_before_anything_is_recorded()
    {
        var f = await Setup();
        f.Vault.Down = true;
        var ctx = Context(f);
        var (session, failure) = await SignInSessions.IssueAsync(ctx, f.User, SignInMethods.Google, f.Jwt, f.Tokens,
            f.Options, f.Hooks);

        Assert.Null(session);
        Assert.Equal(503, ((IStatusCodeHttpResult)failure!).StatusCode);
        Assert.Empty(f.Hooks.Begun);
        Assert.Equal(0, f.Tokens.Count);
        Assert.Null(SetCookieValue(ctx, f.Options.CookieName));
    }

    [Fact]
    public async Task Rotation_keeps_the_family_and_marks_the_old_token_instead_of_deleting_it()
    {
        var f = await Setup();
        var (session, _, first) = await SignIn(f);

        var (status, _, ctx) = await Refresh(f, first);

        Assert.Equal(200, status);
        var second = SetCookieValue(ctx, f.Options.RefreshCookieName)!;
        Assert.Equal(session, f.Jwt.ValidateToken(SetCookieValue(ctx, f.Options.CookieName)!)!.FindFirstValue(SessionClaims.SessionId));
        Assert.Equal(session, (await f.Tokens.FindAsync(second))!.FamilyId);
        var old = await f.Tokens.FindAsync(first);
        Assert.NotNull(old!.RotatedAt);
        Assert.Null(await f.Tokens.ValidateAsync(first));
    }

    [Fact]
    public async Task A_rotated_token_inside_the_grace_is_a_plain_401_that_leaves_the_session_and_cookies_alone()
    {
        var f = await Setup();
        var (_, _, first) = await SignIn(f);
        var (_, _, rotation) = await Refresh(f, first);
        var second = SetCookieValue(rotation, f.Options.RefreshCookieName)!;

        f.Clock.Now += AuthEndpoints.RotationGrace - TimeSpan.FromSeconds(1);
        var (status, error, ctx) = await Refresh(f, first);

        Assert.Equal((401, "invalid_token"), (status, error));
        Assert.Empty(ctx.Response.Headers.SetCookie.ToArray());  // the browser already holds the successor
        Assert.Empty(f.Hooks.Ended);
        Assert.Equal(200, (await Refresh(f, second)).Status);
    }

    [Fact]
    public async Task A_lost_refresh_response_keeps_the_session_through_retries_at_1_2_4_and_60_seconds()
    {
        var f = await Setup();
        var (session, _, first) = await SignIn(f);
        var start = f.Clock.Now;
        var (lostStatus, _, lost) = await Refresh(f, first);  // rotated, but the answer never reaches the browser
        Assert.Equal(200, lostStatus);
        var neverArrived = SetCookieValue(lost, f.Options.RefreshCookieName)!;

        foreach (var seconds in new[] { 1, 2, 4 })
        {
            f.Clock.Now = start + TimeSpan.FromSeconds(seconds);
            var (status, error, ctx) = await Refresh(f, first);
            Assert.Equal((401, "invalid_token"), (status, error));
            Assert.Empty(ctx.Response.Headers.SetCookie.ToArray());
        }

        f.Clock.Now = start + TimeSpan.FromSeconds(60);
        var (retryStatus, _, retry) = await Refresh(f, first);

        Assert.Equal(200, retryStatus);
        var renewed = SetCookieValue(retry, f.Options.RefreshCookieName)!;
        Assert.Equal(session, f.Jwt.ValidateToken(SetCookieValue(retry, f.Options.CookieName)!)!.FindFirstValue(SessionClaims.SessionId));
        Assert.Equal(session, (await f.Tokens.FindAsync(renewed))!.FamilyId);
        Assert.Null(await f.Tokens.FindAsync(neverArrived));  // the successor nobody received is revoked
        Assert.Empty(f.Hooks.Ended);

        f.Clock.Now += TimeSpan.FromMinutes(5);
        Assert.Equal(200, (await Refresh(f, renewed)).Status);
        Assert.Empty(f.Hooks.Ended);
    }

    [Fact]
    public async Task A_stale_duplicate_cookie_does_not_turn_a_lost_response_into_reuse()
    {
        var f = await Setup();
        var (session, _, r0) = await SignIn(f);
        var (_, _, first) = await Refresh(f, r0);
        var r1 = SetCookieValue(first, f.Options.RefreshCookieName)!;
        f.Clock.Now += TimeSpan.FromMinutes(10);
        var (_, _, second) = await Refresh(f, r1);
        var r2 = SetCookieValue(second, f.Options.RefreshCookieName)!;
        f.Clock.Now += TimeSpan.FromMinutes(10);
        var start = f.Clock.Now;
        Assert.Equal(200, (await Refresh(f, r0, null, r2)).Status);  // R2 rotates to R3; that response is lost

        // The browser still sends the stale R0 next to its own R2. R0's successor was used; R2's never was.
        f.Clock.Now = start + TimeSpan.FromSeconds(2);
        var (graceStatus, graceError, graceCtx) = await Refresh(f, r0, null, r2);
        Assert.Equal((401, "invalid_token"), (graceStatus, graceError));
        Assert.Empty(graceCtx.Response.Headers.SetCookie.ToArray());

        f.Clock.Now = start + TimeSpan.FromSeconds(60);
        var (status, _, retry) = await Refresh(f, r0, null, r2);

        Assert.Equal(200, status);
        Assert.Empty(f.Hooks.Ended);
        Assert.Equal(session, (await f.Tokens.FindAsync(SetCookieValue(retry, f.Options.RefreshCookieName)!))!.FamilyId);
    }

    [Fact]
    public async Task Two_tabs_racing_inside_the_grace_with_a_duplicate_cookie_keep_the_session()
    {
        var f = await Setup();
        var (_, _, r0) = await SignIn(f);
        var (_, _, first) = await Refresh(f, r0);
        var r1 = SetCookieValue(first, f.Options.RefreshCookieName)!;
        f.Clock.Now += TimeSpan.FromMinutes(10);
        var slow = new InterleavingStore(f.Tokens) { StoreDelay = TimeSpan.FromMilliseconds(150) };

        var results = await Task.WhenAll(Refresh(f, r0, slow, r1), Refresh(f, r1, slow, r0));

        Assert.Equal([200, 401], results.Select(r => r.Status).Order());
        Assert.Equal("invalid_token", results.Single(r => r.Status == 401).Error);
        Assert.Empty(results.Single(r => r.Status == 401).Ctx.Response.Headers.SetCookie.ToArray());
        Assert.Empty(f.Hooks.Ended);
        var renewed = SetCookieValue(results.Single(r => r.Status == 200).Ctx, f.Options.RefreshCookieName)!;
        f.Clock.Now += TimeSpan.FromMinutes(10);
        Assert.Equal(200, (await Refresh(f, renewed, null, r0, r1)).Status);
        Assert.Empty(f.Hooks.Ended);
    }

    [Fact]
    public async Task A_token_two_or_more_generations_old_ends_the_whole_family()
    {
        var f = await Setup();
        var (session, _, first) = await SignIn(f);
        var (_, _, rotation) = await Refresh(f, first);
        var second = SetCookieValue(rotation, f.Options.RefreshCookieName)!;
        f.Clock.Now += TimeSpan.FromMinutes(5);
        var (_, _, victim) = await Refresh(f, second);  // the browser carries on with the successor
        var third = SetCookieValue(victim, f.Options.RefreshCookieName)!;

        f.Clock.Now += TimeSpan.FromMinutes(1);
        var (status, error, ctx) = await Refresh(f, first);  // a copy of the first token turns up

        Assert.Equal((401, "session_revoked"), (status, error));
        Assert.True(ClearsCookie(ctx, f.Options.CookieName));
        Assert.True(ClearsCookie(ctx, f.Options.RefreshCookieName));
        Assert.Equal([(session, SessionEndReasons.RefreshReused)], f.Hooks.Ended);
        // The live token dies with the family: the thief and the victim are both signed out.
        Assert.Null(await f.Tokens.FindAsync(third));
        Assert.Equal(401, (await Refresh(f, third)).Status);
        Assert.Equal(0, f.Tokens.Count);
    }

    [Fact]
    public async Task A_rotated_token_is_marked_at_the_time_of_the_mark_not_of_the_request()
    {
        var f = await Setup();
        var (_, _, first) = await SignIn(f);
        var slowStore = new InterleavingStore(f.Tokens) { AfterStore = () => { f.Clock.Now += TimeSpan.FromSeconds(10); return Task.CompletedTask; } };

        await Refresh(f, first, slowStore);

        Assert.Equal((DateTimeOffset?)f.Clock.Now, (await f.Tokens.FindAsync(first))!.RotatedAt);
    }

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, true)]
    [InlineData(false, false)]
    [InlineData(true, false)]
    public async Task A_session_that_ends_during_its_renewal_keeps_no_live_token(bool afterStore, bool hostKnows)
    {
        var f = await Setup();
        var (session, _, first) = await SignIn(f);
        // Signed out from another device while this renewal is in flight. Without host records (RedCompute),
        // only the family revoke happens.
        Func<Task> signOutElsewhere = hostKnows
            ? () => AuthEndpoints.EndSessionAsync(f.Tokens, f.Hooks, session, f.User.Id, SessionEndReasons.SignedOut, null)
            : () => f.Tokens.RevokeFamilyAsync(session);
        var store = afterStore
            ? new InterleavingStore(f.Tokens) { AfterStore = signOutElsewhere }
            : new InterleavingStore(f.Tokens) { BeforeStore = signOutElsewhere };

        var (status, error, ctx) = await Refresh(f, first, store);

        Assert.Equal((401, "session_revoked"), (status, error));
        Assert.Equal(0, f.Tokens.Count);
        Assert.Null(SetCookieValue(ctx, f.Options.RefreshCookieName));
        Assert.True(ClearsCookie(ctx, f.Options.CookieName));
    }

    [Fact]
    public async Task A_session_the_host_ended_cannot_renew()
    {
        var f = await Setup();
        var (session, _, refresh) = await SignIn(f);
        f.Hooks.EndedSessions.Add(session);

        var (status, error, ctx) = await Refresh(f, refresh);

        Assert.Equal((401, "session_revoked"), (status, error));
        Assert.True(ClearsCookie(ctx, f.Options.RefreshCookieName));
        Assert.Null(await f.Tokens.FindAsync(refresh));
    }

    [Fact]
    public async Task A_refresh_token_from_before_sessions_is_adopted_into_a_new_family()
    {
        var f = await Setup();
        var legacy = f.Jwt.GenerateRefreshToken();
        await f.Tokens.StoreAsync(legacy, f.User.Id, DateTimeOffset.UtcNow.AddDays(30));

        var (status, _, ctx) = await Refresh(f, legacy);

        Assert.Equal(200, status);
        var (method, session) = Assert.Single(f.Hooks.Begun);
        Assert.Equal(SignInMethods.Adopted, method);
        Assert.Equal(session, f.Jwt.ValidateToken(SetCookieValue(ctx, f.Options.CookieName)!)!.FindFirstValue(SessionClaims.SessionId));
        Assert.Equal(session, (await f.Tokens.FindAsync(SetCookieValue(ctx, f.Options.RefreshCookieName)!))!.FamilyId);
        // The old row joins the family, so a later reuse of it ends this session.
        Assert.Equal(session, (await f.Tokens.FindAsync(legacy))!.FamilyId);
    }

    [Fact]
    public async Task Two_tabs_renewing_a_token_from_before_sessions_adopt_one_family()
    {
        var f = await Setup();
        var legacy = f.Jwt.GenerateRefreshToken();
        await f.Tokens.StoreAsync(legacy, f.User.Id, DateTimeOffset.UtcNow.AddDays(30));
        var slow = new InterleavingStore(f.Tokens) { StoreDelay = TimeSpan.FromMilliseconds(150) };

        var results = await Task.WhenAll(Refresh(f, legacy, slow), Refresh(f, legacy, slow));

        var (method, session) = Assert.Single(f.Hooks.Begun);
        Assert.Equal(SignInMethods.Adopted, method);
        Assert.Equal([200, 401], results.Select(r => r.Status).Order());
        Assert.Equal("invalid_token", results.Single(r => r.Status == 401).Error);  // the other tab's race answer
        Assert.Equal(session, (await f.Tokens.FindAsync(legacy))!.FamilyId);
        Assert.Equal(2, f.Tokens.Count);
    }

    [Fact]
    public async Task A_token_from_before_sessions_the_host_refuses_to_adopt_is_revoked()
    {
        var f = await Setup();
        f.Hooks.StartAs = DeviceSessionStatus.Ended;
        var legacy = f.Jwt.GenerateRefreshToken();
        await f.Tokens.StoreAsync(legacy, f.User.Id, DateTimeOffset.UtcNow.AddDays(30));

        var (status, error, ctx) = await Refresh(f, legacy);

        Assert.Equal((401, "session_revoked"), (status, error));
        Assert.True(ClearsCookie(ctx, f.Options.RefreshCookieName));
        Assert.Equal(0, f.Tokens.Count);
    }

    [Fact]
    public async Task Logout_ends_the_family_and_tells_the_host()
    {
        var f = await Setup();
        var (session, _, first) = await SignIn(f);
        var (_, _, rotation) = await Refresh(f, first);
        var second = SetCookieValue(rotation, f.Options.RefreshCookieName)!;

        var ctx = Context(f, second);
        await AuthEndpoints.LogoutAsync(ctx, f.Tokens, f.Options, f.Hooks);

        Assert.Equal([(session, SessionEndReasons.SignedOut)], f.Hooks.Ended);
        Assert.Equal(0, f.Tokens.Count);  // the live token and the rotated one
        Assert.True(ClearsCookie(ctx, f.Options.CookieName));
    }

    [Fact]
    public async Task Logout_with_only_the_badge_ends_its_session_host_first()
    {
        var f = await Setup();
        var (session, access, _) = await SignIn(f);
        var tokensWhenTheHostHeard = -1;
        f.Hooks.OnEnd = () => tokensWhenTheHostHeard = f.Tokens.Count;

        var ctx = Context(f);
        ctx.Request.Headers.Cookie = $"{f.Options.CookieName}={access}";
        await AuthEndpoints.LogoutAsync(ctx, f.Tokens, f.Options, f.Hooks, f.Jwt);

        Assert.Equal([(session, SessionEndReasons.SignedOut)], f.Hooks.Ended);
        Assert.Equal(1, tokensWhenTheHostHeard);  // design 3.3: the host records the end before the tokens go
        Assert.Equal(0, f.Tokens.Count);
        Assert.True(ClearsCookie(ctx, f.Options.CookieName));
    }

    [Fact]
    public async Task Logout_clears_the_cookies_even_when_the_store_throws()
    {
        var f = await Setup();
        var (_, access, _) = await SignIn(f);
        var broken = new InterleavingStore(f.Tokens) { FailRevokes = true };

        var ctx = Context(f);
        ctx.Request.Headers.Cookie = $"{f.Options.CookieName}={access}";
        var result = await AuthEndpoints.LogoutAsync(ctx, broken, f.Options, f.Hooks, f.Jwt);

        Assert.Equal(503, ((IStatusCodeHttpResult)result).StatusCode);
        Assert.True(ClearsCookie(ctx, f.Options.CookieName));
        Assert.True(ClearsCookie(ctx, f.Options.RefreshCookieName));
        Assert.Single(f.Hooks.Ended);  // the host recorded the end first, so the gate refuses the sid anyway
    }

    [Fact]
    public async Task Logout_from_a_real_browser_cookie_jar_ends_the_session()
    {
        var f = await Setup(legacy: true);
        var builder = WebApplication.CreateSlimBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        await using var app = builder.Build();
        // Typed as Func<..., Task<IResult>>: a bare HttpContext lambda would bind as a RequestDelegate and drop the result.
        app.MapPost("/sign-in", (Func<HttpContext, Task<IResult>>)(async ctx =>
        {
            var (session, failure) = await SignInSessions.IssueAsync(ctx, f.User, SignInMethods.Google, f.Jwt, f.Tokens,
                f.Options, f.Hooks);
            return failure ?? Results.Ok(new { sessionId = session!.SessionId });
        }));
        app.MapPost("/auth/logout", (Func<HttpContext, Task<IResult>>)(ctx => AuthEndpoints.LogoutAsync(ctx, f.Tokens, f.Options, f.Hooks, f.Jwt)));
        app.MapPost("/auth/refresh", (Func<HttpContext, Task<IResult>>)(ctx =>
            AuthEndpoints.RefreshAsync(ctx, f.Tokens, f.Users, f.Jwt, f.Options, f.Hooks, f.Clock)));
        await app.StartAsync();
        var origin = new Uri(app.Urls.Single());

        var jar = new CookieContainer();
        using var browser = new HttpClient(new HttpClientHandler { CookieContainer = jar, UseCookies = true }) { BaseAddress = origin };
        (await browser.PostAsync("/sign-in", null)).EnsureSuccessStatusCode();
        var session = Assert.Single(f.Hooks.Begun).Session;
        var refreshCopy = jar.GetCookies(new Uri(origin, "/auth/refresh"))[f.Options.RefreshCookieName]!.Value;
        // The jar keeps the refresh cookie to its path: the logout request never carries it.
        Assert.Null(jar.GetCookies(new Uri(origin, "/auth/logout"))[f.Options.RefreshCookieName]);

        (await browser.PostAsync("/auth/logout", null)).EnsureSuccessStatusCode();

        Assert.Equal([(session, SessionEndReasons.SignedOut)], f.Hooks.Ended);
        Assert.Equal(0, f.Tokens.Count);
        // A copy of the refresh token kept from before the logout renews nothing.
        using var copy = new HttpClient { BaseAddress = origin };
        using var request = new HttpRequestMessage(HttpMethod.Post, "/auth/refresh");
        request.Headers.Add("Cookie", $"{f.Options.RefreshCookieName}={refreshCopy}");
        Assert.Equal(HttpStatusCode.Unauthorized, (await copy.SendAsync(request)).StatusCode);
        await app.StopAsync();
    }

    [Fact]
    public async Task A_disabled_account_loses_the_whole_session_at_renewal()
    {
        var f = await Setup();
        var (session, _, refresh) = await SignIn(f);
        var ctx = Context(f, refresh);
        var users = new SuspendedUserStore(f.User);

        var result = await AuthEndpoints.RefreshAsync(ctx, f.Tokens, users, f.Jwt, f.Options, f.Hooks, f.Clock);

        Assert.Equal(401, ((IStatusCodeHttpResult)result).StatusCode);
        Assert.Equal([(session, SessionEndReasons.AccountDisabled)], f.Hooks.Ended);
        Assert.Equal(0, f.Tokens.Count);
    }

    private sealed class SuspendedUserStore(AuthUser user) : IUserStore
    {
        private readonly AuthUser _user = user with { Status = "suspended" };
        public Task<AuthUser?> FindByProviderAsync(string provider, string providerId) => Task.FromResult<AuthUser?>(_user);
        public Task<AuthUser?> FindByIdAsync(string id) => Task.FromResult<AuthUser?>(id == _user.Id ? _user : null);
        public Task<AuthUser> CreateOrUpdateFromExternalAsync(ExternalIdentity identity, bool mayBootstrapFirstUser = false)
            => Task.FromResult(_user);
    }

    [Fact]
    public async Task Me_reports_the_device_session_only_for_a_session_badge()
    {
        var f = await Setup();
        var (session, access, _) = await SignIn(f);
        f.Hooks.StartAs = DeviceSessionStatus.Pending;

        var ctx = new DefaultHttpContext { User = f.Jwt.ValidateToken(access)! };
        var device = await AuthEndpoints.DeviceAsync(ctx, f.User.Id, new PendingHooks());
        Assert.Equal(System.Text.Json.JsonSerializer.Serialize(new { sessionId = session, status = "pending" }),
            System.Text.Json.JsonSerializer.Serialize(device));

        var service = new DefaultHttpContext { User = f.Jwt.ValidateToken(f.Jwt.GenerateServiceAccessToken("redleaf"))! };
        Assert.Null(await AuthEndpoints.DeviceAsync(service, "service:redleaf", f.Hooks));
        var legacy = new DefaultHttpContext { User = f.Jwt.ValidateToken(f.Jwt.GenerateBrowserAccessToken(f.User.Id, f.User.Email, null, ["user"]))! };
        Assert.Null(await AuthEndpoints.DeviceAsync(legacy, f.User.Id, f.Hooks));
    }

    private sealed class PendingHooks : IDeviceSessionHooks
    {
        public Task<DeviceSessionStatus> BeginAsync(HttpContext c, AuthUser u, string m, string s) => Task.FromResult(DeviceSessionStatus.Pending);
        public Task<DeviceSessionStatus> StatusAsync(string s, string u) => Task.FromResult(DeviceSessionStatus.Pending);
        public Task EndAsync(string s, string u, string r) => Task.CompletedTask;
    }

    // ----- the default hooks (RedCompute, and any host without session records) -----

    [Fact]
    public async Task Without_host_hooks_every_session_is_approved_and_nothing_is_tracked()
    {
        var services = new ServiceCollection();
        services.AddAppHostAuth(new AuthOptions { Jwt = new JwtOptions { SigningKey = "default-hooks-signing-key-0123456789abcdef" } });
        using var provider = services.BuildServiceProvider();

        var hooks = provider.GetRequiredService<IDeviceSessionHooks>();

        Assert.Same(DefaultDeviceSessionHooks.Instance, hooks);
        var user = new AuthUser("u-1", "u@example.test", "U", null, ["user"]);
        Assert.Equal(DeviceSessionStatus.Approved, await hooks.BeginAsync(new DefaultHttpContext(), user, SignInMethods.Google, DeviceSessionIds.New()));
        Assert.Equal(DeviceSessionStatus.Approved, await hooks.StatusAsync(DeviceSessionIds.New(), "u-1"));
        await hooks.EndAsync(DeviceSessionIds.New(), "u-1", SessionEndReasons.SignedOut);
    }

    [Fact]
    public void A_host_that_registers_its_own_hooks_gets_them_whatever_the_order()
    {
        var mine = new RecordingHooks();
        var before = new ServiceCollection();
        before.AddSingleton<IDeviceSessionHooks>(mine);
        before.AddAppHostAuth(new AuthOptions());
        var after = new ServiceCollection();
        after.AddAppHostAuth(new AuthOptions());
        after.AddSingleton<IDeviceSessionHooks>(mine);

        using var a = before.BuildServiceProvider();
        using var b = after.BuildServiceProvider();
        Assert.Same(mine, a.GetRequiredService<IDeviceSessionHooks>());
        Assert.Same(mine, b.GetRequiredService<IDeviceSessionHooks>());
    }

    [Fact]
    public async Task Without_host_hooks_refresh_and_logout_behave_as_before_sessions()
    {
        var f = await Setup();
        var legacy = f.Jwt.GenerateRefreshToken();
        await f.Tokens.StoreAsync(legacy, f.User.Id, DateTimeOffset.UtcNow.AddDays(30));

        var ctx = Context(f, legacy);
        var result = await AuthEndpoints.RefreshAsync(ctx, f.Tokens, f.Users, f.Jwt, f.Options);
        Assert.Equal(200, ((IStatusCodeHttpResult)result).StatusCode ?? 200);
        var next = SetCookieValue(ctx, f.Options.RefreshCookieName)!;

        var logout = Context(f, next);
        await AuthEndpoints.LogoutAsync(logout, f.Tokens, f.Options);
        Assert.Null(await f.Tokens.ValidateAsync(next));
    }

    // ----- one issuer -----

    [Fact]
    public void Only_SignInSessions_issues_browser_badges_and_session_cookies_in_AppHost()
    {
        var root = AppHostSourceRoot();
        var offenders = new List<string>();
        foreach (var file in Directory.EnumerateFiles(root, "*.cs", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(root, file).Replace('\\', '/');
            if (rel.StartsWith("bin/") || rel.StartsWith("obj/")) continue;
            var text = File.ReadAllText(file);
            var issues = text.Contains("Cookies.Append(options.CookieName") || text.Contains("Cookies.Append(options.RefreshCookieName");
            var mints = text.Contains(".GenerateBrowserAccessToken(");
            if (rel == "Auth/SignInSessions.cs" || rel == "Auth/JwtService.cs") continue;
            // Renewal reissues for an existing session: it may mint, but it writes cookies only through SignInSessions.
            if (rel == "Auth/AuthEndpoints.cs") { if (issues) offenders.Add(rel); continue; }
            if (issues || mints) offenders.Add(rel);
        }
        Assert.Empty(offenders);
    }

    // From this source file, so it works whatever --artifacts-path the build used.
    private static string AppHostSourceRoot()
        => Path.GetFullPath(Path.Combine(ThisDirectory(), "..", "..", "RedBamboo.AppHost"));

    private static string ThisDirectory([System.Runtime.CompilerServices.CallerFilePath] string path = "")
        => Path.GetDirectoryName(path)!;
}
