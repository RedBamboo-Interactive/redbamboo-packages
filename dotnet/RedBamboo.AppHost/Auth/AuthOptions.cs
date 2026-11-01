namespace RedBamboo.AppHost.Auth;

public class AuthOptions
{
    public AuthMode Mode { get; init; } = AuthMode.LocalDefault;
    public JwtOptions? Jwt { get; init; }
    public GoogleAuthOptions? Google { get; init; }
    public string CookieName { get; init; } = "redsuite_token";
    public string RefreshCookieName { get; init; } = "redsuite_refresh";
    /// <summary>
    /// Paths the access badge does not guard. /auth/refresh and /auth/logout authenticate with the refresh
    /// cookie themselves; they run exactly when the access badge has expired, so guarding them with it
    /// would 401 every remote renewal before the handler could rotate the session.
    /// </summary>
    public List<string> BypassPaths { get; init; } = ["/ping", "/api/remote/status", "/auth/login", "/auth/callback",
        "/auth/refresh", "/auth/logout", "/login", "/discover"];
}

/// <summary>
/// Whether an external sign-in provider is configured. A local caller is the default identity
/// without signing in under either mode; a remote caller must always sign in.
/// </summary>
public enum AuthMode
{
    LocalDefault,
    Required
}
