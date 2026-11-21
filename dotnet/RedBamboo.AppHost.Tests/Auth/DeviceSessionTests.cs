using System.Security.Claims;
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
            return Task.CompletedTask;
        }
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
        public InMemoryRefreshTokenStore Tokens { get; } = new();
        public InMemoryUserStore Users { get; } = new();
        public RecordingHooks Hooks { get; } = new();
        public Clock Clock { get; } = new();
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

    private static async Task<(int Status, string? Error, DefaultHttpContext Ctx)> Refresh(Fixture f, string cookie)
    {
        var ctx = Context(f, cookie);
        var result = await AuthEndpoints.RefreshAsync(ctx, f.Tokens, f.Users, f.Jwt, f.Options, f.Hooks, f.Clock);
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
    public async Task A_rotated_token_used_after_the_grace_ends_the_whole_family()
    {
        var f = await Setup();
        var (session, _, first) = await SignIn(f);
        var (_, _, rotation) = await Refresh(f, first);
        var second = SetCookieValue(rotation, f.Options.RefreshCookieName)!;

        f.Clock.Now += AuthEndpoints.RotationGrace + TimeSpan.FromSeconds(1);
        var (status, error, ctx) = await Refresh(f, first);

        Assert.Equal((401, "session_revoked"), (status, error));
        Assert.True(ClearsCookie(ctx, f.Options.CookieName));
        Assert.True(ClearsCookie(ctx, f.Options.RefreshCookieName));
        Assert.Equal([(session, SessionEndReasons.RefreshReused)], f.Hooks.Ended);
        // The successor dies with the family: the thief and the victim are both signed out.
        Assert.Null(await f.Tokens.FindAsync(second));
        Assert.Equal(401, (await Refresh(f, second)).Status);
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
