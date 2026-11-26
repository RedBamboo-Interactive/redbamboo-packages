using System.Collections.Concurrent;
using System.Diagnostics;
using RedBamboo.AppHost.Tunnel;
using Xunit;

namespace RedBamboo.AppHost.Tests.Tunnel;

/// <summary>Runs alone: these measure the process-wide thread pool, which any parallel test would disturb.</summary>
[CollectionDefinition(nameof(TunnelThreadPoolMeasurementCollection), DisableParallelization = true)]
public sealed class TunnelThreadPoolMeasurementCollection;

/// <summary>
/// N19 (2026-11-26): cloudflared's stdout and stderr were read with BeginOutputReadLine/BeginErrorReadLine. On
/// Windows, Process gives synchronous pipes, so each pending read parks one pool worker in a blocking ReadFile for
/// the tunnel's whole life: the last two pinned workers in the RedLeaf kernel once its managed children were moved
/// off the pool. Its output is now read on threads of its own. The children here are ping.exe: one line a second on
/// stdout, and a silent stderr whose pending read pins a worker just the same.
/// </summary>
[Collection(nameof(TunnelThreadPoolMeasurementCollection))]
public sealed class CloudflareTunnelOutputTests
{
    private const int Children = 5;

    [Fact]
    public void Cloudflareds_output_is_read_off_the_thread_pool()
    {
        using var children = new PingChildren(Children, count: 60);
        var onPool = new ConcurrentBag<bool>();
        using var firstLines = new CountdownEvent(Children);
        foreach (var child in children.Processes)
        {
            var seen = 0;
            CloudflareTunnelService.ReadOutput(child, _ =>
            {
                onPool.Add(Thread.CurrentThread.IsThreadPoolThread);
                if (Interlocked.Exchange(ref seen, 1) == 0) firstLines.Signal();
            });
        }

        Assert.True(firstLines.Wait(TimeSpan.FromSeconds(15)), "Not every child's first line arrived.");
        Assert.DoesNotContain(true, onPool);
    }

    /// <summary>The probe's shape: queued work items must all get a thread at once while tunnels are read.</summary>
    [Fact]
    public void Queued_work_gets_a_thread_at_once_while_cloudflared_is_read()
    {
        using var children = new PingChildren(Children, count: 60);
        using var firstLines = new CountdownEvent(Children);
        foreach (var child in children.Processes)
        {
            var seen = 0;
            CloudflareTunnelService.ReadOutput(child, _ =>
            {
                if (Interlocked.Exchange(ref seen, 1) == 0) firstLines.Signal();
            });
        }
        Assert.True(firstLines.Wait(TimeSpan.FromSeconds(15)), "Not every child's first line arrived.");

        ThreadPool.GetMinThreads(out var minWorkers, out _);
        var items = Math.Max(2, minWorkers - 2);
        using var started = new CountdownEvent(items);
        using var release = new ManualResetEventSlim();
        var clock = Stopwatch.StartNew();
        for (var i = 0; i < items; i++)
            ThreadPool.UnsafeQueueUserWorkItem(_ =>
            {
                started.Signal();
                release.Wait(TimeSpan.FromSeconds(30));
            }, null);
        var allStarted = started.Wait(TimeSpan.FromSeconds(20));
        var elapsed = clock.Elapsed;
        release.Set();

        Assert.True(allStarted, $"{items} queued work items did not all get a thread within 20 s.");
        Assert.True(elapsed < TimeSpan.FromSeconds(1),
            $"{items} queued work items took {elapsed.TotalMilliseconds:F0} ms to all get a thread while {Children} " +
            $"tunnels were read (pool minimum {minWorkers}); without pinned readers it takes milliseconds.");
    }

    /// <summary>Stopping the tunnel kills cloudflared, and that alone must end both readers.</summary>
    [Fact]
    public void Killing_the_process_ends_both_readers()
    {
        using var children = new PingChildren(1, count: 60);
        var child = children.Processes[0];
        using var firstLine = new ManualResetEventSlim();
        var reading = CloudflareTunnelService.ReadOutput(child, _ => firstLine.Set());
        Assert.True(firstLine.Wait(TimeSpan.FromSeconds(15)), "The child's first line did not arrive.");
        Assert.False(reading.IsCompleted);

        child.Kill(entireProcessTree: true);

        Assert.True(reading.Wait(TimeSpan.FromSeconds(10)), "The readers did not end after the process was killed.");
    }

    /// <summary>A throwing line handler (a StatusChanged subscriber) is reported and never stops the draining.</summary>
    [Fact]
    public void A_throwing_handler_is_reported_and_reading_goes_on()
    {
        using var children = new PingChildren(1, count: 4);
        var lines = 0;
        var errors = new ConcurrentQueue<Exception>();
        var reading = CloudflareTunnelService.ReadOutput(children.Processes[0], _ =>
        {
            Interlocked.Increment(ref lines);
            throw new InvalidOperationException("subscriber failed");
        }, errors.Enqueue);

        Assert.True(reading.Wait(TimeSpan.FromSeconds(20)), "The readers did not reach the end of the output.");
        Assert.True(lines > 1, $"Reading stopped after the first throwing line ({lines} line(s)).");
        Assert.Equal(lines, errors.Count);
    }

    private sealed class PingChildren : IDisposable
    {
        public List<Process> Processes { get; } = [];

        public PingChildren(int children, int count)
        {
            var ping = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "ping.exe");
            for (var i = 0; i < children; i++)
            {
                var child = Process.Start(new ProcessStartInfo(ping, $"127.0.0.1 -n {count}")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                }) ?? throw new InvalidOperationException("ping.exe did not start.");
                Processes.Add(child);
            }
        }

        public void Dispose()
        {
            foreach (var child in Processes)
            {
                try { child.Kill(entireProcessTree: true); child.WaitForExit(5000); }
                catch (InvalidOperationException) { }
                child.Dispose();
            }
        }
    }
}
