namespace RedBamboo.AppHost.Discovery;

public abstract class RegistryServiceDescriptor : IServiceDescriptor
{
    private readonly EndpointRegistry _registry;

    protected RegistryServiceDescriptor(EndpointRegistry registry) => _registry = registry;

    public EndpointRegistry Registry => _registry;

    public abstract string ServiceName { get; }
    public abstract string Version { get; }
    public abstract string Description { get; }
    public abstract string ApiBase { get; }

    public abstract Task<IReadOnlyList<CapabilityDescriptor>> GetCapabilitiesAsync();

    public IReadOnlyList<EndpointDescriptor> GetAppEndpoints() => _registry.GetEndpoints();

    public virtual Task<object?> GetHealthExtrasAsync() => Task.FromResult<object?>(null);
}
