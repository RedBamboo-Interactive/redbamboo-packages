namespace RedBamboo.AppHost.Proxy;

public class ProxyRouteConfig
{
    public required string PathPrefix { get; init; }
    public required string UpstreamBaseUrl { get; init; }
    public TimeSpan Timeout { get; init; } = TimeSpan.FromMinutes(5);
    public bool ProxyWebSocket { get; init; } = true;
}
