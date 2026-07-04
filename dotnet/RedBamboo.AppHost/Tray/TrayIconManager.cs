#if WINDOWS
using System.Diagnostics;
using System.Drawing;
using System.Windows;
using H.NotifyIcon;
using H.NotifyIcon.Core;
using RedBamboo.AppHost.Startup;

namespace RedBamboo.AppHost.Tray;

public class TrayIconManager : IDisposable
{
    private TaskbarIcon? _trayIcon;
    private readonly TrayIconConfig _config;

    public TrayIconManager(TrayIconConfig config)
    {
        _config = config;
    }

    public void Initialize()
    {
        _trayIcon = new TaskbarIcon
        {
            ToolTipText = _config.AppName,
            Icon = _config.LoadIcon(),
            ContextMenu = BuildContextMenu(),
            MenuActivation = PopupActivationMode.RightClick,
        };
        _trayIcon.ForceCreate();
        _trayIcon.TrayMouseDoubleClick += (_, _) => OpenDashboard();
    }

    public void UpdateIcon(Icon newIcon)
    {
        if (_trayIcon == null) return;
        try
        {
            var oldIcon = _trayIcon.Icon;
            _trayIcon.Icon = newIcon;
            oldIcon?.Dispose();
        }
        catch { }
    }

    private void OpenDashboard()
    {
        Process.Start(new ProcessStartInfo($"http://localhost:{_config.Port}") { UseShellExecute = true });
    }

    private System.Windows.Controls.ContextMenu BuildContextMenu()
    {
        var menu = new System.Windows.Controls.ContextMenu();

        var openItem = new System.Windows.Controls.MenuItem { Header = $"Open {_config.AppName}" };
        openItem.Click += (_, _) => OpenDashboard();
        menu.Items.Add(openItem);

        menu.Items.Add(new System.Windows.Controls.Separator());

        var statusItem = new System.Windows.Controls.MenuItem
        {
            Header = "Status: checking...",
            IsEnabled = false,
            Tag = "status",
        };
        menu.Items.Add(statusItem);

        if (_config.GetSubMenuEntries != null)
        {
            menu.Items.Add(new System.Windows.Controls.MenuItem
            {
                Header = _config.SubMenuHeader ?? "Apps",
                Tag = "submenu",
            });
        }

        if (_config.EnableAutoStartToggle)
        {
            menu.Items.Add(new System.Windows.Controls.Separator());

            var autoStartItem = new System.Windows.Controls.MenuItem
            {
                Header = "Start with Windows",
                IsCheckable = true,
                Tag = "autostart",
            };
            autoStartItem.Click += (_, _) =>
            {
                StartupManager.SetEnabled(_config.AppName, autoStartItem.IsChecked);
            };
            menu.Items.Add(autoStartItem);
        }

        if (_config.RebuildScript != null)
        {
            menu.Items.Add(new System.Windows.Controls.Separator());

            var restartItem = new System.Windows.Controls.MenuItem { Header = "Restart" };
            restartItem.Click += (_, _) =>
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = $"-NoProfile -ExecutionPolicy Bypass -File \"{_config.RebuildScript}\"",
                    UseShellExecute = true,
                });
            };
            menu.Items.Add(restartItem);
        }

        menu.Items.Add(new System.Windows.Controls.Separator());

        var exitItem = new System.Windows.Controls.MenuItem { Header = "Exit" };
        exitItem.Click += (_, _) =>
        {
            _trayIcon?.Dispose();
            if (_config.OnExit != null)
                _config.OnExit();
            else
                Application.Current.Shutdown();
        };
        menu.Items.Add(exitItem);

        menu.Opened += async (_, _) => await RefreshMenuStatus(menu);

        return menu;
    }

    private async Task RefreshMenuStatus(System.Windows.Controls.ContextMenu menu)
    {
        string header;
        if (_config.GetStatusLines != null)
        {
            var lines = await _config.GetStatusLines();
            header = lines.Count > 0 ? string.Join("\n", lines) : "No status";
        }
        else
        {
            header = "Running";
        }

        IReadOnlyList<TrayMenuEntry>? subMenuEntries = null;
        if (_config.GetSubMenuEntries != null)
            subMenuEntries = await _config.GetSubMenuEntries();

        foreach (System.Windows.Controls.MenuItem item in menu.Items.OfType<System.Windows.Controls.MenuItem>())
        {
            if (item.Tag?.ToString() == "status")
                item.Header = header;
            else if (item.Tag?.ToString() == "autostart")
                item.IsChecked = StartupManager.IsEnabled(_config.AppName);
            else if (item.Tag?.ToString() == "submenu" && subMenuEntries != null)
                RebuildSubMenu(item, subMenuEntries);
        }
    }

    private static void RebuildSubMenu(System.Windows.Controls.MenuItem parent, IReadOnlyList<TrayMenuEntry> entries)
    {
        parent.Items.Clear();

        if (entries.Count == 0)
        {
            parent.Items.Add(new System.Windows.Controls.MenuItem { Header = "None", IsEnabled = false });
            return;
        }

        foreach (var entry in entries)
        {
            var child = new System.Windows.Controls.MenuItem
            {
                Header = entry.Label,
                IsEnabled = entry.Activate != null,
            };
            if (entry.Activate is { } activate)
                child.Click += (_, _) => activate();
            parent.Items.Add(child);
        }
    }

    public void Dispose()
    {
        _trayIcon?.Dispose();
    }
}
#endif
