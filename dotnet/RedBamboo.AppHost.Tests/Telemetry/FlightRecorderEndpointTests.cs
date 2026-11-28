using System.Net;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using RedBamboo.AppHost.Discovery;
using RedBamboo.AppHost.Telemetry;
using RedBamboo.AppHost.Telemetry.FlightRecorder;
using RedBamboo.AppHost.Tunnel;
using Xunit;

namespace RedBamboo.AppHost.Tests.Telemetry;

/// <summary>GET /api/telemetry/samples and /stalls: access, paging, validation, and their /discover descriptions.</summary>
public sealed class FlightRecorderEndpointTests : IAsyncLifetime
{
    private readonly TempTelemetryDb _db = new();
    private TelemetryService _telemetry = null!;
    private WebApplication _app = null!;

    public Task InitializeAsync()
    {
        _telemetry = new TelemetryService(new TelemetryOptions
        {
            AppName = "Probe",
            DbPath = _db.Path_,
            FlightRecorder = new FlightRecorderOptions { ProcessSampler = false, StallDetector = false },
        });
        var start = new DateTimeOffset(2026, 11, 28, 10, 0, 0, TimeSpan.Zero);
        for (var i = 0; i < 5; i++)
        {
            _telemetry.Recorder.Store.Insert(new ProcessSample
            {
                Timestamp = start.AddSeconds(15 * i),
                IntervalMs = 15_000,
                CpuCores = 0.25,
                WorkingSetBytes = 100 + i,
                Groups = [new ProcessGroupSample("postgres", 12, 0.05, 400, 90, 1_000, null)],
            });
        }
        _telemetry.Recorder.Store.Insert(new StallEvent { Timestamp = start, Tick = StallTicks.ThreadPool, LatenessMs = 900 });
        _telemetry.Recorder.Store.Insert(new StallEvent { Timestamp = start.AddMinutes(1), Tick = StallTicks.Process, LatenessMs = 400 });

        var builder = WebApplication.CreateSlimBuilder();
        _app = builder.Build();
        TelemetryEndpoints.MapTelemetryEndpoints(_app, _telemetry);
        _app.MapDiscoveryEndpoints(new Descriptor(new EndpointRegistry(_app)), new CloudflareTunnelService());
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        await _app.DisposeAsync();
        await _telemetry.DisposeAsync();
        _db.Dispose();
    }

    [Fact]
    public async Task Samples_PageNewestFirst_WithTheirGroups()
    {
        var (status, body) = await Call("/api/telemetry/samples", "?limit=2&offset=1", local: true);
        Assert.Equal(200, status);
        Assert.Equal(2, body.GetProperty("count").GetInt32());
        var samples = body.GetProperty("samples").EnumerateArray().ToList();
        Assert.Equal(103, samples[0].GetProperty("working_set_bytes").GetInt64());
        Assert.Equal(102, samples[1].GetProperty("working_set_bytes").GetInt64());
        var group = samples[0].GetProperty("groups")[0];
        Assert.Equal("postgres", group.GetProperty("name").GetString());
        Assert.Equal(12, group.GetProperty("process_count").GetInt32());
        Assert.Equal(JsonValueKind.Null, group.GetProperty("io_write_bytes").ValueKind);
        Assert.Equal(15, body.GetProperty("interval_seconds").GetDouble());

        (_, body) = await Call("/api/telemetry/samples", "?since=2026-11-28T11:00:30%2B01:00", local: true);
        Assert.Equal(3, body.GetProperty("count").GetInt32());             // 10:00:30Z and later

        (_, body) = await Call("/api/telemetry/samples", "?limit=999999", local: true);
        Assert.Equal(2000, body.GetProperty("limit").GetInt32());
    }

    [Fact]
    public async Task Stalls_FilterByTick_AndRejectBadInput()
    {
        var (status, body) = await Call("/api/telemetry/stalls", "?tick=threadpool", local: true);
        Assert.Equal(200, status);
        var stall = Assert.Single(body.GetProperty("stalls").EnumerateArray());
        Assert.Equal("threadpool", stall.GetProperty("tick").GetString());
        Assert.Equal(900, stall.GetProperty("lateness_ms").GetDouble());
        Assert.Equal(250, body.GetProperty("threshold_ms").GetDouble());

        (status, _) = await Call("/api/telemetry/stalls", "?tick=gc", local: true);
        Assert.Equal(400, status);
        (status, _) = await Call("/api/telemetry/samples", "?since=yesterday", local: true);
        Assert.Equal(400, status);
    }

    [Fact]
    public async Task ARemoteCallerWhoIsNotAnAdmin_IsRefused()
    {
        var (status, _) = await Call("/api/telemetry/samples", "", local: false, user: new ClaimsPrincipal(
            new ClaimsIdentity([new Claim("sub", "user-1"), new Claim("roles", "user")], "test")));
        Assert.Equal(403, status);
        (status, _) = await Call("/api/telemetry/stalls", "", local: false, user: new ClaimsPrincipal(
            new ClaimsIdentity([new Claim("sub", "admin-1"), new Claim("roles", "admin")], "test")));
        Assert.Equal(200, status);
    }

    [Fact]
    public async Task Discovery_DescribesBothRoutes()
    {
        var catalog = await ((IApplicationBuilder)_app).DiscoveryCatalog()!.GetAsync();
        var samples = catalog.Routes.Single(route => route.Path == "/api/telemetry/samples");
        var stalls = catalog.Routes.Single(route => route.Path == "/api/telemetry/stalls");
        Assert.Contains("cpu_cores", samples.Description);
        Assert.Contains("pool starvation", stalls.Description);
        Assert.Contains(samples.Parameters!, parameter => parameter.Name == "since");
        Assert.Contains(stalls.Parameters!, parameter => parameter.Name == "tick");

        var descriptor = TelemetryEndpoints.GetTelemetryCapabilityDescriptor();
        Assert.Contains(descriptor.Endpoints, endpoint => endpoint.Path == "/api/telemetry/samples");
        Assert.Contains(descriptor.Endpoints, endpoint => endpoint.Path == "/api/telemetry/stalls");
    }

    private async Task<(int Status, JsonElement Body)> Call(string pattern, string query, bool local, ClaimsPrincipal? user = null)
    {
        var endpoint = ((IEndpointRouteBuilder)_app).DataSources.SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Single(candidate => "/" + candidate.RoutePattern.RawText!.TrimStart('/') == pattern);
        var context = new DefaultHttpContext { RequestServices = _app.Services };
        context.Request.Method = "GET";
        context.Request.QueryString = new QueryString(query);
        context.Connection.RemoteIpAddress = local ? IPAddress.Loopback : IPAddress.Parse("203.0.113.9");
        if (user is not null) context.User = user;
        context.Response.Body = new MemoryStream();
        await endpoint.RequestDelegate!(context);
        context.Response.Body.Position = 0;
        if (context.Response.Body.Length == 0) return (context.Response.StatusCode, default);
        using var document = await JsonDocument.ParseAsync(context.Response.Body);
        return (context.Response.StatusCode, document.RootElement.Clone());
    }

    private sealed class Descriptor(EndpointRegistry registry) : RegistryServiceDescriptor(registry)
    {
        public override string ServiceName => "Probe";
        public override string Version => "1.0";
        public override string Description => "Probe service";
        public override string ApiBase => "http://127.0.0.1:1";

        // As both hosts list it (RedCompute and RedLeaf descriptors).
        public override Task<IReadOnlyList<CapabilityDescriptor>> GetCapabilitiesAsync() =>
            Task.FromResult<IReadOnlyList<CapabilityDescriptor>>([TelemetryEndpoints.GetTelemetryCapabilityDescriptor()]);
    }
}
