#if WINDOWS
using System.Diagnostics;

namespace RedBamboo.AppHost.Startup;

/// <summary>
/// Proof that the sign-in task works: the app records how each start that came from it
/// ended, and only a start that finished is reported as verified.
/// </summary>
public static partial class StartupManager
{
    /// <summary>
    /// The option pair the sign-in task passes, so the app can tell a start from the
    /// registration apart from one the user made. A launcher that starts the app as a
    /// child forwards it through <see cref="StartedByEnvironmentVariable"/> instead.
    /// </summary>
    public const string StartedByOption = "--started-by";
    public const string SignInStartOrigin = "windows-sign-in";
    public const string StartedByEnvironmentVariable = "REDBAMBOO_STARTED_BY";

    public static IReadOnlyList<string> SignInArguments { get; } =
        [StartedByOption, SignInStartOrigin];

    public static bool IsSignInStart(IReadOnlyList<string> arguments)
    {
        for (var index = 0; index + 1 < arguments.Count; index++)
            if (arguments[index] == StartedByOption && arguments[index + 1] == SignInStartOrigin)
                return true;
        return Environment.GetEnvironmentVariable(StartedByEnvironmentVariable) == SignInStartOrigin;
    }

    /// <summary>
    /// Records that a start from the sign-in task has begun, when this is one. Returns
    /// null otherwise. The caller reports how it ended through the returned attempt; a
    /// start that never reports is shown as failed once its process is gone.
    /// </summary>
    public static StartupSignInAttempt? BeginSignInStart(
        string appName, IReadOnlyList<string> arguments)
    {
        if (!IsSignInStart(arguments))
            return null;
        // Only this process was started by the registration, not the ones it starts.
        Environment.SetEnvironmentVariable(StartedByEnvironmentVariable, null);

        using var process = Process.GetCurrentProcess();
        return BeginSignInStart(
            new WindowsStartupTaskStore(),
            appName,
            process.Id,
            process.StartTime.ToUniversalTime(),
            DateTimeOffset.UtcNow);
    }

    internal static StartupSignInAttempt BeginSignInStart(
        IStartupTaskStore store,
        string appName,
        int processId,
        DateTimeOffset processStartedAt,
        DateTimeOffset now)
    {
        var record = new StartupSignInRecord(
            now, StartupSignInRecord.Starting, null, null, processId, processStartedAt);
        lock (Gate)
            store.WriteSignInRecord(LegacyTaskName(appName), record);
        return new StartupSignInAttempt(store, appName, record);
    }

    internal static void FinishSignInStart(
        IStartupTaskStore store,
        string appName,
        StartupSignInRecord started,
        string outcome,
        string? reason,
        DateTimeOffset now)
    {
        lock (Gate)
        {
            // Turning the setting on again meanwhile cleared the record; that new
            // registration has not been proven by this start.
            if (store.ReadSignInRecord(appName) != started)
                return;
            store.WriteSignInRecord(
                appName,
                started with { Outcome = outcome, CompletedAt = now, Reason = reason });
        }
    }
}

/// <summary>One start from the sign-in task. The first outcome reported is kept.</summary>
public sealed class StartupSignInAttempt
{
    private readonly IStartupTaskStore _store;
    private readonly string _appName;
    private readonly StartupSignInRecord _started;
    private int _finished;

    internal StartupSignInAttempt(
        IStartupTaskStore store, string appName, StartupSignInRecord started)
    {
        _store = store;
        _appName = appName;
        _started = started;
    }

    public void Succeeded() => Finish(StartupSignInRecord.Succeeded, null);

    public void Failed(string reason) => Finish(StartupSignInRecord.Failed, reason);

    private void Finish(string outcome, string? reason)
    {
        if (Interlocked.Exchange(ref _finished, 1) != 0)
            return;
        StartupManager.FinishSignInStart(
            _store, _appName, _started, outcome, reason, DateTimeOffset.UtcNow);
    }
}

/// <summary>How the last start from the sign-in task went, kept per Windows user.</summary>
public sealed record StartupSignInRecord(
    DateTimeOffset StartedAt,
    string Outcome,
    DateTimeOffset? CompletedAt,
    string? Reason,
    int ProcessId,
    DateTimeOffset ProcessStartedAt)
{
    public const string Starting = "starting";
    public const string Succeeded = "succeeded";
    public const string Failed = "failed";
}
#endif
