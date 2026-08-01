#if WINDOWS
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace RedBamboo.AppHost.Tray;

public static class IconHelper
{
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr hIcon);

    public static Icon CreateTrayIcon(Color bgColor, Action<Graphics, int> drawForeground, int size = 32)
    {
        using var bmp = new Bitmap(size, size);
        using var g = Graphics.FromImage(bmp);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.Clear(Color.Transparent);

        float r = size * 6.4f / 32f;
        using var bgBrush = new SolidBrush(bgColor);
        using var bgPath = RoundedRect(new RectangleF(0, 0, size, size), r);
        g.FillPath(bgBrush, bgPath);

        drawForeground(g, size);

        var hIcon = bmp.GetHicon();
        try
        {
            return (Icon)Icon.FromHandle(hIcon).Clone();
        }
        finally
        {
            DestroyIcon(hIcon);
        }
    }

    public static Icon CreateTrayIcon(Color mainColor, int size = 32)
    {
        return CreateTrayIcon(mainColor, TrayIcons.SimpleTerminal, size);
    }

    private static GraphicsPath RoundedRect(RectangleF rect, float radius)
    {
        var path = new GraphicsPath();
        float d = radius * 2;
        path.AddArc(rect.X, rect.Y, d, d, 180, 90);
        path.AddArc(rect.Right - d, rect.Y, d, d, 270, 90);
        path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
        path.AddArc(rect.X, rect.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }
}

public static class StatusColors
{
    public static Color Gray => Color.FromArgb(0x72, 0x76, 0x7D);
    public static Color Red => Color.FromArgb(0xE5, 0x5B, 0x5B);
    public static Color Foundation => Color.FromArgb(0x4A, 0x9D, 0x5B);
    public static Color Technology => Color.FromArgb(0x5B, 0x8B, 0xC4);
    public static Color Life => Color.FromArgb(0xC9, 0x94, 0x4A);
    public static Color Imagination => Color.FromArgb(0x7C, 0x4D, 0xFF);
    public static Color Presence => Color.FromArgb(0xC7, 0x4B, 0x7A);
}
#endif
