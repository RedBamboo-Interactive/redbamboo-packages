#if WINDOWS
using Microsoft.Win32;

namespace RedBamboo.AppHost.Startup;

public static class StartupManager
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

    public static bool IsEnabled(string appName)
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey, false);
        return key?.GetValue(appName) != null;
    }

    public static void SetEnabled(string appName, bool enabled)
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey, true);
        if (key == null) return;

        if (enabled)
        {
            var exePath = Environment.ProcessPath;
            if (exePath != null)
                key.SetValue(appName, exePath);
        }
        else
        {
            key.DeleteValue(appName, throwOnMissingValue: false);
        }
    }
}
#endif
