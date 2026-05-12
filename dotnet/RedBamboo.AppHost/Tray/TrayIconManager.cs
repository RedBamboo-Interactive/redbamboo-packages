#if WINDOWS
using System.Diagnostics;
using System.Drawing;
using System.Windows;
using H.NotifyIcon;
using H.NotifyIcon.Core;

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

        foreach (System.Windows.Controls.MenuItem item in menu.Items.OfType<System.Windows.Controls.MenuItem>())
        {
            if (item.Tag?.ToString() == "status")
            {
                item.Header = header;
                break;
            }
        }
    }

    public void Dispose()
    {
        _trayIcon?.Dispose();
    }
}
#endif
