#if WINDOWS
using System.ComponentModel;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Xml.Linq;
using Microsoft.Win32;

namespace RedBamboo.AppHost.Startup;

/// <summary>
/// "Start with Windows": a per-user Task Scheduler task that starts the app when the
/// user signs in, in their own desktop session, with their standard (non-elevated)
/// token. A task rather than the HKCU Run key because its last run result proves the
/// launch actually worked, and the user can create and remove it without elevation.
///
/// Earlier versions registered an S4U boot task named after the app. It ran the app
/// in session 0, where an administrator's token is never filtered, so the launcher's
/// restricted relaunch ran and every child process the app started was denied. That
/// task is replaced whenever it is found.
/// </summary>
public static class StartupManager
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string TaskSchema = "http://schemas.microsoft.com/windows/2004/02/mit/task";
    private const int FileNotFoundHResult = unchecked((int)0x80070002);
    private const int TaskNotFoundHResult = unchecked((int)0x8004130F);
    private const int AccessDeniedHResult = unchecked((int)0x80070005);
    private const int NeverRunTaskResult = 0x00041303;

    // Task Scheduler results that do not mean the launcher failed: running, never run,
    // queued, ended by the user, or a trigger ignored because an instance was running.
    private static readonly int[] NonFailureTaskResults =
    [
        0,
        0x00041301,
        NeverRunTaskResult,
        0x00041325,
        0x00041306,
        unchecked((int)0x8004131F),
    ];

    private static readonly Lock Gate = new();

    // Apps whose legacy registration a status read could not replace without approval,
    // so later reads do not retry (and churn the sign-in task) on every refresh.
    private static readonly HashSet<string> LegacyMigrationDeferred =
        new(StringComparer.OrdinalIgnoreCase);

    public static bool IsEnabled(string appName)
        => GetStatus(appName).Enabled;

    public static void RemoveLegacySignInRegistration(string appName)
        => new WindowsStartupTaskStore().DeleteRunEntry(appName);

    /// <summary>
    /// Reads the registration. A legacy boot task is replaced on the way when that needs
    /// no administrator approval; otherwise the status says it is still there.
    /// </summary>
    public static StartupRegistrationStatus GetStatus(
        string appName, StartupLaunchCommand? command = null)
    {
        try
        {
            command ??= Environment.ProcessPath is { } path
                ? new StartupLaunchCommand(path, []) : null;
            if (command is null)
                return StartupRegistrationStatus.Unavailable(
                    "RedLeaf could not resolve its startup executable.");

            var store = new WindowsStartupTaskStore();
            var userSid = CurrentUserSid();
            lock (Gate)
            {
                if (!LegacyMigrationDeferred.Contains(appName))
                {
                    try
                    {
                        if (!MigrateWithoutApproval(store, appName, command, userSid))
                            LegacyMigrationDeferred.Add(appName);
                    }
                    catch (Exception)
                    {
                        // The status below still reports what is registered.
                        LegacyMigrationDeferred.Add(appName);
                    }
                }
                return Inspect(store, appName, command, userSid);
            }
        }
        catch (Exception error)
        {
            return StartupRegistrationStatus.Unavailable(
                $"Windows startup registration could not be inspected: {error.Message}");
        }
    }

    public static StartupRegistrationStatus SetEnabled(
        string appName,
        bool enabled,
        StartupLaunchCommand? launchCommand = null)
    {
        launchCommand ??= Environment.ProcessPath is { } processPath
            ? new StartupLaunchCommand(processPath, [])
            : null;
        if (launchCommand is null)
            throw new InvalidOperationException(
                "RedLeaf could not resolve its startup executable.");

        var store = new WindowsStartupTaskStore();
        var userSid = CurrentUserSid();
        lock (Gate)
        {
            var status = enabled
                ? Enable(store, appName, launchCommand, userSid)
                : Disable(store, appName, launchCommand, userSid);
            LegacyMigrationDeferred.Remove(appName);
            return status;
        }
    }

    internal static StartupRegistrationStatus Inspect(
        IStartupTaskStore store,
        string appName,
        StartupLaunchCommand command,
        string userSid)
        => Evaluate(
            store.Query(SignInTaskName(appName, userSid)),
            command,
            store.ExecutableExists(command.ExecutablePath),
            store.ReadRunEntry(appName),
            userSid,
            store.Query(LegacyTaskName(appName)));

    /// <summary>
    /// Replaces a legacy boot task, or an HKCU Run entry, with the sign-in task when the
    /// user's own token is allowed to remove it. An enabled legacy registration becomes an
    /// enabled sign-in task; a disabled one is only removed. Returns false when removing the
    /// boot task needs administrator approval; nothing is changed then.
    /// </summary>
    internal static bool MigrateWithoutApproval(
        IStartupTaskStore store,
        string appName,
        StartupLaunchCommand command,
        string userSid)
    {
        var signInName = SignInTaskName(appName, userSid);
        var legacy = store.Query(LegacyTaskName(appName));
        var runEntry = store.ReadRunEntry(appName);
        if (legacy is null && runEntry is null)
            return true;

        var startsWithWindows = legacy?.Enabled == true || runEntry is not null;
        var hadSignInTask = store.Query(signInName) is not null;
        var registered = false;
        if (startsWithWindows && !hadSignInTask)
        {
            // Without the launcher there is nothing to register; keep what starts today.
            if (!store.ExecutableExists(command.ExecutablePath))
                return true;
            store.Register(signInName, BuildTaskXml(appName, command, userSid));
            registered = true;
        }

        if (legacy is not null && !store.TryDelete(LegacyTaskName(appName)))
        {
            if (registered)
                store.TryDelete(signInName);
            return false;
        }

        store.DeleteRunEntry(appName);
        return true;
    }

    internal static StartupRegistrationStatus Enable(
        IStartupTaskStore store,
        string appName,
        StartupLaunchCommand command,
        string userSid)
    {
        if (!store.ExecutableExists(command.ExecutablePath))
            throw new FileNotFoundException(
                "The RedLeaf startup launcher is missing.",
                command.ExecutablePath);

        var legacyName = LegacyTaskName(appName);
        var signInName = SignInTaskName(appName, userSid);
        var current = Inspect(store, appName, command, userSid);
        // Re-registering a working task would erase its last run result.
        if (!current.Enabled)
        {
            var hadSignInTask = store.Query(signInName) is not null;
            store.Register(signInName, BuildTaskXml(appName, command, userSid));

            // Add the sign-in task first, so a refused approval never leaves the user
            // with neither registration; roll it back so both never start RedLeaf.
            if (store.Query(legacyName) is not null && !store.TryDelete(legacyName))
            {
                try
                {
                    store.DeleteWithApproval(legacyName);
                }
                catch (Exception error)
                {
                    if (!hadSignInTask)
                        store.TryDelete(signInName);
                    throw new InvalidOperationException(
                        $"RedLeaf kept its old boot task because Windows did not remove it: {error.Message}",
                        error);
                }
            }
        }

        store.DeleteRunEntry(appName);
        var status = Inspect(store, appName, command, userSid);
        if (!status.Enabled)
            throw new InvalidOperationException(status.Message);
        return status;
    }

    internal static StartupRegistrationStatus Disable(
        IStartupTaskStore store,
        string appName,
        StartupLaunchCommand command,
        string userSid)
    {
        // The boot task first: if its approval is refused, nothing has changed yet.
        var legacyName = LegacyTaskName(appName);
        if (store.Query(legacyName) is not null && !store.TryDelete(legacyName))
            store.DeleteWithApproval(legacyName);

        var signInName = SignInTaskName(appName, userSid);
        if (store.Query(signInName) is not null && !store.TryDelete(signInName))
            throw new InvalidOperationException(
                "Windows did not allow RedLeaf to remove its sign-in task.");
        store.DeleteRunEntry(appName);

        var status = Inspect(store, appName, command, userSid);
        if (status.State != "disabled")
            throw new InvalidOperationException(status.Message);
        return status;
    }

    internal static StartupRegistrationStatus Evaluate(
        ScheduledStartupRegistration? registration,
        StartupLaunchCommand expected,
        bool executableExists,
        string? legacyRegistration,
        string expectedUserSid,
        ScheduledStartupRegistration? legacyBootTask = null)
    {
        if (legacyBootTask is not null)
            return legacyBootTask.Enabled
                ? new(
                    false,
                    true,
                    false,
                    "legacy_boot_task",
                    "RedLeaf still has its old boot task, which starts it before you sign in, where it cannot start its database or tools. Turn this setting on to start RedLeaf when you sign in instead. Windows asks once for administrator approval to remove the old task.")
                : new(
                    false,
                    true,
                    false,
                    "legacy_boot_task_disabled",
                    "RedLeaf's old boot task is turned off, so RedLeaf does not start with Windows. Turn this setting on to start RedLeaf when you sign in instead. Windows asks once for administrator approval to remove the old task.");

        if (registration is null)
        {
            return string.IsNullOrWhiteSpace(legacyRegistration)
                ? new(
                    false,
                    false,
                    false,
                    "disabled",
                    "RedLeaf will not start automatically when you sign in to Windows.")
                : new(
                    false,
                    true,
                    false,
                    "legacy_run_entry",
                    "RedLeaf is registered through an older Windows startup entry that cannot be verified. Turn this setting on again to repair it.");
        }

        if (!registration.Enabled)
            return new(
                false,
                true,
                false,
                "disabled_by_windows",
                "The RedLeaf sign-in task is turned off in Windows Task Scheduler. Turn this setting on again to repair it.");
        if (!executableExists)
            return new(
                false,
                true,
                false,
                "executable_missing",
                "The registered RedLeaf startup launcher is missing.");
        if (registration.HasBootTrigger)
            return new(
                false,
                true,
                false,
                "boot_trigger_present",
                "The RedLeaf startup task also runs when Windows boots, before sign-in. Turn this setting on again to repair it.");
        if (!registration.HasLogonTrigger
            || !SidEquals(registration.LogonTriggerUserId, expectedUserSid))
            return new(
                false,
                true,
                false,
                "logon_trigger_missing",
                "The RedLeaf startup task does not run when you sign in. Turn this setting on again to repair it.");
        if (!string.Equals(
                registration.LogonType,
                "InteractiveToken",
                StringComparison.OrdinalIgnoreCase))
            return new(
                false,
                true,
                false,
                "not_interactive",
                "The RedLeaf startup task does not run in your Windows session. Turn this setting on again to repair it.");
        if (!SidEquals(registration.UserId, expectedUserSid))
            return new(
                false,
                true,
                false,
                "wrong_user",
                "The RedLeaf startup task runs as a different Windows user.");
        if (string.Equals(
                registration.RunLevel,
                "HighestAvailable",
                StringComparison.OrdinalIgnoreCase))
            return new(
                false,
                true,
                false,
                "elevated_task",
                "The RedLeaf startup task runs with administrator privileges. Turn this setting on again to repair it.");

        var expectedArguments = expected.ToTaskArguments();
        var expectedWorkingDirectory =
            Path.GetDirectoryName(expected.ExecutablePath) ?? string.Empty;
        if (!PathEquals(registration.ExecutablePath, expected.ExecutablePath)
            || !string.Equals(
                registration.Arguments,
                expectedArguments,
                StringComparison.Ordinal)
            || !PathEquals(
                registration.WorkingDirectory,
                expectedWorkingDirectory))
            return new(
                false,
                true,
                false,
                "command_mismatch",
                "The RedLeaf sign-in task points to an outdated RedLeaf launcher.");

        // The task definition can be correct while the launch itself fails. Only the
        // last real run proves that Windows actually started RedLeaf.
        if (registration.LastResult is { } lastResult
            && !NonFailureTaskResults.Contains(lastResult))
            return new(
                true,
                true,
                false,
                "last_start_failed",
                $"Windows tried to start RedLeaf when you signed in, but the startup launcher failed (result 0x{lastResult:X8}). RedLeaf is not verified to start with Windows.");

        return new(
            true,
            true,
            true,
            "ready",
            registration.LastResult is null or NeverRunTaskResult
                ? "RedLeaf will start the next time you sign in to Windows."
                : "RedLeaf is verified to start when you sign in to Windows.");
    }

    internal static string BuildTaskXml(
        string appName,
        StartupLaunchCommand command,
        string? userSid = null)
    {
        _ = LegacyTaskName(appName);
        userSid ??= CurrentUserSid();
        var workingDirectory = Path.GetDirectoryName(command.ExecutablePath)
            ?? throw new InvalidOperationException(
                "RedLeaf could not resolve its startup directory.");
        XNamespace ns = TaskSchema;
        var arguments = command.ToTaskArguments();
        var action = new XElement(
            ns + "Exec",
            new XElement(ns + "Command", command.ExecutablePath));
        if (arguments.Length > 0)
            action.Add(new XElement(ns + "Arguments", arguments));
        action.Add(new XElement(
            ns + "WorkingDirectory",
            workingDirectory));

        return new XDocument(
            new XDeclaration("1.0", "UTF-16", null),
            new XElement(
                ns + "Task",
                new XAttribute("version", "1.4"),
                new XElement(
                    ns + "RegistrationInfo",
                    new XElement(
                        ns + "Description",
                        $"Starts {appName} when you sign in to Windows, in your desktop session, without administrator rights.")),
                new XElement(
                    ns + "Triggers",
                    new XElement(
                        ns + "LogonTrigger",
                        new XElement(ns + "Enabled", true),
                        new XElement(ns + "UserId", userSid),
                        // Let Explorer bring up the notification area for the tray icon.
                        new XElement(ns + "Delay", "PT10S"))),
                new XElement(
                    ns + "Principals",
                    new XElement(
                        ns + "Principal",
                        new XAttribute("id", "Author"),
                        new XElement(ns + "UserId", userSid),
                        new XElement(ns + "LogonType", "InteractiveToken"),
                        new XElement(ns + "RunLevel", "LeastPrivilege"))),
                new XElement(
                    ns + "Settings",
                    new XElement(
                        ns + "MultipleInstancesPolicy",
                        "IgnoreNew"),
                    new XElement(
                        ns + "DisallowStartIfOnBatteries",
                        false),
                    new XElement(
                        ns + "StopIfGoingOnBatteries",
                        false),
                    new XElement(ns + "AllowHardTerminate", true),
                    new XElement(
                        ns + "RunOnlyIfNetworkAvailable",
                        false),
                    new XElement(ns + "AllowStartOnDemand", true),
                    new XElement(ns + "Enabled", true),
                    new XElement(ns + "Hidden", false),
                    new XElement(
                        ns + "ExecutionTimeLimit",
                        "PT0S"),
                    // The default 7 is below normal, which RedLeaf and its database
                    // would inherit; 5 matches an app started from the desktop.
                    new XElement(ns + "Priority", 5),
                    new XElement(
                        ns + "RestartOnFailure",
                        new XElement(ns + "Interval", "PT1M"),
                        new XElement(ns + "Count", 3))),
                new XElement(
                    ns + "Actions",
                    new XAttribute("Context", "Author"),
                    action)))
            .ToString(SaveOptions.DisableFormatting);
    }

    internal static ScheduledStartupRegistration ParseTaskXml(
        string taskXml,
        int? lastResult = null)
    {
        var document = XDocument.Parse(taskXml);
        XNamespace ns = TaskSchema;
        var root = document.Root
            ?? throw new InvalidDataException(
                "Windows returned an empty task definition.");
        var action = root
            .Descendants(ns + "Exec")
            .SingleOrDefault()
            ?? throw new InvalidDataException(
                "The RedLeaf startup task has no executable action.");
        var triggers = root.Element(ns + "Triggers");
        var logonTrigger = triggers?.Elements(ns + "LogonTrigger").FirstOrDefault();
        var principal = root
            .Element(ns + "Principals")
            ?.Elements(ns + "Principal")
            .SingleOrDefault();

        return new ScheduledStartupRegistration(
            action.Element(ns + "Command")?.Value ?? string.Empty,
            action.Element(ns + "Arguments")?.Value ?? string.Empty,
            action.Element(ns + "WorkingDirectory")?.Value ?? string.Empty,
            !string.Equals(
                root.Element(ns + "Settings")
                    ?.Element(ns + "Enabled")
                    ?.Value,
                "false",
                StringComparison.OrdinalIgnoreCase),
            triggers?.Elements(ns + "BootTrigger").Any() == true,
            logonTrigger is not null,
            principal?.Element(ns + "UserId")?.Value,
            principal?.Element(ns + "LogonType")?.Value,
            principal?.Element(ns + "RunLevel")?.Value,
            lastResult,
            logonTrigger?.Element(ns + "UserId")?.Value);
    }

    /// <summary>
    /// One task per Windows user, so two accounts on one PC never overwrite each other's.
    /// </summary>
    internal static string SignInTaskName(string appName, string userSid)
        => $"{LegacyTaskName(appName)} sign-in {userSid}";

    /// <summary>The S4U boot task earlier versions registered.</summary>
    internal static string LegacyTaskName(string appName)
    {
        if (string.IsNullOrWhiteSpace(appName)
            || appName.IndexOfAny(
                ['\\', '/', ':', '*', '?', '"', '<', '>', '|']) >= 0)
            throw new ArgumentException(
                "Startup application name is invalid.",
                nameof(appName));
        return appName;
    }

    private static string CurrentUserSid()
        => WindowsIdentity.GetCurrent().User?.Value
            ?? throw new InvalidOperationException(
                "RedLeaf could not resolve the current Windows user.");

    private static bool SidEquals(string? actual, string expected)
        => string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase);

    private static bool PathEquals(string first, string second)
    {
        if (string.IsNullOrWhiteSpace(first)
            || string.IsNullOrWhiteSpace(second))
            return false;
        return string.Equals(
            Path.GetFullPath(first),
            Path.GetFullPath(second),
            StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Task Scheduler and the Run key, as the current Windows user sees them.</summary>
    private sealed class WindowsStartupTaskStore : IStartupTaskStore
    {
        public bool ExecutableExists(string path) => File.Exists(path);

        public ScheduledStartupRegistration? Query(string taskName)
        {
            var result = RunSchtasks(
                "/Query", "/TN", taskName, "/XML", "/HRESULT");
            if (result.ExitCode is FileNotFoundHResult or TaskNotFoundHResult)
                return null;
            if (result.ExitCode != 0)
                throw new InvalidOperationException(
                    $"Windows could not query the RedLeaf startup task (exit code 0x{result.ExitCode:X8}).");

            var registration = ParseTaskXml(
                result.StandardOutput,
                QueryLastTaskResult(taskName));
            return registration with
            {
                UserId = ToSid(registration.UserId),
                LogonTriggerUserId = ToSid(registration.LogonTriggerUserId),
            };
        }

        public void Register(string taskName, string taskXml)
        {
            var taskFile = Path.Combine(
                ExchangeDirectory(),
                $"redleaf-startup-{Guid.NewGuid():N}.xml");
            try
            {
                File.WriteAllText(taskFile, taskXml, Encoding.Unicode);
                var result = RunSchtasks(
                    "/Create", "/TN", taskName, "/XML", taskFile, "/F", "/HRESULT");
                if (result.ExitCode != 0)
                    throw new InvalidOperationException(
                        $"Windows did not create the RedLeaf sign-in task (0x{result.ExitCode:X8}): {Summarize(result)}");
            }
            finally
            {
                try { File.Delete(taskFile); } catch { }
            }
        }

        public bool TryDelete(string taskName)
        {
            var result = RunSchtasks("/Delete", "/TN", taskName, "/F", "/HRESULT");
            return result.ExitCode switch
            {
                0 or FileNotFoundHResult or TaskNotFoundHResult => true,
                AccessDeniedHResult => false,
                _ => throw new InvalidOperationException(
                    $"Windows could not remove the RedLeaf startup task (0x{result.ExitCode:X8}): {Summarize(result)}"),
            };
        }

        public void DeleteWithApproval(string taskName)
        {
            // schtasks itself is elevated, so the approval prompt names the Task Scheduler
            // tool from Microsoft rather than a command shell.
            var startInfo = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.SystemDirectory, "schtasks.exe"),
                UseShellExecute = true,
                Verb = "runas",
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            foreach (var argument in new[] { "/Delete", "/TN", taskName, "/F", "/HRESULT" })
                startInfo.ArgumentList.Add(argument);

            try
            {
                using var process = Process.Start(startInfo)
                    ?? throw new InvalidOperationException(
                        "Windows did not start the startup-task removal.");
                process.WaitForExit();
                if (process.ExitCode is not (0 or FileNotFoundHResult or TaskNotFoundHResult))
                    throw new InvalidOperationException(
                        $"Windows did not remove the old RedLeaf boot task (0x{process.ExitCode:X8}).");
            }
            catch (Win32Exception error)
                when (error.NativeErrorCode == 1223)
            {
                throw new InvalidOperationException(
                    "The Windows administrator approval was cancelled.",
                    error);
            }
        }

        public string? ReadRunEntry(string appName)
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey, false);
            var value = key?.GetValue(
                appName,
                null,
                RegistryValueOptions.DoNotExpandEnvironmentNames);
            return value as string;
        }

        public void DeleteRunEntry(string appName)
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey, true);
            key?.DeleteValue(appName, throwOnMissingValue: false);
        }

        /// <summary>Task Scheduler may report the principal as a name instead of a SID.</summary>
        private static string? ToSid(string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            try
            {
                return value.StartsWith("S-1-", StringComparison.OrdinalIgnoreCase)
                    ? new SecurityIdentifier(value).Value
                    : new NTAccount(value).Translate(typeof(SecurityIdentifier)).Value;
            }
            catch (SystemException)
            {
                return value;
            }
        }

        /// <summary>
        /// Reads the last run result through the Task Scheduler COM API. schtasks only
        /// exposes it in localized text, so a parse there would break on non-English Windows.
        /// Returns null when the result cannot be read; the definition checks still apply.
        /// </summary>
        private static int? QueryLastTaskResult(string taskName)
        {
            object? service = null;
            object? folder = null;
            object? task = null;
            try
            {
                var serviceType = Type.GetTypeFromProgID("Schedule.Service");
                if (serviceType is null) return null;
                service = Activator.CreateInstance(serviceType);
                if (service is null) return null;
                Invoke(service, "Connect", BindingFlags.InvokeMethod);
                folder = Invoke(service, "GetFolder", BindingFlags.InvokeMethod, @"\");
                task = folder is null
                    ? null
                    : Invoke(folder, "GetTask", BindingFlags.InvokeMethod, taskName);
                return task is null
                    ? null
                    : Convert.ToInt32(Invoke(task, "LastTaskResult", BindingFlags.GetProperty));
            }
            catch (Exception error) when (error is COMException
                                           or TargetInvocationException
                                           or InvalidCastException
                                           or MissingMemberException)
            {
                return null;
            }
            finally
            {
                foreach (var item in new[] { task, folder, service })
                    if (item is not null && Marshal.IsComObject(item))
                        Marshal.ReleaseComObject(item);
            }
        }

        private static object? Invoke(
            object target,
            string member,
            BindingFlags kind,
            params object[] arguments)
            => target.GetType().InvokeMember(member, kind, null, target, arguments);

        /// <summary>
        /// A directory schtasks can read the task XML from. TEMP may point at a scratch
        /// drive the RedLeaf process inherited from an agent session.
        /// </summary>
        private static string ExchangeDirectory()
        {
            var localAppData = Environment.GetFolderPath(
                Environment.SpecialFolder.LocalApplicationData,
                Environment.SpecialFolderOption.DoNotVerify);
            if (string.IsNullOrWhiteSpace(localAppData))
                throw new InvalidOperationException(
                    "RedLeaf could not resolve the local application data folder.");
            var directory = Path.Combine(localAppData, "RedBamboo", "Startup");
            Directory.CreateDirectory(directory);
            return directory;
        }

        private static string Summarize(ProcessResult result)
            => string.Join(
                " ",
                (result.StandardError + "\n" + result.StandardOutput).Split(
                    ['\r', '\n'],
                    StringSplitOptions.RemoveEmptyEntries
                    | StringSplitOptions.TrimEntries));

        private static ProcessResult RunSchtasks(
            params string[] arguments)
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = Path.Combine(
                    Environment.SystemDirectory,
                    "schtasks.exe"),
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            foreach (var argument in arguments)
                startInfo.ArgumentList.Add(argument);

            using var process = Process.Start(startInfo)
                ?? throw new InvalidOperationException(
                    "Windows did not start the task query.");
            var output = process.StandardOutput.ReadToEndAsync();
            var error = process.StandardError.ReadToEndAsync();
            process.WaitForExit();
            return new ProcessResult(
                process.ExitCode,
                output.Result,
                error.Result);
        }

        private sealed record ProcessResult(
            int ExitCode,
            string StandardOutput,
            string StandardError);
    }
}

/// <summary>The Windows surfaces startup registration reads and changes.</summary>
internal interface IStartupTaskStore
{
    bool ExecutableExists(string path);

    ScheduledStartupRegistration? Query(string taskName);

    /// <summary>Creates or replaces a task with the current user's token.</summary>
    void Register(string taskName, string taskXml);

    /// <summary>
    /// Deletes a task with the current user's token. True when it is gone; false when
    /// Windows requires administrator approval to delete it.
    /// </summary>
    bool TryDelete(string taskName);

    /// <summary>Deletes a task after one Windows administrator approval prompt.</summary>
    void DeleteWithApproval(string taskName);

    string? ReadRunEntry(string appName);

    void DeleteRunEntry(string appName);
}

internal sealed record ScheduledStartupRegistration(
    string ExecutablePath,
    string Arguments,
    string WorkingDirectory,
    bool Enabled,
    bool HasBootTrigger,
    bool HasLogonTrigger,
    string? UserId,
    string? LogonType,
    string? RunLevel = null,
    int? LastResult = null,
    string? LogonTriggerUserId = null);

public sealed record StartupRegistrationStatus(
    bool Enabled,
    bool Registered,
    bool Verified,
    string State,
    string Message)
{
    public static StartupRegistrationStatus Unavailable(
        string message)
        => new(false, false, false, "unavailable", message);
}
#endif
