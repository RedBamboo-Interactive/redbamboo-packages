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

        // Phosphor "leaf-bold" (@phosphor-icons/web 2.1.2, MIT).
        path.StartFigure();
        var p = new PointF(909.68f, 159.44f);
        path.AddBezier(p, new PointF(908.217f, 135.132f), new PointF(888.868f, 115.783f), p = new PointF(864.693f, 114.326f));
        path.AddLine(p, p = new PointF(864.56f, 114.32f));
        path.AddBezier(p, new PointF(706.16f, 105f), new PointF(566.2f, 123.68f), p = new PointF(448.56f, 169.8f));
        path.AddBezier(p, new PointF(336f, 213.92f), new PointF(249.24f, 282.32f), p = new PointF(197.56f, 367.6f));
        path.AddBezier(p, new PointF(127.08f, 484.04f), new PointF(126.92f, 625.4f), p = new PointF(195.76f, 760.36f));
        path.AddLine(p, p = new PointF(126.04f, 830.08f));
        path.AddBezier(p, new PointF(117.339f, 838.781f), new PointF(111.957f, 850.802f), p = new PointF(111.957f, 864.08f));
        path.AddBezier(p, new PointF(111.957f, 890.636f), new PointF(133.485f, 912.163f), p = new PointF(160.04f, 912.163f));
        path.AddBezier(p, new PointF(173.318f, 912.163f), new PointF(185.339f, 906.781f), p = new PointF(194.04f, 898.08f));
        path.AddLine(p, p = new PointF(263.76f, 828.36f));
        path.AddBezier(p, new PointF(330.72f, 862.52f), new PointF(399.28f, 879.76f), p = new PointF(465.56f, 879.76f));
        path.AddBezier(p, new PointF(465.898f, 879.761f), new PointF(466.298f, 879.762f), p = new PointF(466.698f, 879.762f));
        path.AddBezier(p, new PointF(536.881f, 879.762f), new PointF(602.44f, 859.967f), p = new PointF(658.097f, 825.656f));
        path.AddLine(p, p = new PointF(656.52f, 826.561f));
        path.AddBezier(p, new PointF(741.8f, 774.881f), new PointF(810.2f, 688.081f), p = new PointF(854.32f, 575.561f));
        path.AddBezier(p, new PointF(900.32f, 457.841f), new PointF(919f, 317.841f), p = new PointF(909.68f, 159.441f));
        path.CloseFigure();

        path.StartFigure();
        p = new PointF(606.64f, 744.32f);
        path.AddBezier(p, new PointF(526.28f, 793f), new PointF(432f, 796.68f), p = new PointF(335.76f, 756f));
        path.AddLine(p, p = new PointF(673.92f, 417.84f));
        path.AddBezier(p, new PointF(682.621f, 409.139f), new PointF(688.003f, 397.118f), p = new PointF(688.003f, 383.84f));
        path.AddBezier(p, new PointF(688.003f, 357.284f), new PointF(666.475f, 335.757f), p = new PointF(639.92f, 335.757f));
        path.AddBezier(p, new PointF(626.642f, 335.757f), new PointF(614.621f, 341.139f), p = new PointF(605.92f, 349.84f));
        path.AddLine(p, p = new PointF(268f, 688.24f));
        path.AddBezier(p, new PointF(227.44f, 592.24f), new PointF(231.12f, 497.72f), p = new PointF(280f, 417.36f));
        path.AddBezier(p, new PointF(363.64f, 279.24f), new PointF(562.16f, 202.48f), p = new PointF(816f, 208.36f));
        path.AddBezier(p, new PointF(821.52f, 462.12f), new PointF(744.76f, 660.68f), p = new PointF(606.64f, 744.32f));
        path.CloseFigure();

        using var matrix = new Matrix();
        matrix.Translate(-512f, -512f, MatrixOrder.Append);
        matrix.Scale(0.42f, 0.42f, MatrixOrder.Append);
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
