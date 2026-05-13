using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using RedBamboo.AppHost.Discovery;

namespace RedBamboo.AppHost.Logging;

public static class LogEndpoints
{
    public static void MapLogEndpoints(this WebApplication app, LogService logService)
    {
        var group = app.MapGroup("/api/logs");

        group.MapGet("/", async (
            string? level,
            string? category,
            string? source,
            string? instance_id,
            string? correlation_id,
            string? job_id,
            string? search,
            string? after_id,
            string? since,
            string? until,
            int? limit) =>
        {
            if (since is not null && !DateTimeOffset.TryParse(since, out _))
                return Results.BadRequest(new { error = "Invalid 'since' timestamp" });
            if (until is not null && !DateTimeOffset.TryParse(until, out _))
                return Results.BadRequest(new { error = "Invalid 'until' timestamp" });

            var query = new LogQueryParams
            {
                MinLevel = level is not null ? LogLevelExtensions.FromString(level) : null,
                Category = category,
                Source = source,
                InstanceId = instance_id,
                CorrelationId = correlation_id,
                JobId = job_id,
                Search = search,
                AfterId = after_id,
                Since = since is not null ? DateTimeOffset.Parse(since) : null,
                Until = until is not null ? DateTimeOffset.Parse(until) : null,
                Limit = limit ?? 200,
            };

            var (entries, total) = await logService.QueryPersistedAsync(query);
            var byLevel = entries
                .GroupBy(e => e.Level.ToWireString())
                .ToDictionary(g => g.Key, g => g.Count());

            return Results.Ok(new
            {
                entries = entries.Select(e => e.ToWireFormat()),
                total,
                by_level = byLevel,
                error_count = entries.Count(e => e.Level >= LogLevel.Error),
                warn_count = entries.Count(e => e.Level == LogLevel.Warn),
            });
        });

        group.MapPost("/clear", () =>
        {
            logService.Clear();
            return Results.Ok(new { ok = true });
        });

        group.MapGet("/summary", () =>
        {
            var recentErrors = logService
                .Query(new LogQueryParams { MinLevel = LogLevel.Error, Limit = 10 })
                .Select(e => e.ToWireFormat());

            return Results.Ok(new
            {
                stats = logService.GetStats(),
                recent_errors = recentErrors,
            });
        });
    }

    public static CapabilityDescriptor GetLogCapabilityDescriptor(LogService logService)
    {
        return new CapabilityDescriptor(
            Slug: "logging",
            DisplayName: "Structured Logging",
            Status: "ok",
            Description: $"Unified log collection for {logService.Source} with query and streaming support",
            Endpoints:
            [
                new EndpointDescriptor("GET", "/api/logs", "Query log entries with filters", Parameters:
                [
                    new ParameterDescriptor("level", "string", Description: "Minimum log level", Enum: ["debug", "info", "warn", "error", "critical"]),
                    new ParameterDescriptor("category", "string", Description: "Category prefix filter"),
                    new ParameterDescriptor("source", "string", Description: "Source app filter"),
                    new ParameterDescriptor("instance_id", "string", Description: "Instance ID filter"),
                    new ParameterDescriptor("correlation_id", "string", Description: "Correlation ID filter"),
                    new ParameterDescriptor("job_id", "string", Description: "Job ID filter"),
                    new ParameterDescriptor("search", "string", Description: "Full-text search across message, tag"),
                    new ParameterDescriptor("after_id", "string", Description: "Cursor-based pagination — entries after this ID"),
                    new ParameterDescriptor("since", "string", Description: "ISO8601 start time"),
                    new ParameterDescriptor("until", "string", Description: "ISO8601 end time"),
                    new ParameterDescriptor("limit", "integer", Description: "Max entries to return", Default: 200),
                ]),
                new EndpointDescriptor("POST", "/api/logs/clear", "Clear the in-memory log buffer"),
                new EndpointDescriptor("GET", "/api/logs/summary", "Aggregate stats and recent errors"),
            ]);
    }
}
