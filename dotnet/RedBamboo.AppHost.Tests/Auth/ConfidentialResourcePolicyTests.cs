using System.Security.Claims;
using RedBamboo.AppHost.Auth;
using Xunit;

namespace RedBamboo.AppHost.Tests.Auth;

/// <summary>
/// A confidential resource needs a human owner; its owning agent is optional. The owner reads it
/// either way, the owning agent only when one is set, and nobody reads one with no owner.
/// </summary>
public class ConfidentialResourcePolicyTests
{
    private const string Owner = "laurent";
    private const string Agent = "agent-nova";

    private static readonly ConfidentialResource OwnerAndAgent = new(Owner, Agent, true);
    private static readonly ConfidentialResource OwnerOnly = new(Owner, null, true);
    private static readonly ConfidentialResource NoOwner = new(null, Agent, true);

    private static ClaimsPrincipal Human(string sub, string authenticationType = "Bearer")
        => new(new ClaimsIdentity([new Claim("sub", sub)], authenticationType));

    private static ClaimsPrincipal ExecutionToken(string sub)
        => new(new ClaimsIdentity([
            new Claim("sub", sub),
            new Claim(ExecutionIdentityClaims.TokenUseClaim, ExecutionIdentityClaims.TokenUse),
        ], "Bearer"));

    private static ExecutionIdentity AgentRun(string agentId, string beneficiary) => new(
        ExecutionIdentity.CurrentSchemaVersion, Guid.NewGuid().ToString(),
        new ExecutionAppIdentity("nova", "Nova"),
        new ExecutionActorIdentity("agent", "nova", "Nova", agentId),
        new ExecutionBeneficiaryIdentity("user", beneficiary),
        []);

    private static ExecutionIdentity BrowserRun(string beneficiary) => new(
        ExecutionIdentity.CurrentSchemaVersion, Guid.NewGuid().ToString(),
        new ExecutionAppIdentity("nova", "Nova", "plugin-nova"),
        new ExecutionActorIdentity("app", "nova", "Nova", "plugin-nova"),
        new ExecutionBeneficiaryIdentity("user", beneficiary),
        [new ExecutionContextReference("browser", Route: "/apps/nova")]);

    private static bool Read(ClaimsPrincipal principal, ExecutionIdentity? execution, ConfidentialResource resource)
        => ConfidentialResourcePolicy.CanRead(principal, execution, resource);

    [Fact]
    public void A_resource_that_is_not_confidential_is_readable_by_anyone()
        => Assert.True(Read(new ClaimsPrincipal(), null, new ConfidentialResource(null, null, false)));

    [Fact]
    public void The_owner_reads_a_confidential_resource_with_or_without_an_owning_agent()
    {
        Assert.True(Read(Human(Owner), null, OwnerAndAgent));
        Assert.True(Read(Human(Owner), null, OwnerOnly));
        Assert.True(Read(Human("LAURENT"), null, OwnerOnly));
    }

    [Fact]
    public void Nobody_else_reads_it_and_neither_does_a_caller_that_is_not_an_explicit_human()
    {
        foreach (var resource in new[] { OwnerAndAgent, OwnerOnly })
        {
            Assert.False(Read(Human("someone-else"), null, resource));
            Assert.False(Read(Human(Owner, ConfidentialResourcePolicy.LocalDefaultAuthenticationType), null, resource));
            Assert.False(Read(ExecutionToken(Owner), null, resource));
            Assert.False(Read(new ClaimsPrincipal(), null, resource));
        }
    }

    [Fact]
    public void The_owning_agent_reads_it_only_for_the_owner()
    {
        Assert.True(Read(ExecutionToken(Owner), AgentRun(Agent, Owner), OwnerAndAgent));
        Assert.True(Read(ExecutionToken(Owner), AgentRun(Agent.ToUpperInvariant(), Owner), OwnerAndAgent));
        Assert.False(Read(ExecutionToken(Owner), AgentRun("agent-other", Owner), OwnerAndAgent));
        Assert.False(Read(ExecutionToken("someone-else"), AgentRun(Agent, "someone-else"), OwnerAndAgent));
        var forSystem = AgentRun(Agent, Owner) with { Beneficiary = new ExecutionBeneficiaryIdentity("system", Owner, Reason: "test") };
        Assert.False(Read(ExecutionToken(Owner), forSystem, OwnerAndAgent));
        var appActor = AgentRun(Agent, Owner) with { Actor = new ExecutionActorIdentity("app", Agent, "Nova", Agent) };
        Assert.False(Read(ExecutionToken(Owner), appActor, OwnerAndAgent));
    }

    [Fact]
    public void Without_an_owning_agent_no_agent_reads_it_even_for_the_owner()
    {
        Assert.False(Read(ExecutionToken(Owner), AgentRun(Agent, Owner), OwnerOnly));
        Assert.False(Read(ExecutionToken(Owner), AgentRun("", Owner), OwnerOnly));
        // An execution is judged as the execution, never as the human whose token carries it.
        Assert.False(Read(Human(Owner), AgentRun(Agent, Owner), OwnerOnly));
    }

    [Fact]
    public void Without_an_owner_nobody_reads_it()
    {
        Assert.False(Read(Human(Owner), null, NoOwner));
        Assert.False(Read(ExecutionToken(Owner), AgentRun(Agent, Owner), NoOwner));
        Assert.False(Read(ExecutionToken(Owner), BrowserRun(Owner), NoOwner with { OwnerAppId = "nova" }));
        Assert.False(Read(Human(Owner), null, new ConfidentialResource("  ", null, true)));
    }

    [Fact]
    public void The_owner_in_the_owning_apps_browser_reads_it_with_or_without_an_owning_agent()
    {
        foreach (var resource in new[] { OwnerAndAgent, OwnerOnly })
        {
            Assert.True(Read(ExecutionToken(Owner), BrowserRun(Owner), resource with { OwnerAppId = "nova" }));
            Assert.False(Read(ExecutionToken(Owner), BrowserRun(Owner), resource));
            Assert.False(Read(ExecutionToken(Owner), BrowserRun(Owner), resource with { OwnerAppId = "mail" }));
            Assert.False(Read(ExecutionToken("someone-else"), BrowserRun("someone-else"), resource with { OwnerAppId = "nova" }));
            Assert.False(Read(ExecutionToken(Owner), BrowserRun(Owner) with { Context = [] }, resource with { OwnerAppId = "nova" }));
        }
    }
}
