using System.Collections.Concurrent;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Data.Sqlite;
using RedBamboo.AppHost.Telemetry;
using RedBamboo.AppHost.Telemetry.FlightRecorder;
using Xunit;

namespace RedBamboo.AppHost.Tests.Telemetry;

/// <summary>Database time per request: the accumulator, the middleware's row and header, and the column migration.</summary>
public sealed class RequestDbTimingTests
{
    [Fact]
    public void Add_WithoutARequest_IsIgnored()
    {
        Assert.Null(RequestDbTiming.Current);
        RequestDbTiming.Add(TimeSpan.FromMilliseconds(5));
        Assert.Null(RequestDbTiming.Current);
    }

    [Fact]
    public async Task Middleware_SumsCommands_SetsServerTiming_AndStoresNullWithoutDatabaseWork()
    {
        using var db = new TempTelemetryDb();
        var (telemetry, entries) = Service(db, recordDatabaseTime: true);
        await using var _ = telemetry;

        var feature = await RunAsync(telemetry, async () =>
        {
            RequestDbTiming.Add(TimeSpan.FromMilliseconds(2));
            await Task.Yield();
            await Task.Run(() => RequestDbTiming.Add(TimeSpan.FromMilliseconds(3.5)));   // child work flows with the request
        }, path: "/api/one");
        var none = await RunAsync(telemetry, () => Task.CompletedTask, path: "/api/two");

        var one = entries.Single(e => e.Path == "/api/one");
        Assert.Equal(2, one.DbCount);
        Assert.Equal(5.5, one.DbMs!.Value, 6);
        Assert.Matches(@"^total;dur=\d+\.\d, db;dur=5\.5$", feature.Headers["Server-Timing"].ToString());

        var two = entries.Single(e => e.Path == "/api/two");
        Assert.Null(two.DbCount);
        Assert.Null(two.DbMs);
        Assert.DoesNotContain("db;", none.Headers["Server-Timing"].ToString());
    }

    [Fact]
    public async Task ConcurrentRequests_KeepTheirOwnSums()
    {
        using var db = new TempTelemetryDb();
        var (telemetry, entries) = Service(db, recordDatabaseTime: true);
        await using var _ = telemetry;

        await Task.WhenAll(Enumerable.Range(1, 40).Select(n => Task.Run(() => RunAsync(telemetry, async () =>
        {
            for (var i = 0; i < n; i++)
            {
                RequestDbTiming.Add(TimeSpan.FromMilliseconds(1));
                await Task.Yield();
            }
        }, path: $"/api/r{n}"))));

        Assert.Equal(40, entries.Count);
        foreach (var entry in entries)
        {
            var n = int.Parse(entry.Path["/api/r".Length..]);
            Assert.Equal(n, entry.DbCount);
            Assert.Equal(n, entry.DbMs!.Value, 6);
        }
    }

    [Fact]
    public async Task WorkThatOutlivesTheRequest_IsNotAttributed()
    {
        using var db = new TempTelemetryDb();
        var (telemetry, entries) = Service(db, recordDatabaseTime: true);
        await using var _ = telemetry;

        RequestDbTiming? captured = null;
        var later = new TaskCompletionSource();
        Task? straggler = null;
        await RunAsync(telemetry, () =>
        {
            captured = RequestDbTiming.Current;
            straggler = Task.Run(async () =>
            {
                await later.Task;
                RequestDbTiming.Add(TimeSpan.FromSeconds(1));     // after the request ended
            });
            return Task.CompletedTask;
        }, path: "/api/fire-and-forget");
        later.SetResult();
        await straggler!;

        Assert.Null(entries.Single().DbCount);
        Assert.Equal(0, captured!.Count);
    }

    [Fact]
    public async Task Off_RecordsNoAccumulator()
    {
        using var db = new TempTelemetryDb();
        var (telemetry, entries) = Service(db, recordDatabaseTime: false);
        await using var _ = telemetry;
        await RunAsync(telemetry, () =>
        {
            Assert.Null(RequestDbTiming.Current);
            return Task.CompletedTask;
        }, path: "/api/off");
        Assert.Null(entries.Single().DbCount);
    }

    [Fact]
    public async Task ExistingStore_GainsTheColumnsInPlace_AndKeepsItsRows()
    {
        using var db = new TempTelemetryDb();
        // The request table as it is on disk before this change, with enough rows to span many pages.
        db.Execute("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL,
                route_pattern TEXT, status_code INTEGER NOT NULL, duration_ms REAL NOT NULL, response_size INTEGER,
                correlation_id TEXT, error TEXT, kind TEXT, execution_id TEXT, app_id TEXT, actor_kind TEXT,
                actor_id TEXT, beneficiary_kind TEXT, beneficiary_id TEXT);
            CREATE INDEX idx_requests_timestamp ON requests(timestamp);
            CREATE INDEX idx_requests_route ON requests(route_pattern);
            CREATE INDEX idx_requests_duration ON requests(duration_ms);
            CREATE INDEX idx_requests_execution ON requests(execution_id);
            WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 20000)
            INSERT INTO requests (timestamp, method, path, status_code, duration_ms)
            SELECT '2026-11-20T10:00:00.0000000+00:00', 'GET', '/api/entities/' || i, 200, i FROM n;
            PRAGMA wal_checkpoint(TRUNCATE);
            """);
        var pagesBefore = db.Scalar("PRAGMA page_count");

        var service = new TelemetryService(new TelemetryOptions
        {
            AppName = "Test",
            DbPath = db.Path_,
            FlightRecorder = new FlightRecorderOptions { ProcessSampler = false, StallDetector = false },
        });
        await service.DisposeAsync();
        SqliteConnection.ClearAllPools();

        Assert.Equal(20000, db.Scalar("SELECT COUNT(*) FROM requests"));
        Assert.Equal(20000, db.Scalar("SELECT COUNT(*) FROM requests WHERE db_ms IS NULL AND db_count IS NULL"));
        Assert.Equal(2, db.Scalar("SELECT COUNT(*) FROM pragma_table_info('requests') WHERE name IN ('db_ms', 'db_count')"));
        db.Execute("PRAGMA wal_checkpoint(TRUNCATE)");
        // The new tables add a few pages; a rewrite of 20,000 rows would add hundreds.
        Assert.True(db.Scalar("PRAGMA page_count") - pagesBefore < 20, $"{pagesBefore} -> {db.Scalar("PRAGMA page_count")} pages");

        // Opening it again changes nothing.
        service = new TelemetryService(new TelemetryOptions
        {
            AppName = "Test",
            DbPath = db.Path_,
            FlightRecorder = new FlightRecorderOptions { ProcessSampler = false, StallDetector = false },
        });
        var old = service.Reader.Query(new TelemetryQueryParams { Limit = 1 });
        Assert.Null(Assert.Single(old).DbMs);
        await service.DisposeAsync();
    }

    [Fact]
    public async Task Reader_RoundTripsTheColumns_AndReadsAStoreWithoutThem()
    {
        using var db = new TempTelemetryDb();
        var (telemetry, _) = Service(db, recordDatabaseTime: true);
        telemetry.Record(new TelemetryEntry { Method = "GET", Path = "/x", StatusCode = 200, DurationMs = 9, DbMs = 4.25, DbCount = 3 });
        await telemetry.DisposeAsync();   // flushes the writer
        var row = Assert.Single(telemetry.Reader.Query(new TelemetryQueryParams()));
        Assert.Equal(4.25, row.DbMs);
        Assert.Equal(3, row.DbCount);

        using var older = new TempTelemetryDb();
        older.Execute("""
            CREATE TABLE requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL,
                route_pattern TEXT, status_code INTEGER NOT NULL, duration_ms REAL NOT NULL, response_size INTEGER,
                correlation_id TEXT, error TEXT, kind TEXT, execution_id TEXT, app_id TEXT, actor_kind TEXT,
                actor_id TEXT, beneficiary_kind TEXT, beneficiary_id TEXT);
            INSERT INTO requests (timestamp, method, path, status_code, duration_ms) VALUES ('2026-11-20T10:00:00.0000000+00:00', 'GET', '/y', 200, 1);
            """);
        var other = Assert.Single(new TelemetryReader(older.Path_).Query(new TelemetryQueryParams()));
        Assert.Null(other.DbMs);
    }

    private static (TelemetryService Service, ConcurrentBag<TelemetryEntry> Entries) Service(TempTelemetryDb db, bool recordDatabaseTime)
    {
        var service = new TelemetryService(new TelemetryOptions
        {
            AppName = "Test",
            DbPath = db.Path_,
            RecordDatabaseTime = recordDatabaseTime,
            FlightRecorder = new FlightRecorderOptions { ProcessSampler = false, StallDetector = false },
        });
        var entries = new ConcurrentBag<TelemetryEntry>();
        service.OnEntry += entries.Add;
        return (service, entries);
    }

    /// <summary>One request through the real middleware; the response "starts" when the handler returns.</summary>
    private static async Task<StartingResponseFeature> RunAsync(TelemetryService telemetry, Func<Task> handler, string path)
    {
        var context = new DefaultHttpContext();
        var feature = new StartingResponseFeature();
        context.Features.Set<IHttpResponseFeature>(feature);
        context.Request.Method = "GET";
        context.Request.Path = path;
        var middleware = new TelemetryMiddleware(async ctx =>
        {
            await handler();
            await feature.StartAsync();
        }, telemetry);
        await middleware.InvokeAsync(context);
        return feature;
    }

    private sealed class StartingResponseFeature : IHttpResponseFeature
    {
        private readonly List<(Func<object, Task> Callback, object State)> _starting = [];

        public int StatusCode { get; set; } = 200;
        public string? ReasonPhrase { get; set; }
        public IHeaderDictionary Headers { get; set; } = new HeaderDictionary();
        public Stream Body { get; set; } = Stream.Null;
        public bool HasStarted { get; private set; }

        public void OnStarting(Func<object, Task> callback, object state) => _starting.Add((callback, state));

        public void OnCompleted(Func<object, Task> callback, object state) { }

        public async Task StartAsync()
        {
            foreach (var (callback, state) in Enumerable.Reverse(_starting)) await callback(state);
            HasStarted = true;
        }
    }
}
