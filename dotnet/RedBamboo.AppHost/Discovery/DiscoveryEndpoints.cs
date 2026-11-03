using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using RedBamboo.AppHost.Auth;
using RedBamboo.AppHost.Tunnel;
using RedBamboo.AppHost.WebSockets;

namespace RedBamboo.AppHost.Discovery;

public static class DiscoveryEndpoints
{
    private const string CatalogProperty = "RedBamboo.AppHost.DiscoveryCatalog";
    private static readonly JsonSerializerOptions Compact = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private static DateTime _startTime = DateTime.UtcNow;

    /// <summary>The live catalog of this service, for callers such as a not-found fallback.</summary>
    public static DiscoveryCatalogProvider? DiscoveryCatalog(this IApplicationBuilder app)
        => app.Properties.TryGetValue(CatalogProperty, out var provider) ? provider as DiscoveryCatalogProvider : null;

    /// <summary>
    /// Everything past a service's name shows what it runs, so it needs a signed-in caller. A host
    /// with no sign-in middleware has only its own machine to trust.
    /// </summary>
    internal static bool MayReadCatalog(HttpContext context, AuthOptions? auth)
        => context.User.Identity?.IsAuthenticated == true || (auth is null && RequestOrigin.IsLocal(context));

    /// <summary>
    /// Answers a request no route took. A caller who may read the catalog hears what they probably meant;
    /// anyone else learns nothing about the routes.
    /// </summary>
    public static async Task WriteNoRouteAsync(this IApplicationBuilder app, HttpContext context, string path)
    {
        var provider = MayReadCatalog(context, context.RequestServices.GetService<AuthOptions>())
            ? app.DiscoveryCatalog()
            : null;
        if (provider is null)
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            await context.Response.WriteAsJsonAsync(new { error = "not_found", message = "No such endpoint -- see /discover" });
            return;
        }

        var catalog = await provider.GetAsync();
        var miss = catalog.Explain(context.Request.Method, path);
        if (miss.Allowed.Count > 0)
        {
            context.Response.StatusCode = StatusCodes.Status405MethodNotAllowed;
            context.Response.Headers.Allow = string.Join(", ", miss.Allowed);
            await context.Response.WriteAsJsonAsync(new
            {
                error = "method_not_allowed",
                message = $"{context.Request.Method} is not supported here. Allowed: {string.Join(", ", miss.Allowed)}.",
                allowed = miss.Allowed,
                discover = miss.Area is null ? "/discover" : $"/discover/{miss.Area}",
            });
            return;
        }

        context.Response.StatusCode = StatusCodes.Status404NotFound;
        await context.Response.WriteAsJsonAsync(new
        {
            error = "not_found",
            message = miss.BadValue is { } route
                ? $"No such endpoint -- a value doesn't fit {route.Method} {route.Path}"
                : "No such endpoint -- see /discover",
            closest = miss.Closest.Select(item => new { method = item.Method, path = item.Path, description = item.Description }),
            find = miss.Find,
        });
    }

    private static IResult SignInRequired() => Results.Json(new
    {
        error = "unauthorized",
        message = "Sign in to read this service's routes.",
    }, statusCode: StatusCodes.Status401Unauthorized);

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
        var catalog = new DiscoveryCatalogProvider(app, descriptor);
        ((IApplicationBuilder)app).Properties[CatalogProperty] = catalog;
        app.Lifetime.ApplicationStarted.Register(() => _ = Task.Run(async () =>
        {
            try { await catalog.GetAsync(); }
            catch { /* A failed warm-up just leaves the first caller to build it. */ }
        }));
        var auth = app.Services.GetService<AuthOptions>();

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

        app.MapGet("/discover", async (HttpContext context, string? format) =>
        {
            var authMode = auth?.Mode.ToString();

            // The sign-in pages read this before anyone has signed in; they need only the name and icon.
            if (!MayReadCatalog(context, auth))
            {
                return Results.Json(new
                {
                    service = descriptor.ServiceName,
                    name = descriptor.ServiceName,
                    version = descriptor.Version,
                    description = descriptor.Description,
                    iconClass = descriptor.IconClass,
                    iconColor = descriptor.IconColor,
                    authMode,
                    signIn = "Sign in to read this service's routes.",
                }, Compact);
            }

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

            if (!string.Equals(format, "v1", StringComparison.OrdinalIgnoreCase))
            {
                var current = await catalog.GetAsync();
                return Results.Json(current.Map(descriptor, authMode, management, proxies), Compact);
            }

            var capabilities = await descriptor.GetCapabilitiesAsync();

            return Results.Ok(new
            {
                service = descriptor.ServiceName,
                name = descriptor.ServiceName,
                version = descriptor.Version,
                description = descriptor.Description,
                api_base = descriptor.ApiBase,
                iconClass = descriptor.IconClass,
                iconColor = descriptor.IconColor,
                authMode,
                capabilities,
                app_endpoints = appEndpoints,
                proxies,
                management,
            });
        });

        app.MapGet("/discover/find", async (HttpContext context, string? q, int? limit, bool? @public) =>
        {
            if (!MayReadCatalog(context, auth)) return SignInRequired();
            var current = await catalog.GetAsync();
            return Results.Json(current.Find(q, limit ?? 15, @public == true), Compact);
        });

        app.MapGet("/discover/{area}", async (HttpContext context, string area, bool? @public) =>
        {
            if (!MayReadCatalog(context, auth)) return SignInRequired();
            var current = await catalog.GetAsync();
            var detail = current.Area(area, @public == true);
            return detail is null
                ? Results.Json(new
                {
                    error = "unknown_area",
                    message = $"Nothing here is called '{area}'. /discover lists the areas.",
                    find = "/discover/find?q=" + Uri.EscapeDataString(area),
                }, statusCode: StatusCodes.Status404NotFound)
                : Results.Json(detail, Compact);
        });

        app.MapGet("/openapi.json", async (HttpContext context) =>
        {
            if (!MayReadCatalog(context, auth)) return SignInRequired();
            var current = await catalog.GetAsync();
            return Results.Json(OpenApiGenerator.Generate(descriptor, current));
        });
    }
}
