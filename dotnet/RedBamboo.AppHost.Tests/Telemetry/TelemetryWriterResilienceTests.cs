using System.Collections.Concurrent;
using RedBamboo.AppHost.Logging;
using RedBamboo.AppHost.Telemetry;
using RedBamboo.AppHost.Telemetry.FlightRecorder;
using Xunit;

namespace RedBamboo.AppHost.Tests.Telemetry;

/// <summary>
/// The request writer and the retention cleanup outlive a failure: a failed batch is counted, logged once
/// and dropped, and the next batch is written (the only consumer used to end on the first exception,
/// which left RedLeaf's store without rows for days); the cleanup deletes in chunks and survives a failure.
/// </summary>
public sealed class TelemetryWriterResilienceTests
{
    [Fact]
    public async Task AFailedBatch_IsDroppedAndLogged_AndTheNextOneIsWritten()
    {
        using var db = new TempTelemetryDb();
        var telemetry = Service(db);
        var log = new LogService(new LogServiceOptions { Source = "test" });
        var warnings = new ConcurrentQueue<string>();
        // The writer's warnings only: the start-up cleanup can run after the rename and warn too.
        log.OnLogEntry += entry => { if (entry.Level == LogLevel.Warn && entry.Message.Contains("not written")) warnings.Enqueue(entry.Message); };
        telemetry.AttachLog(log);

        telemetry.Record(Entry("/before"));
        await Until(() => db.Scalar("SELECT COUNT(*) FROM requests") == 1);

        db.Execute("ALTER TABLE requests RENAME TO requests_away");
        telemetry.Record(Entry("/lost"));
        await Until(() => telemetry.WriteFailures >= 1);
        db.Execute("ALTER TABLE requests_away RENAME TO requests");

        telemetry.Record(Entry("/after"));
        await Until(() => db.Scalar("SELECT COUNT(*) FROM requests") == 2);
        await telemetry.DisposeAsync();

        Assert.Equal(1, telemetry.WriteFailures);
        Assert.Equal(1, telemetry.DroppedRows);
        Assert.Equal(1, db.Scalar("SELECT COUNT(*) FROM requests WHERE path = '/after'"));
        Assert.Equal(0, db.Scalar("SELECT COUNT(*) FROM requests WHERE path = '/lost'"));
        var warning = Assert.Single(warnings);
        Assert.Contains("1 rows not written", warning);
    }

    [Fact]
    public async Task RepeatedFailures_AreLoggedAtMostOnceAnHour()
    {
        using var db = new TempTelemetryDb();
        var telemetry = Service(db);
        var log = new LogService(new LogServiceOptions { Source = "test" });
        var warnings = 0;
        log.OnLogEntry += entry => { if (entry.Level == LogLevel.Warn && entry.Message.Contains("not written")) Interlocked.Increment(ref warnings); };
        telemetry.AttachLog(log);
        telemetry.Record(Entry("/first"));
        await Until(() => db.Scalar("SELECT COUNT(*) FROM requests") == 1);

        db.Execute("ALTER TABLE requests RENAME TO requests_away");
        for (var i = 0; i < 5; i++)
        {
            telemetry.Record(Entry($"/lost-{i}"));
            var expected = i + 1;
            await Until(() => telemetry.WriteFailures >= expected);
        }
        await telemetry.DisposeAsync();

        Assert.Equal(5, telemetry.WriteFailures);
        Assert.Equal(1, warnings);
    }

    [Fact]
    public async Task Cleanup_DeletesOldRowsInChunks_AndKeepsTheRest()
    {
        using var db = new TempTelemetryDb();
        // The schema first, then rows older than the 30-day retention: 12,001 of them, two full chunks and one row.
        await Service(db).DisposeAsync();
        var old = DateTimeOffset.UtcNow.AddDays(-31);
        InsertRows(db, 12_001, old);
        InsertRows(db, 3, DateTimeOffset.UtcNow.AddDays(-29));

        var telemetry = Service(db);   // its start-up cleanup
        await Until(() => db.Scalar("SELECT COUNT(*) FROM requests") == 3);
        Assert.Equal(0, telemetry.CleanupFailures);

        // Exactly one chunk's worth: the loop runs a second, empty DELETE and returns the right total.
        InsertRows(db, TelemetryService.CleanupChunkRows, old);
        Assert.Equal(TelemetryService.CleanupChunkRows, telemetry.Cleanup());
        Assert.Equal(3, db.Scalar("SELECT COUNT(*) FROM requests"));
        await telemetry.DisposeAsync();
    }

    [Fact]
    public async Task AFailedCleanup_IsCountedAndLogged_AndTheNextOneRuns()
    {
        using var db = new TempTelemetryDb();
        var telemetry = Service(db);
        var log = new LogService(new LogServiceOptions { Source = "test" });
        var warnings = new ConcurrentQueue<string>();
        log.OnLogEntry += entry => { if (entry.Level == LogLevel.Warn) warnings.Enqueue(entry.Message); };
        telemetry.AttachLog(log);

        db.Execute("ALTER TABLE requests RENAME TO requests_away");
        telemetry.CleanupOrLog();   // throws inside: no such table
        Assert.True(telemetry.CleanupFailures >= 1);
        db.Execute("ALTER TABLE requests_away RENAME TO requests");

        InsertRows(db, 2, DateTimeOffset.UtcNow.AddDays(-40));
        var failures = telemetry.CleanupFailures;
        telemetry.CleanupOrLog();
        Assert.Equal(failures, telemetry.CleanupFailures);
        Assert.Equal(0, db.Scalar("SELECT COUNT(*) FROM requests"));
        Assert.Contains(warnings, warning => warning.StartsWith("Telemetry retention cleanup failed", StringComparison.Ordinal));
        await telemetry.DisposeAsync();
    }

    private static TelemetryService Service(TempTelemetryDb db) => new(new TelemetryOptions
    {
        AppName = "Test",
        DbPath = db.Path_,
        FlightRecorder = new FlightRecorderOptions { ProcessSampler = false, StallDetector = false },
    });

    private static TelemetryEntry Entry(string path)
        => new() { Method = "GET", Path = path, StatusCode = 200, DurationMs = 1 };

    private static void InsertRows(TempTelemetryDb db, int count, DateTimeOffset at)
        => db.Execute($"""
            WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < {count})
            INSERT INTO requests (timestamp, method, path, status_code, duration_ms)
            SELECT '{at.ToUniversalTime():O}', 'GET', '/old', 200, 1 FROM n
            """);

    private static async Task Until(Func<bool> condition)
    {
        var deadline = DateTime.UtcNow.AddSeconds(15);
        while (!condition())
        {
            if (DateTime.UtcNow > deadline) throw new TimeoutException("Condition not met in 15 s.");
            await Task.Delay(20);
        }
    }
}
