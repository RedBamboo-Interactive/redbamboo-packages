using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using RedBamboo.AppHost.Auth;
using RedBamboo.AppHost.Discovery;
using RedBamboo.AppHost.Logging;
using RedBamboo.AppHost.RemoteAccess;
using RedBamboo.AppHost.Tunnel;

namespace RedBamboo.AppHost.Extensions;

public static class AppHostExtensions
{
    public static IServiceCollection AddAppHostTunnel(this IServiceCollection services)
    {
        services.AddSingleton<CloudflareTunnelService>();
        return services;
    }

    public static IServiceCollection AddAppHostLogging(
        this IServiceCollection services, Action<LogServiceOptions>? configure = null)
    {
        var options = new LogServiceOptions { Source = "app" };
        configure?.Invoke(options);
        var logService = new LogService(options);
        services.AddSingleton(logService);
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
        LogService? logService = null)
    {
        DiscoveryEndpoints.MapDiscoveryEndpoints(app, descriptor, tunnelService);
        RemoteAccessEndpoints.MapRemoteAccessEndpoints(app, tunnelService, appName, getTunnelConfig);
        if (logService is not null)
            LogEndpoints.MapLogEndpoints(app, logService);
        return app;
    }
}
