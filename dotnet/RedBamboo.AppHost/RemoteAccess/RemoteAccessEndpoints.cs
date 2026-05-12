using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using RedBamboo.AppHost.Tunnel;

namespace RedBamboo.AppHost.RemoteAccess;

public static class RemoteAccessEndpoints
{
    public static void MapRemoteAccessEndpoints(
        this WebApplication app,
        CloudflareTunnelService tunnelService,
        string appName,
        Func<TunnelConfig> getTunnelConfig)
    {
        var configDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            appName);

        string GetEffectiveAccessToken()
        {
            var fromConfig = getTunnelConfig().AccessToken;
            if (!string.IsNullOrEmpty(fromConfig))
                return fromConfig;
            return TokenPersistence.LoadToken(configDir) ?? "";
        }

        var group = app.MapGroup("/api/remote");

        group.MapGet("/status", () =>
        {
            var config = getTunnelConfig();
            var accessToken = GetEffectiveAccessToken();
            return Results.Ok(new
            {
                enabled = config.Enabled,
                tunnel_status = tunnelService.Status.ToString().ToLowerInvariant(),
                is_external = tunnelService.IsExternal,
                hostname = config.Hostname,
                auth_enabled = !string.IsNullOrEmpty(accessToken),
                error = tunnelService.ErrorMessage,
            });
        });

        group.MapPost("/enable", async () =>
        {
            var config = getTunnelConfig();
            var accessToken = GetEffectiveAccessToken();
            if (string.IsNullOrEmpty(accessToken))
            {
                accessToken = TokenPersistence.GenerateAccessToken();
                TokenPersistence.SaveToken(configDir, accessToken);
            }

            var started = await tunnelService.StartAsync(config);

            return Results.Ok(new
            {
                ok = true,
                tunnel_status = tunnelService.Status.ToString().ToLowerInvariant(),
                is_external = tunnelService.IsExternal,
                hostname = config.Hostname,
                access_token = accessToken,
                started,
            });
        });

        group.MapPost("/disable", async () =>
        {
            await tunnelService.StopAsync();
            return Results.Ok(new
            {
                ok = true,
                tunnel_status = tunnelService.Status.ToString().ToLowerInvariant(),
            });
        });

        group.MapGet("/share", () =>
        {
            var config = getTunnelConfig();
            var accessToken = GetEffectiveAccessToken();

            if (string.IsNullOrEmpty(config.Hostname) || string.IsNullOrEmpty(accessToken))
            {
                return Results.BadRequest(new
                {
                    error = "remote_not_configured",
                    message = "Remote access hostname and access token must be configured before sharing.",
                });
            }

            var url = $"https://{config.Hostname}?token={Uri.EscapeDataString(accessToken)}";
            return Results.Ok(new { url, hostname = config.Hostname, token = accessToken });
        });

        group.MapPut("/token", () =>
        {
            var newToken = TokenPersistence.GenerateAccessToken();
            TokenPersistence.SaveToken(configDir, newToken);
            return Results.Ok(new { ok = true, access_token = newToken });
        });
    }
}
