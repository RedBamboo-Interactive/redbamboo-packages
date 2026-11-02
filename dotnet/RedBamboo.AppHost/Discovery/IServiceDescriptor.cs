namespace RedBamboo.AppHost.Discovery;

public interface IServiceDescriptor
{
    string ServiceName { get; }
    string Version { get; }
    string Description { get; }
    string ApiBase { get; }
    string? IconClass => null;
    string? IconColor => null;

    Task<IReadOnlyList<CapabilityDescriptor>> GetCapabilitiesAsync();
    IReadOnlyList<EndpointDescriptor> GetAppEndpoints();
    Task<object?> GetHealthExtrasAsync();

    /// <summary>Plugins and other parts that own routes beyond the kernel.</summary>
    Task<IReadOnlyList<DiscoveryArea>> GetAreasAsync() => Task.FromResult<IReadOnlyList<DiscoveryArea>>([]);
}
