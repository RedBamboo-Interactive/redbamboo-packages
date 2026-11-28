using System.Diagnostics;
using RedBamboo.AppHost.Telemetry;
using RedBamboo.AppHost.Telemetry.FlightRecorder;
using Xunit;
using Xunit.Abstractions;

namespace RedBamboo.AppHost.Tests.Telemetry;

/// <summary>The 15 s process sample: cadence on a fake clock, row content, the store, the real readings and their cost.</summary>
public sealed class ProcessSamplerTests(ITestOutputHelper output)
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(15);

    [Fact]
    public void Sample_IsDueOnlyEveryInterval_WithoutDrift()
    {
        var time = new FakeTime();
        var counters = new FakeCounters();
        var sampler = new ProcessSampler(time, counters, new FlightRecorderOptions());

        Assert.Equal(Interval, sampler.UntilDue());
        Assert.Null(sampler.TryTake());

        time.Advance(TimeSpan.FromSeconds(14));
        Assert.Null(sampler.TryTake());
        Assert.Equal(TimeSpan.FromSeconds(1), sampler.UntilDue());

        // Woken a few milliseconds early counts as due; the next one is still due at 30 s, not 45 - 0.01.
        time.Advance(TimeSpan.FromMilliseconds(990));
        var first = sampler.TryTake();
        Assert.NotNull(first);
        Assert.Equal(14_990, first!.IntervalMs, 3);
        Assert.Equal(TimeSpan.FromSeconds(15.01), sampler.UntilDue());

        time.Advance(TimeSpan.FromSeconds(15.01));
        Assert.Equal(15_010, sampler.TryTake()!.IntervalMs, 3);

        // A pause of a minute gives one row for the whole gap and restarts the cadence from now.
        time.Advance(TimeSpan.FromSeconds(60));
        var late = sampler.TryTake()!;
        Assert.Equal(60_000, late.IntervalMs, 3);
        Assert.Null(sampler.TryTake());
        Assert.Equal(Interval, sampler.UntilDue());
    }

    [Fact]
    public void Sample_TurnsCumulativeCountersIntoIntervalValues()
    {
        var time = new FakeTime();
        var counters = new FakeCounters
        {
            Value = new RuntimeCounters
            {
                Cpu = TimeSpan.FromSeconds(100),
                Gen0Collections = 10, Gen1Collections = 5, Gen2Collections = 1,
                GcPause = TimeSpan.FromMilliseconds(400),
                AllocatedBytes = 1_000_000,
                ThreadPoolCompleted = 5_000,
                LockContentions = 7,
            },
        };
        var pool = new FakePool { Next = new DatabasePoolReading(3, 7, 0) };
        var postgres = new FakeGroup("postgres")
        {
            Next = new ProcessGroupReading(4, TimeSpan.FromSeconds(50), 400_000_000, 100_000_000, 10_000, 20_000),
        };
        var options = new FlightRecorderOptions { DatabasePool = pool, ProcessGroups = [postgres] };
        var sampler = new ProcessSampler(time, counters, options);

        counters.Value = counters.Value with
        {
            Cpu = TimeSpan.FromSeconds(107.5),
            WorkingSetBytes = 800_000_000,
            PrivateBytes = 600_000_000,
            HeapTotalBytes = 300_000_000,
            HeapCommittedBytes = 350_000_000,
            Gen0Bytes = 1, Gen1Bytes = 2, Gen2Bytes = 3, LohBytes = 4, PohBytes = 5,
            Gen0Collections = 14, Gen1Collections = 6, Gen2Collections = 1,
            GcPause = TimeSpan.FromMilliseconds(475),
            AllocatedBytes = 51_000_000,
            Threads = 120,
            ThreadPoolThreads = 9,
            ThreadPoolPending = 42,
            ThreadPoolCompleted = 8_000,
            LockContentions = 10,
        };
        postgres.Next = new ProcessGroupReading(5, TimeSpan.FromSeconds(53), 420_000_000, 110_000_000, 15_000, 21_000);

        sampler.ObserveRequest(new TelemetryEntry { Method = "GET", Path = "/api/entities/1", RoutePattern = "/api/entities/{id}", DurationMs = 40 });
        sampler.ObserveRequest(new TelemetryEntry { Method = "POST", Path = "/api/search", RoutePattern = "/api/search", DurationMs = 1_250 });
        sampler.ObserveRequest(new TelemetryEntry { Method = "GET", Path = "/nowhere", DurationMs = 3 });

        time.Advance(Interval);
        var sample = sampler.TryTake()!;

        Assert.Equal(time.GetUtcNow(), sample.Timestamp);
        Assert.Equal(0.5, sample.CpuCores!.Value, 6);           // 7.5 s of CPU over 15 s
        Assert.Equal(800_000_000, sample.WorkingSetBytes);
        Assert.Equal(600_000_000, sample.PrivateBytes);
        Assert.Equal(300_000_000, sample.HeapTotalBytes);
        Assert.Equal((1L, 2L, 3L, 4L, 5L), (sample.HeapGen0Bytes, sample.HeapGen1Bytes, sample.HeapGen2Bytes, sample.HeapLohBytes, sample.HeapPohBytes));
        Assert.Equal((4, 1, 0), (sample.Gen0Collections, sample.Gen1Collections, sample.Gen2Collections));
        Assert.Equal(75, sample.GcPauseMs, 6);
        Assert.Equal(50_000_000, sample.AllocatedBytes);
        Assert.Equal(120, sample.ThreadCount);
        Assert.Equal(9, sample.ThreadPoolThreads);
        Assert.Equal(42, sample.ThreadPoolPending);
        Assert.Equal(3_000, sample.ThreadPoolCompleted);
        Assert.Equal(3, sample.LockContentions);
        Assert.Equal(3, sample.RequestCount);
        Assert.Equal(1_250, sample.SlowestRequestMs);
        Assert.Equal("POST /api/search", sample.SlowestRequest);
        Assert.Equal((3L, 7L, 0L), (sample.DbPoolBusy!.Value, sample.DbPoolIdle!.Value, sample.DbPoolPending!.Value));

        var group = Assert.Single(sample.Groups);
        Assert.Equal("postgres", group.Name);
        Assert.Equal(5, group.ProcessCount);
        Assert.Equal(0.2, group.CpuCores!.Value, 6);            // 3 s over 15 s
        Assert.Equal(420_000_000, group.WorkingSetBytes);
        Assert.Equal(110_000_000, group.PrivateBytes);
        Assert.Equal(5_000, group.IoReadBytes);
        Assert.Equal(1_000, group.IoWriteBytes);

        // The request window starts over; an absent pool and group read as null and missing.
        pool.Next = null;
        postgres.Next = null;
        time.Advance(Interval);
        var next = sampler.TryTake()!;
        Assert.Equal(0, next.RequestCount);
        Assert.Null(next.SlowestRequest);
        Assert.Null(next.DbPoolBusy);
        Assert.Empty(next.Groups);
        Assert.Equal(0, next.CpuCores);
    }

    [Fact]
    public void Group_ThatRestartsWithLowerTotals_ReportsNoCpuOrIoForThatInterval()
    {
        var time = new FakeTime();
        var postgres = new FakeGroup("postgres") { Next = new ProcessGroupReading(3, TimeSpan.FromSeconds(90), 1, 1, 9_000, 9_000) };
        var sampler = new ProcessSampler(time, new FakeCounters(), new FlightRecorderOptions { ProcessGroups = [postgres] });

        postgres.Next = new ProcessGroupReading(2, TimeSpan.FromSeconds(1), 1, 1, 100, 100);
        time.Advance(Interval);
        var group = Assert.Single(sampler.TryTake()!.Groups);
        Assert.Null(group.CpuCores);
        Assert.Null(group.IoReadBytes);
        Assert.Null(group.IoWriteBytes);

        // I/O the platform does not expose stays null rather than becoming zero.
        postgres.Next = new ProcessGroupReading(2, TimeSpan.FromSeconds(2.5), 1, null, null, null);
        time.Advance(Interval);
        group = Assert.Single(sampler.TryTake()!.Groups);
        Assert.Equal(0.1, group.CpuCores!.Value, 6);
        Assert.Null(group.PrivateBytes);
        Assert.Null(group.IoReadBytes);
    }

    [Fact]
    public void Recorder_WritesRowsTheReadSurfaceReturns_AndCleansOnlyItsOwnOldRows()
    {
        using var db = new TempTelemetryDb();
        db.EnsureRecorderSchema();
        var time = new FakeTime();
        var counters = new FakeCounters();
        var postgres = new FakeGroup("postgres") { Next = new ProcessGroupReading(2, TimeSpan.Zero, 10, 5, 0, 0) };
        using var recorder = new FlightRecorderService(
            new FlightRecorderOptions { ProcessGroups = [postgres] }, db.ConnectionString, time, counters);

        recorder.Pump();
        Assert.Equal(0, db.Scalar("SELECT COUNT(*) FROM process_samples"));

        for (var i = 0; i < 3; i++)
        {
            time.Advance(Interval);
            counters.Value.Cpu += TimeSpan.FromSeconds(1.5);
            recorder.Pump();
        }

        Assert.Equal(3, db.Scalar("SELECT COUNT(*) FROM process_samples"));
        Assert.Equal(3, db.Scalar("SELECT COUNT(*) FROM process_group_samples"));
        Assert.Equal(0, recorder.Failures);

        var rows = recorder.QuerySamples(null, null, limit: 2, offset: 0);
        Assert.Equal(2, rows.Count);
        Assert.True(rows[0].Timestamp > rows[1].Timestamp);         // newest first
        Assert.Equal(0.1, rows[0].CpuCores!.Value, 6);
        Assert.Equal("postgres", Assert.Single(rows[0].Groups).Name);

        var oldest = recorder.QuerySamples(null, null, limit: 10, offset: 2);
        Assert.Single(oldest);
        var since = recorder.QuerySamples(rows[0].Timestamp.ToOffset(TimeSpan.FromHours(2)), null, limit: 10, offset: 0);
        Assert.Single(since);                                       // a non-UTC bound still compares in UTC

        var deleted = recorder.Store.Cleanup(rows[1].Timestamp);
        Assert.Equal(2, deleted);                                   // the oldest sample and its group row
        Assert.Equal(2, db.Scalar("SELECT COUNT(*) FROM process_samples"));
    }

    [Fact]
    public void Recorder_SurvivesAFailingTick_AndWritesAgainAfterwards()
    {
        using var db = new TempTelemetryDb();
        db.EnsureRecorderSchema();
        var time = new FakeTime();
        using var recorder = new FlightRecorderService(new FlightRecorderOptions(), db.ConnectionString, time, new FakeCounters());

        db.Execute("ALTER TABLE process_samples RENAME TO process_samples_away");
        time.Advance(Interval);
        recorder.Pump();
        Assert.Equal(1, recorder.Failures);

        db.Execute("ALTER TABLE process_samples_away RENAME TO process_samples");
        time.Advance(Interval);
        recorder.Pump();
        Assert.Equal(1, recorder.Failures);
        Assert.Equal(1, db.Scalar("SELECT COUNT(*) FROM process_samples"));
    }

    [Fact]
    public void TelemetryService_CreatesTheTables_AndCanRunWithTheSamplerOff()
    {
        using var db = new TempTelemetryDb();
        var service = new TelemetryService(new TelemetryOptions
        {
            AppName = "Test",
            DbPath = db.Path_,
            FlightRecorder = new FlightRecorderOptions { ProcessSampler = false },
        });
        try
        {
            Assert.Equal(1, db.Scalar("SELECT COUNT(*) FROM sqlite_master WHERE name = 'process_samples'"));
            Assert.Equal(1, db.Scalar("SELECT COUNT(*) FROM sqlite_master WHERE name = 'process_group_samples'"));
            Assert.Empty(service.Recorder.QuerySamples(null, null, 10, 0));
        }
        finally
        {
            service.DisposeAsync().AsTask().GetAwaiter().GetResult();
        }
    }

    [Fact]
    public void RealReadings_AreSane()
    {
        var counters = default(RuntimeCounters);
        ProcessRuntimeCounters.Instance.Read(ref counters);

        Assert.True(counters.Cpu > TimeSpan.Zero);
        Assert.True(counters.WorkingSetBytes > 10_000_000);
        Assert.True(counters.HeapTotalBytes > 0);
        Assert.True(counters.ThreadPoolThreads >= 0);
        if (OperatingSystem.IsWindows() || OperatingSystem.IsLinux())
        {
            Assert.NotNull(counters.PrivateBytes);
            Assert.True(counters.PrivateBytes > 0);
            Assert.True(counters.Threads > 3, $"threads {counters.Threads}");
        }
    }

    [Fact]
    public void ProcessTree_SumsTheRootAndItsChildren()
    {
        if (!OperatingSystem.IsWindows() && !OperatingSystem.IsLinux()) return;

        using var child = Process.Start(OperatingSystem.IsWindows()
            ? new ProcessStartInfo("cmd.exe", "/c ping -n 30 127.0.0.1 > nul") { CreateNoWindow = true, UseShellExecute = false }
            : new ProcessStartInfo("sleep", "30") { UseShellExecute = false })!;
        try
        {
            var self = Environment.ProcessId;
            using var probe = new ProcessTreeProbe("self", () => self, () => [self, child.Id]);
            Assert.True(probe.TryRead(out var first));
            Assert.Equal(2, first.ProcessCount);
            Assert.True(first.WorkingSetBytes > 0);
            Assert.NotNull(first.PrivateBytes);
            Assert.True(first.CpuTotal > TimeSpan.Zero);

            child.Kill();
            child.WaitForExit();
            Assert.True(probe.TryRead(out var second));
            Assert.Equal(1, second.ProcessCount);
            Assert.True(second.CpuTotal >= first.CpuTotal, "an exited child's CPU stays in the total");

            using var gone = new ProcessTreeProbe("none", () => null);
            Assert.False(gone.TryRead(out _));
        }
        finally
        {
            if (!child.HasExited) child.Kill();
        }
    }

    /// <summary>
    /// What one tick costs on this machine: readings, a pool and a process-tree probe over this test
    /// process, and the SQLite write. Reported in the output; the bound only catches a regression by
    /// an order of magnitude.
    /// </summary>
    [Fact]
    public void Tick_CostsWellUnderAMillisecondOfCpu()
    {
        using var db = new TempTelemetryDb();
        db.EnsureRecorderSchema();
        var self = Environment.ProcessId;
        // Fifteen children stand in for PostgreSQL's backends; the probe reads each of them every tick.
        var children = Enumerable.Range(0, 15).Select(_ => Process.Start(OperatingSystem.IsWindows()
            ? new ProcessStartInfo("cmd.exe", "/c ping -n 60 127.0.0.1 > nul") { CreateNoWindow = true, UseShellExecute = false }
            : new ProcessStartInfo("sleep", "60") { UseShellExecute = false })!).ToList();
        try
        {
        var ids = children.Select(child => child.Id).Append(self).ToArray();
        using var tree = new ProcessTreeProbe("self", () => self, () => ids);
        var time = new FakeTime();
        var options = new FlightRecorderOptions { ProcessGroups = [tree], DatabasePool = new FakePool { Next = new(1, 2, 0) } };
        using var recorder = new FlightRecorderService(options, db.ConnectionString, time);

        for (var i = 0; i < 20; i++) { time.Advance(Interval); recorder.Pump(); }

        const int ticks = 300;
        var cpuBefore = Environment.CpuUsage.TotalTime;
        var allocatedBefore = GC.GetAllocatedBytesForCurrentThread();
        var wall = Stopwatch.StartNew();
        for (var i = 0; i < ticks; i++) { time.Advance(Interval); recorder.Pump(); }
        wall.Stop();
        var cpuMs = (Environment.CpuUsage.TotalTime - cpuBefore).TotalMilliseconds / ticks;
        var allocated = (GC.GetAllocatedBytesForCurrentThread() - allocatedBefore) / ticks;

        Assert.True(tree.TryRead(out var group));
        output.WriteLine($"per tick ({group.ProcessCount} processes in the group): {wall.Elapsed.TotalMilliseconds / ticks:F3} ms wall, " +
            $"{cpuMs:F3} ms process CPU, {allocated:N0} bytes allocated");
        Assert.Equal(0, recorder.Failures);
        Assert.True(cpuMs < 2, $"{cpuMs:F3} ms of CPU per tick");
        }
        finally
        {
            foreach (var child in children)
            {
                try { child.Kill(); } catch { }
                child.Dispose();
            }
        }
    }
}
