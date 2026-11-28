namespace RedBamboo.AppHost.Telemetry.FlightRecorder;

/// <summary>
/// The flight recorder: a low-cost process sample every <see cref="SampleInterval"/> and a stall
/// row whenever a self-timing tick runs late, both written to the service's telemetry database
/// so a slow minute can be explained after the fact. On by default; each half can be switched off.
/// </summary>
public sealed class FlightRecorderOptions
{
    /// <summary>Write one <c>process_samples</c> row per <see cref="SampleInterval"/>.</summary>
    public bool ProcessSampler { get; set; } = true;

    public TimeSpan SampleInterval { get; set; } = TimeSpan.FromSeconds(15);

    /// <summary>Run the two 100 ms self-timing ticks and write <c>stall_events</c> rows.</summary>
    public bool StallDetector { get; set; } = true;

    public TimeSpan StallTick { get; set; } = TimeSpan.FromMilliseconds(100);

    /// <summary>A tick later than this is a stall.</summary>
    public TimeSpan StallThreshold { get; set; } = TimeSpan.FromMilliseconds(250);

    /// <summary>At most this many stall rows per tick kind per minute; the rest are counted, not written.</summary>
    public int StallRowsPerMinute { get; set; } = 5;

    /// <summary>Retention of the flight recorder tables, independent of the request table's.</summary>
    public int RetentionDays { get; set; } = 30;

    /// <summary>Connection pool occupancy, when the host has a database pool to report.</summary>
    public IDatabasePoolProbe? DatabasePool { get; set; }

    /// <summary>Child process groups the host owns (RedLeaf: its managed PostgreSQL tree).</summary>
    public List<IProcessGroupProbe> ProcessGroups { get; set; } = [];

    internal bool AnyEnabled => ProcessSampler || StallDetector;
}

/// <summary>Database connection pool occupancy at the moment of a sample.</summary>
public interface IDatabasePoolProbe
{
    /// <summary>False when the pool cannot be read (nothing opened yet, provider without metrics).</summary>
    bool TryRead(out DatabasePoolReading reading);
}

public readonly record struct DatabasePoolReading(long Busy, long Idle, long? Pending);

/// <summary>
/// A group of child processes the host owns, summed. Called once per sample on the sampler
/// thread; implementations keep their own state between calls (handles, previous CPU) and
/// must not block.
/// </summary>
public interface IProcessGroupProbe
{
    string Name { get; }

    /// <summary>False when the group does not exist right now (not started, not managed here).</summary>
    bool TryRead(out ProcessGroupReading reading);
}

/// <summary>
/// Cumulative counters for a process group. CPU and I/O are cumulative totals over the processes the
/// probe has seen; the sampler turns them into per-interval values. Null where the platform does not
/// expose the value.
/// </summary>
public readonly record struct ProcessGroupReading(
    int ProcessCount,
    TimeSpan CpuTotal,
    long WorkingSetBytes,
    long? PrivateBytes,
    long? IoReadBytesTotal,
    long? IoWriteBytesTotal);
