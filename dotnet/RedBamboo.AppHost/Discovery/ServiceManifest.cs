namespace RedBamboo.AppHost.Discovery;

public record CapabilityDescriptor(
    string Slug,
    string DisplayName,
    string Status,
    string? Description = null,
    IReadOnlyList<EndpointDescriptor>? Endpoints = null);

public record EndpointDescriptor(
    string Method,
    string Path,
    string Description,
    IReadOnlyList<ParameterDescriptor>? Parameters = null);

public record ParameterDescriptor(
    string Name,
    string Type,
    bool Required = false,
    string? Description = null,
    object? Default = null,
    IReadOnlyList<string>? Enum = null);
