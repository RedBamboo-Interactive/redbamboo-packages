namespace RedBamboo.AppHost.Telemetry;

public class TelemetryOptions
{
    public required string AppName { get; set; }
    public int RetentionDays { get; set; } = 30;
    public string? DbPath { get; set; }
    public List<string> ExcludePathPrefixes { get; set; } = ["/ws"];
    public bool ExcludeStaticFiles { get; set; } = true;
}
