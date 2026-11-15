using Microsoft.AspNetCore.Builder;
using RedBamboo.AppHost.Auth;
using RedBamboo.AppHost.Discovery;
using RedBamboo.AppHost.Extensions;
using Xunit;

namespace RedBamboo.AppHost.Tests.Auth;

/// <summary>
/// The built-in /login page offers only the external provider. An app with its own sign-in screen
/// (RedLeaf: password form, plus Google when configured) must be able to keep that page off /login,
/// or a signed-out password user lands on a page with no way back in (RedLeaf 0.1.49 field report).
/// </summary>
public sealed class LoginPageRouteTests
{
    private static string[] GetPatterns(bool? serveLoginPage)
    {
        var app = WebApplication.CreateSlimBuilder().Build();
        var registry = new EndpointRegistry(app);
        if (serveLoginPage is { } serve) registry.MapAuthEndpoints(serve);
        else registry.MapAuthEndpoints();
        return registry.GetEndpoints()
            .Where(endpoint => endpoint.Method == "GET" || endpoint.Method == "POST")
            .Select(endpoint => endpoint.Path)
            .ToArray();
    }

    [Fact]
    public void By_default_the_built_in_login_page_answers_login()
        => Assert.Contains("/login", GetPatterns(serveLoginPage: null));

    [Fact]
    public void An_app_with_its_own_sign_in_screen_keeps_login_for_itself()
    {
        var patterns = GetPatterns(serveLoginPage: false);
        Assert.DoesNotContain("/login", patterns);
        Assert.Contains("/auth/login", patterns);
        Assert.Contains("/auth/callback", patterns);
        Assert.Contains("/auth/refresh", patterns);
    }
}
