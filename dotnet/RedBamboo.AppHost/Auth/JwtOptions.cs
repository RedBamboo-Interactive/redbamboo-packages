namespace RedBamboo.AppHost.Auth;

public class JwtOptions
{
    public required string SigningKey { get; init; }
    public string Issuer { get; init; } = "redsuite";
    public string Audience { get; init; } = "redsuite";
    public TimeSpan AccessTokenLifetime { get; init; } = TimeSpan.FromDays(365);
    public TimeSpan ExecutionTokenLifetime { get; init; } = TimeSpan.FromMinutes(30);
    /// <summary>
    /// Lifetime for execution identity injected into a persistent AI provider process.
    /// The process environment cannot be mutated after launch, so this credential must
    /// outlive the process; starting or resuming the process mints a fresh token.
    /// </summary>
    public TimeSpan SessionExecutionTokenLifetime { get; init; } = TimeSpan.FromDays(365);
    public TimeSpan RefreshTokenLifetime { get; init; } = TimeSpan.FromDays(30);
    public TimeSpan ClockSkew { get; init; } = TimeSpan.FromSeconds(30);
}
