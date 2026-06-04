namespace RedBamboo.AppHost.Telemetry;

public record TelemetryEntry
{
    public long Id { get; init; }
    public DateTimeOffset Timestamp { get; init; } = DateTimeOffset.UtcNow;
    public string Method { get; init; } = "";
    public string Path { get; init; } = "";
    public string? RoutePattern { get; init; }
    public int StatusCode { get; init; }
    public double DurationMs { get; init; }
    public long? ResponseSize { get; init; }
    public string? CorrelationId { get; init; }
    public string? Error { get; init; }
    public string? Kind { get; init; }

    public object ToWireFormat() => new
    {
        id = Id,
        timestamp = Timestamp.ToString("O"),
        method = Method,
        path = Path,
        route_pattern = RoutePattern,
        status_code = StatusCode,
        duration_ms = Math.Round(DurationMs, 2),
        response_size = ResponseSize,
        correlation_id = CorrelationId,
        error = Error,
        kind = Kind,
    };
}

public record TelemetryQueryParams
{
    public string? RoutePattern { get; init; }
    public string? Method { get; init; }
    public double? MinDurationMs { get; init; }
    public int? MinStatusCode { get; init; }
    public int? MaxStatusCode { get; init; }
    public DateTimeOffset? Since { get; init; }
    public DateTimeOffset? Until { get; init; }
    public int Limit { get; init; } = 100;
    public int Offset { get; init; }
}

public record RouteStats
{
    public string Method { get; init; } = "";
    public string RoutePattern { get; init; } = "";
    public int Count { get; init; }
    public int ErrorCount { get; init; }
    public double AvgMs { get; init; }
    public double MinMs { get; init; }
    public double MaxMs { get; init; }
    public double P10Ms { get; init; }
    public double P50Ms { get; init; }
    public double P70Ms { get; init; }
    public double P90Ms { get; init; }
    public double P99Ms { get; init; }
    public long? AvgResponseSize { get; init; }
    public string? LastSeen { get; init; }
    public string? Kind { get; init; }
    public string? Description { get; init; }
}
