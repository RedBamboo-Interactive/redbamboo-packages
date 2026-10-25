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

public enum AuthMode
{
    LocalDefault,
    Required
}
