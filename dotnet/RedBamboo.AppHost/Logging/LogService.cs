using System.Collections.Concurrent;

namespace RedBamboo.AppHost.Logging;

public class LogService
{
    private readonly ConcurrentQueue<LogEntry> _buffer = new();
    private readonly LogServiceOptions _options;
    private int _count;
    private int _errorCount;
    private int _warnCount;

    public LogService(LogServiceOptions options)
    {
        _options = options;
    }

    public event Action<LogEntry>? OnLogEntry;

    public int Count => _count;
    public int ErrorCount => _errorCount;
    public int WarnCount => _warnCount;
    public string Source => _options.Source;

    public LogEntry Log(
        LogLevel level,
        string category,
        string message,
        string? fullMessage = null,
        string? tag = null,
        string? tagColor = null,
        string? stackTrace = null,
        string? correlationId = null,
        string? jobId = null,
        string? instanceId = null,
        IReadOnlyDictionary<string, object>? metadata = null)
    {
        if (_options.Parser is { } parser)
        {
            var parsed = parser.Parse(message);
            tag = parsed.Tag;
            tagColor = parsed.TagColor;
            if (parsed.Category is not null) category = parsed.Category;
            if (parsed.Level is not null) level = parsed.Level.Value;
        }

        var entry = new LogEntry
        {
            Id = GenerateId(),
            Timestamp = DateTimeOffset.UtcNow,
            Level = level,
            Category = category,
            Source = _options.Source,
            Message = ExtractFirstLine(message),
            FullMessage = fullMessage ?? (message.Contains('\n') ? message : null),
            Tag = tag,
            TagColor = tagColor,
            StackTrace = stackTrace,
            CorrelationId = correlationId,
            JobId = jobId,
            InstanceId = instanceId,
            Metadata = metadata,
        };

        Enqueue(entry);
        PersistIfAvailable(entry);
        OnLogEntry?.Invoke(entry);

        return entry;
    }

    public LogEntry Debug(string category, string message, string? correlationId = null)
        => Log(LogLevel.Debug, category, message, correlationId: correlationId);

    public LogEntry Info(string category, string message, string? correlationId = null)
        => Log(LogLevel.Info, category, message, correlationId: correlationId);

    public LogEntry Warn(string category, string message, string? correlationId = null)
        => Log(LogLevel.Warn, category, message, correlationId: correlationId);

    public LogEntry Error(string category, string message, string? stackTrace = null, string? correlationId = null)
        => Log(LogLevel.Error, category, message, stackTrace: stackTrace, correlationId: correlationId);

    public LogEntry Critical(string category, string message, string? stackTrace = null, string? correlationId = null)
        => Log(LogLevel.Critical, category, message, stackTrace: stackTrace, correlationId: correlationId);

    public IReadOnlyList<LogEntry> Query(LogQueryParams? queryParams = null)
    {
        var q = queryParams ?? new LogQueryParams();
        IEnumerable<LogEntry> entries = _buffer;

        if (q.MinLevel is { } minLevel)
            entries = entries.Where(e => e.Level >= minLevel);
        if (q.Category is { } cat)
            entries = entries.Where(e => e.Category.StartsWith(cat, StringComparison.OrdinalIgnoreCase));
        if (q.Source is { } src)
            entries = entries.Where(e => e.Source.Equals(src, StringComparison.OrdinalIgnoreCase));
        if (q.InstanceId is { } iid)
            entries = entries.Where(e => e.InstanceId == iid);
        if (q.CorrelationId is { } cid)
            entries = entries.Where(e => e.CorrelationId == cid);
        if (q.JobId is { } jid)
            entries = entries.Where(e => e.JobId == jid);
        if (q.Search is { } search)
            entries = entries.Where(e =>
                e.Message.Contains(search, StringComparison.OrdinalIgnoreCase) ||
                (e.FullMessage?.Contains(search, StringComparison.OrdinalIgnoreCase) == true) ||
                (e.Tag?.Contains(search, StringComparison.OrdinalIgnoreCase) == true));
        if (q.AfterId is { } afterId)
            entries = entries.SkipWhile(e => e.Id != afterId).Skip(1);
        if (q.Since is { } since)
            entries = entries.Where(e => e.Timestamp >= since);
        if (q.Until is { } until)
            entries = entries.Where(e => e.Timestamp <= until);

        return entries.TakeLast(q.Limit).ToList();
    }

    public async Task<(IReadOnlyList<LogEntry> Entries, int Total)> QueryPersistedAsync(LogQueryParams query)
    {
        if (_options.Persistence is { } persistence)
            return await persistence.QueryAsync(query);

        var entries = Query(query);
        return (entries, entries.Count);
    }

    public void Clear()
    {
        while (_buffer.TryDequeue(out _)) { }
        Interlocked.Exchange(ref _count, 0);
        Interlocked.Exchange(ref _errorCount, 0);
        Interlocked.Exchange(ref _warnCount, 0);
    }

    public object GetStats() => new
    {
        total = _count,
        errors = _errorCount,
        warnings = _warnCount,
        buffer_size = _buffer.Count,
        buffer_capacity = _options.BufferCapacity,
        source = _options.Source,
        has_persistence = _options.Persistence is not null,
        has_parser = _options.Parser is not null,
    };

    private void Enqueue(LogEntry entry)
    {
        _buffer.Enqueue(entry);
        Interlocked.Increment(ref _count);

        if (entry.Level >= LogLevel.Error) Interlocked.Increment(ref _errorCount);
        if (entry.Level == LogLevel.Warn) Interlocked.Increment(ref _warnCount);

        while (_buffer.Count > _options.BufferCapacity)
            _buffer.TryDequeue(out _);
    }

    private void PersistIfAvailable(LogEntry entry)
    {
        if (_options.Persistence is not { } persistence) return;
        _ = Task.Run(() => persistence.PersistAsync([entry]));
    }

    private static string GenerateId()
    {
        Span<byte> bytes = stackalloc byte[4];
        System.Security.Cryptography.RandomNumberGenerator.Fill(bytes);
        return Convert.ToHexStringLower(bytes);
    }

    private static string ExtractFirstLine(string message)
    {
        var idx = message.IndexOf('\n');
        return idx >= 0 ? message[..idx].TrimEnd('\r') : message;
    }
}
