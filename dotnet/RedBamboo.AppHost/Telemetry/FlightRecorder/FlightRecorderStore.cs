using Microsoft.Data.Sqlite;

namespace RedBamboo.AppHost.Telemetry.FlightRecorder;

/// <summary>
/// The flight recorder's tables in the service's telemetry database. Writes come from the one
/// recorder thread on a connection it keeps open, with prepared commands, so a tick allocates no
/// SQL; reads and cleanup open their own pooled connections (WAL mode: readers never block it).
/// </summary>
internal sealed class FlightRecorderStore : IDisposable
{
    public const int MaxPageSize = 2000;

    private readonly string _connectionString;
    private SqliteConnection? _writer;
    private SqliteCommand? _insertSample;
    private SqliteCommand? _insertGroup;

    public FlightRecorderStore(string connectionString) => _connectionString = connectionString;

    /// <summary>Creates the tables when missing. Never alters or rewrites existing ones.</summary>
    public static void EnsureSchema(SqliteConnection connection)
    {
        using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE IF NOT EXISTS process_samples (
                id INTEGER PRIMARY KEY,
                timestamp TEXT NOT NULL,
                interval_ms REAL NOT NULL,
                cpu_cores REAL,
                working_set_bytes INTEGER NOT NULL,
                private_bytes INTEGER,
                heap_total_bytes INTEGER NOT NULL,
                heap_committed_bytes INTEGER NOT NULL,
                heap_gen0_bytes INTEGER NOT NULL,
                heap_gen1_bytes INTEGER NOT NULL,
                heap_gen2_bytes INTEGER NOT NULL,
                heap_loh_bytes INTEGER NOT NULL,
                heap_poh_bytes INTEGER NOT NULL,
                gc_gen0 INTEGER NOT NULL,
                gc_gen1 INTEGER NOT NULL,
                gc_gen2 INTEGER NOT NULL,
                gc_pause_ms REAL NOT NULL,
                allocated_bytes INTEGER NOT NULL,
                thread_count INTEGER,
                threadpool_threads INTEGER NOT NULL,
                threadpool_pending INTEGER NOT NULL,
                threadpool_completed INTEGER NOT NULL,
                lock_contentions INTEGER NOT NULL,
                request_count INTEGER NOT NULL,
                slowest_request_ms REAL,
                slowest_request TEXT,
                db_pool_busy INTEGER,
                db_pool_idle INTEGER,
                db_pool_pending INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_process_samples_timestamp ON process_samples(timestamp);
            CREATE TABLE IF NOT EXISTS process_group_samples (
                id INTEGER PRIMARY KEY,
                sample_id INTEGER NOT NULL,
                timestamp TEXT NOT NULL,
                name TEXT NOT NULL,
                process_count INTEGER NOT NULL,
                cpu_cores REAL,
                working_set_bytes INTEGER NOT NULL,
                private_bytes INTEGER,
                io_read_bytes INTEGER,
                io_write_bytes INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_process_group_samples_sample ON process_group_samples(sample_id);
            CREATE INDEX IF NOT EXISTS idx_process_group_samples_timestamp ON process_group_samples(timestamp);
            """;
        command.ExecuteNonQuery();
    }

    public void Insert(ProcessSample sample)
    {
        var connection = Writer();
        using var transaction = connection.BeginTransaction();

        var insert = _insertSample ??= PrepareSampleInsert(connection);
        insert.Transaction = transaction;
        var p = insert.Parameters;
        var i = 0;
        p[i++].Value = Utc(sample.Timestamp);
        p[i++].Value = sample.IntervalMs;
        p[i++].Value = (object?)sample.CpuCores ?? DBNull.Value;
        p[i++].Value = sample.WorkingSetBytes;
        p[i++].Value = (object?)sample.PrivateBytes ?? DBNull.Value;
        p[i++].Value = sample.HeapTotalBytes;
        p[i++].Value = sample.HeapCommittedBytes;
        p[i++].Value = sample.HeapGen0Bytes;
        p[i++].Value = sample.HeapGen1Bytes;
        p[i++].Value = sample.HeapGen2Bytes;
        p[i++].Value = sample.HeapLohBytes;
        p[i++].Value = sample.HeapPohBytes;
        p[i++].Value = sample.Gen0Collections;
        p[i++].Value = sample.Gen1Collections;
        p[i++].Value = sample.Gen2Collections;
        p[i++].Value = sample.GcPauseMs;
        p[i++].Value = sample.AllocatedBytes;
        p[i++].Value = (object?)sample.ThreadCount ?? DBNull.Value;
        p[i++].Value = sample.ThreadPoolThreads;
        p[i++].Value = sample.ThreadPoolPending;
        p[i++].Value = sample.ThreadPoolCompleted;
        p[i++].Value = sample.LockContentions;
        p[i++].Value = sample.RequestCount;
        p[i++].Value = (object?)sample.SlowestRequestMs ?? DBNull.Value;
        p[i++].Value = (object?)sample.SlowestRequest ?? DBNull.Value;
        p[i++].Value = (object?)sample.DbPoolBusy ?? DBNull.Value;
        p[i++].Value = (object?)sample.DbPoolIdle ?? DBNull.Value;
        p[i++].Value = (object?)sample.DbPoolPending ?? DBNull.Value;
        var id = (long)insert.ExecuteScalar()!;

        if (sample.Groups.Count > 0)
        {
            var group = _insertGroup ??= PrepareGroupInsert(connection);
            group.Transaction = transaction;
            foreach (var g in sample.Groups)
            {
                var gp = group.Parameters;
                gp[0].Value = id;
                gp[1].Value = Utc(sample.Timestamp);
                gp[2].Value = g.Name;
                gp[3].Value = g.ProcessCount;
                gp[4].Value = (object?)g.CpuCores ?? DBNull.Value;
                gp[5].Value = g.WorkingSetBytes;
                gp[6].Value = (object?)g.PrivateBytes ?? DBNull.Value;
                gp[7].Value = (object?)g.IoReadBytes ?? DBNull.Value;
                gp[8].Value = (object?)g.IoWriteBytes ?? DBNull.Value;
                group.ExecuteNonQuery();
            }
        }

        transaction.Commit();
    }

    public List<ProcessSample> QuerySamples(DateTimeOffset? since, DateTimeOffset? until, int limit, int offset)
    {
        using var connection = new SqliteConnection(_connectionString);
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = $"""
            SELECT id, timestamp, interval_ms, cpu_cores, working_set_bytes, private_bytes,
                   heap_total_bytes, heap_committed_bytes, heap_gen0_bytes, heap_gen1_bytes, heap_gen2_bytes,
                   heap_loh_bytes, heap_poh_bytes, gc_gen0, gc_gen1, gc_gen2, gc_pause_ms, allocated_bytes,
                   thread_count, threadpool_threads, threadpool_pending, threadpool_completed, lock_contentions,
                   request_count, slowest_request_ms, slowest_request, db_pool_busy, db_pool_idle, db_pool_pending
            FROM process_samples {Range(command, since, until)}
            ORDER BY timestamp DESC
            LIMIT @limit OFFSET @offset
            """;
        command.Parameters.AddWithValue("@limit", Math.Clamp(limit, 1, MaxPageSize));
        command.Parameters.AddWithValue("@offset", Math.Max(0, offset));

        var samples = new List<ProcessSample>();
        using (var r = command.ExecuteReader())
        {
            while (r.Read())
            {
                samples.Add(new ProcessSample
                {
                    Id = r.GetInt64(0),
                    Timestamp = DateTimeOffset.Parse(r.GetString(1)),
                    IntervalMs = r.GetDouble(2),
                    CpuCores = r.IsDBNull(3) ? null : r.GetDouble(3),
                    WorkingSetBytes = r.GetInt64(4),
                    PrivateBytes = r.IsDBNull(5) ? null : r.GetInt64(5),
                    HeapTotalBytes = r.GetInt64(6),
                    HeapCommittedBytes = r.GetInt64(7),
                    HeapGen0Bytes = r.GetInt64(8),
                    HeapGen1Bytes = r.GetInt64(9),
                    HeapGen2Bytes = r.GetInt64(10),
                    HeapLohBytes = r.GetInt64(11),
                    HeapPohBytes = r.GetInt64(12),
                    Gen0Collections = r.GetInt32(13),
                    Gen1Collections = r.GetInt32(14),
                    Gen2Collections = r.GetInt32(15),
                    GcPauseMs = r.GetDouble(16),
                    AllocatedBytes = r.GetInt64(17),
                    ThreadCount = r.IsDBNull(18) ? null : r.GetInt32(18),
                    ThreadPoolThreads = r.GetInt32(19),
                    ThreadPoolPending = r.GetInt64(20),
                    ThreadPoolCompleted = r.GetInt64(21),
                    LockContentions = r.GetInt64(22),
                    RequestCount = r.GetInt32(23),
                    SlowestRequestMs = r.IsDBNull(24) ? null : r.GetDouble(24),
                    SlowestRequest = r.IsDBNull(25) ? null : r.GetString(25),
                    DbPoolBusy = r.IsDBNull(26) ? null : r.GetInt64(26),
                    DbPoolIdle = r.IsDBNull(27) ? null : r.GetInt64(27),
                    DbPoolPending = r.IsDBNull(28) ? null : r.GetInt64(28),
                });
            }
        }

        if (samples.Count == 0) return samples;

        var groups = new Dictionary<long, List<ProcessGroupSample>>();
        using (var groupCommand = connection.CreateCommand())
        {
            groupCommand.CommandText = """
                SELECT sample_id, name, process_count, cpu_cores, working_set_bytes, private_bytes, io_read_bytes, io_write_bytes
                FROM process_group_samples
                WHERE sample_id >= @min AND sample_id <= @max
                ORDER BY id
                """;
            groupCommand.Parameters.AddWithValue("@min", samples.Min(s => s.Id));
            groupCommand.Parameters.AddWithValue("@max", samples.Max(s => s.Id));
            using var r = groupCommand.ExecuteReader();
            while (r.Read())
            {
                var sampleId = r.GetInt64(0);
                if (!groups.TryGetValue(sampleId, out var list)) groups[sampleId] = list = [];
                list.Add(new ProcessGroupSample(
                    r.GetString(1),
                    r.GetInt32(2),
                    r.IsDBNull(3) ? null : r.GetDouble(3),
                    r.GetInt64(4),
                    r.IsDBNull(5) ? null : r.GetInt64(5),
                    r.IsDBNull(6) ? null : r.GetInt64(6),
                    r.IsDBNull(7) ? null : r.GetInt64(7)));
            }
        }

        for (var i = 0; i < samples.Count; i++)
            if (groups.TryGetValue(samples[i].Id, out var list))
                samples[i] = samples[i] with { Groups = list };
        return samples;
    }

    /// <summary>Deletes flight recorder rows older than <paramref name="cutoff"/>; the number deleted.</summary>
    public int Cleanup(DateTimeOffset cutoff)
    {
        using var connection = new SqliteConnection(_connectionString);
        connection.Open();
        var deleted = 0;
        foreach (var table in CleanupTables)
        {
            using var command = connection.CreateCommand();
            command.CommandText = $"DELETE FROM {table} WHERE timestamp < @cutoff";
            command.Parameters.AddWithValue("@cutoff", Utc(cutoff));
            deleted += command.ExecuteNonQuery();
        }
        return deleted;
    }

    private static readonly string[] CleanupTables = ["process_samples", "process_group_samples"];

    /// <summary>Stored and compared as UTC "O" text, so string order is time order.</summary>
    internal static string Utc(DateTimeOffset value) => value.ToUniversalTime().ToString("O");

    internal static string Range(SqliteCommand command, DateTimeOffset? since, DateTimeOffset? until)
    {
        var clauses = new List<string>(2);
        if (since is { } s)
        {
            clauses.Add("timestamp >= @since");
            command.Parameters.AddWithValue("@since", Utc(s));
        }
        if (until is { } u)
        {
            clauses.Add("timestamp <= @until");
            command.Parameters.AddWithValue("@until", Utc(u));
        }
        return clauses.Count == 0 ? "" : "WHERE " + string.Join(" AND ", clauses);
    }

    private SqliteConnection Writer()
    {
        if (_writer is { State: System.Data.ConnectionState.Open }) return _writer;
        DisposeWriter();
        _writer = new SqliteConnection(_connectionString);
        _writer.Open();
        // This connection only: a commit no longer waits for an fsync (about 5 ms and 1.7 ms of CPU
        // on Windows). In WAL mode the database stays consistent after a crash; at worst the last
        // samples before a power cut are lost. The request writer keeps its own setting.
        using (var pragma = _writer.CreateCommand())
        {
            pragma.CommandText = "PRAGMA synchronous=NORMAL";
            pragma.ExecuteNonQuery();
        }
        return _writer;
    }

    /// <summary>Drops the writer connection; the next write opens a fresh one (after an I/O error, say).</summary>
    public void ResetWriter() => DisposeWriter();

    private static SqliteCommand PrepareSampleInsert(SqliteConnection connection)
    {
        var columns = new[]
        {
            "timestamp", "interval_ms", "cpu_cores", "working_set_bytes", "private_bytes",
            "heap_total_bytes", "heap_committed_bytes", "heap_gen0_bytes", "heap_gen1_bytes", "heap_gen2_bytes",
            "heap_loh_bytes", "heap_poh_bytes", "gc_gen0", "gc_gen1", "gc_gen2", "gc_pause_ms", "allocated_bytes",
            "thread_count", "threadpool_threads", "threadpool_pending", "threadpool_completed", "lock_contentions",
            "request_count", "slowest_request_ms", "slowest_request", "db_pool_busy", "db_pool_idle", "db_pool_pending",
        };
        return Prepare(connection, "process_samples", columns, " RETURNING id");
    }

    private static SqliteCommand PrepareGroupInsert(SqliteConnection connection)
        => Prepare(connection, "process_group_samples",
            ["sample_id", "timestamp", "name", "process_count", "cpu_cores", "working_set_bytes", "private_bytes",
             "io_read_bytes", "io_write_bytes"], "");

    internal static SqliteCommand Prepare(SqliteConnection connection, string table, string[] columns, string suffix)
    {
        var command = connection.CreateCommand();
        command.CommandText = $"INSERT INTO {table} ({string.Join(", ", columns)}) VALUES " +
            $"({string.Join(", ", columns.Select(c => "@" + c))}){suffix}";
        foreach (var column in columns)
            command.Parameters.Add(new SqliteParameter("@" + column, null));
        return command;
    }

    private void DisposeWriter()
    {
        _insertSample?.Dispose();
        _insertGroup?.Dispose();
        _insertSample = _insertGroup = null;
        _writer?.Dispose();
        _writer = null;
    }

    public void Dispose() => DisposeWriter();
}
