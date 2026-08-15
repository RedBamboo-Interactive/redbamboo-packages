using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RedBamboo.AppHost.Auth;

public sealed record ExecutionAppIdentity(
    string Id,
    string Name,
    string? EntityId = null,
    string? Icon = null,
    string? Color = null);

public sealed record ExecutionActorIdentity(
    string Kind,
    string Id,
    string Name,
    string? EntityId = null,
    string? Avatar = null);

public sealed record ExecutionBeneficiaryIdentity(
    string Kind,
    string? Id = null,
    string? Name = null,
    string? Avatar = null,
    string? Reason = null);

public sealed record ExecutionContextReference(
    string Kind,
    string? Id = null,
    string? EntityId = null,
    string? Name = null,
    string? Route = null);

public sealed record ExecutionTrace(
    string? RequestId = null,
    string? CorrelationId = null,
    string? ParentJobId = null);

/// <summary>
/// Signed attribution carried by an execution access token. Authorization continues to come from
/// the token subject and roles; this record answers which app/actor is operating, for whose benefit,
/// and inside which product context.
/// </summary>
public sealed record ExecutionIdentity(
    int SchemaVersion,
    string ExecutionId,
    ExecutionAppIdentity App,
    ExecutionActorIdentity Actor,
    ExecutionBeneficiaryIdentity Beneficiary,
    IReadOnlyList<ExecutionContextReference> Context,
    string? ParentExecutionId = null,
    ExecutionTrace? Trace = null)
{
    public const int CurrentSchemaVersion = 1;

    public void Validate(string subjectId)
    {
        if (SchemaVersion != CurrentSchemaVersion)
            throw new ExecutionIdentityValidationException(
                $"Unsupported execution identity schema version {SchemaVersion}");
        if (!Guid.TryParse(ExecutionId, out _))
            throw new ExecutionIdentityValidationException("executionId must be a GUID");
        if (ParentExecutionId is not null && !Guid.TryParse(ParentExecutionId, out _))
            throw new ExecutionIdentityValidationException("parentExecutionId must be a GUID when supplied");
        if (Trace?.ParentJobId is not null && !Guid.TryParse(Trace.ParentJobId, out _))
            throw new ExecutionIdentityValidationException("trace.parentJobId must be a GUID when supplied");
        if (App is null)
            throw new ExecutionIdentityValidationException("app is required");
        if (string.IsNullOrWhiteSpace(App.Id) || string.IsNullOrWhiteSpace(App.Name))
            throw new ExecutionIdentityValidationException("app id and name are required");
        if (Actor is null)
            throw new ExecutionIdentityValidationException("actor is required");
        if (string.IsNullOrWhiteSpace(Actor.Kind) || string.IsNullOrWhiteSpace(Actor.Id)
            || string.IsNullOrWhiteSpace(Actor.Name))
            throw new ExecutionIdentityValidationException("actor kind, id, and name are required");
        if (Beneficiary is null)
            throw new ExecutionIdentityValidationException("beneficiary is required");
        if (Context is null)
            throw new ExecutionIdentityValidationException("context is required");
        if (Context.Count > 16)
            throw new ExecutionIdentityValidationException("execution identity accepts at most 16 context references");
        if (Context.Any(item => string.IsNullOrWhiteSpace(item.Kind)))
            throw new ExecutionIdentityValidationException("every context reference requires a kind");

        switch (Beneficiary.Kind.Trim().ToLowerInvariant())
        {
            case "user":
                if (string.IsNullOrWhiteSpace(Beneficiary.Id))
                    throw new ExecutionIdentityValidationException("a user beneficiary requires an id");
                if (!string.Equals(Beneficiary.Id, subjectId, StringComparison.OrdinalIgnoreCase))
                    throw new ExecutionIdentityValidationException(
                        "the authenticated subject must match the user beneficiary");
                break;
            case "system":
                if (string.IsNullOrWhiteSpace(Beneficiary.Reason))
                    throw new ExecutionIdentityValidationException(
                        "a system beneficiary requires an explicit reason");
                break;
            default:
                throw new ExecutionIdentityValidationException(
                    "beneficiary kind must be user or system");
        }
    }
}

public sealed record ExecutionPrincipal(
    string SubjectId,
    string Email,
    string? Name,
    IReadOnlyList<string> Roles,
    string? Avatar = null)
{
    public static ExecutionPrincipal FromClaims(ClaimsPrincipal principal)
    {
        var subject = principal.FindFirstValue(JwtRegisteredClaimNames.Sub)
            ?? throw new ExecutionIdentityValidationException("authenticated subject is missing");
        var roles = ExecutionIdentityClaims.ReadRoles(principal);
        return new ExecutionPrincipal(
            subject,
            principal.FindFirstValue(JwtRegisteredClaimNames.Email) ?? "",
            principal.FindFirstValue(JwtRegisteredClaimNames.Name),
            roles,
            principal.FindFirstValue("picture"));
    }
}

public sealed record IssuedExecutionToken(
    string AccessToken,
    DateTimeOffset ExpiresAt,
    ExecutionIdentity Identity);

public interface IExecutionTokenIssuer
{
    IssuedExecutionToken Issue(
        ExecutionIdentity identity,
        ExecutionPrincipal principal,
        TimeSpan? lifetime = null);

    IssuedExecutionToken Issue(
        ExecutionIdentity identity,
        ClaimsPrincipal principal,
        TimeSpan? lifetime = null)
        => Issue(identity, ExecutionPrincipal.FromClaims(principal), lifetime);
}

public sealed class ExecutionTokenIssuer(JwtService jwtService, JwtOptions options)
    : IExecutionTokenIssuer
{
    public IssuedExecutionToken Issue(
        ExecutionIdentity identity,
        ExecutionPrincipal principal,
        TimeSpan? lifetime = null)
    {
        var expiresAt = DateTimeOffset.UtcNow.Add(lifetime ?? options.ExecutionTokenLifetime);
        var token = jwtService.GenerateExecutionToken(identity, principal, expiresAt);
        return new IssuedExecutionToken(token, expiresAt, identity);
    }
}

public static class ExecutionIdentityClaims
{
    public const string TokenUseClaim = "token_use";
    public const string TokenUse = "execution";
    public const string IdentityClaim = "execution_identity";
    public const string HttpContextItemKey = "RedBamboo.ExecutionIdentity";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static string Serialize(ExecutionIdentity identity)
        => JsonSerializer.Serialize(identity, JsonOptions);

    public static bool TryRead(
        ClaimsPrincipal principal,
        out ExecutionIdentity? identity,
        out string? error)
    {
        identity = null;
        error = null;
        if (!string.Equals(principal.FindFirstValue(TokenUseClaim), TokenUse,
                StringComparison.OrdinalIgnoreCase))
            return false;

        var raw = principal.FindFirstValue(IdentityClaim);
        if (string.IsNullOrWhiteSpace(raw))
        {
            error = "execution identity claim is missing";
            return false;
        }

        try
        {
            identity = JsonSerializer.Deserialize<ExecutionIdentity>(raw, JsonOptions)
                ?? throw new ExecutionIdentityValidationException("execution identity is empty");
            var subject = principal.FindFirstValue(JwtRegisteredClaimNames.Sub)
                ?? throw new ExecutionIdentityValidationException("authenticated subject is missing");
            identity.Validate(subject);
            return true;
        }
        catch (Exception ex) when (ex is JsonException or ExecutionIdentityValidationException)
        {
            identity = null;
            error = ex.Message;
            return false;
        }
    }

    public static string[] ReadRoles(ClaimsPrincipal principal)
    {
        var values = principal.FindAll("roles").Select(claim => claim.Value).ToArray();
        if (values.Length == 1 && values[0].StartsWith('['))
        {
            try { return JsonSerializer.Deserialize<string[]>(values[0]) ?? []; }
            catch (JsonException) { return []; }
        }
        return values;
    }
}

public static class ExecutionContextScope
{
    private static readonly AsyncLocal<ExecutionIdentity?> CurrentValue = new();

    public static ExecutionIdentity? Current => CurrentValue.Value;

    public static IDisposable Push(ExecutionIdentity identity)
    {
        var previous = CurrentValue.Value;
        CurrentValue.Value = identity;
        return new Restore(() => CurrentValue.Value = previous);
    }

    private sealed class Restore(Action restore) : IDisposable
    {
        public void Dispose() => restore();
    }
}

public sealed class ExecutionIdentityValidationException(string message) : Exception(message);
