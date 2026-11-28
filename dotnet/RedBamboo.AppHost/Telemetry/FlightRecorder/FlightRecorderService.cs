using System.Collections.Concurrent;
using RedBamboo.AppHost.Logging;

namespace RedBamboo.AppHost.Telemetry.FlightRecorder;

/// <summary>
/// Runs the process sampler on one dedicated background thread, so samples keep coming while the
/// thread pool is starved (which is exactly when they matter), and writes the stall detector's rows
/// as soon as a late tick queues one. A failed tick is counted and logged at most once an hour and
/// never stops the thread.
/// </summary>
public sealed class FlightRecorderService : IDisposable
{
    private static readonly TimeSpan FailureLogInterval = TimeSpan.FromHours(1);

    private readonly FlightRecorderOptions _options;
    private readonly FlightRecorderStore _store;
    private readonly TimeProvider _time;
    private readonly ProcessSampler? _sampler;
    private readonly ManualResetEvent _stop = new(false);
    private readonly AutoResetEvent _stallSignal = new(false);
    private readonly WaitHandle[] _wakeUps;
    private readonly ConcurrentQueue<(StallEvent Event, bool Warn)> _stalls = new();
    private readonly StallTicker? _ticker;
    private Thread? _thread;
    private LogService? _log;
    private long _lastFailureLog = long.MinValue;

    internal FlightRecorderService(FlightRecorderOptions options, string connectionString,
        TimeProvider? time = null, IRuntimeCounterSource? counters = null)
    {
        _options = options;
        _time = time ?? TimeProvider.System;
        _store = new FlightRecorderStore(connectionString);
        if (options.ProcessSampler)
            _sampler = new ProcessSampler(_time, counters ?? ProcessRuntimeCounters.Instance, options);
        if (options.StallDetector)
            _ticker = new StallTicker(options, _time, _stalls, () => _stallSignal.Set());
        _wakeUps = [_stop, _stallSignal];
    }

    public FlightRecorderOptions Options => _options;

    /// <summary>Failed ticks since start (a write or a reading that threw).</summary>
    public int Failures { get; private set; }

    internal FlightRecorderStore Store => _store;

    /// <summary>Where warnings go; until attached they are only counted.</summary>
    public void AttachLog(LogService log) => _log = log;

    public List<ProcessSample> QuerySamples(DateTimeOffset? since, DateTimeOffset? until, int limit, int offset)
        => _store.QuerySamples(since, until, limit, offset);

    public List<StallEvent> QueryStalls(DateTimeOffset? since, DateTimeOffset? until, string? tick, int limit, int offset)
        => _store.QueryStalls(since, until, tick, limit, offset);

    internal StallTicker? Ticker => _ticker;

    internal void ObserveRequest(TelemetryEntry entry) => _sampler?.ObserveRequest(entry);

    internal void Start()
    {
        if (!_options.AnyEnabled || _thread is not null) return;
        _thread = new Thread(Run)
        {
            IsBackground = true,
            Name = "flight-recorder",
        };
        _thread.Start();
        _ticker?.Start();
    }

    private void Run()
    {
        while (true)
        {
            var wait = _sampler?.UntilDue() ?? Timeout.InfiniteTimeSpan;
            if (WaitHandle.WaitAny(_wakeUps, wait) == 0) break;
            Pump();
        }
        Pump(); // stalls queued during shutdown
    }

    /// <summary>One pass: writes queued stalls, then the sample when it is due. The thread's body; tests call it with a fake clock.</summary>
    internal void Pump()
    {
        try
        {
            while (_stalls.TryDequeue(out var stall))
            {
                _store.Insert(stall.Event);
                if (stall.Warn) WarnStall(stall.Event);
            }
            if (_sampler?.TryTake() is { } sample) _store.Insert(sample);
        }
        catch (Exception ex)
        {
            Failures++;
            _store.ResetWriter();
            var now = _time.GetTimestamp();
            if (_lastFailureLog == long.MinValue || _time.GetElapsedTime(_lastFailureLog, now) >= FailureLogInterval)
            {
                _lastFailureLog = now;
                _log?.Warn("telemetry", $"Flight recorder tick failed ({Failures} so far): {ex.GetType().Name}: {ex.Message}");
            }
        }
    }

    private void WarnStall(StallEvent stall)
    {
        var what = stall.Tick == StallTicks.ThreadPool ? "Thread-pool tick" : "Process tick";
        var suppressed = stall.Suppressed > 0 ? $"; {stall.Suppressed} more late ticks of this kind were not recorded before it" : "";
        _log?.Warn("telemetry",
            $"Stall: {what} ran {stall.LatenessMs:F0} ms late (GC pause {stall.GcPauseMs:F0} ms, " +
            $"{stall.ThreadPoolPending} work items pending, {stall.ThreadPoolThreads} pool threads, " +
            $"{stall.ThreadCount?.ToString() ?? "?"} threads){suppressed}. At most one warning per minute per tick; " +
            "rows in stall_events.");
    }

    public void Dispose()
    {
        _ticker?.Dispose();
        _stop.Set();
        _thread?.Join(TimeSpan.FromSeconds(5));
        _store.Dispose();
        _stop.Dispose();
        _stallSignal.Dispose();
    }
}
