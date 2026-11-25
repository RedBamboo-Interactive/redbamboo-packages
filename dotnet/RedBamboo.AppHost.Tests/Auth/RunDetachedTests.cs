using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using RedBamboo.AppHost.Auth;
using Xunit;

namespace RedBamboo.AppHost.Tests.Auth;

/// <summary>
/// 2026-11-25: a kernel restarted from inside an Agent's request started a whole new host, and every
/// loop of that host inherited the request's execution scope. Work started through
/// <see cref="ExecutionContextScope.RunDetachedAsync(Func{Task})"/> begins with nothing ambient, however deep the caller's scopes are.
/// </summary>
public sealed class RunDetachedTests
{
    private static readonly AsyncLocal<string?> OtherAmbient = new();

    [Fact]
    public async Task A_host_started_from_inside_a_request_runs_its_loops_with_no_ambient_identity()
    {
        using var requestHost = new CancellationTokenSource();
        var probe = new LoopProbe();
        IHost? host = null;
        try
        {
            using (ExecutionContextScope.PushRequest(Identity("request-x"), requestHost.Token))
            using (ExecutionContextScope.Push(Identity("carrier-y")))
            {
                OtherAmbient.Value = "request-local";
                await ExecutionContextScope.RunDetachedAsync(async () =>
                {
                    host = new HostBuilder()
                        .ConfigureServices(services => services
                            .AddSingleton(probe)
                            .AddHostedService<RecordingLoop>())
                        .Build();
                    await host.StartAsync();
                });
                // The caller's own flow is untouched by the detachment.
                Assert.Equal("carrier-y", ExecutionContextScope.Current?.ExecutionId);
                Assert.Equal("request-local", OtherAmbient.Value);
            }

            var seen = await probe.Seen.Task.WaitAsync(TimeSpan.FromSeconds(10));
            Assert.Equal<(string?, string?, string?)>((null, null, null), seen);
        }
        finally
        {
            if (host is not null)
            {
                await host.StopAsync();
                host.Dispose();
            }
        }
    }

    [Fact]
    public async Task Detached_work_returns_its_result_and_its_failure_to_the_caller()
    {
        using (ExecutionContextScope.Push(Identity("caller")))
        {
            Assert.Null(await ExecutionContextScope.RunDetachedAsync(() => Task.FromResult(ExecutionContextScope.Current)));
            var error = await Assert.ThrowsAsync<InvalidOperationException>(
                () => ExecutionContextScope.RunDetachedAsync(new Func<Task>(() => throw new InvalidOperationException("boom"))));
            Assert.Equal("boom", error.Message);
        }
    }

    [Fact]
    public async Task Detaching_where_flow_is_already_suppressed_is_harmless()
    {
        Task<ExecutionIdentity?> inner;
        using (ExecutionContextScope.Push(Identity("caller")))
        {
            using (ExecutionContext.SuppressFlow())
                inner = ExecutionContextScope.RunDetachedAsync(() => Task.FromResult(ExecutionContextScope.Current));
            Assert.Null(await inner);
        }
    }

    private sealed class LoopProbe
    {
        public TaskCompletionSource<(string?, string?, string?)> Seen { get; }
            = new(TaskCreationOptions.RunContinuationsAsynchronously);
    }

    private sealed class RecordingLoop(LoopProbe probe) : BackgroundService
    {
        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            // A loop's later iterations, after the request that restarted the host is long gone.
            await Task.Yield();
            await Task.Delay(10, stoppingToken);
            probe.Seen.TrySetResult((ExecutionContextScope.Current?.ExecutionId,
                ExecutionContextScope.Live?.ExecutionId, OtherAmbient.Value));
        }
    }

    private static ExecutionIdentity Identity(string id) => new(
        ExecutionIdentity.CurrentSchemaVersion,
        id,
        new ExecutionAppIdentity("nova", "Nova", null, null, null),
        new ExecutionActorIdentity("agent", "nova", "Nova", null, null),
        new ExecutionBeneficiaryIdentity("user", "user-1", "User", null, null),
        []);
}
