namespace RedBamboo.AppHost.Discovery;

public static class OpenApiGenerator
{
    public static async Task<object> GenerateAsync(IServiceDescriptor descriptor)
    {
        var capabilities = await descriptor.GetCapabilitiesAsync();
        var appEndpoints = descriptor.GetAppEndpoints();

        var paths = new Dictionary<string, object>();

        AddPath(paths, "/ping", "get", "Ping", "Liveness probe");
        AddPath(paths, "/health", "get", "Health", "Structured health check with tunnel and capability status");
        AddPath(paths, "/discover", "get", "Discover", "Machine-readable service manifest for AI agent discovery");
        AddPath(paths, "/api/remote/status", "get", "RemoteStatus", "Tunnel and remote access status");
        AddPath(paths, "/api/remote/enable", "post", "RemoteEnable", "Start tunnel and auto-generate access token");
        AddPath(paths, "/api/remote/disable", "post", "RemoteDisable", "Stop tunnel");
        AddPath(paths, "/api/remote/share", "get", "RemoteShare", "Get shareable URL with embedded token");
        AddPath(paths, "/api/remote/token", "put", "RemoteRegenerateToken", "Regenerate access token");

        foreach (var ep in appEndpoints)
        {
            AddPath(paths, ep.Path, ep.Method.ToLowerInvariant(),
                ep.Path.Replace("/", "").Replace("{", "").Replace("}", ""),
                ep.Description);
        }

        foreach (var cap in capabilities)
        {
            if (cap.Endpoints == null) continue;
            foreach (var ep in cap.Endpoints)
            {
                AddPath(paths, ep.Path, ep.Method.ToLowerInvariant(),
                    $"{cap.Slug}_{ep.Path.Replace("/", "_").Trim('_')}",
                    ep.Description);
            }
        }

        return new
        {
            openapi = "3.1.0",
            info = new
            {
                title = descriptor.ServiceName,
                version = descriptor.Version,
                description = descriptor.Description,
            },
            servers = new[] { new { url = descriptor.ApiBase } },
            paths,
        };
    }

    private static void AddPath(Dictionary<string, object> paths, string path, string method, string operationId, string description)
    {
        var op = new Dictionary<string, object>
        {
            [method] = new
            {
                operationId,
                summary = description,
                responses = new Dictionary<string, object>
                {
                    ["200"] = new { description = "Success" }
                }
            }
        };

        if (paths.TryGetValue(path, out var existing) && existing is Dictionary<string, object> dict)
            dict[method] = ((Dictionary<string, object>)op[method]);
        else
            paths[path] = op;
    }
}
