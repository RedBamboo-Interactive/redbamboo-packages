namespace RedBamboo.AppHost.Watchers;

public sealed class EntityWatcherOptions
{
    public TimeSpan InitialBackoff { get; init; } = TimeSpan.FromSeconds(2);
    public TimeSpan MaxBackoff { get; init; } = TimeSpan.FromSeconds(60);
    public double BackoffMultiplier { get; init; } = 2.0;
    public string LogCategory { get; init; } = "entity-watcher";
}
