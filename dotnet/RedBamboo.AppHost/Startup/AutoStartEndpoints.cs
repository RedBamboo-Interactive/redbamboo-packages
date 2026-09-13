#if WINDOWS
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace RedBamboo.AppHost.Startup;

public static class AutoStartEndpoints
{
    public static void MapAutoStartEndpoints(
        this WebApplication app,
        string appName,
        StartupLaunchCommand? launchCommand = null)
    {
        app.MapGet("/api/autostart", () =>
            Results.Ok(StartupManager.GetStatus(appName, launchCommand)));

        app.MapPut("/api/autostart", async (HttpContext ctx) =>
        {
            var body = await ctx.Request.ReadFromJsonAsync<AutoStartRequest>();
            if (body is null)
                return Results.BadRequest(new { error = "invalid_body" });

            try
            {
                return Results.Ok(StartupManager.SetEnabled(appName, body.Enabled, launchCommand));
            }
            catch (Exception error)
            {
                return Results.Json(new
                {
                    error = "autostart_setup_failed",
                    message = error.Message,
                    status = StartupManager.GetStatus(appName, launchCommand),
                }, statusCode: StatusCodes.Status500InternalServerError);
            }
        });
    }

    private record AutoStartRequest(bool Enabled);
}
#endif
