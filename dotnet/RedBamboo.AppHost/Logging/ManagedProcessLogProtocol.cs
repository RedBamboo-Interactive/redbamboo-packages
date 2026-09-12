using System.Text.Json;
using Microsoft.Extensions.Logging;
using AppHostLogLevel = RedBamboo.AppHost.Logging.LogLevel;
using MicrosoftLogLevel = Microsoft.Extensions.Logging.LogLevel;

namespace RedBamboo.AppHost.Logging;

/// <summary>
/// A one-line, versioned envelope for logs written by a managed child process.
/// The prefix lets the parent distinguish structured records from arbitrary stdout.
/// </summary>
public static class ManagedProcessLogProtocol
{
    public const string Prefix = "@redbamboo-log:v1@";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static string Serialize(ManagedProcessLogRecord record)
        => Prefix + JsonSerializer.Serialize(record, JsonOptions);

    public static void Write(ManagedProcessLogRecord record)
        => Console.Out.WriteLine(Serialize(record));

    public static bool TryParse(string? line, out ManagedProcessLogRecord record)
    {
        record = default!;
        if (string.IsNullOrEmpty(line) || !line.StartsWith(Prefix, StringComparison.Ordinal))
            return false;

        try
        {
            var parsed = JsonSerializer.Deserialize<ManagedProcessLogRecord>(
                line.AsSpan(Prefix.Length), JsonOptions);
            if (parsed is null
                || string.IsNullOrWhiteSpace(parsed.Category)
                || parsed.Message is null)
                return false;
            record = parsed;
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    internal static AppHostLogLevel FromMicrosoftLevel(MicrosoftLogLevel level) => level switch
    {
        MicrosoftLogLevel.Trace or MicrosoftLogLevel.Debug => AppHostLogLevel.Debug,
        MicrosoftLogLevel.Information => AppHostLogLevel.Info,
        MicrosoftLogLevel.Warning => AppHostLogLevel.Warn,
        MicrosoftLogLevel.Error => AppHostLogLevel.Error,
        MicrosoftLogLevel.Critical => AppHostLogLevel.Critical,
        _ => AppHostLogLevel.Info,
    };
}

public sealed record ManagedProcessLogRecord(
    AppHostLogLevel Level,
    string Category,
    string Message,
    string? FullMessage = null,
    string? StackTrace = null,
    string? CorrelationId = null,
    string? JobId = null,
    string? InstanceId = null,
    string? Tag = null,
    string? TagColor = null,
    int? EventId = null,
    string? EventName = null);

/// <summary>Writes Microsoft.Extensions.Logging events through the managed-process envelope.</summary>
public sealed class ManagedProcessConsoleLoggerProvider : ILoggerProvider
{
    public ILogger CreateLogger(string categoryName) => new ManagedProcessConsoleLogger(categoryName);

    public void Dispose() { }

    private sealed class ManagedProcessConsoleLogger(string category) : ILogger
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
            if (!IsEnabled(logLevel)) return;
            var message = formatter(state, exception);
            ManagedProcessLogProtocol.Write(new ManagedProcessLogRecord(
                ManagedProcessLogProtocol.FromMicrosoftLevel(logLevel),
                category,
                message,
                FullMessage: exception is null ? null : message,
                StackTrace: exception?.ToString(),
                EventId: eventId.Id,
                EventName: eventId.Name));
        }
    }
}
