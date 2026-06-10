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
    /// /discover and /openapi.json are public service metadata: agents must be able to
    /// learn what a service is before they hold a token for it (parity with JWT mode).
    /// </summary>
    public List<string> BypassPaths { get; init; } =
        ["/ping", "/api/remote/status", "/discover", "/openapi.json"];
    public bool AllowQueryParamToken { get; init; } = true;
    public bool FallThroughOnFailure { get; init; } = false;
}
