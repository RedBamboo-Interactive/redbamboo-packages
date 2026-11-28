using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using RedBamboo.AppHost.Discovery;
using RedBamboo.AppHost.Auth;
using RedBamboo.AppHost.Telemetry.FlightRecorder;

namespace RedBamboo.AppHost.Telemetry;

public static class TelemetryEndpoints
{
    public static void MapTelemetryEndpoints(this WebApplication app, TelemetryService telemetry)
    {
        var group = app.MapGroup("/api/telemetry").RequireInfrastructureAccess();

        group.MapGet("/", (
            string? route,
            string? method,
            double? min_duration,
            int? min_status,
            int? max_status,
            string? since,
            string? until,
            string? execution_id,
            string? app_id,
            string? actor_id,
            string? beneficiary_id,
            int? limit,
            int? offset) =>
        {
            if (since is not null && !DateTimeOffset.TryParse(since, out _))
                return Results.BadRequest(new { error = "Invalid 'since' timestamp" });
            if (until is not null && !DateTimeOffset.TryParse(until, out _))
                return Results.BadRequest(new { error = "Invalid 'until' timestamp" });

            var query = new TelemetryQueryParams
            {
                RoutePattern = route,
                Method = method,
                MinDurationMs = min_duration,
                MinStatusCode = min_status,
                MaxStatusCode = max_status,
                Since = since is not null ? DateTimeOffset.Parse(since) : null,
                Until = until is not null ? DateTimeOffset.Parse(until) : null,
                ExecutionId = execution_id,
                AppId = app_id,
                ActorId = actor_id,
                BeneficiaryId = beneficiary_id,
                Limit = limit ?? 100,
                Offset = offset ?? 0,
            };

            var entries = telemetry.Query(query);

            return Results.Ok(new
            {
                entries = entries.Select(e => e.ToWireFormat()),
                count = entries.Count,
            });
        });

        group.MapGet("/stats", (string? since, string? route) =>
        {
            if (since is not null && !DateTimeOffset.TryParse(since, out _))
                return Results.BadRequest(new { error = "Invalid 'since' timestamp" });

            var sinceDate = since is not null ? DateTimeOffset.Parse(since) : (DateTimeOffset?)null;
            var stats = telemetry.GetStats(sinceDate, route);
            var total = telemetry.GetTotalCount(sinceDate);

            return Results.Ok(new
            {
                routes = stats,
                total_requests = total,
                since = sinceDate?.ToString("O"),
            });
        });

        group.MapGet("/process", () => Results.Ok(telemetry.GetProcessMetrics()));

        group.MapGet("/samples", (string? since, string? until, int? limit, int? offset) =>
            {
                if (!TryRange(since, until, out var from, out var to, out var problem)) return problem!;
                var page = Page(limit, offset, DefaultSamplePage);
                var samples = telemetry.Recorder.QuerySamples(from, to, page.Limit, page.Offset);
                return Results.Ok(new
                {
                    samples = samples.Select(sample => sample.ToWireFormat()),
                    count = samples.Count,
                    limit = page.Limit,
                    offset = page.Offset,
                    interval_seconds = telemetry.Options.FlightRecorder.SampleInterval.TotalSeconds,
                    enabled = telemetry.Options.FlightRecorder.ProcessSampler,
                });
            })
            .WithSummary(SamplesDescription);

        group.MapGet("/stalls", (string? since, string? until, string? tick, int? limit, int? offset) =>
            {
                if (!TryRange(since, until, out var from, out var to, out var problem)) return problem!;
                if (tick is not null && tick is not (StallTicks.Process or StallTicks.ThreadPool))
                    return Results.BadRequest(new { error = "Invalid 'tick': use 'process' or 'threadpool'" });
                var page = Page(limit, offset, DefaultStallPage);
                var stalls = telemetry.Recorder.QueryStalls(from, to, tick, page.Limit, page.Offset);
                return Results.Ok(new
                {
                    stalls = stalls.Select(stall => stall.ToWireFormat()),
                    count = stalls.Count,
                    limit = page.Limit,
                    offset = page.Offset,
                    threshold_ms = telemetry.Options.FlightRecorder.StallThreshold.TotalMilliseconds,
                    enabled = telemetry.Options.FlightRecorder.StallDetector,
                });
            })
            .WithSummary(StallsDescription);

        group.MapPost("/cleanup", () =>
        {
            var deleted = telemetry.Cleanup();
            return Results.Ok(new { ok = true, deleted });
        });
    }

    private const int DefaultSamplePage = 240;   // an hour at 15 s
    private const int DefaultStallPage = 100;

    private const string SamplesDescription =
        "Process samples, newest first, one per 15 s (limit default 240, at most 2000; since/until ISO 8601). " +
        "Per sample: cpu_cores over the interval, working_set_bytes, private_bytes, heap_total/committed and per " +
        "generation (gen0-2, loh, poh; as of the last GC), gc_gen0-2 and gc_pause_ms and allocated_bytes over the " +
        "interval, thread_count, threadpool_threads/pending, threadpool_completed and lock_contentions over the " +
        "interval, request_count and the slowest request (method + route), db_pool_busy/idle/pending, and groups[] " +
        "(host-owned child processes, e.g. postgres: process_count, cpu_cores, working_set_bytes, private_bytes, " +
        "io_read_bytes/io_write_bytes over the interval). Null where not measured.";

    private const string StallsDescription =
        "Stall events, newest first (limit default 100, at most 2000; since/until ISO 8601; tick=process|threadpool). " +
        "A row means a 100 ms self-timing tick ran more than 250 ms late: tick 'process' (a dedicated thread: the " +
        "whole process paused, e.g. GC or OS scheduling) or 'threadpool' (late only there: pool starvation). Fields: " +
        "lateness_ms, gc_pause_ms during the late interval, threadpool_pending, threadpool_threads, thread_count, and " +
        "suppressed (late ticks the 5-per-minute limit did not write before this row).";

    private static bool TryRange(string? since, string? until, out DateTimeOffset? from, out DateTimeOffset? to, out IResult? problem)
    {
        from = to = null;
        problem = null;
        if (since is not null)
        {
            if (!DateTimeOffset.TryParse(since, out var parsed))
            {
                problem = Results.BadRequest(new { error = "Invalid 'since' timestamp" });
                return false;
            }
            from = parsed;
        }
        if (until is not null)
        {
            if (!DateTimeOffset.TryParse(until, out var parsed))
            {
                problem = Results.BadRequest(new { error = "Invalid 'until' timestamp" });
                return false;
            }
            to = parsed;
        }
        return true;
    }

    private static (int Limit, int Offset) Page(int? limit, int? offset, int defaultLimit)
        => (Math.Clamp(limit ?? defaultLimit, 1, FlightRecorderStore.MaxPageSize), Math.Max(0, offset ?? 0));

    public static CapabilityDescriptor GetTelemetryCapabilityDescriptor()
    {
        return new CapabilityDescriptor(
            Slug: "telemetry",
            DisplayName: "API Telemetry",
            Status: "ok",
            Description: "Per-request performance tracking with percentile stats",
            Endpoints:
            [
                new EndpointDescriptor("GET", "/api/telemetry",
                    "Query telemetry entries with filters", Parameters:
                    [
                        new ParameterDescriptor("route", "string",
                            Description: "Filter by route pattern"),
                        new ParameterDescriptor("method", "string",
                            Description: "Filter by HTTP method"),
                        new ParameterDescriptor("min_duration", "number",
                            Description: "Minimum duration in ms"),
                        new ParameterDescriptor("min_status", "integer",
                            Description: "Minimum status code"),
                        new ParameterDescriptor("max_status", "integer",
                            Description: "Maximum status code"),
                        new ParameterDescriptor("since", "string",
                            Description: "ISO8601 start time"),
                        new ParameterDescriptor("until", "string",
                            Description: "ISO8601 end time"),
                        new ParameterDescriptor("execution_id", "string",
                            Description: "Exact signed suite execution id"),
                        new ParameterDescriptor("app_id", "string",
                            Description: "Exact execution app id"),
                        new ParameterDescriptor("actor_id", "string",
                            Description: "Exact execution actor id"),
                        new ParameterDescriptor("beneficiary_id", "string",
                            Description: "Exact execution beneficiary id"),
                        new ParameterDescriptor("limit", "integer",
                            Description: "Max entries to return", Default: 100),
                        new ParameterDescriptor("offset", "integer",
                            Description: "Pagination offset", Default: 0),
                    ]),
                new EndpointDescriptor("GET", "/api/telemetry/stats",
                    "Aggregate stats by route with percentiles (p50/p70/p90/p99)", Parameters:
                    [
                        new ParameterDescriptor("since", "string",
                            Description: "ISO8601 start time"),
                        new ParameterDescriptor("route", "string",
                            Description: "Filter to specific route pattern"),
                    ]),
                new EndpointDescriptor("GET", "/api/telemetry/process",
                    "Current process metrics (CPU, memory, GC, threads)"),
                new EndpointDescriptor("POST", "/api/telemetry/cleanup",
                    "Trigger retention cleanup now"),
                new EndpointDescriptor("GET", "/api/telemetry/samples", SamplesDescription, Parameters:
                    [
                        new ParameterDescriptor("since", "string", Description: "ISO8601 start time"),
                        new ParameterDescriptor("until", "string", Description: "ISO8601 end time"),
                        new ParameterDescriptor("limit", "integer", Description: "Max samples (at most 2000)", Default: DefaultSamplePage),
                        new ParameterDescriptor("offset", "integer", Description: "Pagination offset", Default: 0),
                    ]),
                new EndpointDescriptor("GET", "/api/telemetry/stalls", StallsDescription, Parameters:
                    [
                        new ParameterDescriptor("since", "string", Description: "ISO8601 start time"),
                        new ParameterDescriptor("until", "string", Description: "ISO8601 end time"),
                        new ParameterDescriptor("tick", "string", Description: "process or threadpool"),
                        new ParameterDescriptor("limit", "integer", Description: "Max stalls (at most 2000)", Default: DefaultStallPage),
                        new ParameterDescriptor("offset", "integer", Description: "Pagination offset", Default: 0),
                    ]),
            ]);
    }
}
