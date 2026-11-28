namespace RedBamboo.AppHost.Telemetry.FlightRecorder;

/// <summary>
/// A root process and its direct children, summed (PostgreSQL's postmaster and its backends are
/// exactly that shape). CPU and I/O are kept cumulative across processes that come and go, so the
/// sampler's interval values stay right while backends start and exit.
///
/// Windows: the children are found among <c>candidates</c> (RedLeaf passes the process ids of its
/// kernel Job Object, one call) by parent id, each new id classified once; tracked processes keep
/// an open handle, so even one that exited since the last sample gives its final CPU and I/O. No
/// whole-system snapshot. Linux: <c>/proc/[root]/task/[root]/children</c> (a scan of <c>/proc</c>
/// at most once a minute where the kernel lacks that file); a backend that exits between two samples
/// loses the CPU of its last partial interval. Summed working set counts shared memory (PostgreSQL's
/// shared buffers) once per process; private bytes do not.
/// </summary>
public sealed class ProcessTreeProbe : IProcessGroupProbe, IDisposable
{
    private static readonly TimeSpan LinuxRescanInterval = TimeSpan.FromMinutes(1);

    private readonly Func<int?> _rootProcessId;
    private readonly Func<IReadOnlyList<int>?>? _candidates;
    private readonly Dictionary<int, Tracked> _tracked = [];
    private readonly HashSet<int> _notInTree = [];
    private readonly HashSet<int> _seen = [];
    private readonly List<int> _removed = [];
    private readonly List<int> _children = [];
    private readonly object _gate = new();

    private int? _root;
    private TimeSpan _retiredCpu;
    private long _retiredRead;
    private long _retiredWritten;
    private bool _ioAvailable = true;
    private long _lastLinuxScan = long.MinValue;

    /// <param name="name">Group name in the sample rows, e.g. "postgres".</param>
    /// <param name="rootProcessId">The root process id now, or null when the group is not running.</param>
    /// <param name="candidates">Windows: the process ids that may belong to the tree. Ignored on Linux.</param>
    public ProcessTreeProbe(string name, Func<int?> rootProcessId, Func<IReadOnlyList<int>?>? candidates = null)
    {
        Name = name;
        _rootProcessId = rootProcessId;
        _candidates = candidates;
    }

    public string Name { get; }

    public bool TryRead(out ProcessGroupReading reading)
    {
        lock (_gate)
        {
            reading = default;
            int? root;
            try { root = _rootProcessId(); }
            catch { root = null; }

            if (root != _root)
            {
                // A new postmaster is a new group: nothing carries over, and the sampler sees the reset.
                RetireAll();
                _root = root;
            }
            if (root is not { } rootId) return false;

            return OperatingSystem.IsWindows() ? ReadWindows(rootId, out reading)
                : OperatingSystem.IsLinux() ? ReadLinux(rootId, out reading)
                : false;
        }
    }

    private bool ReadWindows(int root, out ProcessGroupReading reading)
    {
        IReadOnlyList<int>? candidates = null;
        try { candidates = _candidates?.Invoke(); }
        catch { /* the root alone still reads */ }

        _seen.Clear();
        _seen.Add(root);
        if (candidates is not null)
            foreach (var id in candidates) _seen.Add(id);

        foreach (var id in _seen)
        {
            if (_tracked.ContainsKey(id) || _notInTree.Contains(id)) continue;
            var handle = NativeProcess.Windows.OpenProcess(NativeProcess.ProcessQueryLimitedInformation, false, id);
            if (handle == 0)
            {
                _notInTree.Add(id);
                continue;
            }
            var belongs = id == root || NativeProcess.Windows.ParentProcessId(handle) == root;
            if (!belongs || !NativeProcess.Windows.TryReadTimes(handle, out _, out var creation))
            {
                NativeProcess.Windows.CloseHandle(handle);
                _notInTree.Add(id);
                continue;
            }
            _tracked[id] = new Tracked { Handle = handle, Identity = creation };
        }
        _notInTree.RemoveWhere(id => !_seen.Contains(id));

        var count = 0;
        var cpu = TimeSpan.Zero;
        long workingSet = 0, privateBytes = 0, read = 0, written = 0;
        _removed.Clear();
        foreach (var (id, process) in _tracked)
        {
            if (NativeProcess.Windows.TryReadTimes(process.Handle, out var processCpu, out _)) process.Cpu = processCpu;
            if (NativeProcess.Windows.TryReadIo(process.Handle, out var r, out var w))
            {
                process.Read = r;
                process.Written = w;
            }

            if (!_seen.Contains(id) || NativeProcess.Windows.HasExited(process.Handle))
            {
                _removed.Add(id);
                continue;
            }

            count++;
            cpu += process.Cpu;
            read += process.Read;
            written += process.Written;
            if (NativeProcess.Windows.TryReadMemory(process.Handle, out var ws, out var priv))
            {
                workingSet += ws;
                privateBytes += priv;
            }
        }
        foreach (var id in _removed) Retire(id);

        if (count == 0)
        {
            reading = default;
            return false;
        }
        reading = new ProcessGroupReading(count, _retiredCpu + cpu, workingSet, privateBytes,
            _retiredRead + read, _retiredWritten + written);
        return true;
    }

    private bool ReadLinux(int root, out ProcessGroupReading reading)
    {
        _seen.Clear();
        _seen.Add(root);
        if (NativeProcess.Linux.TryReadChildren(root, _children))
        {
            foreach (var id in _children) _seen.Add(id);
        }
        else
        {
            // No children file: keep the ones already known, and look for new ones at most once a minute.
            foreach (var id in _tracked.Keys) _seen.Add(id);
            var now = Environment.TickCount64;
            if (_lastLinuxScan == long.MinValue || now - _lastLinuxScan >= (long)LinuxRescanInterval.TotalMilliseconds)
            {
                _lastLinuxScan = now;
                ScanProcForChildren(root);
            }
        }

        var count = 0;
        var cpu = TimeSpan.Zero;
        long workingSet = 0, privateBytes = 0, read = 0, written = 0;
        var ioComplete = _ioAvailable;
        _removed.Clear();

        foreach (var id in _seen)
        {
            if (!NativeProcess.Linux.TryReadStat($"/proc/{id}/stat", out var stat)
                || (id != root && stat.ParentId != root))
            {
                if (_tracked.ContainsKey(id)) _removed.Add(id);
                continue;
            }

            if (!_tracked.TryGetValue(id, out var process) || process.Identity != stat.StartTicks)
            {
                if (process is not null) Retire(id);
                process = new Tracked { Identity = stat.StartTicks };
                _tracked[id] = process;
            }

            process.Cpu = stat.Cpu;
            if (ioComplete && NativeProcess.Linux.TryReadIo($"/proc/{id}/io", out var r, out var w))
            {
                process.Read = r;
                process.Written = w;
            }
            else
            {
                ioComplete = false;
            }

            count++;
            cpu += process.Cpu;
            read += process.Read;
            written += process.Written;
            if (NativeProcess.Linux.TryReadStatm($"/proc/{id}/statm", out var resident, out var shared))
            {
                workingSet += resident;
                privateBytes += Math.Max(0, resident - shared);
            }
            else
            {
                workingSet += stat.ResidentBytes;
            }
        }

        foreach (var id in _tracked.Keys)
            if (!_seen.Contains(id)) _removed.Add(id);
        foreach (var id in _removed) Retire(id);

        // /proc/[pid]/io is unreadable for another user's processes: report no I/O rather than a partial sum.
        _ioAvailable = ioComplete;

        if (count == 0)
        {
            reading = default;
            return false;
        }
        reading = new ProcessGroupReading(count, _retiredCpu + cpu, workingSet, privateBytes,
            ioComplete ? _retiredRead + read : null, ioComplete ? _retiredWritten + written : null);
        return true;
    }

    private void ScanProcForChildren(int root)
    {
        try
        {
            foreach (var directory in Directory.EnumerateDirectories("/proc"))
            {
                var name = Path.GetFileName(directory.AsSpan());
                if (!int.TryParse(name, out var id) || _seen.Contains(id)) continue;
                if (NativeProcess.Linux.TryReadStat($"/proc/{id}/stat", out var stat) && stat.ParentId == root)
                    _seen.Add(id);
            }
        }
        catch
        {
            // Best effort: the known processes still read.
        }
    }

    private void Retire(int id)
    {
        if (!_tracked.Remove(id, out var process)) return;
        _retiredCpu += process.Cpu;
        _retiredRead += process.Read;
        _retiredWritten += process.Written;
        if (process.Handle != 0) NativeProcess.Windows.CloseHandle(process.Handle);
    }

    private void RetireAll()
    {
        foreach (var process in _tracked.Values)
            if (process.Handle != 0) NativeProcess.Windows.CloseHandle(process.Handle);
        _tracked.Clear();
        _notInTree.Clear();
        _retiredCpu = TimeSpan.Zero;
        _retiredRead = _retiredWritten = 0;
        _ioAvailable = true;
        _lastLinuxScan = long.MinValue;
    }

    public void Dispose()
    {
        lock (_gate) RetireAll();
    }

    private sealed class Tracked
    {
        public nint Handle;
        public long Identity;
        public TimeSpan Cpu;
        public long Read;
        public long Written;
    }
}
