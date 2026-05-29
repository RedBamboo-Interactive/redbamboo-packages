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

    public event Action<TelemetryEntry>? OnEntry;
    public TelemetryOptions Options => _options;

    public TelemetryService(TelemetryOptions options)
    {
        _options = options;

        var dbPath = options.DbPath ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            options.AppName, "telemetry.db");
        Directory.CreateDirectory(Path.GetDirectoryName(dbPath)!);
        _connectionString = $"Data Source={dbPath}";

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

    public List<TelemetryEntry> Query(TelemetryQueryParams q)
    {
        using var conn = new SqliteConnection(_connectionString);
        conn.Open();

        var clauses = new List<string>();
        var cmd = conn.CreateCommand();

        if (q.RoutePattern is { } route)
        {
            clauses.Add("route_pattern = @route");
            cmd.Parameters.AddWithValue("@route", route);
        }
        if (q.Method is { } method)
        {
            clauses.Add("method = @method");
            cmd.Parameters.AddWithValue("@method", method);
        }
        if (q.MinDurationMs is { } minDur)
        {
            clauses.Add("duration_ms >= @minDur");
            cmd.Parameters.AddWithValue("@minDur", minDur);
        }
        if (q.MinStatusCode is { } minStatus)
        {
            clauses.Add("status_code >= @minStatus");
            cmd.Parameters.AddWithValue("@minStatus", minStatus);
        }
        if (q.MaxStatusCode is { } maxStatus)
        {
            clauses.Add("status_code <= @maxStatus");
            cmd.Parameters.AddWithValue("@maxStatus", maxStatus);
        }
        if (q.Since is { } since)
        {
            clauses.Add("timestamp >= @since");
            cmd.Parameters.AddWithValue("@since", since.ToString("O"));
        }
        if (q.Until is { } until)
        {
            clauses.Add("timestamp <= @until");
            cmd.Parameters.AddWithValue("@until", until.ToString("O"));
        }

        var where = clauses.Count > 0 ? "WHERE " + string.Join(" AND ", clauses) : "";
        cmd.CommandText = $"""
            SELECT id, timestamp, method, path, route_pattern, status_code,
                   duration_ms, response_size, correlation_id, error
            FROM requests {where}
            ORDER BY timestamp DESC
            LIMIT @limit OFFSET @offset
            """;
        cmd.Parameters.AddWithValue("@limit", q.Limit);
        cmd.Parameters.AddWithValue("@offset", q.Offset);

        return ReadEntries(cmd);
    }

    public List<RouteStats> GetStats(DateTimeOffset? since = null, string? routePattern = null)
    {
        using var conn = new SqliteConnection(_connectionString);
        conn.Open();

        var clauses = new List<string>();
        var cmd = conn.CreateCommand();

        if (since is { } s)
        {
            clauses.Add("timestamp >= @since");
            cmd.Parameters.AddWithValue("@since", s.ToString("O"));
        }
        if (routePattern is { } rp)
        {
            clauses.Add("route_pattern = @route");
            cmd.Parameters.AddWithValue("@route", rp);
        }

        var where = clauses.Count > 0 ? "WHERE " + string.Join(" AND ", clauses) : "";

        cmd.CommandText = $"""
            SELECT
                method,
                COALESCE(route_pattern, path) AS route,
                COUNT(*) AS cnt,
                AVG(duration_ms),
                MIN(duration_ms),
                MAX(duration_ms),
                SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END),
                AVG(response_size),
                MAX(timestamp)
            FROM requests {where}
            GROUP BY method, COALESCE(route_pattern, path)
            ORDER BY cnt DESC
            """;

        var groups = new List<(string method, string route, int count, double avg,
            double min, double max, int errors, double? avgSize, string lastSeen)>();

        using (var reader = cmd.ExecuteReader())
        {
            while (reader.Read())
            {
                groups.Add((
                    reader.GetString(0),
                    reader.GetString(1),
                    reader.GetInt32(2),
                    reader.GetDouble(3),
                    reader.GetDouble(4),
                    reader.GetDouble(5),
                    reader.GetInt32(6),
                    reader.IsDBNull(7) ? null : reader.GetDouble(7),
                    reader.GetString(8)));
            }
        }

        var result = new List<RouteStats>();

        foreach (var g in groups)
        {
            var durations = GetSortedDurations(conn, g.method, g.route, since);

            result.Add(new RouteStats
            {
                Method = g.method,
                RoutePattern = g.route,
                Count = g.count,
                ErrorCount = g.errors,
                AvgMs = Math.Round(g.avg, 2),
                MinMs = Math.Round(g.min, 2),
                MaxMs = Math.Round(g.max, 2),
                P50Ms = Math.Round(Percentile(durations, 0.50), 2),
                P70Ms = Math.Round(Percentile(durations, 0.70), 2),
                P90Ms = Math.Round(Percentile(durations, 0.90), 2),
                P99Ms = Math.Round(Percentile(durations, 0.99), 2),
                AvgResponseSize = g.avgSize is { } sz ? (long)Math.Round(sz) : null,
                LastSeen = g.lastSeen,
            });
        }

        return result;
    }

    public int GetTotalCount(DateTimeOffset? since = null)
    {
        using var conn = new SqliteConnection(_connectionString);
        conn.Open();
        using var cmd = conn.CreateCommand();

        if (since is { } s)
        {
            cmd.CommandText = "SELECT COUNT(*) FROM requests WHERE timestamp >= @since";
            cmd.Parameters.AddWithValue("@since", s.ToString("O"));
        }
        else
        {
            cmd.CommandText = "SELECT COUNT(*) FROM requests";
        }

        return Convert.ToInt32(cmd.ExecuteScalar());
    }

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
                error TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);
            CREATE INDEX IF NOT EXISTS idx_requests_route ON requests(route_pattern);
            CREATE INDEX IF NOT EXISTS idx_requests_duration ON requests(duration_ms);
            """;
        cmd.ExecuteNonQuery();
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
                     duration_ms, response_size, correlation_id, error)
                VALUES
                    (@ts, @method, @path, @route, @status,
                     @duration, @size, @corr, @err)
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
            cmd.ExecuteNonQuery();
        }

        tx.Commit();
    }

    private static List<TelemetryEntry> ReadEntries(SqliteCommand cmd)
    {
        var entries = new List<TelemetryEntry>();
        using var reader = cmd.ExecuteReader();

        while (reader.Read())
        {
            entries.Add(new TelemetryEntry
            {
                Id = reader.GetInt64(0),
                Timestamp = DateTimeOffset.Parse(reader.GetString(1)),
                Method = reader.GetString(2),
                Path = reader.GetString(3),
                RoutePattern = reader.IsDBNull(4) ? null : reader.GetString(4),
                StatusCode = reader.GetInt32(5),
                DurationMs = reader.GetDouble(6),
                ResponseSize = reader.IsDBNull(7) ? null : reader.GetInt64(7),
                CorrelationId = reader.IsDBNull(8) ? null : reader.GetString(8),
                Error = reader.IsDBNull(9) ? null : reader.GetString(9),
            });
        }

        return entries;
    }

    private static List<double> GetSortedDurations(
        SqliteConnection conn, string method, string route, DateTimeOffset? since)
    {
        using var cmd = conn.CreateCommand();
        var clauses = new List<string>
        {
            "COALESCE(route_pattern, path) = @route",
            "method = @method",
        };
        cmd.Parameters.AddWithValue("@route", route);
        cmd.Parameters.AddWithValue("@method", method);

        if (since is { } s)
        {
            clauses.Add("timestamp >= @since");
            cmd.Parameters.AddWithValue("@since", s.ToString("O"));
        }

        cmd.CommandText = $"""
            SELECT duration_ms FROM requests
            WHERE {string.Join(" AND ", clauses)}
            ORDER BY duration_ms ASC
            """;

        var durations = new List<double>();
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
            durations.Add(reader.GetDouble(0));

        return durations;
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

    private static double Percentile(List<double> sorted, double p)
    {
        if (sorted.Count == 0) return 0;
        var index = p * (sorted.Count - 1);
        var lower = (int)Math.Floor(index);
        var upper = (int)Math.Ceiling(index);
        if (lower == upper) return sorted[lower];
        var weight = index - lower;
        return sorted[lower] * (1 - weight) + sorted[upper] * weight;
    }
}
