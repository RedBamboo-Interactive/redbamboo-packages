#if WINDOWS
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace RedBamboo.AppHost.Startup;

public static class AutoStartEndpoints
{
    public static void MapAutoStartEndpoints(this WebApplication app, string appName)
    {
        app.MapGet("/api/autostart", () =>
            Results.Ok(new { enabled = StartupManager.IsEnabled(appName) }));

        app.MapPut("/api/autostart", async (HttpContext ctx) =>
        {
            var body = await ctx.Request.ReadFromJsonAsync<AutoStartRequest>();
            if (body is null)
                return Results.BadRequest(new { error = "invalid_body" });

            StartupManager.SetEnabled(appName, body.Enabled);
            return Results.Ok(new { enabled = StartupManager.IsEnabled(appName) });
        });
    }

    private record AutoStartRequest(bool Enabled);
}
#endif
