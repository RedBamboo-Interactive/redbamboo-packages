using RedBamboo.AppHost.Auth;
using Xunit;

namespace RedBamboo.AppHost.Tests.Auth;

/// <summary>
/// An execution identity pushed for a request is captured by anything started inside it:
/// Task.Run, timers, a whole restarted host. 2026-11-25: a kernel restarted from an Agent's
/// request ran every plugin loop as that Agent. A request scope therefore stays live only while
/// the host that served the request runs; an explicit scope is the deliberate carrier.
/// </summary>
public sealed class ExecutionContextScopeTests
{
    [Fact]
    public async Task A_request_scope_is_live_for_its_own_host_and_dead_once_that_host_stops()
    {
        using var host = new CancellationTokenSource();
        var identity = Identity("request");
        Task<(ExecutionIdentity? Current, ExecutionIdentity? Live)> Observe() =>
            Task.Run(() => (ExecutionContextScope.Current, ExecutionContextScope.Live));

        Task<(ExecutionIdentity?, ExecutionIdentity?)> during;
        using (ExecutionContextScope.PushRequest(identity, host.Token))
        {
            Assert.Same(identity, ExecutionContextScope.Live);
            during = Observe();
        }

        // A follow-up the request started on the same host still acts for the caller.
        Assert.Equal((identity, identity), await during);

        // A copy captured inside the request, seen after its host stopped, is a leak.
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        Task<(ExecutionIdentity?, ExecutionIdentity?)> captured;
        using (ExecutionContextScope.PushRequest(identity, host.Token))
            captured = Task.Run(async () =>
            {
                await release.Task;
                return (ExecutionContextScope.Current, ExecutionContextScope.Live);
            });
        host.Cancel();
        release.SetResult();
        var (current, live) = await captured;
        Assert.Same(identity, current);
        Assert.Null(live);
    }

    [Fact]
    public async Task An_explicit_scope_stays_live_for_the_work_it_carries()
    {
        var identity = Identity("explicit");
        Task<ExecutionIdentity?> carried;
        using (ExecutionContextScope.Push(identity))
            carried = Task.Run(() => ExecutionContextScope.Live);

        Assert.Same(identity, await carried);
    }

    [Fact]
    public void Disposing_restores_the_previous_scope()
    {
        using var host = new CancellationTokenSource();
        var outer = Identity("outer");
        using (ExecutionContextScope.Push(outer))
        {
            using (ExecutionContextScope.PushRequest(Identity("inner"), host.Token))
                Assert.NotSame(outer, ExecutionContextScope.Current);
            Assert.Same(outer, ExecutionContextScope.Current);
            Assert.Same(outer, ExecutionContextScope.Live);
        }
        Assert.Null(ExecutionContextScope.Current);
    }

    private static ExecutionIdentity Identity(string id) => new(
        ExecutionIdentity.CurrentSchemaVersion,
        id,
        new ExecutionAppIdentity("nova", "Nova", null, null, null),
        new ExecutionActorIdentity("agent", "nova", "Nova", null, null),
        new ExecutionBeneficiaryIdentity("user", "user-1", "User", null, null),
        []);
}
