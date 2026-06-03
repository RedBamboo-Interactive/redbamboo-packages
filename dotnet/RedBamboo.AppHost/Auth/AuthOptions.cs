namespace RedBamboo.AppHost.Auth;

public class AuthOptions
{
    public AuthMode Mode { get; init; } = AuthMode.LocalDefault;
    public JwtOptions? Jwt { get; init; }
    public GoogleAuthOptions? Google { get; init; }
    public string CookieName { get; init; } = "redsuite_token";
    public string RefreshCookieName { get; init; } = "redsuite_refresh";
    public List<string> BypassPaths { get; init; } = ["/ping", "/api/remote/status", "/auth/login", "/auth/callback", "/login"];
}

public enum AuthMode
{
    LocalDefault,
    Required
}
