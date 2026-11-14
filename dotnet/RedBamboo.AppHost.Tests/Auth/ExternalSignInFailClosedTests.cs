using Xunit;
using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using RedBamboo.AppHost.Auth;

namespace RedBamboo.AppHost.Tests.Auth;

/// <summary>
/// Google sign-in fails closed: no open sign-up, no session when the user store cannot decide, and a
/// disabled account stays disabled on every path that issues or renews a session.
/// </summary>
public class ExternalSignInFailClosedTests
{
    private static readonly Guid OwnerId = Guid.Parse("11111111-2222-3333-4444-555555555555");
    private static readonly Guid InvitedId = Guid.Parse("66666666-7777-8888-9999-000000000000");

    private static ExternalIdentity Google(string sub, string email, bool verified = true)
        => new(sub, email, "Someone", null, "google", EmailVerified: verified);

    private static JsonObject OwnerData(string? status = "active") => Without(status, new JsonObject
    {
        ["email"] = "owner@example.test",
        ["display_name"] = "Owner",
        ["auth_provider"] = "google",
        ["provider_id"] = "g-owner",
        ["roles"] = "[\"admin\"]",
        ["status"] = status,
    });

    private static JsonObject Without(string? status, JsonObject data)
    {
        if (status is null) data.Remove("status");
        return data;
    }

    // ----- Case 1: open sign-up is closed -----

    [Fact]
    public async Task An_unknown_google_account_gets_no_user_when_users_already_exist()
    {
        var redLeaf = new FakeRedLeaf().With(OwnerId, OwnerData());
        var store = new RedLeafUserStore(redLeaf.Client());

        var denied = await Assert.ThrowsAsync<ExternalSignInDeniedException>(() =>
            store.CreateOrUpdateFromExternalAsync(Google("g-stranger", "stranger@example.test"), mayBootstrapFirstUser: true));

        Assert.Equal(ExternalSignInDeniedException.NotAllowed, denied.Reason);
        Assert.Empty(redLeaf.Writes);
    }

    [Fact]
    public async Task The_first_user_is_created_only_when_the_caller_allows_first_user_setup()
    {
        var refused = new FakeRedLeaf();
        await Assert.ThrowsAsync<ExternalSignInDeniedException>(() =>
            new RedLeafUserStore(refused.Client()).CreateOrUpdateFromExternalAsync(Google("g-first", "first@example.test")));
        Assert.Empty(refused.Writes);

        var setup = new FakeRedLeaf();
        var user = await new RedLeafUserStore(setup.Client())
            .CreateOrUpdateFromExternalAsync(Google("g-first", "first@example.test"), mayBootstrapFirstUser: true);

        Assert.Equal(["admin"], user.Roles);
        Assert.True(user.IsActive);
        Assert.Equal("POST /api/entities", Assert.Single(setup.Writes));
    }

    [Fact]
    public async Task An_account_an_administrator_created_for_a_verified_email_is_claimed_and_bound()
    {
        var redLeaf = new FakeRedLeaf()
            .With(OwnerId, OwnerData())
            .With(InvitedId, new JsonObject { ["email"] = "Friend@Example.test", ["roles"] = "[\"editor\"]" });
        var store = new RedLeafUserStore(redLeaf.Client());

        var user = await store.CreateOrUpdateFromExternalAsync(Google("g-friend", "friend@example.test"));

        Assert.Equal(InvitedId.ToString(), user.Id);
        Assert.Equal(["editor"], user.Roles);
        var data = redLeaf.Data(InvitedId);
        Assert.Equal("google", (string?)data["auth_provider"]);
        Assert.Equal("g-friend", (string?)data["provider_id"]);
        Assert.Equal("[\"editor\"]", (string?)data["roles"]);
        Assert.False(data.ContainsKey("status"));

        // Bound: a different Google account with the same email cannot claim it again.
        await Assert.ThrowsAsync<ExternalSignInDeniedException>(() =>
            store.CreateOrUpdateFromExternalAsync(Google("g-impostor", "friend@example.test")));
    }

    [Fact]
    public async Task An_unverified_email_cannot_claim_an_account_waiting_for_it()
    {
        var redLeaf = new FakeRedLeaf()
            .With(OwnerId, OwnerData())
            .With(InvitedId, new JsonObject { ["email"] = "friend@example.test" });

        await Assert.ThrowsAsync<ExternalSignInDeniedException>(() =>
            new RedLeafUserStore(redLeaf.Client())
                .CreateOrUpdateFromExternalAsync(Google("g-friend", "friend@example.test", verified: false)));

        Assert.Empty(redLeaf.Writes);
    }

    [Fact]
    public async Task Through_the_tunnel_a_fresh_installation_cannot_be_claimed()
    {
        var f = new CallbackFixture(new FakeRedLeaf());
        var ctx = f.Request(tunnel: true);

        await f.SignIn(ctx, Google("g-attacker", "attacker@example.test"));

        Assert.Equal(403, ctx.Response.StatusCode);
        Assert.Null(f.Issued(ctx));
        Assert.Empty(f.RedLeaf.Writes);
    }

    [Fact]
    public async Task On_this_machine_a_fresh_installation_gets_its_first_admin()
    {
        var f = new CallbackFixture(new FakeRedLeaf());
        var ctx = f.Request(tunnel: false);

        await f.SignIn(ctx, Google("g-first", "first@example.test"));

        Assert.Equal(302, ctx.Response.StatusCode);
        var principal = f.Jwt.ValidateToken(f.Issued(ctx)!)!;
        Assert.Contains("admin", principal.FindAll("roles").Select(c => c.Value).Single());
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task The_existing_owner_still_signs_in_through_the_tunnel_and_on_loopback(bool tunnel)
    {
        var f = new CallbackFixture(new FakeRedLeaf().With(OwnerId, OwnerData()));
        var ctx = f.Request(tunnel);

        await f.SignIn(ctx, Google("g-owner", "owner@example.test"));

        Assert.Equal(302, ctx.Response.StatusCode);
        var principal = f.Jwt.ValidateToken(f.Issued(ctx)!)!;
        Assert.Equal(OwnerId.ToString(), principal.FindFirst("sub")!.Value);
        Assert.NotNull(f.IssuedRefresh(ctx));
    }

    // ----- Case 2: a store error never becomes a session, and never an admin one -----

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    [InlineData(HttpStatusCode.Unauthorized)]
    public async Task An_unreadable_user_list_denies_sign_in_instead_of_issuing_an_admin_session(HttpStatusCode failure)
    {
        var f = new CallbackFixture(new FakeRedLeaf { ListStatus = failure });
        var ctx = f.Request(tunnel: false);

        await f.SignIn(ctx, Google("g-owner", "owner@example.test"));

        Assert.Equal(503, ctx.Response.StatusCode);
        Assert.Null(f.Issued(ctx));
        Assert.Null(f.IssuedRefresh(ctx));
        Assert.Empty(f.RedLeaf.Writes);
    }

    [Fact]
    public async Task An_unreadable_user_list_is_never_mistaken_for_an_empty_one()
    {
        var redLeaf = new FakeRedLeaf { ListStatus = HttpStatusCode.InternalServerError };

        var error = await Assert.ThrowsAnyAsync<Exception>(() => new RedLeafUserStore(redLeaf.Client())
            .CreateOrUpdateFromExternalAsync(Google("g-x", "x@example.test"), mayBootstrapFirstUser: true));

        Assert.IsNotType<ExternalSignInDeniedException>(error);
        Assert.Empty(redLeaf.Writes);
    }

    [Fact]
    public async Task A_partial_user_list_refuses_to_decide()
    {
        var redLeaf = new FakeRedLeaf { ReportedTotal = 2 }.With(OwnerId, OwnerData());

        await Assert.ThrowsAsync<InvalidOperationException>(() => new RedLeafUserStore(redLeaf.Client())
            .CreateOrUpdateFromExternalAsync(Google("g-owner", "owner@example.test")));
    }

    [Fact]
    public async Task A_failed_login_write_denies_sign_in()
    {
        var f = new CallbackFixture(new FakeRedLeaf { WriteStatus = HttpStatusCode.InternalServerError }.With(OwnerId, OwnerData()));
        var ctx = f.Request(tunnel: true);

        await f.SignIn(ctx, Google("g-owner", "owner@example.test"));

        Assert.Equal(503, ctx.Response.StatusCode);
        Assert.Null(f.Issued(ctx));
    }

    [Fact]
    public async Task Any_store_exception_issues_no_cookie()
    {
        var f = new CallbackFixture(new FakeRedLeaf(), new ThrowingStore());
        var ctx = f.Request(tunnel: false);

        await f.SignIn(ctx, Google("g-owner", "owner@example.test"));

        Assert.Equal(503, ctx.Response.StatusCode);
        Assert.Null(f.Issued(ctx));
        Assert.Null(f.IssuedRefresh(ctx));
    }

    // ----- Case 3: a disabled account stays disabled -----

    [Theory]
    [InlineData("suspended")]
    [InlineData("deleted")]
    [InlineData("anything-else")]
    public async Task A_disabled_account_is_refused_and_its_status_is_not_rewritten(string status)
    {
        var f = new CallbackFixture(new FakeRedLeaf().With(OwnerId, OwnerData(status)));
        var ctx = f.Request(tunnel: false);

        await f.SignIn(ctx, Google("g-owner", "owner@example.test"));

        Assert.Equal(403, ctx.Response.StatusCode);
        Assert.Null(f.Issued(ctx));
        Assert.Equal(status, (string?)f.RedLeaf.Data(OwnerId)["status"]);
        Assert.Empty(f.RedLeaf.Writes);
    }

    [Fact]
    public async Task An_active_sign_in_never_writes_the_status()
    {
        var redLeaf = new FakeRedLeaf().With(OwnerId, OwnerData(status: null));

        await new RedLeafUserStore(redLeaf.Client())
            .CreateOrUpdateFromExternalAsync(Google("g-owner", "owner@example.test"));

        Assert.False(redLeaf.Data(OwnerId).ContainsKey("status"));
        Assert.All(redLeaf.PatchBodies, body => Assert.False(body.ContainsKey("status")));
    }

    [Fact]
    public async Task A_store_that_returns_a_disabled_account_still_issues_no_session()
    {
        var f = new CallbackFixture(new FakeRedLeaf(), new DisabledStore());
        var ctx = f.Request(tunnel: false);

        await f.SignIn(ctx, Google("g-owner", "owner@example.test"));

        Assert.Equal(403, ctx.Response.StatusCode);
        Assert.Null(f.Issued(ctx));
    }

    [Fact]
    public async Task A_disabled_account_cannot_refresh_and_loses_its_refresh_token()
    {
        var f = new CallbackFixture(new FakeRedLeaf());
        var users = new InMemoryUserStore();
        var user = await users.CreateOrUpdateFromExternalAsync(Google("g-owner", "owner@example.test"), mayBootstrapFirstUser: true);
        var refresh = f.Jwt.GenerateRefreshToken();
        await f.Tokens.StoreAsync(refresh, user.Id, DateTimeOffset.UtcNow.AddDays(30));
        users.SetStatus(user.Id, "suspended");

        var ctx = new DefaultHttpContext();
        ctx.Request.Headers.Cookie = $"{f.Options.RefreshCookieName}={refresh}";
        var result = await AuthEndpoints.RefreshAsync(ctx, f.Tokens, users, f.Jwt, f.Options);

        Assert.Equal(401, ((IStatusCodeHttpResult)result).StatusCode);
        Assert.Null(await f.Tokens.ValidateAsync(refresh));
        Assert.Null(f.Issued(ctx));
    }

    [Fact]
    public async Task The_in_memory_store_follows_the_same_rule()
    {
        var users = new InMemoryUserStore();
        await Assert.ThrowsAsync<ExternalSignInDeniedException>(() =>
            users.CreateOrUpdateFromExternalAsync(Google("g-first", "first@example.test")));

        var owner = await users.CreateOrUpdateFromExternalAsync(Google("g-first", "first@example.test"), mayBootstrapFirstUser: true);
        await Assert.ThrowsAsync<ExternalSignInDeniedException>(() =>
            users.CreateOrUpdateFromExternalAsync(Google("g-second", "second@example.test"), mayBootstrapFirstUser: true));

        users.SetStatus(owner.Id, "suspended");
        var disabled = await Assert.ThrowsAsync<ExternalSignInDeniedException>(() =>
            users.CreateOrUpdateFromExternalAsync(Google("g-first", "first@example.test")));
        Assert.Equal(ExternalSignInDeniedException.AccountDisabled, disabled.Reason);
    }

    // ----- fixtures -----

    private sealed class CallbackFixture
    {
        public CallbackFixture(FakeRedLeaf redLeaf, IUserStore? store = null)
        {
            RedLeaf = redLeaf;
            Store = store ?? new RedLeafUserStore(redLeaf.Client());
            Options = new AuthOptions { Mode = AuthMode.Required, Jwt = JwtOptions };
            Services = new ServiceCollection().AddLogging().BuildServiceProvider();
        }

        private JwtOptions JwtOptions { get; } = new() { SigningKey = "external-sign-in-tests-long-secret-key-0123456789" };
        public FakeRedLeaf RedLeaf { get; }
        public IUserStore Store { get; }
        public AuthOptions Options { get; }
        public ServiceProvider Services { get; }
        public JwtService Jwt => new(JwtOptions);
        public InMemoryRefreshTokenStore Tokens { get; } = new();

        public DefaultHttpContext Request(bool tunnel)
        {
            var ctx = new DefaultHttpContext { RequestServices = Services };
            ctx.Request.Scheme = "https";
            ctx.Request.Host = new HostString(tunnel ? "leaf.example.test" : "127.0.0.1:18804");
            ctx.Connection.RemoteIpAddress = IPAddress.Loopback;
            ctx.Connection.LocalIpAddress = IPAddress.Loopback;
            if (tunnel)
            {
                ctx.Request.Headers["Cf-Connecting-Ip"] = "203.0.113.9";
                ctx.Request.Headers["Cf-Ray"] = "8abc-CDG";
            }
            ctx.Response.Body = new MemoryStream();
            return ctx;
        }

        public async Task SignIn(DefaultHttpContext ctx, ExternalIdentity identity)
        {
            var result = await AuthEndpoints.CompleteExternalSignInAsync(ctx, identity, Services, Store, Jwt, Tokens, Options);
            await result.ExecuteAsync(ctx);
        }

        public string? Issued(DefaultHttpContext ctx) => SetCookie(ctx, Options.CookieName);
        public string? IssuedRefresh(DefaultHttpContext ctx) => SetCookie(ctx, Options.RefreshCookieName);

        /// <summary>The value a Set-Cookie header gives the cookie, or null when it is absent or a deletion.</summary>
        private static string? SetCookie(DefaultHttpContext ctx, string name)
        {
            foreach (var header in ctx.Response.Headers.SetCookie)
            {
                if (header is null || !header.StartsWith(name + "=", StringComparison.Ordinal)) continue;
                var value = header[(name.Length + 1)..].Split(';')[0];
                if (value.Length > 0) return value;
            }
            return null;
        }
    }

    private sealed class ThrowingStore : IUserStore
    {
        public Task<AuthUser?> FindByProviderAsync(string provider, string providerId) => throw new HttpRequestException("down");
        public Task<AuthUser?> FindByIdAsync(string id) => throw new HttpRequestException("down");
        public Task<AuthUser> CreateOrUpdateFromExternalAsync(ExternalIdentity identity, bool mayBootstrapFirstUser = false)
            => throw new HttpRequestException("RedLeaf unavailable");
    }

    private sealed class DisabledStore : IUserStore
    {
        private static readonly AuthUser User = new("u-1", "owner@example.test", "Owner", null, ["admin"], "suspended");
        public Task<AuthUser?> FindByProviderAsync(string provider, string providerId) => Task.FromResult<AuthUser?>(User);
        public Task<AuthUser?> FindByIdAsync(string id) => Task.FromResult<AuthUser?>(User);
        public Task<AuthUser> CreateOrUpdateFromExternalAsync(ExternalIdentity identity, bool mayBootstrapFirstUser = false)
            => Task.FromResult(User);
    }

    /// <summary>RedLeaf's user entity routes with their real semantics: list, create, PATCH .../data merges, name PUT.</summary>
    private sealed class FakeRedLeaf : HttpMessageHandler
    {
        private readonly Dictionary<Guid, JsonObject> _users = new();

        public HttpStatusCode ListStatus { get; init; } = HttpStatusCode.OK;
        public HttpStatusCode WriteStatus { get; init; } = HttpStatusCode.OK;
        public int? ReportedTotal { get; init; }
        public List<string> Writes { get; } = [];
        public List<JsonObject> PatchBodies { get; } = [];

        public FakeRedLeaf With(Guid id, JsonObject data)
        {
            _users[id] = data;
            return this;
        }

        public JsonObject Data(Guid id) => _users[id];

        public HttpClient Client() => new(this) { BaseAddress = new Uri("http://redleaf.test/") };

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri!.AbsolutePath;
            var body = request.Content is null
                ? null
                : JsonNode.Parse(await request.Content.ReadAsStringAsync(cancellationToken))!.AsObject();

            if (request.Method == HttpMethod.Get && path == "/api/entities")
            {
                if (ListStatus != HttpStatusCode.OK) return new HttpResponseMessage(ListStatus);
                var items = new JsonArray(_users.Select(u => (JsonNode)Entity(u.Key, u.Value)).ToArray());
                return Json(new JsonObject { ["items"] = items, ["total"] = ReportedTotal ?? _users.Count });
            }

            if (request.Method == HttpMethod.Get) return new HttpResponseMessage(HttpStatusCode.NotFound);

            Writes.Add($"{request.Method} {path}");
            if (WriteStatus != HttpStatusCode.OK) return new HttpResponseMessage(WriteStatus);

            if (request.Method == HttpMethod.Post && path == "/api/entities")
            {
                var id = Guid.NewGuid();
                _users[id] = (JsonObject)body!["data"]!.DeepClone();
                return Json(Entity(id, _users[id]));
            }

            foreach (var (id, data) in _users)
            {
                if (request.Method == HttpMethod.Patch && path == $"/api/entities/{id}/data")
                {
                    PatchBodies.Add(body!);
                    foreach (var (key, value) in body!)
                        data[key] = value?.DeepClone();
                    return Json(Entity(id, data));
                }
                if (request.Method == HttpMethod.Put && path == $"/api/entities/{id}")
                    return Json(Entity(id, data));
            }

            return new HttpResponseMessage(HttpStatusCode.NotFound);
        }

        private static JsonObject Entity(Guid id, JsonObject data) => new()
        {
            ["id"] = id.ToString(),
            ["typeSlug"] = "user",
            ["name"] = (string?)data["display_name"] ?? "User",
            ["data"] = data.ToJsonString(),
        };

        private static HttpResponseMessage Json(JsonNode node) => new(HttpStatusCode.OK)
        {
            Content = new StringContent(node.ToJsonString(), Encoding.UTF8, "application/json"),
        };
    }
}
