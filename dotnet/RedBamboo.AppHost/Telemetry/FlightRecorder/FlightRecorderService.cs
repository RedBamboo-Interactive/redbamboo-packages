using RedBamboo.AppHost.Logging;

namespace RedBamboo.AppHost.Telemetry.FlightRecorder;

/// <summary>
/// Runs the process sampler on one dedicated background thread, so samples keep coming while the
/// thread pool is starved (which is exactly when they matter). A failed tick is counted and logged
/// at most once an hour and never stops the thread.
/// </summary>
public sealed class FlightRecorderService : IDisposable
{
    private static readonly TimeSpan FailureLogInterval = TimeSpan.FromHours(1);

    private readonly FlightRecorderOptions _options;
    private readonly FlightRecorderStore _store;
    private readonly TimeProvider _time;
    private readonly ProcessSampler? _sampler;
    private readonly ManualResetEventSlim _stop = new(false);
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
    }

    public FlightRecorderOptions Options => _options;

    /// <summary>Failed ticks since start (a write or a reading that threw).</summary>
    public int Failures { get; private set; }

    internal FlightRecorderStore Store => _store;

    /// <summary>Where warnings go; until attached they are only counted.</summary>
    public void AttachLog(LogService log) => _log = log;

    public List<ProcessSample> QuerySamples(DateTimeOffset? since, DateTimeOffset? until, int limit, int offset)
        => _store.QuerySamples(since, until, limit, offset);

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
    }

    private void Run()
    {
        while (!_stop.IsSet)
        {
            var wait = _sampler?.UntilDue() ?? Timeout.InfiniteTimeSpan;
            if (wait != Timeout.InfiniteTimeSpan && wait < TimeSpan.Zero) wait = TimeSpan.Zero;
            if (_stop.Wait(wait)) break;
            Pump();
        }
    }

    /// <summary>One pass: writes the sample when it is due. The thread's body; tests call it with a fake clock.</summary>
    internal void Pump()
    {
        try
        {
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

    public void Dispose()
    {
        _stop.Set();
        _thread?.Join(TimeSpan.FromSeconds(5));
        _store.Dispose();
        _stop.Dispose();
    }
}
