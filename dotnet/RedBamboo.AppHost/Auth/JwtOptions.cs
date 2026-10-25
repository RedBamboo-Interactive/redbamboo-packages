namespace RedBamboo.AppHost.Auth;

public class JwtOptions
{
    /// <summary>The shared HS256 key. Legacy mode only; empty and unused when <see cref="Vault"/> is set.</summary>
    public string SigningKey { get; init; } = "";
    /// <summary>
    /// Set on a machine in vault mode: Leaf Vault signs and this process verifies against its public
    /// keys. Null means legacy mode (shared-key HS256), exactly as before the vault existed.
    /// </summary>
    public Vault.VaultBadgeAuthority? Vault { get; init; }
    /// <summary>Browser login badge lifetime in vault mode (the vault caps remote badges at one hour).</summary>
    public TimeSpan BrowserAccessTokenLifetime { get; init; } = TimeSpan.FromHours(1);
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
