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
    bool Confidential,
    string? OwnerAppId = null);

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
            var owningAgent = execution.Actor.Kind.Equals("agent", StringComparison.OrdinalIgnoreCase)
                && string.Equals(actorId, resource.OwnerAgentId, StringComparison.OrdinalIgnoreCase)
                && execution.Beneficiary.Kind.Equals("user", StringComparison.OrdinalIgnoreCase)
                && string.Equals(execution.Beneficiary.Id, resource.OwnerUserId,
                    StringComparison.OrdinalIgnoreCase);
            return owningAgent || IsOwnerOperatedBrowserExecution(execution, resource);
        }

        if (!IsExplicitHuman(principal)) return false;
        return string.Equals(principal.FindFirstValue("sub"), resource.OwnerUserId,
            StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsOwnerOperatedBrowserExecution(
        ExecutionIdentity execution,
        ConfidentialResource resource)
    {
        if (string.IsNullOrWhiteSpace(resource.OwnerAppId)
            || !execution.Actor.Kind.Equals("app", StringComparison.OrdinalIgnoreCase)
            || !string.Equals(execution.App.Id, resource.OwnerAppId,
                StringComparison.OrdinalIgnoreCase)
            || !string.Equals(execution.Actor.Id, execution.App.Id,
                StringComparison.OrdinalIgnoreCase)
            || !execution.Beneficiary.Kind.Equals("user", StringComparison.OrdinalIgnoreCase)
            || !string.Equals(execution.Beneficiary.Id, resource.OwnerUserId,
                StringComparison.OrdinalIgnoreCase))
            return false;

        if (!string.IsNullOrWhiteSpace(execution.App.EntityId)
            && !string.Equals(execution.Actor.EntityId, execution.App.EntityId,
                StringComparison.OrdinalIgnoreCase))
            return false;

        var hasBrowserContext = execution.Context.Any(item =>
            item.Kind.Equals("browser", StringComparison.OrdinalIgnoreCase)
            && !string.IsNullOrWhiteSpace(item.Route));
        if (!hasBrowserContext) return false;

        // A root browser token is the existing direct owner path. Nova's actual
        // transcript facade adds one signed RedLeaf -> RedCompute proxy hop while
        // preserving that browser identity. Admit only that exact derived shape;
        // arbitrary child executions remain outside the confidential boundary.
        if (execution.ParentExecutionId is null) return true;
        if (string.IsNullOrWhiteSpace(execution.ParentExecutionId)
            || execution.Context.Count != 2)
            return false;

        var browser = execution.Context[0];
        var proxy = execution.Context[1];
        return browser.Kind.Equals("browser", StringComparison.OrdinalIgnoreCase)
            && !string.IsNullOrWhiteSpace(browser.Route)
            && proxy.Kind.Equals("redcompute-call", StringComparison.OrdinalIgnoreCase)
            && proxy.Id is null
            && proxy.EntityId is null
            && proxy.Name is null
            && proxy.Route is null;
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
