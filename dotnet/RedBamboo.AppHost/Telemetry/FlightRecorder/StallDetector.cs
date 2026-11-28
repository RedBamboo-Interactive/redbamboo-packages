using System.Collections.Concurrent;

namespace RedBamboo.AppHost.Telemetry.FlightRecorder;

/// <summary>Which self-timing tick ran late.</summary>
public static class StallTicks
{
    /// <summary>A dedicated thread's sleep: late means the whole process paused (GC suspension, OS scheduling, paging).</summary>
    public const string Process = "process";

    /// <summary>A timer callback on the thread pool: late here but not on the process tick means pool starvation.</summary>
    public const string ThreadPool = "threadpool";
}

/// <summary>One <c>stall_events</c> row.</summary>
public sealed record StallEvent
{
    public long Id { get; init; }
    public DateTimeOffset Timestamp { get; init; }
    public string Tick { get; init; } = "";
    /// <summary>How much later than its period the tick ran.</summary>
    public double LatenessMs { get; init; }
    /// <summary>GC pause time accumulated since the previous tick of this kind, i.e. during the late interval.</summary>
    public double GcPauseMs { get; init; }
    public long ThreadPoolPending { get; init; }
    public int ThreadPoolThreads { get; init; }
    public int? ThreadCount { get; init; }
    /// <summary>Late ticks of this kind the rate limit did not write since the previous row of this kind.</summary>
    public int Suppressed { get; init; }

    public object ToWireFormat() => new
    {
        id = Id,
        timestamp = Timestamp.ToString("O"),
        tick = Tick,
        lateness_ms = Math.Round(LatenessMs, 1),
        gc_pause_ms = Math.Round(GcPauseMs, 2),
        threadpool_pending = ThreadPoolPending,
        threadpool_threads = ThreadPoolThreads,
        thread_count = ThreadCount,
        suppressed = Suppressed,
    };
}

/// <summary>
/// The decision part of the stall detector, apart from the threads that tick: is a tick late, is
/// it written or only counted (at most <see cref="FlightRecorderOptions.StallRowsPerMinute"/> rows
/// per kind per minute), and is it the one that logs a warning (the first row of a minute, per kind).
/// </summary>
internal sealed class StallLimiter(FlightRecorderOptions options, TimeProvider time)
{
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(1);
    private readonly Dictionary<string, State> _states = [];
    private readonly object _gate = new();

    public readonly record struct Decision(bool Record, bool Warn, int SuppressedBefore);

    /// <summary>Null when the tick was on time; otherwise what to do with this late tick.</summary>
    public Decision? Observe(string tick, TimeSpan elapsedSincePreviousTick)
    {
        var lateness = elapsedSincePreviousTick - options.StallTick;
        if (lateness <= options.StallThreshold) return null;

        lock (_gate)
        {
            if (!_states.TryGetValue(tick, out var state)) _states[tick] = state = new State { WindowStart = long.MinValue };
            var now = time.GetTimestamp();
            if (state.WindowStart == long.MinValue || time.GetElapsedTime(state.WindowStart, now) >= Window)
            {
                state.WindowStart = now;
                state.Written = 0;
            }

            if (state.Written >= Math.Max(1, options.StallRowsPerMinute))
            {
                state.Suppressed++;
                return new Decision(false, false, 0);
            }

            var suppressed = state.Suppressed;
            state.Suppressed = 0;
            state.Written++;
            return new Decision(true, state.Written == 1, suppressed);
        }
    }

    private sealed class State
    {
        public long WindowStart;
        public int Written;
        public int Suppressed;
    }
}

/// <summary>
/// The two 100 ms self-timing ticks. Each measures the time since its previous tick; a stall is
/// queued for the recorder thread to write and log, so the ticks themselves never touch SQLite
/// or the log. A tick costs one clock read and one GC pause read.
/// </summary>
internal sealed class StallTicker : IDisposable
{
    private readonly FlightRecorderOptions _options;
    private readonly TimeProvider _time;
    private readonly StallLimiter _limiter;
    private readonly ConcurrentQueue<(StallEvent Event, bool Warn)> _queue;
    private readonly Action _signal;
    private readonly ManualResetEventSlim _stop = new(false);
    private Thread? _thread;
    private Timer? _timer;
    private long _poolPrevious;
    private TimeSpan _poolPausePrevious;
    private volatile bool _stopped;

    public StallTicker(FlightRecorderOptions options, TimeProvider time,
        ConcurrentQueue<(StallEvent Event, bool Warn)> queue, Action signal)
    {
        _options = options;
        _time = time;
        _limiter = new StallLimiter(options, time);
        _queue = queue;
        _signal = signal;
    }

    public void Start()
    {
        _thread = new Thread(RunProcessTick) { IsBackground = true, Name = "flight-recorder-tick" };
        _thread.Start();

        _poolPrevious = _time.GetTimestamp();
        _poolPausePrevious = GC.GetTotalPauseDuration();
        // One-shot and re-armed from the callback, so a starved pool shows as one long late tick, not a queue of them.
        _timer = new Timer(_ => OnPoolTick(), null, _options.StallTick, Timeout.InfiniteTimeSpan);
    }

    private void RunProcessTick()
    {
        var previous = _time.GetTimestamp();
        var pausePrevious = GC.GetTotalPauseDuration();
        while (!_stop.Wait(_options.StallTick))
        {
            var now = _time.GetTimestamp();
            var pause = GC.GetTotalPauseDuration();
            Observe(StallTicks.Process, _time.GetElapsedTime(previous, now), pause - pausePrevious);
            previous = now;
            pausePrevious = pause;
        }
    }

    private void OnPoolTick()
    {
        if (_stopped) return;
        var now = _time.GetTimestamp();
        var pause = GC.GetTotalPauseDuration();
        Observe(StallTicks.ThreadPool, _time.GetElapsedTime(_poolPrevious, now), pause - _poolPausePrevious);
        _poolPrevious = now;
        _poolPausePrevious = pause;
        try { _timer?.Change(_options.StallTick, Timeout.InfiniteTimeSpan); }
        catch (ObjectDisposedException) { }
    }

    /// <summary>One tick's measurement; public to the assembly so tests can feed it directly.</summary>
    internal void Observe(string tick, TimeSpan elapsed, TimeSpan gcPause)
    {
        if (_limiter.Observe(tick, elapsed) is not { Record: true } decision) return;
        _queue.Enqueue((new StallEvent
        {
            Timestamp = _time.GetUtcNow(),
            Tick = tick,
            LatenessMs = (elapsed - _options.StallTick).TotalMilliseconds,
            GcPauseMs = gcPause.TotalMilliseconds,
            ThreadPoolPending = ThreadPool.PendingWorkItemCount,
            ThreadPoolThreads = ThreadPool.ThreadCount,
            ThreadCount = NativeProcess.SelfThreadCount(),
            Suppressed = decision.SuppressedBefore,
        }, decision.Warn));
        _signal();
    }

    public void Dispose()
    {
        _stopped = true;
        _stop.Set();
        _timer?.Dispose();
        _thread?.Join(TimeSpan.FromSeconds(2));
        _stop.Dispose();
    }
}
