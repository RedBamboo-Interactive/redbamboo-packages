namespace RedBamboo.AppHost.Auth;

public class JwtOptions
{
    public required string SigningKey { get; init; }
    public string Issuer { get; init; } = "redsuite";
    public string Audience { get; init; } = "redsuite";
    public TimeSpan AccessTokenLifetime { get; init; } = TimeSpan.FromMinutes(15);
    public TimeSpan RefreshTokenLifetime { get; init; } = TimeSpan.FromDays(30);
}
