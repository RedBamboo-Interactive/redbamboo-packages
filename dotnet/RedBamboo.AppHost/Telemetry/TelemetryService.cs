using System.Threading.Channels;
using Microsoft.Data.Sqlite;

namespace RedBamboo.AppHost.Telemetry;

public class TelemetryService : IAsyncDisposable
{
    private readonly TelemetryOptions _options;
    private readonly string _connectionString;
    private readonly Channel<TelemetryEntry> _channel;
    private readonly Task _consumerTask;
    private readonly CancellationTokenSource _cts = new();

    private readonly Dictionary<string, string> _descriptions = new(StringComparer.OrdinalIgnoreCase);

    public event Action<TelemetryEntry>? OnEntry;
    public TelemetryOptions Options => _options;

    /// <summary>Query surface over this service's database, reusable against other apps' databases too.</summary>
    public TelemetryReader Reader { get; }

    public void DescribeRoute(string method, string routePattern, string description)
        => _descriptions[$"{method} {routePattern}"] = description;

    public TelemetryService(TelemetryOptions options)
    {
        _options = options;

        var dbPath = options.DbPath ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            options.AppName, "telemetry.db");
        Directory.CreateDirectory(Path.GetDirectoryName(dbPath)!);
        _connectionString = $"Data Source={dbPath}";
        Reader = new TelemetryReader(dbPath,
            key => _descriptions.TryGetValue(key, out var desc) ? desc : null);

        _channel = Channel.CreateBounded<TelemetryEntry>(
            new BoundedChannelOptions(10_000) { FullMode = BoundedChannelFullMode.DropOldest });

        InitializeDatabase();
        _consumerTask = Task.Run(() => ConsumeAsync(_cts.Token));
        _ = Task.Run(() => CleanupLoopAsync(_cts.Token));
    }

    public void Record(TelemetryEntry entry)
    {
        _channel.Writer.TryWrite(entry);
        OnEntry?.Invoke(entry);
    }

    public List<TelemetryEntry> Query(TelemetryQueryParams q) => Reader.Query(q);

    public List<RouteStats> GetStats(DateTimeOffset? since = null, string? routePattern = null)
        => Reader.GetStats(since, routePattern);

    public int GetTotalCount(DateTimeOffset? since = null) => Reader.GetTotalCount(since);

    public object GetProcessMetrics()
    {
        var proc = System.Diagnostics.Process.GetCurrentProcess();
        return new
        {
            cpu_total_ms = proc.TotalProcessorTime.TotalMilliseconds,
            working_set_mb = Math.Round(proc.WorkingSet64 / 1024.0 / 1024.0, 1),
            private_memory_mb = Math.Round(proc.PrivateMemorySize64 / 1024.0 / 1024.0, 1),
            gc_gen0 = GC.CollectionCount(0),
            gc_gen1 = GC.CollectionCount(1),
            gc_gen2 = GC.CollectionCount(2),
            gc_total_memory_mb = Math.Round(GC.GetTotalMemory(false) / 1024.0 / 1024.0, 1),
            thread_count = proc.Threads.Count,
            uptime_seconds = (int)(DateTime.UtcNow - proc.StartTime.ToUniversalTime()).TotalSeconds,
        };
    }

    public int Cleanup()
    {
        var cutoff = DateTimeOffset.UtcNow.AddDays(-_options.RetentionDays);
        using var conn = new SqliteConnection(_connectionString);
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM requests WHERE timestamp < @cutoff";
        cmd.Parameters.AddWithValue("@cutoff", cutoff.ToString("O"));
        var deleted = cmd.ExecuteNonQuery();

        if (deleted > 0)
        {
            using var optimize = conn.CreateCommand();
            optimize.CommandText = "PRAGMA optimize";
            optimize.ExecuteNonQuery();
        }

        return deleted;
    }

    public async ValueTask DisposeAsync()
    {
        await _cts.CancelAsync();
        _channel.Writer.Complete();
        try { await _consumerTask; } catch (OperationCanceledException) { }
        _cts.Dispose();
    }

    private void InitializeDatabase()
    {
        using var conn = new SqliteConnection(_connectionString);
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                method TEXT NOT NULL,
                path TEXT NOT NULL,
                route_pattern TEXT,
                status_code INTEGER NOT NULL,
                duration_ms REAL NOT NULL,
                response_size INTEGER,
                correlation_id TEXT,
                error TEXT,
                kind TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);
            CREATE INDEX IF NOT EXISTS idx_requests_route ON requests(route_pattern);
            CREATE INDEX IF NOT EXISTS idx_requests_duration ON requests(duration_ms);
            """;
        cmd.ExecuteNonQuery();

        MigrateSchema(conn);
    }

    private static void MigrateSchema(SqliteConnection conn)
    {
        using var pragma = conn.CreateCommand();
        pragma.CommandText = "PRAGMA table_info(requests)";
        var columns = new HashSet<string>();
        using (var reader = pragma.ExecuteReader())
            while (reader.Read()) columns.Add(reader.GetString(1));

        if (!columns.Contains("kind"))
        {
            using var alter = conn.CreateCommand();
            alter.CommandText = "ALTER TABLE requests ADD COLUMN kind TEXT";
            alter.ExecuteNonQuery();
        }
    }

    private async Task ConsumeAsync(CancellationToken ct)
    {
        var batch = new List<TelemetryEntry>(64);

        try
        {
            await foreach (var entry in _channel.Reader.ReadAllAsync(ct))
            {
                batch.Add(entry);
                while (batch.Count < 64 && _channel.Reader.TryRead(out var more))
                    batch.Add(more);

                WriteBatch(batch);
                batch.Clear();
            }
        }
        catch (OperationCanceledException) { }

        while (_channel.Reader.TryRead(out var remaining))
            batch.Add(remaining);
        if (batch.Count > 0) WriteBatch(batch);
    }

    private void WriteBatch(List<TelemetryEntry> entries)
    {
        using var conn = new SqliteConnection(_connectionString);
        conn.Open();
        using var tx = conn.BeginTransaction();

        foreach (var e in entries)
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                INSERT INTO requests
                    (timestamp, method, path, route_pattern, status_code,
                     duration_ms, response_size, correlation_id, error, kind)
                VALUES
                    (@ts, @method, @path, @route, @status,
                     @duration, @size, @corr, @err, @kind)
                """;
            cmd.Parameters.AddWithValue("@ts", e.Timestamp.ToString("O"));
            cmd.Parameters.AddWithValue("@method", e.Method);
            cmd.Parameters.AddWithValue("@path", e.Path);
            cmd.Parameters.AddWithValue("@route", (object?)e.RoutePattern ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@status", e.StatusCode);
            cmd.Parameters.AddWithValue("@duration", e.DurationMs);
            cmd.Parameters.AddWithValue("@size", (object?)e.ResponseSize ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@corr", (object?)e.CorrelationId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@err", (object?)e.Error ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@kind", (object?)e.Kind ?? DBNull.Value);
            cmd.ExecuteNonQuery();
        }

        tx.Commit();
    }

    private async Task CleanupLoopAsync(CancellationToken ct)
    {
        try
        {
            Cleanup();
            while (!ct.IsCancellationRequested)
            {
                await Task.Delay(TimeSpan.FromHours(24), ct);
                Cleanup();
            }
        }
        catch (OperationCanceledException) { }
    }
}
