#if WINDOWS
using System.Drawing;
using System.Drawing.Drawing2D;

namespace RedBamboo.AppHost.Tray;

public static class TrayIcons
{
    public static void SimpleTerminal(Graphics g, int size)
    {
        float s = size / 32f;
        using var pen = new Pen(Color.White, 2.5f * s) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        g.DrawLine(pen, 8 * s, 11 * s, 14 * s, 16 * s);
        g.DrawLine(pen, 8 * s, 21 * s, 14 * s, 16 * s);
        g.DrawLine(pen, 17 * s, 21 * s, 24 * s, 21 * s);
    }

    public static void Terminal(Graphics g, int size)
    {
        using var path = BuildFaTerminalPath(size);
        using var brush = new SolidBrush(Color.White);
        g.FillPath(brush, path);
    }

    public static void Microchip(Graphics g, int size)
    {
        using var path = BuildFaMicrochipPath(size);
        using var brush = new SolidBrush(Color.White);
        g.FillPath(brush, path);
    }

    public static void Flame(Graphics g, int size)
    {
        using var path = BuildFlamePath(size);
        using var brush = new SolidBrush(Color.White);
        g.FillPath(brush, path);
    }

    public static void Star(Graphics g, int size)
    {
        using var path = BuildStarPath(size);
        using var brush = new SolidBrush(Color.White);
        g.FillPath(brush, path);
    }

    public static void Leaf(Graphics g, int size)
    {
        using var path = BuildLeafPath(size);
        using var brush = new SolidBrush(Color.White);
        g.FillPath(brush, path);
    }

    private static GraphicsPath BuildFaTerminalPath(int size)
    {
        var path = new GraphicsPath(FillMode.Winding);

        path.AddBezier(71f, 159f, 61.6f, 168.4f, 61.6f, 183.6f, 71f, 192.9f);
        path.AddLine(71f, 192.9f, 134f, 255.9f);
        path.AddLine(134f, 255.9f, 71f, 318.9f);
        path.AddBezier(71f, 318.9f, 61.6f, 328.3f, 61.6f, 343.5f, 71f, 352.8f);
        path.AddBezier(71f, 352.8f, 80.4f, 362.1f, 95.6f, 362.2f, 104.9f, 352.8f);
        path.AddLine(104.9f, 352.8f, 184.9f, 272.8f);
        path.AddBezier(184.9f, 272.8f, 194.3f, 263.4f, 194.3f, 248.2f, 184.9f, 238.9f);
        path.AddLine(184.9f, 238.9f, 104.9f, 158.9f);
        path.AddBezier(104.9f, 158.9f, 95.5f, 149.5f, 80.3f, 149.5f, 71f, 158.9f);
        path.CloseFigure();

        path.StartFigure();
        path.AddBezier(216f, 336f, 202.7f, 336f, 192f, 346.7f, 192f, 360f);
        path.AddBezier(192f, 360f, 192f, 373.3f, 202.7f, 384f, 216f, 384f);
        path.AddLine(216f, 384f, 360f, 384f);
        path.AddBezier(360f, 384f, 373.3f, 384f, 384f, 373.3f, 384f, 360f);
        path.AddBezier(384f, 360f, 384f, 346.7f, 373.3f, 336f, 360f, 336f);
        path.AddLine(360f, 336f, 216f, 336f);
        path.CloseFigure();

        using var matrix = new Matrix();
        matrix.Translate(-222.5f, -266.5f, MatrixOrder.Append);
        matrix.Scale(1.25f, 1.25f, MatrixOrder.Append);
        matrix.Translate(256f, 256f, MatrixOrder.Append);
        matrix.Scale(size / 512f, size / 512f, MatrixOrder.Append);
        path.Transform(matrix);

        return path;
    }

    private static GraphicsPath BuildFaMicrochipPath(int size)
    {
        var path = new GraphicsPath(FillMode.Winding);

        // Outer chip body with pins
        path.AddArc(128, 0, 48, 48, 0, -180);
        path.AddLine(128, 24, 128, 64);
        path.AddArc(64, 64, 128, 128, 270, -90);
        path.AddLine(64, 128, 24, 128);
        path.AddArc(0, 128, 48, 48, 270, -180);
        path.AddLine(24, 176, 64, 176);
        path.AddLine(64, 176, 64, 232);
        path.AddLine(64, 232, 24, 232);
        path.AddArc(0, 232, 48, 48, 270, -180);
        path.AddLine(24, 280, 64, 280);
        path.AddLine(64, 280, 64, 336);
        path.AddLine(64, 336, 24, 336);
        path.AddArc(0, 336, 48, 48, 270, -180);
        path.AddLine(24, 384, 64, 384);
        path.AddArc(64, 320, 128, 128, 180, -90);
        path.AddLine(128, 448, 128, 488);
        path.AddArc(128, 464, 48, 48, 180, -180);
        path.AddLine(176, 488, 176, 448);
        path.AddLine(176, 448, 232, 448);
        path.AddLine(232, 448, 232, 488);
        path.AddArc(232, 464, 48, 48, 180, -180);
        path.AddLine(280, 488, 280, 448);
        path.AddLine(280, 448, 336, 448);
        path.AddLine(336, 448, 336, 488);
        path.AddArc(336, 464, 48, 48, 180, -180);
        path.AddLine(384, 488, 384, 448);
        path.AddArc(320, 320, 128, 128, 90, -90);
        path.AddLine(448, 384, 488, 384);
        path.AddArc(464, 336, 48, 48, 90, -180);
        path.AddLine(488, 336, 448, 336);
        path.AddLine(448, 336, 448, 280);
        path.AddLine(448, 280, 488, 280);
        path.AddArc(464, 232, 48, 48, 90, -180);
        path.AddLine(488, 232, 448, 232);
        path.AddLine(448, 232, 448, 176);
        path.AddLine(448, 176, 488, 176);
        path.AddArc(464, 128, 48, 48, 90, -180);
        path.AddLine(488, 128, 448, 128);
        path.AddArc(320, 64, 128, 128, 0, -90);
        path.AddLine(384, 64, 384, 24);
        path.AddArc(336, 0, 48, 48, 0, -180);
        path.AddLine(336, 24, 336, 64);
        path.AddLine(336, 64, 280, 64);
        path.AddLine(280, 64, 280, 24);
        path.AddArc(232, 0, 48, 48, 0, -180);
        path.AddLine(232, 24, 232, 64);
        path.AddLine(232, 64, 176, 64);
        path.AddLine(176, 64, 176, 24);
        path.CloseFigure();

        // Inner rounded rectangle
        path.StartFigure();
        path.AddLine(160, 128, 352, 128);
        path.AddArc(320, 128, 64, 64, 270, 90);
        path.AddLine(384, 160, 384, 352);
        path.AddArc(320, 320, 64, 64, 0, 90);
        path.AddLine(352, 384, 160, 384);
        path.AddArc(128, 320, 64, 64, 90, 90);
        path.AddLine(128, 352, 128, 160);
        path.AddArc(128, 128, 64, 64, 180, 90);
        path.CloseFigure();

        // Inner square
        path.StartFigure();
        path.AddLine(176, 176, 176, 336);
        path.AddLine(176, 336, 336, 336);
        path.AddLine(336, 336, 336, 176);
        path.AddLine(336, 176, 176, 176);
        path.CloseFigure();

        using var matrix = new Matrix();
        matrix.Translate(-256f, -256f, MatrixOrder.Append);
        matrix.Scale(0.75f, 0.75f, MatrixOrder.Append);
        matrix.Translate(256f, 256f, MatrixOrder.Append);
        matrix.Scale(size / 512f, size / 512f, MatrixOrder.Append);
        path.Transform(matrix);

        return path;
    }

    private static GraphicsPath BuildFlamePath(int size)
    {
        var path = new GraphicsPath(FillMode.Winding);

        // Flame shape from favicon.svg (24x24 viewBox)
        path.AddArc(6f, 9.5f, 5f, 5f, 90f, -90f);
        path.AddBezier(11f, 12f, 11f, 10.62f, 10.5f, 10f, 10f, 9f);
        path.AddBezier(10f, 9f, 8.928f, 6.857f, 9.776f, 4.946f, 12f, 3f);
        path.AddBezier(12f, 3f, 12.5f, 5.5f, 14f, 7.9f, 16f, 9.5f);
        path.AddBezier(16f, 9.5f, 18f, 11.1f, 19f, 13f, 19f, 15f);
        path.AddArc(5f, 8f, 14f, 14f, 0f, 180f);
        path.AddBezier(5f, 15f, 5f, 13.847f, 5.433f, 12.706f, 6f, 12f);
        path.AddArc(6f, 9.5f, 5f, 5f, 180f, -90f);
        path.CloseFigure();

        using var matrix = new Matrix();
        matrix.Scale(size / 24f, size / 24f);
        path.Transform(matrix);

        return path;
    }
    private static GraphicsPath BuildLeafPath(int size)
    {
        var path = new GraphicsPath(FillMode.Winding);

        path.AddBezier(471.3f, 6.7f, 477.7f, 0.6f, 487f, -1.6f, 495.6f, 1.2f);
        path.AddBezier(495.6f, 1.2f, 505.4f, 4.5f, 512f, 13.7f, 512f, 24f);
        path.AddLine(512f, 24f, 512f, 210.9f);
        path.AddBezier(512f, 210.9f, 512f, 342.1f, 403.9f, 448f, 273.2f, 448f);
        path.AddBezier(273.2f, 448f, 196.2f, 448f, 129.8f, 398.5f, 105.7f, 329.3f);
        path.AddBezier(105.7f, 329.3f, 70.3f, 360.1f, 48f, 405.4f, 48f, 456f);
        path.AddBezier(48f, 456f, 48f, 469.3f, 37.3f, 480f, 24f, 480f);
        path.AddBezier(24f, 480f, 10.7f, 480f, 0f, 469.3f, 0f, 456f);
        path.AddBezier(0f, 456f, 0f, 381.1f, 38.2f, 315.1f, 96.1f, 276.3f);
        path.AddBezier(96.1f, 276.3f, 131.4f, 252.7f, 173.5f, 240f, 216f, 240f);
        path.AddLine(216f, 240f, 296f, 240f);
        path.AddBezier(296f, 240f, 309.3f, 240f, 320f, 229.3f, 320f, 216f);
        path.AddBezier(320f, 216f, 320f, 202.7f, 309.3f, 192f, 296f, 192f);
        path.AddLine(296f, 192f, 216f, 192f);
        path.AddBezier(216f, 192f, 176.3f, 192f, 138.7f, 200.8f, 105f, 216.5f);
        path.AddBezier(105f, 216.5f, 128.3f, 146.5f, 194.2f, 96f, 272f, 96f);
        path.AddBezier(272f, 96f, 338.4f, 96f, 387.8f, 73.9f, 420.7f, 52f);
        path.AddBezier(420.7f, 52f, 439.9f, 39.2f, 456.2f, 23.9f, 471.4f, 6.7f);
        path.CloseFigure();

        using var matrix = new Matrix();
        matrix.Translate(-256f, -256f, MatrixOrder.Append);
        matrix.Scale(0.75f, 0.75f, MatrixOrder.Append);
        matrix.Translate(256f, 256f, MatrixOrder.Append);
        matrix.Scale(size / 512f, size / 512f, MatrixOrder.Append);
        path.Transform(matrix);

        return path;
    }

    private static GraphicsPath BuildStarPath(int size)
    {
        var path = new GraphicsPath(FillMode.Winding);

        // 5-pointed star centered at (256, 256) in a 512x512 viewBox
        float cx = 256f, cy = 256f, outer = 220f, inner = 90f;
        var pts = new PointF[10];
        for (int i = 0; i < 10; i++)
        {
            double angle = Math.PI / 2 + i * Math.PI / 5;
            float r = i % 2 == 0 ? outer : inner;
            pts[i] = new PointF(
                cx + r * (float)Math.Cos(angle),
                cy - r * (float)Math.Sin(angle));
        }
        path.AddPolygon(pts);

        using var matrix = new Matrix();
        matrix.Scale(size / 512f, size / 512f);
        path.Transform(matrix);

        return path;
    }
}
#endif
