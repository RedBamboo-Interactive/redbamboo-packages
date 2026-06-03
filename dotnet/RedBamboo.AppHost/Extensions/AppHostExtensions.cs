using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using RedBamboo.AppHost.Auth;
using RedBamboo.AppHost.Discovery;
using RedBamboo.AppHost.Logging;
using RedBamboo.AppHost.Proxy;
using RedBamboo.AppHost.RemoteAccess;
using RedBamboo.AppHost.Telemetry;
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

    public static IServiceCollection AddAppHostTelemetry(
        this IServiceCollection services, Action<TelemetryOptions> configure)
    {
        var options = new TelemetryOptions { AppName = "Unknown" };
        configure(options);
        var service = new TelemetryService(options);
        services.AddSingleton(service);
        services.AddAppHostWebSocket();
        return services;
    }

    public static IApplicationBuilder UseAppHostTelemetry(this IApplicationBuilder app)
    {
        if (app.ApplicationServices.GetService<TelemetryService>() is null)
            return app;
        return app.UseMiddleware<TelemetryMiddleware>();
    }

    public static IApplicationBuilder UseAppHostAuth(
        this IApplicationBuilder app, BearerAuthOptions options)
    {
        return app.UseMiddleware<BearerAuthMiddleware>(options);
    }

    public static IServiceCollection AddAppHostAuth(
        this IServiceCollection services, AuthOptions options)
    {
        services.AddSingleton(options);

        if (options.Jwt != null)
        {
            services.AddSingleton(options.Jwt);
            services.AddSingleton<JwtService>();
        }

        if (options.Google != null)
        {
            services.AddSingleton(options.Google);
            services.AddHttpClient<GoogleAuthProvider>();
            services.AddSingleton<IAuthProvider>(sp => sp.GetRequiredService<GoogleAuthProvider>());
        }

        services.AddSingleton<AuthenticatedHttpClientFactory>();

        services.AddSingleton<IUserStore, RedLeafUserStore>();
        services.AddSingleton<IRefreshTokenStore, RedLeafRefreshTokenStore>();

        services.AddSingleton(new PermissionDataSourceOptions());
        services.AddHttpClient<HttpPermissionDataSource>();
        services.AddSingleton<IPermissionDataSource>(sp => sp.GetRequiredService<HttpPermissionDataSource>());
        services.AddSingleton<IPermissionService, PermissionService>();

        return services;
    }

    public static IServiceCollection AddAppHostAuth(
        this IServiceCollection services, Action<AuthOptions> configure)
    {
        var options = new AuthOptions();
        configure(options);
        return services.AddAppHostAuth(options);
    }

    public static IServiceCollection AddPermissionDataSource<T>(
        this IServiceCollection services) where T : class, IPermissionDataSource
    {
        services.AddSingleton<IPermissionDataSource, T>();
        return services;
    }

    public static IApplicationBuilder UseUserDetection(this IApplicationBuilder app)
    {
        return app.UseMiddleware<UserDetectionMiddleware>();
    }

    public static IApplicationBuilder UseAppHostJwtAuth(this IApplicationBuilder app)
    {
        var options = app.ApplicationServices.GetService<AuthOptions>();
        if (options is null) return app;
        return app.UseMiddleware<AuthMiddleware>();
    }

    public static void MapAuthEndpoints(this EndpointRegistry registry)
    {
        AuthEndpoints.Map(registry);
    }

    public static EndpointRegistry CreateEndpointRegistry(this WebApplication app)
        => new EndpointRegistry(app);

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
#if WINDOWS
        Startup.AutoStartEndpoints.MapAutoStartEndpoints(app, appName);
#endif

        if (logService is not null)
            LogEndpoints.MapLogEndpoints(app, logService);

        var telemetry = app.Services.GetService<TelemetryService>();
        if (telemetry is not null)
        {
            if (descriptor is RegistryServiceDescriptor rsd)
                foreach (var ep in rsd.Registry.GetEndpoints())
                    telemetry.DescribeRoute(ep.Method, ep.Path, ep.Description);

            TelemetryEndpoints.MapTelemetryEndpoints(app, telemetry);
        }

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

            if (telemetry is not null)
            {
                var telemetryRegistered = broadcaster.GetEventSchemas()
                    .Any(s => s.Type == "telemetry.request");
                if (!telemetryRegistered)
                {
                    broadcaster.RegisterEvent(new WsEventSchema(
                        "telemetry.request",
                        "Fired for every tracked API request",
                        DataSchema: "TelemetryEntry",
                        Fields: ["method", "path", "route_pattern", "status_code", "duration_ms"]));
                    telemetry.OnEntry += entry =>
                        broadcaster.Broadcast("telemetry.request", entry.ToWireFormat());
                }
            }

            WebSocketEndpoints.MapWebSocketEndpoints(app, broadcaster, wsProxyRoutes);
        }

        return app;
    }
}
