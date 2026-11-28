using RedBamboo.AppHost.Telemetry.FlightRecorder;

namespace RedBamboo.AppHost.Telemetry;

public class TelemetryOptions
{
    public required string AppName { get; set; }
    public int RetentionDays { get; set; } = 30;
    public string? DbPath { get; set; }
    public List<string> ExcludePathPrefixes { get; set; } = ["/ws"];
    public bool ExcludeStaticFiles { get; set; } = true;

    /// <summary>
    /// Open a <see cref="RequestDbTiming"/> per tracked request and store its sum as <c>db_ms</c> /
    /// <c>db_count</c>, with <c>db;dur=</c> in Server-Timing. Only useful when the host's database
    /// layer reports to it (RedLeaf: its EF Core interceptor), so off unless the host turns it on.
    /// </summary>
    public bool RecordDatabaseTime { get; set; }

    /// <summary>Process samples written beside the request rows (see <see cref="FlightRecorderOptions"/>).</summary>
    public FlightRecorderOptions FlightRecorder { get; set; } = new();
}
