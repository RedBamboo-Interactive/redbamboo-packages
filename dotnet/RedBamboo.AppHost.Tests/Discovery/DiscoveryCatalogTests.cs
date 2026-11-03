using System.Net;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using RedBamboo.AppHost.Auth;
using RedBamboo.AppHost.Discovery;
using RedBamboo.AppHost.Tunnel;
using Xunit;

namespace RedBamboo.AppHost.Tests.Discovery;

public class DiscoveryCatalogTests
{
    private sealed record RegisterRequest(string Path, string? Name, string? RemoteUrl);

    private sealed class Descriptor(EndpointRegistry registry) : RegistryServiceDescriptor(registry)
    {
        public override string ServiceName => "Probe";
        public override string Version => "1.0";
        public override string Description => "Probe service";
        public override string ApiBase => "http://127.0.0.1:1";

        public override Task<IReadOnlyList<CapabilityDescriptor>> GetCapabilitiesAsync() =>
            Task.FromResult<IReadOnlyList<CapabilityDescriptor>>(
            [
                new CapabilityDescriptor("versioning", "Versioning", "active", "Tracks changes. Second sentence.",
                [
                    new EndpointDescriptor("GET", "/api/entities/{id}/versions/{version}", "Get a version"),
                ]),
            ]);

        public override Task<IReadOnlyList<DiscoveryArea>> GetAreasAsync() =>
            Task.FromResult<IReadOnlyList<DiscoveryArea>>(
            [
                new DiscoveryArea("codered", "Code", "plugin", "/api/apps/codered", "Coding sessions.",
                    "/api/public/codered",
                    [new DiscoveryConcept("repository", "Repository", "A tracked checkout.")]),
            ]);
    }

    private static WebApplication BuildApp(bool withAuth = true)
    {
        var builder = WebApplication.CreateSlimBuilder();
        if (withAuth) builder.Services.AddSingleton(new AuthOptions());
        var app = builder.Build();

        var registry = new EndpointRegistry(app);
        registry.MapGet("/api/entities/{id}/versions/{version:int}", "Registered version route", () => Results.Ok());
        registry.MapGet("/api/entities", "List entities", () => Results.Ok());
        registry.Describe("GET", "/api/public/codered/site", "Public site");

        // Mapped outside the registry on purpose, the way some kernel routes are.
        app.MapGet("/api/hidden/secret", () => Results.Ok());

        var group = app.MapGroup("/api/apps/codered");
        group.MapPost("/repositories/register", (RegisterRequest request) => Results.Ok());
        group.MapGet("/repositories", (string? status, int limit) => Results.Ok()).WithSummary("List repositories");
        group.MapPatch("/repositories/{id:guid}", (Guid id) => Results.Ok());
        group.MapGet("/quiet", () => Results.Ok()).ExcludeFromDescription();
        group.MapGet("/discover", () => Results.Ok());
        group.MapPost("/raw-body", (HttpContext context) => Results.Ok())
            .WithMetadata(new AcceptsMetadata([], typeof(RegisterRequest)));

        app.MapDiscoveryEndpoints(new Descriptor(registry), new CloudflareTunnelService());
        return app;
    }

    private static async Task<(int Status, JsonElement Body)> Call(
        WebApplication app, string pattern, string query = "", ClaimsPrincipal? user = null, Dictionary<string, object?>? routeValues = null)
    {
        var endpoint = ((IEndpointRouteBuilder)app).DataSources.SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Single(candidate => candidate.RoutePattern.RawText == pattern);
        var context = new DefaultHttpContext { RequestServices = app.Services };
        context.Request.Method = "GET";
        context.Request.QueryString = new QueryString(query);
        context.Connection.RemoteIpAddress = IPAddress.Parse("203.0.113.9");
        if (user is not null) context.User = user;
        foreach (var (key, value) in routeValues ?? []) context.Request.RouteValues[key] = value;
        context.Response.Body = new MemoryStream();
        await endpoint.RequestDelegate!(context);
        context.Response.Body.Position = 0;
        using var document = await JsonDocument.ParseAsync(context.Response.Body);
        return (context.Response.StatusCode, document.RootElement.Clone());
    }

    private static ClaimsPrincipal SignedIn() =>
        new(new ClaimsIdentity([new Claim("sub", "user-1")], "test"));

    private static async Task<DiscoveryCatalog> CatalogOf(WebApplication app) =>
        await ((IApplicationBuilder)app).DiscoveryCatalog()!.GetAsync();

    [Fact]
    public async Task A_stranger_gets_only_the_service_name_and_how_to_sign_in()
    {
        await using var app = BuildApp();
        var (status, body) = await Call(app, "/discover");

        Assert.Equal(200, status);
        Assert.Equal("Probe", body.GetProperty("name").GetString());
        Assert.False(body.TryGetProperty("areas", out _));
        Assert.False(body.TryGetProperty("app_endpoints", out _));
        Assert.False(body.TryGetProperty("capabilities", out _));
        Assert.False(body.TryGetProperty("management", out _));
        Assert.DoesNotContain("codered", body.GetRawText());
    }

    [Theory]
    [InlineData("/discover/find")]
    [InlineData("/discover/{area}")]
    [InlineData("/openapi.json")]
    public async Task A_stranger_cannot_read_the_catalog_routes(string pattern)
    {
        await using var app = BuildApp();
        var (status, body) = await Call(app, pattern, routeValues: new() { ["area"] = "codered" });

        Assert.Equal(401, status);
        Assert.DoesNotContain("repositories", body.GetRawText());
    }

    [Fact]
    public async Task The_previous_format_is_also_closed_to_a_stranger()
    {
        await using var app = BuildApp();
        var (_, body) = await Call(app, "/discover", "?format=v1");
        Assert.False(body.TryGetProperty("app_endpoints", out _));
    }

    [Fact]
    public async Task A_signed_in_caller_gets_a_map_of_areas_and_not_every_route()
    {
        await using var app = BuildApp();
        var (_, body) = await Call(app, "/discover", user: SignedIn());

        Assert.False(body.TryGetProperty("app_endpoints", out _));
        var code = body.GetProperty("areas").EnumerateArray().Single(area => area.GetProperty("id").GetString() == "codered");
        Assert.Equal("plugin", code.GetProperty("kind").GetString());
        Assert.Equal("/discover/codered", code.GetProperty("href").GetString());
        Assert.Equal(5, code.GetProperty("routes").GetInt32());
        Assert.Equal("repository", code.GetProperty("concepts")[0].GetString());
        Assert.DoesNotContain("/repositories/register", body.GetRawText());
    }

    [Fact]
    public async Task The_previous_format_stays_available_to_a_signed_in_caller()
    {
        await using var app = BuildApp();
        var (_, body) = await Call(app, "/discover", "?format=v1", SignedIn());
        Assert.True(body.TryGetProperty("app_endpoints", out _));
        Assert.True(body.TryGetProperty("capabilities", out _));
    }

    [Fact]
    public async Task Plugin_routes_come_from_the_route_table_with_a_schema_and_no_plugin_change()
    {
        await using var app = BuildApp();
        var catalog = await CatalogOf(app);

        var register = catalog.Routes.Single(route => route.Path == "/api/apps/codered/repositories/register");
        Assert.Equal("POST", register.Method);
        Assert.Equal("codered", register.Area);
        Assert.Null(register.Description);

        var schema = JsonSerializer.SerializeToElement(register.RequestBody);
        Assert.Equal("path", schema.GetProperty("required").EnumerateArray().Single().GetString());
        Assert.True(schema.GetProperty("properties").TryGetProperty("remoteUrl", out _));

        var list = catalog.Routes.Single(route => route.Path == "/api/apps/codered/repositories" && route.Method == "GET");
        Assert.Equal("List repositories", list.Description);
        var parameters = list.Parameters!.ToDictionary(parameter => parameter.Name);
        Assert.False(parameters["status"].Required);
        Assert.True(parameters["limit"].Required);
        Assert.Equal("integer", parameters["limit"].Type);
    }

    [Fact]
    public async Task A_route_excluded_from_description_or_outside_the_registry_stays_unlisted()
    {
        await using var app = BuildApp();
        var catalog = await CatalogOf(app);

        Assert.DoesNotContain(catalog.Routes, route => route.Path.EndsWith("/quiet", StringComparison.Ordinal));
        Assert.DoesNotContain(catalog.Routes, route => route.Path == "/api/hidden/secret");
    }

    [Fact]
    public async Task A_capability_listing_merges_with_its_real_route_instead_of_doubling_it()
    {
        await using var app = BuildApp();
        var catalog = await CatalogOf(app);

        var version = catalog.Routes.Single(route => route.CleanPath == "/api/entities/{id}/versions/{version}");
        Assert.Equal("/api/entities/{id}/versions/{version:int}", version.Path);
        Assert.Equal("Registered version route", version.Description);
        Assert.Equal("versioning", version.Area);
    }

    [Fact]
    public async Task Find_gets_the_register_route_from_plain_words()
    {
        await using var app = BuildApp();
        var (status, body) = await Call(app, "/discover/find", "?q=register+a+repository", SignedIn());

        Assert.Equal(200, status);
        var first = body.GetProperty("routes")[0];
        Assert.Equal("/api/apps/codered/repositories/register", first.GetProperty("path").GetString());
        Assert.Equal("/discover/codered", first.GetProperty("href").GetString());
        Assert.Equal("repository", body.GetProperty("concepts")[0].GetProperty("type").GetString());
    }

    [Fact]
    public async Task Find_leaves_public_visitor_routes_out_unless_asked()
    {
        await using var app = BuildApp();
        var (_, hidden) = await Call(app, "/discover/find", "?q=site", SignedIn());
        var (_, shown) = await Call(app, "/discover/find", "?q=site&public=true", SignedIn());

        Assert.Equal(0, hidden.GetProperty("total").GetInt32());
        Assert.Equal("/api/public/codered/site", shown.GetProperty("routes")[0].GetProperty("path").GetString());
    }

    [Fact]
    public async Task An_area_carries_routes_concepts_and_points_at_its_own_document()
    {
        await using var app = BuildApp();
        var (status, body) = await Call(app, "/discover/{area}", user: SignedIn(), routeValues: new() { ["area"] = "codered" });

        Assert.Equal(200, status);
        Assert.Equal("Code", body.GetProperty("name").GetString());
        Assert.Equal("/api/apps/codered/discover", body.GetProperty("guide").GetString());
        Assert.Equal("repository", body.GetProperty("concepts")[0].GetProperty("type").GetString());
        Assert.Equal(1, body.GetProperty("publicRoutes").GetInt32());
        Assert.Contains(body.GetProperty("routes").EnumerateArray(),
            route => route.GetProperty("path").GetString() == "/api/apps/codered/repositories/register");
        Assert.DoesNotContain(body.GetProperty("routes").EnumerateArray(),
            route => route.GetProperty("path").GetString() == "/api/public/codered/site");
    }

    [Fact]
    public async Task An_unknown_area_says_so_and_offers_the_search()
    {
        await using var app = BuildApp();
        var (status, body) = await Call(app, "/discover/{area}", user: SignedIn(), routeValues: new() { ["area"] = "nope" });

        Assert.Equal(404, status);
        Assert.Equal("/discover/find?q=nope", body.GetProperty("find").GetString());
    }

    [Fact]
    public async Task Explain_tells_a_wrong_method_apart_from_a_missing_route()
    {
        await using var app = BuildApp();
        var catalog = await CatalogOf(app);

        var wrongMethod = catalog.Explain("PATCH", "/api/apps/codered/repositories");
        Assert.Equal(["GET"], wrongMethod.Allowed);

        // "register" is not a guid, so the PATCH route does not make PATCH an allowed method here.
        var literal = catalog.Explain("DELETE", "/api/apps/codered/repositories/register");
        Assert.Equal(["POST"], literal.Allowed);

        var missing = catalog.Explain("GET", "/api/repositories");
        Assert.Empty(missing.Allowed);
        Assert.Contains(missing.Closest, route => route.Path == "/api/apps/codered/repositories");
        Assert.Equal("/discover/find?q=repositories", missing.Find);
    }

    [Fact]
    public async Task Explain_names_the_value_that_failed_a_route_constraint()
    {
        await using var app = BuildApp();
        var catalog = await CatalogOf(app);

        var miss = catalog.Explain("PATCH", "/api/apps/codered/repositories/redleaf");
        Assert.Empty(miss.Allowed);
        Assert.Equal("/api/apps/codered/repositories/{id:guid}", miss.BadValue?.Path);
    }

    [Fact]
    public async Task OpenApi_covers_plugin_routes_without_routing_constraints_in_its_paths()
    {
        await using var app = BuildApp();
        var (status, body) = await Call(app, "/openapi.json", user: SignedIn());

        Assert.Equal(200, status);
        var paths = body.GetProperty("paths");
        Assert.True(paths.TryGetProperty("/api/apps/codered/repositories/{id}", out _));
        Assert.False(paths.TryGetProperty("/api/apps/codered/repositories/{id:guid}", out _));
        Assert.True(paths.GetProperty("/api/apps/codered/repositories/register").TryGetProperty("post", out var post));
        Assert.True(post.TryGetProperty("requestBody", out _));
    }

    private static async Task<(int Status, JsonElement Body, HttpContext Context)> NoRoute(
        WebApplication app, string method, string path, ClaimsPrincipal? user)
    {
        var context = new DefaultHttpContext { RequestServices = app.Services };
        context.Request.Method = method;
        context.Request.Path = path;
        context.Connection.RemoteIpAddress = IPAddress.Parse("203.0.113.9");
        if (user is not null) context.User = user;
        context.Response.Body = new MemoryStream();
        await ((IApplicationBuilder)app).WriteNoRouteAsync(context, path);
        context.Response.Body.Position = 0;
        using var document = await JsonDocument.ParseAsync(context.Response.Body);
        return (context.Response.StatusCode, document.RootElement.Clone(), context);
    }

    [Fact]
    public async Task A_signed_in_caller_with_the_wrong_method_hears_which_methods_work()
    {
        await using var app = BuildApp();
        var (status, body, context) = await NoRoute(app, "PATCH", "/api/apps/codered/repositories", SignedIn());

        Assert.Equal(405, status);
        Assert.Equal("GET", context.Response.Headers.Allow.ToString());
        Assert.Equal("method_not_allowed", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task A_signed_in_caller_who_guessed_a_path_gets_the_closest_routes()
    {
        await using var app = BuildApp();
        var (status, body, _) = await NoRoute(app, "GET", "/api/repositories", SignedIn());

        Assert.Equal(404, status);
        Assert.Contains(body.GetProperty("closest").EnumerateArray(),
            route => route.GetProperty("path").GetString() == "/api/apps/codered/repositories");
    }

    [Fact]
    public async Task A_stranger_who_reaches_no_route_learns_nothing_about_the_routes()
    {
        await using var app = BuildApp();
        var (status, body, _) = await NoRoute(app, "PATCH", "/api/apps/codered/repositories", null);

        Assert.Equal(404, status);
        Assert.False(body.TryGetProperty("closest", out _));
        Assert.False(body.TryGetProperty("allowed", out _));
    }

    [Fact]
    public async Task A_hand_read_body_can_carry_a_schema_without_restricting_content_types()
    {
        await using var app = BuildApp();
        var catalog = await CatalogOf(app);
        var route = catalog.Routes.Single(item => item.Path == "/api/apps/codered/raw-body");

        Assert.NotNull(route.RequestBody);
        Assert.Null(route.ContentTypes);
        var metadata = ((IEndpointRouteBuilder)app).DataSources.SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Single(endpoint => endpoint.RoutePattern.RawText == "/api/apps/codered/raw-body")
            .Metadata.GetMetadata<IAcceptsMetadata>();
        Assert.Empty(metadata!.ContentTypes);
    }

    [Fact]
    public void A_host_with_no_sign_in_trusts_only_its_own_machine()
    {
        var remote = new DefaultHttpContext();
        remote.Connection.RemoteIpAddress = IPAddress.Parse("203.0.113.9");
        var local = new DefaultHttpContext();
        local.Connection.RemoteIpAddress = IPAddress.Loopback;
        local.Connection.LocalIpAddress = IPAddress.Loopback;

        Assert.False(DiscoveryEndpoints.MayReadCatalog(remote, null));
        Assert.True(DiscoveryEndpoints.MayReadCatalog(local, null));
        Assert.False(DiscoveryEndpoints.MayReadCatalog(local, new AuthOptions()));
    }
}
