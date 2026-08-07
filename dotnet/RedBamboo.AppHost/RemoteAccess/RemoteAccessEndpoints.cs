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
            var protectedValue = TokenPersistence.LoadToken(configDir);
            if (!string.IsNullOrEmpty(protectedValue)) return protectedValue;

            var configured = getTunnelConfig().AccessToken;
            if (string.IsNullOrEmpty(configured)) return "";

            TokenPersistence.SaveToken(configDir, configured);
            return configured;
        }

        string GetEffectiveTunnelToken()
        {
            var protectedValue = TokenPersistence.LoadTunnelToken(configDir);
            if (!string.IsNullOrEmpty(protectedValue)) return protectedValue;

            var configured = getTunnelConfig().TunnelToken;
            if (string.IsNullOrEmpty(configured)) return "";

            // One-way migration for hosts that previously supplied the tunnel token
            // through plaintext configuration. The protected value wins thereafter.
            TokenPersistence.SaveTunnelToken(configDir, configured);
            return configured;
        }

        TunnelConfig GetEffectiveTunnelConfig()
        {
            var config = getTunnelConfig();
            config.TunnelToken = GetEffectiveTunnelToken();
            config.AccessToken = GetEffectiveAccessToken();
            return config;
        }

        var group = app.MapGroup("/api/remote");

        group.MapGet("/status", () =>
        {
            var config = GetEffectiveTunnelConfig();
            var accessToken = GetEffectiveAccessToken();
            return Results.Ok(new
            {
                enabled = config.Enabled,
                tunnel_status = tunnelService.Status.ToString().ToLowerInvariant(),
                is_external = tunnelService.IsExternal,
                hostname = config.Hostname,
                auth_enabled = !string.IsNullOrEmpty(accessToken),
                tunnel_token = new
                {
                    configured = !string.IsNullOrEmpty(config.TunnelToken),
                    protection = "encrypted",
                    verification = "unverified",
                },
                error = tunnelService.ErrorMessage,
            });
        });

        group.MapGet("/secrets", () => Results.Ok(new
        {
            tunnel_token = new
            {
                configured = !string.IsNullOrEmpty(GetEffectiveTunnelToken()),
                protection = "encrypted",
                verification = "unverified",
            },
        }));

        group.MapPut("/secrets/tunnel-token", async (HttpRequest request) =>
        {
            var body = await request.ReadFromJsonAsync<SecretReplacement>();
            if (string.IsNullOrWhiteSpace(body?.Value))
                return Results.BadRequest(new { error = "A tunnel token is required." });

            TokenPersistence.SaveTunnelToken(configDir, body.Value.Trim());
            return Results.Ok(new
            {
                configured = true,
                protection = "encrypted",
                verification = "unverified",
            });
        });

        group.MapDelete("/secrets/tunnel-token", async () =>
        {
            await tunnelService.StopAsync();
            TokenPersistence.DeleteTunnelToken(configDir);
            return Results.Ok(new
            {
                configured = false,
                protection = "encrypted",
                verification = "unverified",
            });
        });

        group.MapPost("/enable", async () =>
        {
            var config = GetEffectiveTunnelConfig();
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
            var config = GetEffectiveTunnelConfig();
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

    private sealed class SecretReplacement
    {
        public string? Value { get; set; }
    }
}
