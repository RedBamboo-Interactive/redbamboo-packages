#if WINDOWS
using Microsoft.Win32;

namespace RedBamboo.AppHost.Startup;

public static class StartupManager
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ApprovalKey = @"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

    public static bool IsEnabled(string appName)
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey, false);
        return key?.GetValue(appName) != null;
    }

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

            using var key = Registry.CurrentUser.OpenSubKey(RunKey, false);
            var rawValue = key?.GetValue(appName, null,
                RegistryValueOptions.DoNotExpandEnvironmentNames);
            if (rawValue is not null and not string)
                return new(false, true, false, "invalid_value",
                    "The Windows startup entry has an invalid value and must be repaired.");
            var registered = rawValue as string;
            return Evaluate(registered, command.ToRegistryValue(),
                File.Exists(command.ExecutablePath), GetWindowsApproval(appName));
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
        if (enabled)
        {
            launchCommand ??= Environment.ProcessPath is { } processPath
                ? new StartupLaunchCommand(processPath, [])
                : null;
            if (launchCommand is null)
                throw new InvalidOperationException("RedLeaf could not resolve its startup executable.");
            if (!File.Exists(launchCommand.ExecutablePath))
                throw new FileNotFoundException("The RedLeaf startup launcher is missing.", launchCommand.ExecutablePath);
            using var key = Registry.CurrentUser.CreateSubKey(RunKey, true)
                ?? throw new InvalidOperationException("Windows did not allow RedLeaf to create its startup registration.");
            key.SetValue(appName, launchCommand.ToRegistryValue(), RegistryValueKind.String);
            ClearWindowsDisable(appName);
        }
        else
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey, true);
            key?.DeleteValue(appName, throwOnMissingValue: false);
        }

        var status = GetStatus(appName, launchCommand);
        if (enabled && !status.Enabled) throw new InvalidOperationException(status.Message);
        if (!enabled && status.State != "disabled")
            throw new InvalidOperationException(status.Message);
        return status;
    }

    internal static StartupRegistrationStatus Evaluate(
        string? registered, string expected, bool executableExists, bool? windowsApproved)
    {
        if (string.IsNullOrWhiteSpace(registered))
            return new(false, false, false, "disabled", "RedLeaf will not start automatically when you sign in.");
        if (windowsApproved is false)
            return new(false, true, false, "disabled_by_windows", "Windows disabled the RedLeaf startup entry. Turn this setting on again to repair it.");
        if (windowsApproved is null)
            return new(false, true, false, "approval_unknown", "Windows returned an unknown approval state for the RedLeaf startup entry.");
        if (!executableExists)
            return new(false, true, false, "executable_missing", "The registered RedLeaf startup launcher is missing.");
        if (!registered.Equals(expected, StringComparison.OrdinalIgnoreCase))
            return new(false, true, false, "command_mismatch", "The Windows startup entry points to an outdated RedLeaf launcher.");
        return new(true, true, true, "ready", "Windows startup registration is verified for the next sign-in.");
    }

    private static bool? GetWindowsApproval(string appName)
    {
        using var key = Registry.CurrentUser.OpenSubKey(ApprovalKey, false);
        var value = key?.GetValue(appName, null,
            RegistryValueOptions.DoNotExpandEnvironmentNames);
        return EvaluateWindowsApproval(value);
    }

    internal static bool? EvaluateWindowsApproval(object? value)
    {
        if (value is null) return true;
        if (value is not byte[] { Length: > 0 } bytes) return null;
        return bytes[0] switch
        {
            2 or 6 or 8 => true,
            1 or 3 or 7 or 9 => false,
            _ => null,
        };
    }

    private static void ClearWindowsDisable(string appName)
    {
        using var key = Registry.CurrentUser.OpenSubKey(ApprovalKey, true);
        if (key?.GetValue(appName, null, RegistryValueOptions.DoNotExpandEnvironmentNames)
                is byte[] { Length: > 0 } value && value[0] is 1 or 3 or 7 or 9)
            key.DeleteValue(appName, throwOnMissingValue: false);
    }
}

public sealed record StartupRegistrationStatus(
    bool Enabled, bool Registered, bool Verified, string State, string Message)
{
    public static StartupRegistrationStatus Unavailable(string message)
        => new(false, false, false, "unavailable", message);
}
#endif
