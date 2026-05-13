namespace RedBamboo.AppHost.Logging;

public class LogServiceOptions
{
    public required string Source { get; set; }
    public int BufferCapacity { get; set; } = 4096;
    public ILogPersistence? Persistence { get; set; }
    public ILogEntryParser? Parser { get; set; }
}
