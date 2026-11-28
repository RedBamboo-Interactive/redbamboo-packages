using System.Threading.Channels;
using Microsoft.Data.Sqlite;
using RedBamboo.AppHost.Logging;
using RedBamboo.AppHost.Telemetry.FlightRecorder;

namespace RedBamboo.AppHost.Telemetry;

public class TelemetryService : IAsyncDisposable
{
    private readonly TelemetryOptions _options;
    private readonly string _connectionString;
    private readonly Channel<TelemetryEntry> _channel;
    private readonly Task _consumerTask;
    private readonly Task _cleanupTask;
    private readonly CancellationTokenSource _cts = new();

    private readonly Dictionary<string, string> _descriptions = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Rows per DELETE in the retention cleanup, so the write lock is never held for a whole day of rows.</summary>
    internal const int CleanupChunkRows = 5_000;
    private static readonly TimeSpan FailureLogInterval = TimeSpan.FromHours(1);

    private LogService? _log;
    private long _lastWriteFailureLog = long.MinValue;
    private long _lastCleanupFailureLog = long.MinValue;
    private int _writeFailures;
    private long _droppedRows;
    private int _cleanupFailures;

    /// <summary>Batches the writer could not store since start; each one's rows are dropped and the writer carries on.</summary>
    public int WriteFailures => Volatile.Read(ref _writeFailures);

    /// <summary>Request rows lost to failed batches since start.</summary>
    public long DroppedRows => Interlocked.Read(ref _droppedRows);

    /// <summary>Retention cleanups that failed since start; each is retried at the next daily run.</summary>
    public int CleanupFailures => Volatile.Read(ref _cleanupFailures);

    /// <summary>Where writer, cleanup and flight recorder failures and stall warnings go; until attached they are only counted.</summary>
    public void AttachLog(LogService log)
    {
        _log = log;
        Recorder.AttachLog(log);
    }

    public event Action<TelemetryEntry>? OnEntry;
    public TelemetryOptions Options => _options;

    /// <summary>Query surface over this service's database, reusable against other apps' databases too.</summary>
    public TelemetryReader Reader { get; }

    /// <summary>Process samples (and their read surface) in this service's database.</summary>
    public FlightRecorderService Recorder { get; }

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
        Recorder = new FlightRecorderService(options.FlightRecorder, _connectionString);
        Recorder.Start();
        _consumerTask = Task.Run(() => ConsumeAsync(_cts.Token));
        _cleanupTask = Task.Run(() => CleanupLoopAsync(_cts.Token));
    }

    public void Record(TelemetryEntry entry)
    {
        _channel.Writer.TryWrite(entry);
        Recorder.ObserveRequest(entry);
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
            telemetry_write_failures = WriteFailures,
            telemetry_dropped_rows = DroppedRows,
            telemetry_cleanup_failures = CleanupFailures,
        };
    }

    public int Cleanup()
    {
        var cutoff = DateTimeOffset.UtcNow.AddDays(-_options.RetentionDays);
        using var conn = new SqliteConnection(_connectionString);
        conn.Open();

        // In chunks, each its own transaction, so the request writer gets the lock between them. A single
        // DELETE of a whole day (1.0 to 1.7 million rows here) holds it for as long as that takes.
        var deleted = 0;
        while (true)
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                DELETE FROM requests WHERE id IN
                    (SELECT id FROM requests WHERE timestamp < @cutoff ORDER BY timestamp LIMIT @chunk)
                """;
            cmd.Parameters.AddWithValue("@cutoff", cutoff.ToString("O"));
            cmd.Parameters.AddWithValue("@chunk", CleanupChunkRows);
            var chunk = cmd.ExecuteNonQuery();
            deleted += chunk;
            if (chunk < CleanupChunkRows || _cts.IsCancellationRequested) break;
        }

        // The flight recorder's tables keep their own retention, whatever RetentionDays says.
        var recorderDeleted = Recorder.Store.Cleanup(
            DateTimeOffset.UtcNow.AddDays(-_options.FlightRecorder.RetentionDays));

        if (deleted > 0 || recorderDeleted > 0)
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
        try { await _cleanupTask; } catch (OperationCanceledException) { }
        Recorder.Dispose();
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
                kind TEXT,
                execution_id TEXT,
                app_id TEXT,
                actor_kind TEXT,
                actor_id TEXT,
                beneficiary_kind TEXT,
                beneficiary_id TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);
            CREATE INDEX IF NOT EXISTS idx_requests_route ON requests(route_pattern);
            CREATE INDEX IF NOT EXISTS idx_requests_duration ON requests(duration_ms);
            """;
        cmd.ExecuteNonQuery();

        MigrateSchema(conn);
        FlightRecorderStore.EnsureSchema(conn);
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

        foreach (var column in new[]
        {
            "execution_id", "app_id", "actor_kind", "actor_id",
            "beneficiary_kind", "beneficiary_id",
        })
        {
            if (columns.Contains(column)) continue;
            using var alter = conn.CreateCommand();
            alter.CommandText = $"ALTER TABLE requests ADD COLUMN {column} TEXT";
            alter.ExecuteNonQuery();
        }

        // ADD COLUMN of a nullable column without a default only rewrites the schema text: no table
        // rewrite, so it is instant on an 18 GB store, and existing rows read the new columns as NULL.
        foreach (var (column, type) in new[] { ("db_ms", "REAL"), ("db_count", "INTEGER") })
        {
            if (columns.Contains(column)) continue;
            using var alter = conn.CreateCommand();
            alter.CommandText = $"ALTER TABLE requests ADD COLUMN {column} {type}";
            alter.ExecuteNonQuery();
        }

        using var index = conn.CreateCommand();
        index.CommandText = "CREATE INDEX IF NOT EXISTS idx_requests_execution ON requests(execution_id)";
        index.ExecuteNonQuery();
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

                WriteBatchOrDrop(batch);
                batch.Clear();
            }
        }
        catch (OperationCanceledException) { }

        while (_channel.Reader.TryRead(out var remaining))
            batch.Add(remaining);
        if (batch.Count > 0) WriteBatchOrDrop(batch);
    }

    /// <summary>
    /// One failed batch (a lock held past the busy timeout, a full disk) loses that batch, not every row
    /// until the process restarts: this is the only consumer, and it used to end, silently, on the first
    /// exception (RedLeaf's telemetry.db has no rows from 14 Nov 00:11Z to 15 Nov 03:10Z and from
    /// 17 Nov 16:27Z to 19 Nov 23:44Z 2026, each starting about a day after a kernel start).
    /// </summary>
    private void WriteBatchOrDrop(List<TelemetryEntry> batch)
    {
        try
        {
            WriteBatch(batch);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            var failures = Interlocked.Increment(ref _writeFailures);
            var dropped = Interlocked.Add(ref _droppedRows, batch.Count);
            if (ShouldLog(ref _lastWriteFailureLog))
                _log?.Warn("telemetry", $"Request telemetry batch of {batch.Count} rows not written ({failures} failed batches, " +
                    $"{dropped} rows dropped since start): {ex.GetType().Name}: {ex.Message}");
        }
    }

    private static bool ShouldLog(ref long last)
    {
        var now = Environment.TickCount64;
        var previous = Interlocked.Read(ref last);
        if (previous != long.MinValue && now - previous < (long)FailureLogInterval.TotalMilliseconds) return false;
        return Interlocked.CompareExchange(ref last, now, previous) == previous;
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
                     duration_ms, response_size, correlation_id, error, kind,
                     execution_id, app_id, actor_kind, actor_id, beneficiary_kind, beneficiary_id,
                     db_ms, db_count)
                VALUES
                    (@ts, @method, @path, @route, @status,
                     @duration, @size, @corr, @err, @kind,
                     @execution, @app, @actorKind, @actor, @beneficiaryKind, @beneficiary,
                     @dbMs, @dbCount)
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
            cmd.Parameters.AddWithValue("@execution", (object?)e.ExecutionId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@app", (object?)e.AppId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@actorKind", (object?)e.ActorKind ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@actor", (object?)e.ActorId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@beneficiaryKind", (object?)e.BeneficiaryKind ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@beneficiary", (object?)e.BeneficiaryId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@dbMs", (object?)e.DbMs ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@dbCount", (object?)e.DbCount ?? DBNull.Value);
            cmd.ExecuteNonQuery();
        }

        tx.Commit();
    }

    private async Task CleanupLoopAsync(CancellationToken ct)
    {
        try
        {
            CleanupOrLog();
            while (!ct.IsCancellationRequested)
            {
                await Task.Delay(TimeSpan.FromHours(24), ct);
                CleanupOrLog();
            }
        }
        catch (OperationCanceledException) { }
    }

    /// <summary>A failed cleanup is retried the next day instead of ending retention for the life of the process.</summary>
    internal void CleanupOrLog()
    {
        try
        {
            Cleanup();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            var failures = Interlocked.Increment(ref _cleanupFailures);
            if (ShouldLog(ref _lastCleanupFailureLog))
                _log?.Warn("telemetry", $"Telemetry retention cleanup failed ({failures} so far), retried in 24 h: {ex.GetType().Name}: {ex.Message}");
        }
    }
}
