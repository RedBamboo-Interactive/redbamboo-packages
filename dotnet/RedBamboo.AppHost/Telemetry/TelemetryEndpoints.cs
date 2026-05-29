using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using RedBamboo.AppHost.Discovery;

namespace RedBamboo.AppHost.Telemetry;

public static class TelemetryEndpoints
{
    public static void MapTelemetryEndpoints(this WebApplication app, TelemetryService telemetry)
    {
        var group = app.MapGroup("/api/telemetry");

        group.MapGet("/", (
            string? route,
            string? method,
            double? min_duration,
            int? min_status,
            int? max_status,
            string? since,
            string? until,
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

        group.MapPost("/cleanup", () =>
        {
            var deleted = telemetry.Cleanup();
            return Results.Ok(new { ok = true, deleted });
        });
    }

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
            ]);
    }
}
