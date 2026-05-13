namespace RedBamboo.AppHost.Logging;

public enum LogLevel
{
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3,
    Critical = 4,
}

public static class LogLevelExtensions
{
    public static string ToWireString(this LogLevel level) => level switch
    {
        LogLevel.Debug => "debug",
        LogLevel.Info => "info",
        LogLevel.Warn => "warn",
        LogLevel.Error => "error",
        LogLevel.Critical => "critical",
        _ => "info",
    };

    public static LogLevel FromString(string? value) => value?.ToLowerInvariant() switch
    {
        "debug" => LogLevel.Debug,
        "info" => LogLevel.Info,
        "warn" or "warning" => LogLevel.Warn,
        "error" or "err" => LogLevel.Error,
        "critical" or "fatal" => LogLevel.Critical,
        _ => LogLevel.Info,
    };
}
