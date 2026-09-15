#if WINDOWS
using System.ComponentModel;
using System.Diagnostics;
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
                Path.GetTempPath(),
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
            principal?.Element(ns + "LogonType")?.Value);
    }

    private static void RunElevatedSchtasks(
        params string[] arguments)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = Path.Combine(
                Environment.SystemDirectory,
                "schtasks.exe"),
            UseShellExecute = true,
            Verb = "runas",
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        foreach (var argument in arguments)
            startInfo.ArgumentList.Add(argument);

        try
        {
            using var process = Process.Start(startInfo)
                ?? throw new InvalidOperationException(
                    "Windows did not start the startup-task installer.");
            process.WaitForExit();
            if (process.ExitCode != 0)
                throw new InvalidOperationException(
                    $"Windows rejected the RedLeaf startup task (exit code {process.ExitCode}).");
        }
        catch (Win32Exception error)
            when (error.NativeErrorCode == 1223)
        {
            throw new InvalidOperationException(
                "The Windows administrator approval was cancelled.",
                error);
        }
    }

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
    string? LogonType);

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
