#if WINDOWS
using System.Drawing;

namespace RedBamboo.AppHost.Tray;

public class TrayIconConfig
{
    public required string AppName { get; init; }
    public required int Port { get; init; }
    public required Func<Icon> LoadIcon { get; init; }
    public bool EnableAutoStartToggle { get; init; }
    public string? RebuildScript { get; init; }
    public Func<Task<IReadOnlyList<string>>>? GetStatusLines { get; init; }

    /// <summary>Header of the optional submenu (e.g. "Apps"). Used when <see cref="GetSubMenuEntries"/> is set.</summary>
    public string? SubMenuHeader { get; init; }

    /// <summary>Entries of the optional submenu, re-fetched every time the menu opens.</summary>
    public Func<Task<IReadOnlyList<TrayMenuEntry>>>? GetSubMenuEntries { get; init; }

    public Action? OnExit { get; init; }
}

/// <summary>One entry of the optional tray submenu. A null <see cref="Activate"/> renders a non-clickable line.</summary>
public sealed record TrayMenuEntry(string Label, Action? Activate = null);
#endif
