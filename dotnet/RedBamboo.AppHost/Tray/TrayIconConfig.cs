#if WINDOWS
using System.Drawing;

namespace RedBamboo.AppHost.Tray;

public class TrayIconConfig
{
    public required string AppName { get; init; }
    public required int Port { get; init; }
    public required Func<Icon> LoadIcon { get; init; }
    public Func<Task<IReadOnlyList<string>>>? GetStatusLines { get; init; }
    public Action? OnExit { get; init; }
}
#endif
