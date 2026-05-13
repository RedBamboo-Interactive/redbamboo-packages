namespace RedBamboo.AppHost.Logging;

public record LogEntry
{
    public required string Id { get; init; }
    public required DateTimeOffset Timestamp { get; init; }
    public required LogLevel Level { get; init; }
    public required string Category { get; init; }
    public required string Source { get; init; }
    public required string Message { get; init; }
    public string? FullMessage { get; init; }
    public string? Tag { get; init; }
    public string? TagColor { get; init; }
    public string? StackTrace { get; init; }
    public string? CorrelationId { get; init; }
    public string? JobId { get; init; }
    public string? InstanceId { get; init; }
    public IReadOnlyDictionary<string, object>? Metadata { get; init; }

    public bool IsError => Level >= LogLevel.Error;
    public bool IsMultiline => FullMessage?.Contains('\n') == true;

    public object ToWireFormat() => new
    {
        id = Id,
        timestamp = Timestamp.ToString("o"),
        level = Level.ToWireString(),
        category = Category,
        source = Source,
        message = Message,
        full_message = FullMessage,
        tag = Tag,
        tag_color = TagColor,
        stack_trace = StackTrace,
        correlation_id = CorrelationId,
        job_id = JobId,
        instance_id = InstanceId,
        metadata = Metadata,
        is_error = IsError,
        is_multiline = IsMultiline,
    };
}
