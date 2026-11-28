using System.Runtime.InteropServices;

namespace RedBamboo.AppHost.Telemetry.FlightRecorder;

/// <summary>
/// Cheap per-process readings without <see cref="System.Diagnostics.Process"/>, whose thread list
/// and refresh take a whole-system process snapshot (about 1.3 ms of CPU on a desktop with 500
/// processes). Windows: one call per value on a process handle. Linux: <c>/proc</c>, read into a
/// reused buffer. Every reader returns false rather than throwing.
/// </summary>
internal static class NativeProcess
{
    private const int StillActive = 259;
    internal const uint ProcessQueryLimitedInformation = 0x1000;

    [ThreadStatic] private static byte[]? _buffer;

    private static byte[] Buffer => _buffer ??= new byte[4096];

    // ── Own process ──────────────────────────────────────────────────────────────

    /// <summary>Working set and private bytes (Windows: commit charge; Linux: resident minus shared).</summary>
    public static bool TryReadSelfMemory(out long workingSet, out long? privateBytes)
    {
        if (OperatingSystem.IsWindows())
        {
            if (Windows.TryReadMemory(Windows.GetCurrentProcess(), out workingSet, out var priv))
            {
                privateBytes = priv;
                return true;
            }
        }
        else if (OperatingSystem.IsLinux())
        {
            if (Linux.TryReadStatm("/proc/self/statm", out var resident, out var shared))
            {
                workingSet = resident;
                privateBytes = Math.Max(0, resident - shared);
                return true;
            }
        }

        workingSet = Environment.WorkingSet;
        privateBytes = null;
        return true;
    }

    /// <summary>Operating system threads of this process, or null where it cannot be read cheaply.</summary>
    public static int? SelfThreadCount()
    {
        if (OperatingSystem.IsWindows()) return Windows.CountOwnThreads();
        if (OperatingSystem.IsLinux() && Linux.TryReadStat("/proc/self/stat", out var stat)) return stat.Threads;
        return null;
    }

    // ── Windows ──────────────────────────────────────────────────────────────────

    internal static class Windows
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct ProcessMemoryCountersEx
        {
            public uint Cb;
            public uint PageFaultCount;
            public nuint PeakWorkingSetSize;
            public nuint WorkingSetSize;
            public nuint QuotaPeakPagedPoolUsage;
            public nuint QuotaPagedPoolUsage;
            public nuint QuotaPeakNonPagedPoolUsage;
            public nuint QuotaNonPagedPoolUsage;
            public nuint PagefileUsage;
            public nuint PeakPagefileUsage;
            public nuint PrivateUsage;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IoCounters
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct ProcessBasicInformation
        {
            public nint ExitStatus;
            public nint PebBaseAddress;
            public nint AffinityMask;
            public nint BasePriority;
            public nint UniqueProcessId;
            public nint InheritedFromUniqueProcessId;
        }

        [DllImport("kernel32.dll")]
        public static extern nint GetCurrentProcess();

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern nint OpenProcess(uint access, bool inherit, int processId);

        [DllImport("kernel32.dll")]
        public static extern bool CloseHandle(nint handle);

        [DllImport("kernel32.dll")]
        private static extern bool K32GetProcessMemoryInfo(nint process, out ProcessMemoryCountersEx counters, uint size);

        [DllImport("kernel32.dll")]
        private static extern bool GetProcessTimes(nint process, out long creation, out long exit, out long kernel, out long user);

        [DllImport("kernel32.dll")]
        private static extern bool GetProcessIoCounters(nint process, out IoCounters counters);

        [DllImport("kernel32.dll")]
        private static extern bool GetExitCodeProcess(nint process, out int exitCode);

        [DllImport("ntdll.dll")]
        private static extern int NtQueryInformationProcess(nint process, int infoClass, out ProcessBasicInformation info, int size, out int returned);

        [DllImport("ntdll.dll")]
        private static extern int NtGetNextThread(nint process, nint thread, uint access, uint attributes, uint flags, out nint next);

        public static bool TryReadMemory(nint process, out long workingSet, out long privateBytes)
        {
            var counters = new ProcessMemoryCountersEx { Cb = (uint)Marshal.SizeOf<ProcessMemoryCountersEx>() };
            if (!K32GetProcessMemoryInfo(process, out counters, counters.Cb))
            {
                workingSet = privateBytes = 0;
                return false;
            }
            workingSet = (long)counters.WorkingSetSize;
            privateBytes = (long)counters.PrivateUsage;
            return true;
        }

        /// <summary>User plus kernel time, and the creation time that tells a reused process id apart.</summary>
        public static bool TryReadTimes(nint process, out TimeSpan cpu, out long creation)
        {
            if (!GetProcessTimes(process, out creation, out _, out var kernel, out var user))
            {
                cpu = default;
                return false;
            }
            cpu = TimeSpan.FromTicks(kernel + user);
            return true;
        }

        /// <summary>Bytes moved by read and write calls on any handle (files, pipes, devices).</summary>
        public static bool TryReadIo(nint process, out long read, out long written)
        {
            if (!GetProcessIoCounters(process, out var io))
            {
                read = written = 0;
                return false;
            }
            read = (long)io.ReadTransferCount;
            written = (long)io.WriteTransferCount;
            return true;
        }

        public static bool HasExited(nint process)
            => !GetExitCodeProcess(process, out var code) || code != StillActive;

        public static int? ParentProcessId(nint process)
            => NtQueryInformationProcess(process, 0, out var info, Marshal.SizeOf<ProcessBasicInformation>(), out _) == 0
                ? (int)info.InheritedFromUniqueProcessId
                : null;

        /// <summary>Walks this process's own threads (about 1 µs each); no system-wide snapshot.</summary>
        public static int? CountOwnThreads()
        {
            const uint threadQueryLimitedInformation = 0x0800;
            var self = GetCurrentProcess();
            nint current = 0;
            var count = 0;
            try
            {
                while (NtGetNextThread(self, current, threadQueryLimitedInformation, 0, 0, out var next) == 0)
                {
                    if (current != 0) CloseHandle(current);
                    current = next;
                    count++;
                }
            }
            catch (EntryPointNotFoundException)
            {
                return null;
            }
            finally
            {
                if (current != 0) CloseHandle(current);
            }
            return count;
        }
    }

    // ── Linux ────────────────────────────────────────────────────────────────────

    internal readonly record struct LinuxStat(int ParentId, TimeSpan Cpu, long StartTicks, int Threads, long ResidentBytes);

    internal static class Linux
    {
        private static readonly Lazy<long> ClockTicks = new(() =>
        {
            try
            {
                var ticks = sysconf(2); // _SC_CLK_TCK
                return ticks > 0 ? ticks : 100;
            }
            catch
            {
                return 100;
            }
        });

        [DllImport("libc", SetLastError = true)]
        private static extern long sysconf(int name);

        /// <summary>Reads a small procfs file into the thread's buffer; the length, or -1.</summary>
        public static int ReadSmallFile(string path, out byte[] buffer)
        {
            buffer = Buffer;
            try
            {
                using var handle = File.OpenHandle(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                var total = 0;
                while (total < buffer.Length)
                {
                    var read = RandomAccess.Read(handle, buffer.AsSpan(total), total);
                    if (read <= 0) break;
                    total += read;
                }
                return total;
            }
            catch
            {
                return -1;
            }
        }

        /// <summary><c>/proc/[pid]/stat</c>: the fields after the command name, whose parentheses may hold anything.</summary>
        public static bool TryReadStat(string path, out LinuxStat stat)
        {
            stat = default;
            var length = ReadSmallFile(path, out var buffer);
            if (length <= 0) return false;
            var span = buffer.AsSpan(0, length);
            var close = span.LastIndexOf((byte)')');
            if (close < 0) return false;
            var fields = span[(close + 1)..];

            // Field numbers from proc(5): state is 3, so index = field - 3.
            if (!TryField(fields, 4 - 3, out var ppid)
                || !TryField(fields, 14 - 3, out var utime)
                || !TryField(fields, 15 - 3, out var stime)
                || !TryField(fields, 20 - 3, out var threads)
                || !TryField(fields, 22 - 3, out var start)
                || !TryField(fields, 24 - 3, out var rssPages))
                return false;

            var tick = ClockTicks.Value;
            stat = new LinuxStat((int)ppid, TimeSpan.FromTicks((utime + stime) * TimeSpan.TicksPerSecond / tick),
                start, (int)threads, rssPages * Environment.SystemPageSize);
            return true;
        }

        /// <summary><c>/proc/[pid]/statm</c>: resident and shared, in bytes.</summary>
        public static bool TryReadStatm(string path, out long resident, out long shared)
        {
            resident = shared = 0;
            var length = ReadSmallFile(path, out var buffer);
            if (length <= 0) return false;
            var span = buffer.AsSpan(0, length);
            if (!TryField(span, 1, out var residentPages) || !TryField(span, 2, out var sharedPages)) return false;
            resident = residentPages * Environment.SystemPageSize;
            shared = sharedPages * Environment.SystemPageSize;
            return true;
        }

        /// <summary><c>/proc/[pid]/io</c> read_bytes and write_bytes (storage layer); false when not readable.</summary>
        public static bool TryReadIo(string path, out long read, out long written)
        {
            read = written = 0;
            var length = ReadSmallFile(path, out var buffer);
            if (length <= 0) return false;
            var span = buffer.AsSpan(0, length);
            return TryNamedValue(span, "read_bytes:"u8, out read) && TryNamedValue(span, "write_bytes:"u8, out written);
        }

        /// <summary>Children of <paramref name="pid"/>'s main thread, or false where the kernel has no children file.</summary>
        public static bool TryReadChildren(int pid, List<int> children)
        {
            children.Clear();
            var length = ReadSmallFile($"/proc/{pid}/task/{pid}/children", out var buffer);
            if (length < 0) return false;
            var span = buffer.AsSpan(0, length);
            long value = 0;
            var any = false;
            foreach (var b in span)
            {
                if (b is >= (byte)'0' and <= (byte)'9')
                {
                    value = value * 10 + (b - '0');
                    any = true;
                }
                else if (any)
                {
                    children.Add((int)value);
                    value = 0;
                    any = false;
                }
            }
            if (any) children.Add((int)value);
            return true;
        }

        /// <summary>Space-separated numeric field <paramref name="index"/> (0-based), skipping non-numeric ones.</summary>
        internal static bool TryField(ReadOnlySpan<byte> span, int index, out long value)
        {
            value = 0;
            var field = -1;
            var i = 0;
            while (i < span.Length)
            {
                while (i < span.Length && span[i] is (byte)' ' or (byte)'\n' or (byte)'\t') i++;
                if (i >= span.Length) break;
                field++;
                var start = i;
                while (i < span.Length && span[i] is not ((byte)' ' or (byte)'\n' or (byte)'\t')) i++;
                if (field != index) continue;
                return TryParse(span[start..i], out value);
            }
            return false;
        }

        private static bool TryNamedValue(ReadOnlySpan<byte> span, ReadOnlySpan<byte> name, out long value)
        {
            value = 0;
            var at = span.IndexOf(name);
            if (at < 0) return false;
            var rest = span[(at + name.Length)..];
            var i = 0;
            while (i < rest.Length && rest[i] == (byte)' ') i++;
            var start = i;
            while (i < rest.Length && rest[i] is >= (byte)'0' and <= (byte)'9') i++;
            return TryParse(rest[start..i], out value);
        }

        private static bool TryParse(ReadOnlySpan<byte> digits, out long value)
        {
            value = 0;
            var negative = digits.Length > 0 && digits[0] == (byte)'-';
            if (negative) digits = digits[1..];
            if (digits.Length == 0) return false;
            foreach (var b in digits)
            {
                if (b is < (byte)'0' or > (byte)'9') return false;
                value = value * 10 + (b - '0');
            }
            if (negative) value = -value;
            return true;
        }
    }
}
