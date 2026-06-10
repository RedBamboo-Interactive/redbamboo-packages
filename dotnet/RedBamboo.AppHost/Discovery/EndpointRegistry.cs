using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;

namespace RedBamboo.AppHost.Discovery;

public class EndpointRegistry
{
    private readonly IEndpointRouteBuilder _app;
    private readonly List<MutableEntry> _entries = [];

    public EndpointRegistry(IEndpointRouteBuilder app) => _app = app;

    public EndpointBuilder MapGet(string pattern, string description, Delegate handler)
        => Register("GET", pattern, description, _app.MapGet(pattern, handler));

    public EndpointBuilder MapPost(string pattern, string description, Delegate handler)
        => Register("POST", pattern, description, _app.MapPost(pattern, handler));

    public EndpointBuilder MapPut(string pattern, string description, Delegate handler)
        => Register("PUT", pattern, description, _app.MapPut(pattern, handler));

    public EndpointBuilder MapDelete(string pattern, string description, Delegate handler)
        => Register("DELETE", pattern, description, _app.MapDelete(pattern, handler));

    public EndpointBuilder MapPatch(string pattern, string description, Delegate handler)
        => Register("PATCH", pattern, description, _app.MapPatch(pattern, handler));

    /// <summary>
    /// Record an endpoint in the manifest WITHOUT mapping a route. Use for routes that are
    /// mapped outside the registry (proxies, websockets, catch-alls) but should still be
    /// discoverable via /discover and /openapi.json.
    /// </summary>
    public EndpointBuilder Describe(string method, string pattern, string description)
    {
        var entry = new MutableEntry(method, pattern, description);
        _entries.Add(entry);
        return new EndpointBuilder(null, entry);
    }

    public IReadOnlyList<EndpointDescriptor> GetEndpoints()
        => _entries.Select(e => new EndpointDescriptor(
            e.Method, e.Path, e.Description,
            e.Parameters.Count > 0 ? e.Parameters.ToList() : null,
            e.RequestBodySchema, e.ResponseSchema, e.Auth
        )).ToList();

    private EndpointBuilder Register(string method, string path, string description, RouteHandlerBuilder routeBuilder)
    {
        var entry = new MutableEntry(method, path, description);
        _entries.Add(entry);
        return new EndpointBuilder(routeBuilder, entry);
    }

    internal sealed class MutableEntry(string method, string path, string description)
    {
        public string Method => method;
        public string Path => path;
        public string Description => description;
        public List<ParameterDescriptor> Parameters { get; } = [];
        public object? RequestBodySchema { get; set; }
        public object? ResponseSchema { get; set; }
        public string? Auth { get; set; }
    }
}

public class EndpointBuilder : IEndpointConventionBuilder
{
    private readonly RouteHandlerBuilder? _routeBuilder;
    private readonly EndpointRegistry.MutableEntry _entry;

    internal EndpointBuilder(RouteHandlerBuilder? routeBuilder, EndpointRegistry.MutableEntry entry)
    {
        _routeBuilder = routeBuilder;
        _entry = entry;
    }

    public EndpointBuilder WithParam(string name, string type, bool required = false,
        string? description = null, object? defaultValue = null, IReadOnlyList<string>? enumValues = null,
        string? location = null)
    {
        _entry.Parameters.Add(new ParameterDescriptor(name, type, required, description, defaultValue, enumValues, location));
        return this;
    }

    /// <summary>
    /// Attach a JSON-schema-shaped object describing the request body. Takes precedence over
    /// flat WithParam entries when generating the OpenAPI requestBody. Use for nested bodies
    /// (arrays of objects, attachments) the flat param model cannot express.
    /// </summary>
    public EndpointBuilder WithRequestBody(object jsonSchema)
    {
        _entry.RequestBodySchema = jsonSchema;
        return this;
    }

    /// <summary>Attach a JSON-schema-shaped object describing the success response body.</summary>
    public EndpointBuilder WithResponse(object jsonSchema)
    {
        _entry.ResponseSchema = jsonSchema;
        return this;
    }

    /// <summary>Annotate auth requirement: "none", "local", "bearer", or "jwt".</summary>
    public EndpointBuilder WithAuth(string auth)
    {
        _entry.Auth = auth;
        return this;
    }

    void IEndpointConventionBuilder.Add(Action<Microsoft.AspNetCore.Builder.EndpointBuilder> convention)
        => ((IEndpointConventionBuilder?)_routeBuilder)?.Add(convention);
}
