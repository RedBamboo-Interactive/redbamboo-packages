using System.Security.Claims;
using Microsoft.AspNetCore.Http;

namespace RedBamboo.AppHost.Auth;

/// <summary>
/// The small, suite-wide read boundary for resources marked confidential.
/// Ordinary resources continue to use each application's existing permission model.
/// </summary>
public sealed record ConfidentialResource(
    string? OwnerUserId,
    string? OwnerAgentId,
    bool Confidential);

public static class ConfidentialResourcePolicy
{
    public const string LocalDefaultAuthenticationType = "LocalDefault";

    public static bool CanRead(HttpContext context, ConfidentialResource resource)
        => CanRead(context.User, ExecutionIdentity(context), resource);

    public static bool CanRead(
        ClaimsPrincipal principal,
        ExecutionIdentity? execution,
        ConfidentialResource resource)
    {
        if (!resource.Confidential) return true;
        if (string.IsNullOrWhiteSpace(resource.OwnerUserId)
            || string.IsNullOrWhiteSpace(resource.OwnerAgentId))
            return false;

        if (execution is not null)
        {
            var actorId = execution.Actor.EntityId ?? execution.Actor.Id;
            return execution.Actor.Kind.Equals("agent", StringComparison.OrdinalIgnoreCase)
                && string.Equals(actorId, resource.OwnerAgentId, StringComparison.OrdinalIgnoreCase)
                && execution.Beneficiary.Kind.Equals("user", StringComparison.OrdinalIgnoreCase)
                && string.Equals(execution.Beneficiary.Id, resource.OwnerUserId,
                    StringComparison.OrdinalIgnoreCase);
        }

        if (!IsExplicitHuman(principal)) return false;
        return string.Equals(principal.FindFirstValue("sub"), resource.OwnerUserId,
            StringComparison.OrdinalIgnoreCase);
    }

    public static bool CanManageConfidentiality(
        ClaimsPrincipal principal,
        ExecutionIdentity? execution,
        string? ownerUserId)
        => execution is null
            && IsExplicitHuman(principal)
            && !string.IsNullOrWhiteSpace(ownerUserId)
            && string.Equals(principal.FindFirstValue("sub"), ownerUserId,
                StringComparison.OrdinalIgnoreCase);

    public static bool IsExplicitHuman(ClaimsPrincipal principal)
        => principal.Identity?.IsAuthenticated == true
            && !string.Equals(principal.Identity.AuthenticationType,
                LocalDefaultAuthenticationType, StringComparison.Ordinal)
            && !string.Equals(principal.FindFirstValue(ExecutionIdentityClaims.TokenUseClaim),
                ExecutionIdentityClaims.TokenUse, StringComparison.OrdinalIgnoreCase);

    public static ExecutionIdentity? ExecutionIdentity(HttpContext context)
        => context.Items.TryGetValue(ExecutionIdentityClaims.HttpContextItemKey, out var value)
            ? value as ExecutionIdentity
            : null;
}
