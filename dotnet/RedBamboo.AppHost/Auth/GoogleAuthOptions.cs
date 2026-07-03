namespace RedBamboo.AppHost.Auth;

public class GoogleAuthOptions
{
    public required string ClientId { get; init; }
    public required string ClientSecret { get; init; }
    public List<string> ExtraScopes { get; init; } = [];
    public string? DataDirectory { get; init; }
}
