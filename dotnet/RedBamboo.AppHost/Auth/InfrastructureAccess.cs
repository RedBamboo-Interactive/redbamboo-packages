using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace RedBamboo.AppHost.Auth;

/// <summary>
/// The host's own operating routes (remote access and its tokens, logs, telemetry) answer only a
/// caller on this machine or a signed-in admin. They carry no entity type, so the permission
/// service never sees them: without this any authenticated remote caller could read the tunnel's
/// access token or mint a new one.
/// </summary>
public static class InfrastructureAccess
{
    public static bool Allows(HttpContext context)
        => RequestOrigin.IsLocal(context) || IsAdmin(context.User);

    public static bool IsAdmin(ClaimsPrincipal user)
    {
        if (user.Identity?.IsAuthenticated != true) return false;
        foreach (var claim in user.FindAll("roles"))
        {
            if (!claim.Value.StartsWith('['))
            {
                if (claim.Value == "admin") return true;
                continue;
            }
            try
            {
                if (JsonSerializer.Deserialize<string[]>(claim.Value)?.Contains("admin") == true) return true;
            }
            catch (JsonException)
            {
                // A malformed roles claim grants nothing.
            }
        }
        return false;
    }

    public static TBuilder RequireInfrastructureAccess<TBuilder>(this TBuilder builder)
        where TBuilder : IEndpointConventionBuilder
        => builder.AddEndpointFilter(async (context, next) => Allows(context.HttpContext)
            ? await next(context)
            : Results.Json(
                new { error = "forbidden", message = "You don't have permission to perform this action" },
                statusCode: StatusCodes.Status403Forbidden));
}
