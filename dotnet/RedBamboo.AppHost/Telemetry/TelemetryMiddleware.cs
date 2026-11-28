using System.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using RedBamboo.AppHost.Auth;

namespace RedBamboo.AppHost.Telemetry;

public sealed class TelemetryMiddleware
{
    private readonly RequestDelegate _next;
    private readonly TelemetryService _telemetry;

    public TelemetryMiddleware(RequestDelegate next, TelemetryService telemetry)
    {
        _next = next;
        _telemetry = telemetry;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        if (ShouldSkip(context))
        {
            await _next(context);
            return;
        }

        var sw = Stopwatch.StartNew();
        string? error = null;
        var db = _telemetry.Options.RecordDatabaseTime ? RequestDbTiming.Begin() : null;

        context.Response.OnStarting(() =>
        {
            context.Response.Headers["Server-Timing"] = db is { Count: > 0 }
                ? FormattableString.Invariant($"total;dur={sw.Elapsed.TotalMilliseconds:F1}, db;dur={db.Elapsed.TotalMilliseconds:F1}")
                : FormattableString.Invariant($"total;dur={sw.Elapsed.TotalMilliseconds:F1}");
            return Task.CompletedTask;
        });

        try
        {
            await _next(context);
        }
        catch (Exception ex)
        {
            error = ex.Message;
            throw;
        }
        finally
        {
            sw.Stop();
            db?.Close();

            if (!IsStreamingResponse(context))
            {
                var durationMs = sw.Elapsed.TotalMilliseconds;

                var endpoint = context.GetEndpoint();
                var routePattern = (endpoint as RouteEndpoint)?.RoutePattern?.RawText;

                var kind = context.Items.TryGetValue("Telemetry.Kind", out var k) ? k as string : null;
                var execution = context.Items.TryGetValue(
                    ExecutionIdentityClaims.HttpContextItemKey, out var identity)
                    ? identity as ExecutionIdentity
                    : null;

                _telemetry.Record(new TelemetryEntry
                {
                    Timestamp = DateTimeOffset.UtcNow,
                    Method = context.Request.Method,
                    Path = context.Request.Path.Value ?? "/",
                    RoutePattern = routePattern,
                    StatusCode = context.Response.StatusCode,
                    DurationMs = durationMs,
                    ResponseSize = context.Response.ContentLength,
                    CorrelationId = context.Request.Headers["X-Correlation-Id"].FirstOrDefault(),
                    Error = error ?? (context.Response.StatusCode >= 400 ? $"HTTP {context.Response.StatusCode}" : null),
                    Kind = kind,
                    ExecutionId = execution?.ExecutionId,
                    AppId = execution?.App.Id,
                    ActorKind = execution?.Actor.Kind,
                    ActorId = execution?.Actor.Id,
                    BeneficiaryKind = execution?.Beneficiary.Kind,
                    BeneficiaryId = execution?.Beneficiary.Id,
                    DbMs = db is { Count: > 0 } ? db.Elapsed.TotalMilliseconds : null,
                    DbCount = db is { Count: > 0 } ? db.Count : null,
                });
            }
        }
    }

    private bool ShouldSkip(HttpContext context)
    {
        if (context.WebSockets.IsWebSocketRequest)
            return true;

        var path = context.Request.Path.Value ?? "";
        var options = _telemetry.Options;

        foreach (var prefix in options.ExcludePathPrefixes)
        {
            if (path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                return true;
        }

        if (options.ExcludeStaticFiles && HasFileExtension(path))
            return true;

        return false;
    }

    private static bool IsStreamingResponse(HttpContext context)
    {
        var contentType = context.Response.ContentType;
        return contentType != null &&
               contentType.StartsWith("text/event-stream", StringComparison.OrdinalIgnoreCase);
    }

    private static bool HasFileExtension(string path)
    {
        var ext = Path.GetExtension(path);
        return !string.IsNullOrEmpty(ext);
    }
}
