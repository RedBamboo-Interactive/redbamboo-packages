namespace RedBamboo.AppHost.Auth;

public class BearerAuthOptions
{
    public required Func<string?> GetAccessToken { get; init; }
    public string CookieName { get; init; } = "apphost_token";
    public List<string> BypassPaths { get; init; } = ["/ping", "/api/remote/status"];
    public bool AllowQueryParamToken { get; init; } = true;
}
