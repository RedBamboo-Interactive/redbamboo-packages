using System.Security.Claims;
using RedBamboo.AppHost.Auth;

namespace RedBamboo.AppHost.WebSockets;

public enum WebSocketPrincipalKind
{
    /// <summary>No identity (a host without auth, or an unauthenticated upgrade).</summary>
    Anonymous,

    /// <summary>A person's browser badge. Carries the device session when the badge has one.</summary>
    Person,

    /// <summary>A tokenless loopback browser (LocalDefault): the person at this computer.</summary>
    LocalAccess,

    /// <summary>An execution badge: an Agent, an automation, or an app acting for someone.</summary>
    Execution,

    /// <summary>A suite service, or the tunnel shared secret.</summary>
    Service,
}

/// <summary>Who holds a WebSocket connection, captured at the upgrade.</summary>
public sealed record WebSocketPrincipal(WebSocketPrincipalKind Kind, string? UserId, string? SessionId)
{
    public static readonly WebSocketPrincipal Anonymous = new(WebSocketPrincipalKind.Anonymous, null, null);

    public static WebSocketPrincipal From(ClaimsPrincipal? user)
    {
        if (user?.Identity?.IsAuthenticated != true) return Anonymous;
        var sub = user.FindFirstValue("sub");
        if (string.IsNullOrEmpty(sub)) return Anonymous;

        var authType = user.Identity.AuthenticationType;
        if (string.Equals(authType, ConfidentialResourcePolicy.LocalDefaultAuthenticationType, StringComparison.Ordinal))
            return new(WebSocketPrincipalKind.LocalAccess, sub, null);

        var sessionId = user.FindFirstValue(SessionClaims.SessionId);
        if (string.Equals(user.FindFirstValue(ExecutionIdentityClaims.TokenUseClaim), ExecutionIdentityClaims.TokenUse,
                StringComparison.OrdinalIgnoreCase))
            return new(WebSocketPrincipalKind.Execution, sub, sessionId);

        if (string.Equals(authType, "BearerToken", StringComparison.Ordinal)
            || sub == "service" || sub.StartsWith("service:", StringComparison.Ordinal))
            return new(WebSocketPrincipalKind.Service, sub, null);

        return new(WebSocketPrincipalKind.Person, sub, sessionId);
    }
}
