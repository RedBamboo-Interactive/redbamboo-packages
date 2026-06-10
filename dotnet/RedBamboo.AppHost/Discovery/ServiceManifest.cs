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
    IReadOnlyList<ParameterDescriptor>? Parameters = null,
    object? RequestBody = null,
    object? Response = null,
    string? Auth = null);

public record ParameterDescriptor(
    string Name,
    string Type,
    bool Required = false,
    string? Description = null,
    object? Default = null,
    IReadOnlyList<string>? Enum = null,
    string? Location = null);

/// <summary>Where a parameter lives in the request. Serialized lowercase into manifests.</summary>
public static class ParamLocation
{
    public const string Query = "query";
    public const string Body = "body";
    public const string Path = "path";
    public const string Header = "header";
}
