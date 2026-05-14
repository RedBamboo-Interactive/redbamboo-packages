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
                ep.Description, ep.Parameters);
        }

        foreach (var cap in capabilities)
        {
            if (cap.Endpoints == null) continue;
            foreach (var ep in cap.Endpoints)
            {
                AddPath(paths, ep.Path, ep.Method.ToLowerInvariant(),
                    $"{cap.Slug}_{ep.Path.Replace("/", "_").Trim('_')}",
                    ep.Description, ep.Parameters);
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

    private static void AddPath(
        Dictionary<string, object> paths, string path, string method,
        string operationId, string description,
        IReadOnlyList<ParameterDescriptor>? parameters = null)
    {
        var operation = new Dictionary<string, object>
        {
            ["operationId"] = operationId,
            ["summary"] = description,
            ["responses"] = new Dictionary<string, object>
            {
                ["200"] = new { description = "Success" }
            }
        };

        if (parameters is { Count: > 0 })
        {
            var hasBody = method is "post" or "put" or "patch";

            if (hasBody)
            {
                var properties = new Dictionary<string, object>();
                var required = new List<string>();

                foreach (var p in parameters)
                {
                    var prop = BuildSchemaProperty(p);
                    properties[p.Name] = prop;
                    if (p.Required) required.Add(p.Name);
                }

                var schema = new Dictionary<string, object>
                {
                    ["type"] = "object",
                    ["properties"] = properties,
                };
                if (required.Count > 0)
                    schema["required"] = required;

                operation["requestBody"] = new Dictionary<string, object>
                {
                    ["required"] = required.Count > 0,
                    ["content"] = new Dictionary<string, object>
                    {
                        ["application/json"] = new { schema }
                    }
                };
            }
            else
            {
                var queryParams = new List<object>();
                foreach (var p in parameters)
                {
                    queryParams.Add(new
                    {
                        name = p.Name,
                        @in = "query",
                        required = p.Required,
                        description = p.Description ?? "",
                        schema = BuildTypeSchema(p),
                    });
                }
                operation["parameters"] = queryParams;
            }
        }

        var op = new Dictionary<string, object> { [method] = operation };

        if (paths.TryGetValue(path, out var existing) && existing is Dictionary<string, object> dict)
            dict[method] = operation;
        else
            paths[path] = op;
    }

    private static Dictionary<string, object> BuildSchemaProperty(ParameterDescriptor p)
    {
        var schema = BuildTypeSchema(p);
        if (p.Description != null) schema["description"] = p.Description;
        return schema;
    }

    private static Dictionary<string, object> BuildTypeSchema(ParameterDescriptor p)
    {
        var schema = new Dictionary<string, object> { ["type"] = MapType(p.Type) };
        if (p.Default != null) schema["default"] = p.Default;
        if (p.Enum is { Count: > 0 }) schema["enum"] = p.Enum;
        return schema;
    }

    private static string MapType(string type) => type.ToLowerInvariant() switch
    {
        "int" or "integer" or "int32" or "int64" or "long" => "integer",
        "float" or "double" or "decimal" or "number" => "number",
        "bool" or "boolean" => "boolean",
        "array" or "list" => "array",
        _ => "string",
    };
}
