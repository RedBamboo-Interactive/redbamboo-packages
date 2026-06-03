using Microsoft.AspNetCore.Http;

namespace RedBamboo.AppHost.Auth;

public sealed class UserDetectionMiddleware
{
    private readonly RequestDelegate _next;

    public UserDetectionMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context, AuthenticatedHttpClientFactory factory)
    {
        var sub = context.User?.FindFirst("sub")?.Value;
        if (sub is not null && sub != "local-user")
        {
            var email = context.User!.FindFirst("email")?.Value ?? "";
            var name = context.User!.FindFirst("name")?.Value;
            factory.OnUserAuthenticated(sub, email, name);
        }
        await _next(context);
    }
}
