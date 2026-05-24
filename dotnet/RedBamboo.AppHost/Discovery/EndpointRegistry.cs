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

    public IReadOnlyList<EndpointDescriptor> GetEndpoints()
        => _entries.Select(e => new EndpointDescriptor(
            e.Method, e.Path, e.Description,
            e.Parameters.Count > 0 ? e.Parameters.ToList() : null
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
    }
}

public class EndpointBuilder : IEndpointConventionBuilder
{
    private readonly RouteHandlerBuilder _routeBuilder;
    private readonly EndpointRegistry.MutableEntry _entry;

    internal EndpointBuilder(RouteHandlerBuilder routeBuilder, EndpointRegistry.MutableEntry entry)
    {
        _routeBuilder = routeBuilder;
        _entry = entry;
    }

    public EndpointBuilder WithParam(string name, string type, bool required = false,
        string? description = null, object? defaultValue = null, IReadOnlyList<string>? enumValues = null)
    {
        _entry.Parameters.Add(new ParameterDescriptor(name, type, required, description, defaultValue, enumValues));
        return this;
    }

    void IEndpointConventionBuilder.Add(Action<Microsoft.AspNetCore.Builder.EndpointBuilder> convention)
        => ((IEndpointConventionBuilder)_routeBuilder).Add(convention);
}
