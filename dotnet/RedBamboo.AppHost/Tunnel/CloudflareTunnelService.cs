using System.Diagnostics;
using System.Management;
using System.Reflection;
using System.Runtime.Versioning;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;

namespace RedBamboo.AppHost.Tunnel;

public sealed class CloudflareTunnelService : IAsyncDisposable
{
    private const string StateFileName = "cloudflared-process.json";
    private static readonly Regex LegacyTokenArgument = new(
        "(?:^|\\s)--token(?:=|\\s+)(?:\\\"(?<quoted>[^\\\"]*)\\\"|(?<plain>\\S+))",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private Process? _process;
    private TunnelProcessIdentity? _processIdentity;
    private readonly Lock _lock = new();
    private readonly ILogger? _logger;
    private readonly string _stateFilePath;

    public TunnelStatus Status { get; private set; } = TunnelStatus.Stopped;
    public bool IsExternal { get; private set; }
    public string? ErrorMessage { get; private set; }

    public event Action<TunnelStatus, string?>? StatusChanged;

    public CloudflareTunnelService(ILogger<CloudflareTunnelService>? logger = null)
        : this(GetDefaultStateFilePath(), logger)
    {
    }

    internal CloudflareTunnelService(
        string stateFilePath,
        ILogger<CloudflareTunnelService>? logger = null)
    {
        _stateFilePath = stateFilePath;
        _logger = logger;
    }

    /// <summary>
    /// A tunnel whose cloudflared process record lives at <paramref name="stateFilePath"/>, for a host that
    /// decides where its data lives. The default constructor keeps
    /// <c>%LOCALAPPDATA%\{entry assembly name}\cloudflared-process.json</c>.
    /// </summary>
    public static CloudflareTunnelService WithStateFile(
        string stateFilePath,
        ILogger<CloudflareTunnelService>? logger = null)
    {
        if (string.IsNullOrWhiteSpace(stateFilePath) || !Path.IsPathFullyQualified(stateFilePath))
            throw new ArgumentException($"The tunnel state file '{stateFilePath}' is not an absolute path.", nameof(stateFilePath));
        return new CloudflareTunnelService(stateFilePath, logger);
    }

    /// <summary>Where the record of the cloudflared process this service started is kept.</summary>
    public string StateFilePath => _stateFilePath;

    public Task<bool> StartAsync(TunnelConfig config)
    {
        lock (_lock)
        {
            if (_process != null || (Status == TunnelStatus.Running && IsExternal))
                return Task.FromResult(false);

            if (string.IsNullOrWhiteSpace(config.TunnelToken))
            {
                SetStatus(TunnelStatus.Error, "No tunnel token configured");
                return Task.FromResult(false);
            }

            if (OperatingSystem.IsWindows())
            {
                // Environment blocks of unrelated processes are intentionally not inspected.
                // DetectExternalTunnel can therefore recognize only legacy connectors that
                // still expose an exact --token argument on their command line.
                if (config.DetectExternalTunnel && DetectLegacyTunnelWithToken(config.TunnelToken))
                {
                    _logger?.LogInformation(
                        "Detected existing legacy cloudflared process for this tunnel, using external");
                    IsExternal = true;
                    SetStatus(TunnelStatus.Running, null);
                    return Task.FromResult(true);
                }

                KillOrphanedProcesses(config.TunnelToken);
            }

            var exe = ResolveCloudflaredPath(config.CloudflaredPath);
            if (exe == null)
            {
                SetStatus(TunnelStatus.Error,
                    "cloudflared not found. Install via: winget install Cloudflare.cloudflared");
                return Task.FromResult(false);
            }

            IsExternal = false;
            SetStatus(TunnelStatus.Starting, null);

            var psi = CreateStartInfo(exe, config.TunnelToken);

            _process = new Process { StartInfo = psi, EnableRaisingEvents = true };
            _process.Exited += OnExited;

            try
            {
                _process.Start();
                _processIdentity = new TunnelProcessIdentity(
                    _process.Id,
                    _process.StartTime.ToUniversalTime().Ticks);
                SaveProcessIdentity(_processIdentity);
                var pid = _process.Id;
                ReadOutput(_process, OnLine, ex => _logger?.LogWarning(
                        "A cloudflared output line failed to process ({ErrorType})", ex.GetType().Name))
                    .ContinueWith(
                        reading => _logger?.LogWarning(
                            "Reading cloudflared's output (PID {Pid}) ended with an error ({ErrorType})",
                            pid, reading.Exception?.GetBaseException().GetType().Name),
                        CancellationToken.None, TaskContinuationOptions.OnlyOnFaulted, TaskScheduler.Default);
                _logger?.LogInformation("Started cloudflared tunnel process (PID {Pid})", _process.Id);
            }
            catch (Exception ex)
            {
                TryKillStartedProcess();
                _process = null;
                _processIdentity = null;
                _logger?.LogWarning(
                    "Failed to start cloudflared process ({ErrorType})", ex.GetType().Name);
                SetStatus(TunnelStatus.Error, "Failed to start cloudflared");
                return Task.FromResult(false);
            }

            return Task.FromResult(true);
        }
    }

    public Task StopAsync()
    {
        lock (_lock)
        {
            if (IsExternal)
            {
                IsExternal = false;
                SetStatus(TunnelStatus.Stopped, null);
                return Task.CompletedTask;
            }

            KillProcess();
            SetStatus(TunnelStatus.Stopped, null);
        }
        return Task.CompletedTask;
    }

    public ValueTask DisposeAsync()
    {
        lock (_lock)
        {
            KillProcess();
        }
        return ValueTask.CompletedTask;
    }

    internal static ProcessStartInfo CreateStartInfo(string executablePath, string token)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = executablePath,
            Arguments = "tunnel run",
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        startInfo.Environment["TUNNEL_TOKEN"] = token;
        return startInfo;
    }

    internal static bool IsOwnedProcess(
        TunnelProcessIdentity identity,
        int processId,
        long startTimeUtcTicks,
        string processName)
        => identity.ProcessId == processId
           && identity.StartTimeUtcTicks == startTimeUtcTicks
           && string.Equals(processName, "cloudflared", StringComparison.OrdinalIgnoreCase);

    internal static bool CommandLineContainsLegacyToken(string commandLine, string token)
    {
        if (string.IsNullOrEmpty(commandLine) || string.IsNullOrEmpty(token)) return false;

        foreach (Match match in LegacyTokenArgument.Matches(commandLine))
        {
            var candidate = match.Groups["quoted"].Success
                ? match.Groups["quoted"].Value
                : match.Groups["plain"].Value;
            if (string.Equals(candidate, token, StringComparison.Ordinal)) return true;
        }

        return false;
    }

    /// <summary>
    /// Reads cloudflared's stdout and stderr line by line, each on a dedicated background thread, until both end.
    /// On Windows, <see cref="Process"/> gives synchronous pipes, so BeginOutputReadLine/BeginErrorReadLine would
    /// park one thread-pool worker in a blocking ReadFile per stream for the tunnel's whole life, and parked
    /// workers hold back the pool's other work (N19, 2026-11-26). Killing the process ends both reads. A line
    /// handler that throws goes to <paramref name="onError"/>, and the reading goes on.
    /// </summary>
    internal static Task ReadOutput(Process process, Action<string> onLine, Action<Exception>? onError = null)
        => Task.WhenAll(
            ReadLines(process.StandardOutput, onLine, onError, $"cloudflared {process.Id} stdout"),
            ReadLines(process.StandardError, onLine, onError, $"cloudflared {process.Id} stderr"));

    private static Task ReadLines(StreamReader reader, Action<string> onLine, Action<Exception>? onError, string threadName)
    {
        var done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            try
            {
                while (reader.ReadLine() is { } line)
                {
                    try
                    {
                        onLine(line);
                    }
                    catch (Exception ex)
                    {
                        try { onError?.Invoke(ex); }
                        catch { /* Reporting never stops the draining. */ }
                    }
                }
                done.TrySetResult();
            }
            catch (Exception ex)
            {
                done.TrySetException(ex);
            }
        })
        {
            IsBackground = true,
            Name = threadName,
        };
        thread.Start();
        return done.Task;
    }

    private void OnLine(string line)
    {
        if (Status == TunnelStatus.Starting &&
            (line.Contains("Registered tunnel connection", StringComparison.OrdinalIgnoreCase) ||
             line.Contains("Connection registered", StringComparison.OrdinalIgnoreCase) ||
             Regex.IsMatch(line, @"connection [a-f0-9-]+ registered", RegexOptions.IgnoreCase)))
        {
            _logger?.LogInformation("Cloudflare tunnel connection registered");
            SetStatus(TunnelStatus.Running, null);
        }
    }

    private void OnExited(object? sender, EventArgs e)
    {
        lock (_lock)
        {
            if (sender is not Process exitedProcess || !ReferenceEquals(_process, exitedProcess))
                return;

            int? exitCode = null;
            try
            {
                exitCode = exitedProcess?.ExitCode;
            }
            catch
            {
                // Best-effort status detail only.
            }

            if (_processIdentity is not null)
                DeleteProcessIdentity(_processIdentity);
            _processIdentity = null;
            _process = null;

            if (Status == TunnelStatus.Stopped) return;

            _logger?.LogWarning("cloudflared exited unexpectedly (code {ExitCode})", exitCode);
            SetStatus(TunnelStatus.Error,
                $"cloudflared exited unexpectedly (code {exitCode})");
        }
    }

    private void KillProcess()
    {
        if (_process == null) return;
        var stopped = false;
        try
        {
            _logger?.LogInformation("Stopping cloudflared tunnel (PID {Pid})", _process.Id);
            if (!_process.HasExited)
                _process.Kill(entireProcessTree: true);
            stopped = true;
        }
        catch
        {
            // The process may already have exited.
            try
            {
                stopped = _process.HasExited;
            }
            catch
            {
                // Retain the state file so a later startup can retry ownership cleanup.
            }
        }

        if (stopped && _processIdentity is not null)
            DeleteProcessIdentity(_processIdentity);
        _processIdentity = null;
        _process = null;
    }

    private void TryKillStartedProcess()
    {
        var stopped = false;
        try
        {
            if (_process is not null)
            {
                if (!_process.HasExited)
                    _process.Kill(entireProcessTree: true);
                stopped = true;
            }
        }
        catch
        {
            // Preserve the original start/persistence failure.
        }

        if (stopped && _processIdentity is not null)
            DeleteProcessIdentity(_processIdentity);
    }

    private void SetStatus(TunnelStatus status, string? error)
    {
        Status = status;
        ErrorMessage = error;
        StatusChanged?.Invoke(status, error);
    }

    [SupportedOSPlatform("windows")]
    private bool DetectLegacyTunnelWithToken(string token)
    {
        try
        {
            using var searcher = new ManagementObjectSearcher(
                "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = 'cloudflared.exe'");
            foreach (var obj in searcher.Get())
            {
                var commandLine = obj["CommandLine"]?.ToString() ?? "";
                if (CommandLineContainsLegacyToken(commandLine, token))
                    return true;
            }
        }
        catch (Exception ex)
        {
            _logger?.LogDebug(
                "Failed to detect existing legacy tunnel process ({ErrorType})", ex.GetType().Name);
        }
        return false;
    }

    [SupportedOSPlatform("windows")]
    private void KillOrphanedProcesses(string token)
    {
        KillTrackedOrphan();

        // TODO: Remove this command-line migration fallback after one release.
        KillLegacyOrphans(token);
    }

    [SupportedOSPlatform("windows")]
    private void KillTrackedOrphan()
    {
        var identity = LoadProcessIdentity();
        if (identity is null) return;

        try
        {
            using var process = Process.GetProcessById(identity.ProcessId);
            var startTimeUtcTicks = process.StartTime.ToUniversalTime().Ticks;
            if (!IsOwnedProcess(identity, process.Id, startTimeUtcTicks, process.ProcessName))
            {
                DeleteProcessIdentity(identity);
                return;
            }

            process.Kill(entireProcessTree: true);
            DeleteProcessIdentity(identity);
            _logger?.LogInformation(
                "Killed tracked orphaned cloudflared process (PID {Pid})", identity.ProcessId);
        }
        catch (ArgumentException)
        {
            DeleteProcessIdentity(identity);
        }
        catch (InvalidOperationException)
        {
            DeleteProcessIdentity(identity);
        }
        catch (Exception ex)
        {
            _logger?.LogDebug(
                "Failed to clean up tracked tunnel process ({ErrorType})", ex.GetType().Name);
        }
    }

    [SupportedOSPlatform("windows")]
    private void KillLegacyOrphans(string token)
    {
        try
        {
            using var searcher = new ManagementObjectSearcher(
                "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = 'cloudflared.exe'");
            foreach (var obj in searcher.Get())
            {
                var commandLine = obj["CommandLine"]?.ToString() ?? "";
                if (!CommandLineContainsLegacyToken(commandLine, token)) continue;

                var pid = Convert.ToInt32(obj["ProcessId"]);
                try
                {
                    using var process = Process.GetProcessById(pid);
                    if (!string.Equals(process.ProcessName, "cloudflared", StringComparison.OrdinalIgnoreCase))
                        continue;
                    process.Kill(entireProcessTree: true);
                    _logger?.LogInformation(
                        "Killed legacy orphaned cloudflared process (PID {Pid})", pid);
                }
                catch
                {
                    // The process may have exited between enumeration and termination.
                }
            }
        }
        catch (Exception ex)
        {
            _logger?.LogDebug(
                "Failed to clean up legacy tunnel processes ({ErrorType})", ex.GetType().Name);
        }
    }

    private TunnelProcessIdentity? LoadProcessIdentity()
    {
        try
        {
            if (!File.Exists(_stateFilePath)) return null;
            return JsonSerializer.Deserialize<TunnelProcessIdentity>(
                File.ReadAllText(_stateFilePath));
        }
        catch (Exception ex)
        {
            _logger?.LogDebug(
                "Failed to read cloudflared process state ({ErrorType})", ex.GetType().Name);
            return null;
        }
    }

    private void SaveProcessIdentity(TunnelProcessIdentity identity)
    {
        var directory = Path.GetDirectoryName(_stateFilePath)
            ?? throw new InvalidOperationException("Tunnel state path has no directory");
        Directory.CreateDirectory(directory);

        var temporaryPath = _stateFilePath + ".tmp";
        File.WriteAllText(temporaryPath, JsonSerializer.Serialize(identity));
        File.Move(temporaryPath, _stateFilePath, overwrite: true);
    }

    private void DeleteProcessIdentity(TunnelProcessIdentity expectedIdentity)
    {
        try
        {
            var storedIdentity = LoadProcessIdentity();
            if (storedIdentity != expectedIdentity) return;
            File.Delete(_stateFilePath);
        }
        catch (Exception ex)
        {
            _logger?.LogDebug(
                "Failed to delete cloudflared process state ({ErrorType})", ex.GetType().Name);
        }
    }

    private static string GetDefaultStateFilePath()
    {
        var appName = Assembly.GetEntryAssembly()?.GetName().Name;
        if (string.IsNullOrWhiteSpace(appName)) appName = "RedBamboo";
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            appName,
            StateFileName);
    }

    private static string? ResolveCloudflaredPath(string? configuredPath)
    {
        if (!string.IsNullOrWhiteSpace(configuredPath) && File.Exists(configuredPath))
            return configuredPath;

        var pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (var dir in pathEnv.Split(Path.PathSeparator))
        {
            var candidate = Path.Combine(dir, "cloudflared.exe");
            if (File.Exists(candidate))
                return candidate;
        }

        return null;
    }
}

internal sealed record TunnelProcessIdentity(int ProcessId, long StartTimeUtcTicks);
