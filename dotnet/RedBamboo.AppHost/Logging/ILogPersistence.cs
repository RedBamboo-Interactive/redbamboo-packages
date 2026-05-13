namespace RedBamboo.AppHost.Logging;

public interface ILogPersistence
{
    Task PersistAsync(IReadOnlyList<LogEntry> entries);

    Task<(IReadOnlyList<LogEntry> Entries, int Total)> QueryAsync(LogQueryParams query);

    Task CleanupAsync(int retentionDays);
}

public record LogQueryParams
{
    public LogLevel? MinLevel { get; init; }
    public string? Category { get; init; }
    public string? Source { get; init; }
    public string? InstanceId { get; init; }
    public string? CorrelationId { get; init; }
    public string? JobId { get; init; }
    public string? Search { get; init; }
    public string? AfterId { get; init; }
    public DateTimeOffset? Since { get; init; }
    public DateTimeOffset? Until { get; init; }
    public int Limit { get; init; } = 200;
}
