namespace RedBamboo.AppHost.Telemetry.FlightRecorder;

/// <summary>Cumulative counters and gauges of this process at one instant.</summary>
internal struct RuntimeCounters
{
    public TimeSpan Cpu;
    public long WorkingSetBytes;
    public long? PrivateBytes;
    public long HeapTotalBytes;
    public long HeapCommittedBytes;
    public long Gen0Bytes, Gen1Bytes, Gen2Bytes, LohBytes, PohBytes;
    public int Gen0Collections, Gen1Collections, Gen2Collections;
    public TimeSpan GcPause;
    public long AllocatedBytes;
    public int? Threads;
    public int ThreadPoolThreads;
    public long ThreadPoolPending;
    public long ThreadPoolCompleted;
    public long LockContentions;
}

internal interface IRuntimeCounterSource
{
    void Read(ref RuntimeCounters counters);
}

/// <summary>The real process: runtime APIs and <see cref="NativeProcess"/>; nothing here walks other processes.</summary>
internal sealed class ProcessRuntimeCounters : IRuntimeCounterSource
{
    public static readonly ProcessRuntimeCounters Instance = new();

    public void Read(ref RuntimeCounters c)
    {
        c.Cpu = Environment.CpuUsage.TotalTime;
        NativeProcess.TryReadSelfMemory(out c.WorkingSetBytes, out c.PrivateBytes);

        // Sizes per generation are as of the last collection (the runtime keeps no live per-generation size);
        // HeapTotalBytes is live.
        var info = GC.GetGCMemoryInfo(GCKind.Any);
        var generations = info.GenerationInfo;
        c.Gen0Bytes = generations.Length > 0 ? generations[0].SizeAfterBytes : 0;
        c.Gen1Bytes = generations.Length > 1 ? generations[1].SizeAfterBytes : 0;
        c.Gen2Bytes = generations.Length > 2 ? generations[2].SizeAfterBytes : 0;
        c.LohBytes = generations.Length > 3 ? generations[3].SizeAfterBytes : 0;
        c.PohBytes = generations.Length > 4 ? generations[4].SizeAfterBytes : 0;
        c.HeapCommittedBytes = info.TotalCommittedBytes;
        c.HeapTotalBytes = GC.GetTotalMemory(false);

        c.Gen0Collections = GC.CollectionCount(0);
        c.Gen1Collections = GC.CollectionCount(1);
        c.Gen2Collections = GC.CollectionCount(2);
        c.GcPause = GC.GetTotalPauseDuration();
        c.AllocatedBytes = GC.GetTotalAllocatedBytes(false);

        c.Threads = NativeProcess.SelfThreadCount();
        c.ThreadPoolThreads = ThreadPool.ThreadCount;
        c.ThreadPoolPending = ThreadPool.PendingWorkItemCount;
        c.ThreadPoolCompleted = ThreadPool.CompletedWorkItemCount;
        c.LockContentions = Monitor.LockContentionCount;
    }
}

/// <summary>One <c>process_samples</c> row: gauges at the end of the interval, deltas over it.</summary>
public sealed record ProcessSample
{
    public long Id { get; init; }
    public DateTimeOffset Timestamp { get; init; }
    public double IntervalMs { get; init; }
    /// <summary>Process CPU over the interval, in cores (1.0 = one core busy the whole interval).</summary>
    public double? CpuCores { get; init; }
    public long WorkingSetBytes { get; init; }
    public long? PrivateBytes { get; init; }
    public long HeapTotalBytes { get; init; }
    public long HeapCommittedBytes { get; init; }
    public long HeapGen0Bytes { get; init; }
    public long HeapGen1Bytes { get; init; }
    public long HeapGen2Bytes { get; init; }
    public long HeapLohBytes { get; init; }
    public long HeapPohBytes { get; init; }
    public int Gen0Collections { get; init; }
    public int Gen1Collections { get; init; }
    public int Gen2Collections { get; init; }
    public double GcPauseMs { get; init; }
    public long AllocatedBytes { get; init; }
    public int? ThreadCount { get; init; }
    public int ThreadPoolThreads { get; init; }
    public long ThreadPoolPending { get; init; }
    public long ThreadPoolCompleted { get; init; }
    public long LockContentions { get; init; }
    public int RequestCount { get; init; }
    public double? SlowestRequestMs { get; init; }
    /// <summary>"GET /api/entities/{id}": method and route pattern (the path when no route matched), never a query string.</summary>
    public string? SlowestRequest { get; init; }
    public long? DbPoolBusy { get; init; }
    public long? DbPoolIdle { get; init; }
    public long? DbPoolPending { get; init; }
    public IReadOnlyList<ProcessGroupSample> Groups { get; init; } = [];

    public object ToWireFormat() => new
    {
        id = Id,
        timestamp = Timestamp.ToString("O"),
        interval_ms = Math.Round(IntervalMs, 1),
        cpu_cores = CpuCores is { } cpu ? Math.Round(cpu, 4) : (double?)null,
        working_set_bytes = WorkingSetBytes,
        private_bytes = PrivateBytes,
        heap_total_bytes = HeapTotalBytes,
        heap_committed_bytes = HeapCommittedBytes,
        heap_gen0_bytes = HeapGen0Bytes,
        heap_gen1_bytes = HeapGen1Bytes,
        heap_gen2_bytes = HeapGen2Bytes,
        heap_loh_bytes = HeapLohBytes,
        heap_poh_bytes = HeapPohBytes,
        gc_gen0 = Gen0Collections,
        gc_gen1 = Gen1Collections,
        gc_gen2 = Gen2Collections,
        gc_pause_ms = Math.Round(GcPauseMs, 2),
        allocated_bytes = AllocatedBytes,
        thread_count = ThreadCount,
        threadpool_threads = ThreadPoolThreads,
        threadpool_pending = ThreadPoolPending,
        threadpool_completed = ThreadPoolCompleted,
        lock_contentions = LockContentions,
        request_count = RequestCount,
        slowest_request_ms = SlowestRequestMs is { } slowest ? Math.Round(slowest, 2) : (double?)null,
        slowest_request = SlowestRequest,
        db_pool_busy = DbPoolBusy,
        db_pool_idle = DbPoolIdle,
        db_pool_pending = DbPoolPending,
        groups = Groups.Select(group => group.ToWireFormat()),
    };
}

/// <summary>One <c>process_group_samples</c> row: a host-owned child process group over the same interval.</summary>
public sealed record ProcessGroupSample(
    string Name,
    int ProcessCount,
    double? CpuCores,
    long WorkingSetBytes,
    long? PrivateBytes,
    long? IoReadBytes,
    long? IoWriteBytes)
{
    public object ToWireFormat() => new
    {
        name = Name,
        process_count = ProcessCount,
        cpu_cores = CpuCores is { } cpu ? Math.Round(cpu, 4) : (double?)null,
        working_set_bytes = WorkingSetBytes,
        private_bytes = PrivateBytes,
        io_read_bytes = IoReadBytes,
        io_write_bytes = IoWriteBytes,
    };
}

/// <summary>
/// Turns cumulative readings into one row per interval. Pure apart from the probes it calls, so a
/// fake <see cref="TimeProvider"/> and counter source drive it in tests. Single caller (the recorder
/// thread); <see cref="ObserveRequest"/> may be called from any thread.
/// </summary>
internal sealed class ProcessSampler
{
    // A wait can wake a little early; within this of the due time counts as due.
    private static readonly TimeSpan DueTolerance = TimeSpan.FromMilliseconds(50);

    private readonly TimeProvider _time;
    private readonly IRuntimeCounterSource _source;
    private readonly FlightRecorderOptions _options;
    private readonly Dictionary<IProcessGroupProbe, ProcessGroupReading?> _previousGroups = [];
    private readonly List<ProcessGroupSample> _groupScratch = [];

    private RuntimeCounters _previous;
    private long _previousTimestamp;
    private long _nextDue;
    private int _requests;
    private TelemetryEntry? _slowest;

    public ProcessSampler(TimeProvider time, IRuntimeCounterSource source, FlightRecorderOptions options)
    {
        _time = time;
        _source = source;
        _options = options;
        Baseline();
    }

    public TimeSpan Interval => _options.SampleInterval;

    /// <summary>How long until the next sample is due (zero when due now).</summary>
    public TimeSpan UntilDue()
    {
        var remaining = _time.GetElapsedTime(_time.GetTimestamp(), _nextDue);
        return remaining > TimeSpan.Zero ? remaining : TimeSpan.Zero;
    }

    public void ObserveRequest(TelemetryEntry entry)
    {
        Interlocked.Increment(ref _requests);
        var current = Volatile.Read(ref _slowest);
        while (current is null || entry.DurationMs > current.DurationMs)
        {
            var previous = Interlocked.CompareExchange(ref _slowest, entry, current);
            if (ReferenceEquals(previous, current)) break;
            current = previous;
        }
    }

    /// <summary>The row for the interval that just ended, or null when no sample is due yet.</summary>
    public ProcessSample? TryTake()
    {
        var now = _time.GetTimestamp();
        if (_time.GetElapsedTime(now, _nextDue) > DueTolerance) return null;

        var counters = default(RuntimeCounters);
        _source.Read(ref counters);
        var interval = _time.GetElapsedTime(_previousTimestamp, now);
        var seconds = interval.TotalSeconds;

        var requests = Interlocked.Exchange(ref _requests, 0);
        var slowest = Interlocked.Exchange(ref _slowest, null);

        long? poolBusy = null, poolIdle = null, poolPending = null;
        if (_options.DatabasePool is { } pool)
        {
            try
            {
                if (pool.TryRead(out var reading))
                {
                    poolBusy = reading.Busy;
                    poolIdle = reading.Idle;
                    poolPending = reading.Pending;
                }
            }
            catch { /* a probe never stops the sample */ }
        }

        _groupScratch.Clear();
        foreach (var probe in _options.ProcessGroups)
        {
            ProcessGroupReading? reading = null;
            try
            {
                if (probe.TryRead(out var value)) reading = value;
            }
            catch { /* reported as absent */ }

            _previousGroups.TryGetValue(probe, out var before);
            _previousGroups[probe] = reading;
            if (reading is not { } current) continue;

            _groupScratch.Add(new ProcessGroupSample(
                probe.Name,
                current.ProcessCount,
                before is { } b && current.CpuTotal >= b.CpuTotal && seconds > 0
                    ? (current.CpuTotal - b.CpuTotal).TotalSeconds / seconds
                    : null,
                current.WorkingSetBytes,
                current.PrivateBytes,
                Delta(before?.IoReadBytesTotal, current.IoReadBytesTotal),
                Delta(before?.IoWriteBytesTotal, current.IoWriteBytesTotal)));
        }

        var p = _previous;
        var sample = new ProcessSample
        {
            Timestamp = _time.GetUtcNow(),
            IntervalMs = interval.TotalMilliseconds,
            CpuCores = seconds > 0 && counters.Cpu >= p.Cpu ? (counters.Cpu - p.Cpu).TotalSeconds / seconds : null,
            WorkingSetBytes = counters.WorkingSetBytes,
            PrivateBytes = counters.PrivateBytes,
            HeapTotalBytes = counters.HeapTotalBytes,
            HeapCommittedBytes = counters.HeapCommittedBytes,
            HeapGen0Bytes = counters.Gen0Bytes,
            HeapGen1Bytes = counters.Gen1Bytes,
            HeapGen2Bytes = counters.Gen2Bytes,
            HeapLohBytes = counters.LohBytes,
            HeapPohBytes = counters.PohBytes,
            Gen0Collections = counters.Gen0Collections - p.Gen0Collections,
            Gen1Collections = counters.Gen1Collections - p.Gen1Collections,
            Gen2Collections = counters.Gen2Collections - p.Gen2Collections,
            GcPauseMs = (counters.GcPause - p.GcPause).TotalMilliseconds,
            AllocatedBytes = counters.AllocatedBytes - p.AllocatedBytes,
            ThreadCount = counters.Threads,
            ThreadPoolThreads = counters.ThreadPoolThreads,
            ThreadPoolPending = counters.ThreadPoolPending,
            ThreadPoolCompleted = counters.ThreadPoolCompleted - p.ThreadPoolCompleted,
            LockContentions = counters.LockContentions - p.LockContentions,
            RequestCount = requests,
            SlowestRequestMs = slowest?.DurationMs,
            SlowestRequest = slowest is null ? null : $"{slowest.Method} {slowest.RoutePattern ?? slowest.Path}",
            DbPoolBusy = poolBusy,
            DbPoolIdle = poolIdle,
            DbPoolPending = poolPending,
            Groups = _groupScratch.Count == 0 ? [] : _groupScratch.ToArray(),
        };

        _previous = counters;
        _previousTimestamp = now;
        // Next due one interval after the previous due time, so the cadence does not drift; after a
        // pause longer than an interval, start again from now rather than catching up in a burst.
        _nextDue = Advance(_nextDue, _options.SampleInterval);
        if (Before(_nextDue, now)) _nextDue = Advance(now, _options.SampleInterval);
        return sample;
    }

    private void Baseline()
    {
        _source.Read(ref _previous);
        _previousTimestamp = _time.GetTimestamp();
        _nextDue = Advance(_previousTimestamp, _options.SampleInterval);
        foreach (var probe in _options.ProcessGroups)
        {
            try { _previousGroups[probe] = probe.TryRead(out var reading) ? reading : null; }
            catch { _previousGroups[probe] = null; }
        }
        // Prime the pool probe too, so its first real reading is not its first call.
        try { _options.DatabasePool?.TryRead(out _); } catch { }
    }

    private long Advance(long timestamp, TimeSpan by)
        => timestamp + (long)(by.TotalSeconds * _time.TimestampFrequency);

    private static bool Before(long a, long b) => a < b;

    private static long? Delta(long? before, long? now)
        => before is { } b && now is { } n && n >= b ? n - b : null;
}
