using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using RedBamboo.AppHost.Tunnel;

namespace RedBamboo.AppHost.Discovery;

public static class DiscoveryEndpoints
{
    private static DateTime _startTime = DateTime.UtcNow;

    public static void MapDiscoveryEndpoints(
        this WebApplication app,
        IServiceDescriptor descriptor,
        CloudflareTunnelService tunnelService)
    {
        _startTime = DateTime.UtcNow;

        app.MapGet("/ping", () => Results.Ok(new
        {
            ok = true,
            service = descriptor.ServiceName,
            version = descriptor.Version,
        }));

        app.MapGet("/health", async () =>
        {
            var extras = await descriptor.GetHealthExtrasAsync();
            var capabilities = await descriptor.GetCapabilitiesAsync();
            var degraded = capabilities.Any(c =>
                c.Status.Equals("Error", StringComparison.OrdinalIgnoreCase));

            return Results.Ok(new
            {
                service = descriptor.ServiceName,
                version = descriptor.Version,
                status = degraded ? "degraded" : "ok",
                uptime_seconds = (int)(DateTime.UtcNow - _startTime).TotalSeconds,
                tunnel = new
                {
                    status = tunnelService.Status.ToString().ToLowerInvariant(),
                    is_external = tunnelService.IsExternal,
                    error = tunnelService.ErrorMessage,
                },
                extras,
            });
        });

        app.MapGet("/discover", async () =>
        {
            var capabilities = await descriptor.GetCapabilitiesAsync();
            var appEndpoints = descriptor.GetAppEndpoints();

            return Results.Ok(new
            {
                service = descriptor.ServiceName,
                version = descriptor.Version,
                description = descriptor.Description,
                api_base = descriptor.ApiBase,
                capabilities,
                app_endpoints = appEndpoints,
                management = new
                {
                    ping = "/ping",
                    health = "/health",
                    discovery = "/discover",
                    openapi = "/openapi.json",
                    remote = new
                    {
                        status = "/api/remote/status",
                        enable = "/api/remote/enable",
                        disable = "/api/remote/disable",
                        share = "/api/remote/share",
                    },
                },
            });
        });

        app.MapGet("/openapi.json", async () =>
        {
            var spec = await OpenApiGenerator.GenerateAsync(descriptor);
            return Results.Json(spec);
        });
    }
}
