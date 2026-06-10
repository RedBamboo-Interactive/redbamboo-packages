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
        WebSocketBroadcaster? broadcaster = null,
        bool hasLogs = false,
        bool hasTelemetry = false,
        IReadOnlyDictionary<string, string>? proxyRoutes = null)
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

            var management = new Dictionary<string, object?>
            {
                ["ping"] = "/ping",
                ["health"] = "/health",
                ["discovery"] = "/discover",
                ["openapi"] = "/openapi.json",
                ["remote"] = new
                {
                    status = "/api/remote/status",
                    enable = "/api/remote/enable",
                    disable = "/api/remote/disable",
                    share = "/api/remote/share",
                    token = "/api/remote/token",
                },
            };

            if (hasLogs)
                management["logs"] = new
                {
                    list = "/api/logs",
                    summary = "/api/logs/summary",
                    clear = "/api/logs/clear",
                };

            if (hasTelemetry)
                management["telemetry"] = new
                {
                    list = "/api/telemetry",
                    stats = "/api/telemetry/stats",
                    process = "/api/telemetry/process",
                    cleanup = "/api/telemetry/cleanup",
                };

            if (OperatingSystem.IsWindows())
                management["autostart"] = "/api/autostart";

            // Pass-through routes to sibling services. Agents should follow the upstream's
            // /discover for the full surface behind each prefix.
            object? proxies = null;
            if (proxyRoutes is { Count: > 0 })
            {
                proxies = proxyRoutes.Select(kv => new
                {
                    prefix = kv.Key,
                    upstream = kv.Value,
                    discover = kv.Value.TrimEnd('/') + "/discover",
                    description = $"All methods under {kv.Key}/** are proxied to {kv.Value}. " +
                                  "See the upstream /discover for the endpoints behind this prefix.",
                }).ToList();
            }

            return Results.Ok(new
            {
                service = descriptor.ServiceName,
                name = descriptor.ServiceName,
                version = descriptor.Version,
                description = descriptor.Description,
                api_base = descriptor.ApiBase,
                iconClass = descriptor.IconClass,
                iconColor = descriptor.IconColor,
                capabilities,
                app_endpoints = appEndpoints,
                proxies,
                management,
            });
        });

        app.MapGet("/openapi.json", async () =>
        {
            var spec = await OpenApiGenerator.GenerateAsync(descriptor);
            return Results.Json(spec);
        });
    }
}
