namespace RedBamboo.AppHost.Telemetry;

/// <summary>
/// Database time and command count for the current HTTP request. <see cref="TelemetryMiddleware"/>
/// opens one per tracked request when <see cref="TelemetryOptions.RecordDatabaseTime"/> is set; the
/// host's database layer (RedLeaf: an EF Core command interceptor) calls <see cref="Add"/> once per
/// command. It flows with the request's async context, so concurrent requests never see each
/// other's accumulator, and work that is not under a request finds none and is not attributed.
/// Commands that run in parallel within one request are summed, so the total can exceed the
/// request's wall time. Once the request ends the accumulator is closed: a fire-and-forget
/// continuation that outlives it adds nothing.
/// </summary>
public sealed class RequestDbTiming
{
    private static readonly AsyncLocal<RequestDbTiming?> CurrentSlot = new();

    private long _ticks;
    private int _count;
    private volatile bool _closed;

    public static RequestDbTiming? Current => CurrentSlot.Value;

    /// <summary>Adds one finished command to the current request, if there is one. No allocation.</summary>
    public static void Add(TimeSpan elapsed) => CurrentSlot.Value?.AddCommand(elapsed);

    public TimeSpan Elapsed => TimeSpan.FromTicks(Interlocked.Read(ref _ticks));

    public int Count => Volatile.Read(ref _count);

    public void AddCommand(TimeSpan elapsed)
    {
        if (_closed) return;
        Interlocked.Add(ref _ticks, elapsed.Ticks);
        Interlocked.Increment(ref _count);
    }

    /// <summary>Starts an accumulator for the calling async flow (the middleware, before it calls the pipeline).</summary>
    public static RequestDbTiming Begin()
    {
        var timing = new RequestDbTiming();
        CurrentSlot.Value = timing;
        return timing;
    }

    /// <summary>Stops counting and detaches from the calling flow.</summary>
    public void Close()
    {
        _closed = true;
        if (ReferenceEquals(CurrentSlot.Value, this)) CurrentSlot.Value = null;
    }
}
