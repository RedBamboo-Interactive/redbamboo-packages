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

public static class StartupManager
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string TaskSchema = "http://schemas.microsoft.com/windows/2004/02/mit/task";
    private const int FileNotFoundHResult = unchecked((int)0x80070002);
    private const int TaskNotFoundHResult = unchecked((int)0x8004130F);

    // Task Scheduler results that do not mean the launcher failed: running, never run,
    // queued, ended by the user, or a trigger ignored because an instance was running.
    private static readonly int[] NonFailureTaskResults =
    [
        0,
        0x00041301,
        0x00041303,
        0x00041325,
        0x00041306,
        unchecked((int)0x8004131F),
    ];

    public static bool IsEnabled(string appName)
        => GetStatus(appName).Enabled;

    public static void RemoveLegacySignInRegistration(string appName)
        => RemoveLegacyRegistration(appName);

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

            var userSid = WindowsIdentity.GetCurrent().User?.Value
                ?? throw new InvalidOperationException(
                    "RedLeaf could not resolve the current Windows user.");
            return Evaluate(
                QueryTask(appName),
                command,
                File.Exists(command.ExecutablePath),
                GetLegacyRegistration(appName),
                userSid);
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

        if (enabled)
        {
            if (!File.Exists(launchCommand.ExecutablePath))
                throw new FileNotFoundException(
                    "The RedLeaf startup launcher is missing.",
                    launchCommand.ExecutablePath);

            var current = GetStatus(appName, launchCommand);
            if (current.Enabled)
            {
                RemoveLegacyRegistration(appName);
                return current;
            }

            var taskFile = Path.Combine(
                ElevationExchangeDirectory(),
                $"redleaf-startup-{Guid.NewGuid():N}.xml");
            try
            {
                File.WriteAllText(
                    taskFile,
                    BuildTaskXml(appName, launchCommand),
                    Encoding.Unicode);
                RunElevatedSchtasks(
                    "/Create", "/TN", TaskName(appName),
                    "/XML", taskFile, "/F");
            }
            finally
            {
                try { File.Delete(taskFile); } catch { }
            }

            var status = GetStatus(appName, launchCommand);
            if (!status.Enabled)
                throw new InvalidOperationException(status.Message);
            RemoveLegacyRegistration(appName);
            return status;
        }

        if (QueryTask(appName) is not null)
            RunElevatedSchtasks(
                "/Delete", "/TN", TaskName(appName), "/F");
        RemoveLegacyRegistration(appName);

        var disabled = GetStatus(appName, launchCommand);
        if (disabled.State != "disabled")
            throw new InvalidOperationException(disabled.Message);
        return disabled;
    }

    internal static StartupRegistrationStatus Evaluate(
        ScheduledStartupRegistration? registration,
        StartupLaunchCommand expected,
        bool executableExists,
        string? legacyRegistration,
        string expectedUserSid)
    {
        if (registration is null)
        {
            return string.IsNullOrWhiteSpace(legacyRegistration)
                ? new(
                    false,
                    false,
                    false,
                    "disabled",
                    "RedLeaf will not start automatically with Windows.")
                : new(
                    false,
                    true,
                    false,
                    "legacy_sign_in_only",
                    "RedLeaf is registered only for the next sign-in, not for Windows boot. Turn this setting on again to repair it.");
        }

        if (!registration.Enabled)
            return new(
                false,
                true,
                false,
                "disabled_by_windows",
                "Windows disabled the RedLeaf boot task. Turn this setting on again to repair it.");
        if (!executableExists)
            return new(
                false,
                true,
                false,
                "executable_missing",
                "The registered RedLeaf startup launcher is missing.");
        if (!registration.HasBootTrigger)
            return new(
                false,
                true,
                false,
                "boot_trigger_missing",
                "The RedLeaf startup task does not run when Windows boots.");
        if (!registration.HasLogonTrigger)
            return new(
                false,
                true,
                false,
                "logon_fallback_missing",
                "The RedLeaf startup task has no sign-in recovery trigger.");
        if (!string.Equals(
                registration.LogonType,
                "S4U",
                StringComparison.OrdinalIgnoreCase))
            return new(
                false,
                true,
                false,
                "interactive_only",
                "The RedLeaf startup task still requires an interactive sign-in.");
        if (!string.Equals(
                registration.UserId,
                expectedUserSid,
                StringComparison.OrdinalIgnoreCase))
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
                "The Windows boot task points to an outdated RedLeaf launcher.");

        // The task definition can be correct while the launch itself fails. Only the
        // last real run proves that Windows actually started RedLeaf.
        if (registration.LastResult is { } lastResult
            && !NonFailureTaskResults.Contains(lastResult))
            return new(
                true,
                true,
                false,
                "last_start_failed",
                $"Windows tried to start RedLeaf, but the startup launcher failed (result 0x{lastResult:X8}). RedLeaf is not verified to start with Windows.");

        return new(
            true,
            true,
            true,
            "ready",
            "RedLeaf is verified to start after Windows boots, before sign-in.");
    }

    internal static string BuildTaskXml(
        string appName,
        StartupLaunchCommand command,
        string? userSid = null)
    {
        _ = TaskName(appName);
        userSid ??= WindowsIdentity.GetCurrent().User?.Value
            ?? throw new InvalidOperationException(
                "RedLeaf could not resolve the current Windows user.");
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
                        $"Starts {appName} after Windows boots, before interactive sign-in, with a sign-in fallback.")),
                new XElement(
                    ns + "Triggers",
                    new XElement(
                        ns + "BootTrigger",
                        new XElement(ns + "Enabled", true),
                        new XElement(ns + "Delay", "PT30S")),
                    new XElement(
                        ns + "LogonTrigger",
                        new XElement(ns + "Enabled", true),
                        new XElement(ns + "UserId", userSid),
                        new XElement(ns + "Delay", "PT5S"))),
                new XElement(
                    ns + "Principals",
                    new XElement(
                        ns + "Principal",
                        new XAttribute("id", "Author"),
                        new XElement(ns + "UserId", userSid),
                        new XElement(ns + "LogonType", "S4U"),
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
                    new XElement(ns + "StartWhenAvailable", true),
                    new XElement(
                        ns + "RunOnlyIfNetworkAvailable",
                        false),
                    new XElement(ns + "AllowStartOnDemand", true),
                    new XElement(ns + "Enabled", true),
                    new XElement(ns + "Hidden", true),
                    new XElement(
                        ns + "ExecutionTimeLimit",
                        "PT0S"),
                    new XElement(ns + "Priority", 7),
                    new XElement(
                        ns + "RestartOnFailure",
                        new XElement(ns + "Interval", "PT1M"),
                        new XElement(ns + "Count", 5))),
                new XElement(
                    ns + "Actions",
                    new XAttribute("Context", "Author"),
                    action)))
            .ToString(SaveOptions.DisableFormatting);
    }

    private static string? GetLegacyRegistration(string appName)
    {
        using var key = Registry.CurrentUser.OpenSubKey(
            RunKey,
            false);
        var value = key?.GetValue(
            appName,
            null,
            RegistryValueOptions.DoNotExpandEnvironmentNames);
        return value as string;
    }

    private static void RemoveLegacyRegistration(string appName)
    {
        using var key = Registry.CurrentUser.OpenSubKey(
            RunKey,
            true);
        key?.DeleteValue(appName, throwOnMissingValue: false);
    }

    private static ScheduledStartupRegistration? QueryTask(
        string appName)
    {
        var result = RunSchtasks(
            "/Query", "/TN", TaskName(appName), "/XML", "/HRESULT");
        if (result.ExitCode is FileNotFoundHResult or TaskNotFoundHResult)
            return null;
        if (result.ExitCode != 0)
            throw new InvalidOperationException(
                $"Windows could not query the RedLeaf startup task (exit code {result.ExitCode}).");

        var document = XDocument.Parse(result.StandardOutput);
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
            triggers?.Elements(ns + "LogonTrigger").Any() == true,
            principal?.Element(ns + "UserId")?.Value,
            principal?.Element(ns + "LogonType")?.Value,
            principal?.Element(ns + "RunLevel")?.Value,
            QueryLastTaskResult(appName));
    }

    /// <summary>
    /// Reads the last run result through the Task Scheduler COM API. schtasks only
    /// exposes it in localized text, so a parse there would break on non-English Windows.
    /// Returns null when the result cannot be read; the definition checks still apply.
    /// </summary>
    private static int? QueryLastTaskResult(string appName)
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
                : Invoke(folder, "GetTask", BindingFlags.InvokeMethod, TaskName(appName));
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
    /// A directory both this process and its elevated schtasks child can reach.
    /// TEMP is unsafe: it may sit on a subst drive, and subst drives exist only
    /// in the logon session that created them, never in the elevated token's.
    /// </summary>
    private static string ElevationExchangeDirectory()
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

    internal static string BuildElevatedSchtasksCommandLine(
        string schtasksPath,
        string outputPath,
        IReadOnlyList<string> arguments)
    {
        // cmd.exe expands % even inside quotes, so such a value cannot be passed safely.
        static string Quote(string value)
            => value.IndexOfAny(['"', '%']) >= 0
                ? throw new ArgumentException(
                    "Startup task arguments cannot contain quotes or percent signs.")
                : $"\"{value}\"";

        var command = string.Join(
            " ",
            arguments.Prepend(schtasksPath).Select(Quote));
        // /s strips only the outermost quote pair, leaving every inner quote intact.
        return $"/d /s /c \"{command} > {Quote(outputPath)} 2>&1\"";
    }

    private static void RunElevatedSchtasks(
        params string[] arguments)
    {
        // An elevated ShellExecute child cannot redirect its streams back to us, so
        // schtasks writes its own explanation to a file we read after it exits.
        var outputFile = Path.Combine(
            ElevationExchangeDirectory(),
            $"redleaf-startup-{Guid.NewGuid():N}.log");
        var startInfo = new ProcessStartInfo
        {
            FileName = Path.Combine(
                Environment.SystemDirectory,
                "cmd.exe"),
            Arguments = BuildElevatedSchtasksCommandLine(
                Path.Combine(
                    Environment.SystemDirectory,
                    "schtasks.exe"),
                outputFile,
                arguments),
            UseShellExecute = true,
            Verb = "runas",
            WindowStyle = ProcessWindowStyle.Hidden,
        };

        try
        {
            using var process = Process.Start(startInfo)
                ?? throw new InvalidOperationException(
                    "Windows did not start the startup-task installer.");
            process.WaitForExit();
            if (process.ExitCode != 0)
            {
                var detail = ReadElevatedOutput(outputFile);
                throw new InvalidOperationException(
                    string.IsNullOrEmpty(detail)
                        ? $"Windows rejected the RedLeaf startup task (exit code {process.ExitCode})."
                        : $"Windows rejected the RedLeaf startup task (exit code {process.ExitCode}): {detail}");
            }
        }
        catch (Win32Exception error)
            when (error.NativeErrorCode == 1223)
        {
            throw new InvalidOperationException(
                "The Windows administrator approval was cancelled.",
                error);
        }
        finally
        {
            try { File.Delete(outputFile); } catch { }
        }
    }

    private static string ReadElevatedOutput(string outputFile)
    {
        try
        {
            // schtasks writes through cmd redirection in the console's OEM code page.
            var text = File.ReadAllText(
                outputFile,
                CodePagesEncodingProvider.Instance.GetEncoding(
                    (int)GetOEMCP()) ?? Encoding.Default);
            return string.Join(
                " ",
                text.Split(
                    ['\r', '\n'],
                    StringSplitOptions.RemoveEmptyEntries
                    | StringSplitOptions.TrimEntries));
        }
        catch (IOException)
        {
            return string.Empty;
        }
        catch (UnauthorizedAccessException)
        {
            return string.Empty;
        }
    }

    [DllImport("kernel32.dll")]
    private static extern uint GetOEMCP();

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
        var output = process.StandardOutput.ReadToEnd();
        var error = process.StandardError.ReadToEnd();
        process.WaitForExit();
        return new ProcessResult(
            process.ExitCode,
            output,
            error);
    }

    private static string TaskName(string appName)
    {
        if (string.IsNullOrWhiteSpace(appName)
            || appName.IndexOfAny(
                ['\\', '/', ':', '*', '?', '"', '<', '>', '|']) >= 0)
            throw new ArgumentException(
                "Startup application name is invalid.",
                nameof(appName));
        return appName;
    }

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

    private sealed record ProcessResult(
        int ExitCode,
        string StandardOutput,
        string StandardError);
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
    int? LastResult = null);

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
