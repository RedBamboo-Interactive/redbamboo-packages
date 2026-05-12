namespace RedBamboo.AppHost.Discovery;

public interface IServiceDescriptor
{
    string ServiceName { get; }
    string Version { get; }
    string Description { get; }
    string ApiBase { get; }

    Task<IReadOnlyList<CapabilityDescriptor>> GetCapabilitiesAsync();
    IReadOnlyList<EndpointDescriptor> GetAppEndpoints();
    Task<object?> GetHealthExtrasAsync();
}
