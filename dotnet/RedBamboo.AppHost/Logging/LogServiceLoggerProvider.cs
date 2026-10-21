using Microsoft.Extensions.Logging;
using MicrosoftLogLevel = Microsoft.Extensions.Logging.LogLevel;

namespace RedBamboo.AppHost.Logging;

/// <summary>
/// Forwards Microsoft.Extensions.Logging events into an in-process <see cref="LogService"/>.
/// Without it, everything resolved through <c>ILogger&lt;T&gt;</c> (plugins, kernel services,
/// ASP.NET) only reaches the console provider, which a windowed host never shows, so those
/// warnings and errors never reach the log buffer, its listeners, or the log files.
/// </summary>
public sealed class LogServiceLoggerProvider(LogService logService) : ILoggerProvider
{
    // A LogService listener that itself logs through ILogger must not loop back here.
    [ThreadStatic] private static bool _forwarding;

    public ILogger CreateLogger(string categoryName) => new LogServiceLogger(logService, categoryName);

    public void Dispose() { }

    private sealed class LogServiceLogger(LogService logService, string category) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(MicrosoftLogLevel logLevel) => logLevel != MicrosoftLogLevel.None;

        public void Log<TState>(
            MicrosoftLogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel) || _forwarding) return;
            _forwarding = true;
            try
            {
                var message = formatter(state, exception);
                if (string.IsNullOrEmpty(message) && exception is not null) message = exception.Message;
                logService.Log(
                    ManagedProcessLogProtocol.FromMicrosoftLevel(logLevel),
                    category,
                    message,
                    stackTrace: exception?.ToString());
            }
            finally
            {
                _forwarding = false;
            }
        }
    }
}

public static class LogServiceLoggingBuilderExtensions
{
    /// <summary>
    /// Route <c>ILogger</c> output into <paramref name="logService"/>. Framework categories
    /// (<c>Microsoft.*</c>, <c>System.*</c>) are kept to warnings and above so request and
    /// EF Core chatter does not drown the host's own log; everything else, plugins included,
    /// is forwarded from Information.
    /// </summary>
    public static ILoggingBuilder AddLogService(this ILoggingBuilder builder, LogService logService)
    {
        builder.AddProvider(new LogServiceLoggerProvider(logService));
        builder.AddFilter<LogServiceLoggerProvider>(null, MicrosoftLogLevel.Information);
        builder.AddFilter<LogServiceLoggerProvider>("Microsoft", MicrosoftLogLevel.Warning);
        builder.AddFilter<LogServiceLoggerProvider>("System", MicrosoftLogLevel.Warning);
        return builder;
    }
}
