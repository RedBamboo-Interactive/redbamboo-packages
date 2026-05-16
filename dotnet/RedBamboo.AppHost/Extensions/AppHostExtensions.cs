using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using RedBamboo.AppHost.Auth;
using RedBamboo.AppHost.Discovery;
using RedBamboo.AppHost.Logging;
using RedBamboo.AppHost.Proxy;
using RedBamboo.AppHost.RemoteAccess;
using RedBamboo.AppHost.Tunnel;
using RedBamboo.AppHost.WebSockets;

namespace RedBamboo.AppHost.Extensions;

public static class AppHostExtensions
{
    public static IServiceCollection AddAppHostTunnel(this IServiceCollection services)
    {
        services.AddSingleton<CloudflareTunnelService>();
        return services;
    }

    public static IServiceCollection AddAppHostWebSocket(this IServiceCollection services)
    {
        services.TryAddSingleton<WebSocketBroadcaster>();
        return services;
    }

    public static IServiceCollection AddAppHostLogging(
        this IServiceCollection services, Action<LogServiceOptions>? configure = null)
    {
        var options = new LogServiceOptions { Source = "app" };
        configure?.Invoke(options);
        var logService = new LogService(options);
        services.AddSingleton(logService);
        services.AddAppHostWebSocket();
        return services;
    }

    public static IApplicationBuilder UseAppHostAuth(
        this IApplicationBuilder app, BearerAuthOptions options)
    {
        return app.UseMiddleware<BearerAuthMiddleware>(options);
    }

    public static WebApplication MapAppHostEndpoints(
        this WebApplication app,
        IServiceDescriptor descriptor,
        CloudflareTunnelService tunnelService,
        string appName,
        Func<TunnelConfig> getTunnelConfig,
        LogService? logService = null,
        Dictionary<string, string>? proxyRoutes = null)
    {
        var broadcaster = app.Services.GetService<WebSocketBroadcaster>();

        DiscoveryEndpoints.MapDiscoveryEndpoints(app, descriptor, tunnelService, broadcaster);
        RemoteAccessEndpoints.MapRemoteAccessEndpoints(app, tunnelService, appName, getTunnelConfig);

        if (logService is not null)
            LogEndpoints.MapLogEndpoints(app, logService);

        List<ProxyRouteConfig>? wsProxyRoutes = null;
        if (proxyRoutes is { Count: > 0 })
        {
            var seenWsUpstreams = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var routes = proxyRoutes.Select(kv => new ProxyRouteConfig
            {
                PathPrefix = kv.Key,
                UpstreamBaseUrl = kv.Value,
                ProxyWebSocket = seenWsUpstreams.Add(kv.Value),
            }).ToList();
            ProxyEndpoints.MapProxyEndpoints(app, routes, appName);
            wsProxyRoutes = routes.Where(r => r.ProxyWebSocket).ToList();
        }

        if (broadcaster is not null)
        {
            var alreadyRegistered = broadcaster.GetEventSchemas().Any(s => s.Type == "log.entry");
            if (logService is not null && !alreadyRegistered)
            {
                broadcaster.RegisterEvent(new WsEventSchema(
                    "log.entry",
                    "Fired for every new log entry",
                    DataSchema: "LogEntry",
                    Fields: ["id", "timestamp", "level", "category", "source", "message"]));
                logService.OnLogEntry += entry => broadcaster.Broadcast("log.entry", entry.ToWireFormat());
            }

            WebSocketEndpoints.MapWebSocketEndpoints(app, broadcaster, wsProxyRoutes);
        }

        return app;
    }
}
