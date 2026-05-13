namespace RedBamboo.AppHost.Logging;

public interface ILogEntryParser
{
    ParsedLogFields Parse(string rawMessage);
}

public record ParsedLogFields(
    string? Tag = null,
    string? TagColor = null,
    string? Category = null,
    LogLevel? Level = null);
