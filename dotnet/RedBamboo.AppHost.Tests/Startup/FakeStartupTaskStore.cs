using RedBamboo.AppHost.Startup;

namespace RedBamboo.AppHost.Tests.Startup;

/// <summary>
/// Task Scheduler and the Run key in memory. A task added with
/// <c>needsApproval</c> behaves like one an elevated schtasks created: the user's own
/// token cannot delete it.
/// </summary>
internal sealed class FakeStartupTaskStore : IStartupTaskStore
{
    private const int NeverRun = 0x00041303;
    private readonly Dictionary<string, (ScheduledStartupRegistration Registration, bool NeedsApproval)> _tasks =
        new(StringComparer.OrdinalIgnoreCase);

    public string? RunEntry { get; set; }
    public bool ExecutablePresent { get; set; } = true;
    public bool ApprovalGranted { get; set; } = true;
    public int ApprovalPrompts { get; private set; }
    public List<string> Operations { get; } = [];

    public void AddTask(string name, ScheduledStartupRegistration registration, bool needsApproval = false)
        => _tasks[name] = (registration, needsApproval);

    public bool Has(string name) => _tasks.ContainsKey(name);

    public bool ExecutableExists(string path) => ExecutablePresent;

    public ScheduledStartupRegistration? Query(string taskName)
        => _tasks.TryGetValue(taskName, out var task) ? task.Registration : null;

    public void Register(string taskName, string taskXml)
    {
        Operations.Add($"register {taskName}");
        _tasks[taskName] = (StartupManager.ParseTaskXml(taskXml, NeverRun), false);
    }

    public bool TryDelete(string taskName)
    {
        Operations.Add($"delete {taskName}");
        if (!_tasks.TryGetValue(taskName, out var task)) return true;
        if (task.NeedsApproval) return false;
        _tasks.Remove(taskName);
        return true;
    }

    public void DeleteWithApproval(string taskName)
    {
        ApprovalPrompts++;
        Operations.Add($"approve-delete {taskName}");
        if (!ApprovalGranted)
            throw new InvalidOperationException("The Windows administrator approval was cancelled.");
        _tasks.Remove(taskName);
    }

    public string? ReadRunEntry(string appName) => RunEntry;

    public void DeleteRunEntry(string appName)
    {
        if (RunEntry is not null) Operations.Add("delete run entry");
        RunEntry = null;
    }
}
