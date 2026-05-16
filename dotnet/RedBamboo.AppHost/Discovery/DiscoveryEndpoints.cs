using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using RedBamboo.AppHost.Tunnel;
using RedBamboo.AppHost.WebSockets;

namespace RedBamboo.AppHost.Discovery;

public static class DiscoveryEndpoints
{
    private static DateTime _startTime = DateTime.UtcNow;

    public static void MapDiscoveryEndpoints(
        this WebApplication app,
        IServiceDescriptor descriptor,
        CloudflareTunnelService tunnelService,
        WebSocketBroadcaster? broadcaster = null)
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
            var appEndpoints = descriptor.GetAppEndpoints().ToList();

            if (broadcaster is not null)
            {
                var eventCount = broadcaster.GetEventSchemas().Count;
                appEndpoints.Add(new EndpointDescriptor(
                    "WS", "/ws",
                    $"Real-time event stream ({eventCount} event type{(eventCount == 1 ? "" : "s")}). " +
                    "See /ws/schema for full event catalog"));
                appEndpoints.Add(new EndpointDescriptor(
                    "GET", "/ws/schema",
                    "Returns all registered WebSocket event types with descriptions and field schemas"));
            }

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
