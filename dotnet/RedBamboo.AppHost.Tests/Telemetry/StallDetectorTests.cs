using System.Collections.Concurrent;
using RedBamboo.AppHost.Logging;
using RedBamboo.AppHost.Telemetry.FlightRecorder;
using Xunit;

namespace RedBamboo.AppHost.Tests.Telemetry;

/// <summary>The two self-timing ticks: when a tick is a stall, the per-minute rate limit, the rows and the warning.</summary>
public sealed class StallDetectorTests
{
    private static readonly TimeSpan Tick = TimeSpan.FromMilliseconds(100);

    [Fact]
    public void Limiter_IgnoresTicksUpToTheThreshold()
    {
        var limiter = new StallLimiter(new FlightRecorderOptions(), new FakeTime());
        Assert.Null(limiter.Observe(StallTicks.Process, Tick));
        Assert.Null(limiter.Observe(StallTicks.Process, Tick + TimeSpan.FromMilliseconds(250)));
        Assert.NotNull(limiter.Observe(StallTicks.Process, Tick + TimeSpan.FromMilliseconds(251)));
    }

    [Fact]
    public void Limiter_WritesAHandfulPerMinute_CountsTheRest_AndWarnsOncePerMinute()
    {
        var time = new FakeTime();
        var limiter = new StallLimiter(new FlightRecorderOptions(), time);
        var late = TimeSpan.FromSeconds(1);

        var decisions = new List<StallLimiter.Decision>();
        for (var i = 0; i < 300; i++)                       // a bad minute: a late tick every 200 ms
        {
            decisions.Add(limiter.Observe(StallTicks.ThreadPool, late)!.Value);
            time.Advance(TimeSpan.FromMilliseconds(199));
        }

        Assert.Equal(5, decisions.Count(d => d.Record));
        Assert.Equal(1, decisions.Count(d => d.Warn));
        Assert.True(decisions[0].Warn);
        Assert.All(decisions.Where(d => d.Record), d => Assert.Equal(0, d.SuppressedBefore));

        // The other tick kind has its own budget.
        var process = limiter.Observe(StallTicks.Process, late)!.Value;
        Assert.True(process.Record);
        Assert.True(process.Warn);

        // Next minute: the first row carries how many were only counted, and warns again.
        time.Advance(TimeSpan.FromSeconds(2));
        var next = limiter.Observe(StallTicks.ThreadPool, late)!.Value;
        Assert.True(next.Record);
        Assert.True(next.Warn);
        Assert.Equal(295, next.SuppressedBefore);
    }

    [Fact]
    public void LateTick_BecomesARow_AndOneWarningLine()
    {
        using var db = new TempTelemetryDb();
        db.EnsureRecorderSchema();
        var time = new FakeTime();
        var log = new LogService(new LogServiceOptions { Source = "test" });
        using var recorder = new FlightRecorderService(
            new FlightRecorderOptions { ProcessSampler = false }, db.ConnectionString, time);
        recorder.AttachLog(log);

        var ticker = recorder.Ticker!;
        ticker.Observe(StallTicks.ThreadPool, TimeSpan.FromMilliseconds(1_900), TimeSpan.FromMilliseconds(12));
        ticker.Observe(StallTicks.ThreadPool, TimeSpan.FromMilliseconds(700), TimeSpan.Zero);
        ticker.Observe(StallTicks.ThreadPool, Tick, TimeSpan.Zero);                 // on time: nothing
        recorder.Pump();

        var rows = recorder.QueryStalls(null, null, null, 10, 0);
        Assert.Equal(2, rows.Count);
        var first = rows.Single(r => r.LatenessMs > 1_000);
        Assert.Equal(StallTicks.ThreadPool, first.Tick);
        Assert.Equal(1_800, first.LatenessMs, 3);
        Assert.Equal(12, first.GcPauseMs, 3);
        Assert.Equal(time.GetUtcNow(), first.Timestamp);
        Assert.True(first.ThreadPoolThreads >= 0);

        var warnings = log.Query().Where(e => e.Category == "telemetry").ToList();
        Assert.Single(warnings);
        Assert.Contains("Thread-pool tick ran 1800 ms late", warnings[0].Message);

        Assert.Empty(recorder.QueryStalls(null, null, StallTicks.Process, 10, 0));
        Assert.Equal(2, recorder.QueryStalls(null, null, StallTicks.ThreadPool, 10, 0).Count);
    }

    [Fact]
    public void Cleanup_RemovesOldStalls()
    {
        using var db = new TempTelemetryDb();
        db.EnsureRecorderSchema();
        var time = new FakeTime();
        using var recorder = new FlightRecorderService(new FlightRecorderOptions { ProcessSampler = false }, db.ConnectionString, time);
        recorder.Ticker!.Observe(StallTicks.Process, TimeSpan.FromSeconds(1), TimeSpan.Zero);
        recorder.Pump();
        Assert.Equal(0, recorder.Store.Cleanup(time.GetUtcNow()));
        Assert.Equal(1, recorder.Store.Cleanup(time.GetUtcNow().AddSeconds(1)));
    }

    /// <summary>
    /// The real ticks: blocking every pool thread makes the thread-pool tick late while the
    /// dedicated thread keeps its cadence. Only the thread-pool row is asserted; the process tick
    /// can be late too on a loaded machine.
    /// </summary>
    [Fact]
    public void StarvedPool_IsRecordedByTheThreadPoolTick()
    {
        using var db = new TempTelemetryDb();
        db.EnsureRecorderSchema();
        var options = new FlightRecorderOptions { ProcessSampler = false };
        using var recorder = new FlightRecorderService(options, db.ConnectionString);
        recorder.Start();
        Thread.Sleep(300);

        ThreadPool.GetMinThreads(out var workers, out _);
        using var release = new ManualResetEventSlim(false);
        var blockers = Enumerable.Range(0, workers * 4)
            .Select(_ => Task.Factory.StartNew(() => release.Wait(TimeSpan.FromSeconds(10)), CancellationToken.None,
                TaskCreationOptions.DenyChildAttach, TaskScheduler.Default))
            .ToArray();
        try
        {
            var deadline = DateTime.UtcNow.AddSeconds(8);
            while (DateTime.UtcNow < deadline && recorder.QueryStalls(null, null, StallTicks.ThreadPool, 1, 0).Count == 0)
                Thread.Sleep(100);
        }
        finally
        {
            release.Set();
            Task.WaitAll(blockers);
        }

        var stall = Assert.Single(recorder.QueryStalls(null, null, StallTicks.ThreadPool, 1, 0));
        Assert.True(stall.LatenessMs > 250);
    }
}
