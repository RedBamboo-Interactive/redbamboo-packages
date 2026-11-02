namespace RedBamboo.AppHost.Auth;

public class BearerAuthOptions
{
    public required Func<string?> GetAccessToken { get; init; }

    /// <summary>
    /// Default matches the redsuite_token cookie that AppHost proxy/WS forwarding reads,
    /// so bearer-mode apps using defaults get cookie forwarding through proxies.
    /// </summary>
    public string CookieName { get; init; } = "redsuite_token";

    /// <summary>
    /// Prefixes the access token does not guard.
    /// </summary>
    public List<string> BypassPaths { get; init; } = ["/ping", "/api/remote/status"];

    /// <summary>
    /// Exact paths that answer without the access token. Agents must be able to learn what a service is
    /// before they hold a token for it; the handlers decide how much a stranger sees.
    /// </summary>
    public List<string> ExactBypassPaths { get; init; } = ["/discover", "/openapi.json"];
    public bool AllowQueryParamToken { get; init; } = true;
    public bool FallThroughOnFailure { get; init; } = false;
}
