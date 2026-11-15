namespace RedBamboo.AppHost.Logging;

public class FileLogger : IAsyncDisposable
{
    private readonly string _logDirectory;
    private readonly int _maxFiles;
    private readonly Lock _lock = new();
    private StreamWriter? _writer;
    private string? _currentDate;

    /// <summary>Logs to <c>%LOCALAPPDATA%\{appName}\Logs</c>, as every host did before it could choose.</summary>
    public FileLogger(string appName, int maxFiles = 10)
        : this(DefaultLogDirectory(appName), maxFiles, directoryChosen: true)
    {
    }

    private FileLogger(string logDirectory, int maxFiles, bool directoryChosen)
    {
        _ = directoryChosen; // only tells this constructor apart from the public one
        _logDirectory = logDirectory;
        _maxFiles = maxFiles;
        Directory.CreateDirectory(_logDirectory);
    }

    /// <summary>
    /// Logs to <paramref name="logDirectory"/>, for a host that decides where its data lives (RedLeaf's
    /// data location). The folder must be an absolute path; it is created when missing.
    /// </summary>
    public static FileLogger ForDirectory(string logDirectory, int maxFiles = 10)
    {
        if (string.IsNullOrWhiteSpace(logDirectory) || !Path.IsPathFullyQualified(logDirectory))
            throw new ArgumentException($"The log directory '{logDirectory}' is not an absolute path.", nameof(logDirectory));
        return new FileLogger(logDirectory, maxFiles, directoryChosen: true);
    }

    /// <summary>The folder the daily <c>yyyy-MM-dd.log</c> files go to.</summary>
    public string LogDirectory => _logDirectory;

    private static string DefaultLogDirectory(string appName)
        => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), appName, "Logs");

    public void Write(LogEntry entry)
    {
        var dateStr = entry.Timestamp.LocalDateTime.ToString("yyyy-MM-dd");
        lock (_lock)
        {
            EnsureWriter(dateStr);
            _writer!.WriteLine(FormatEntry(entry));
            _writer.Flush();
        }
    }

    public void AttachTo(LogService logService)
    {
        logService.OnLogEntry += Write;
    }

    public async ValueTask DisposeAsync()
    {
        lock (_lock)
        {
            _writer?.Dispose();
            _writer = null;
        }
        await ValueTask.CompletedTask;
        GC.SuppressFinalize(this);
    }

    private void EnsureWriter(string dateStr)
    {
        if (_currentDate == dateStr && _writer is not null) return;

        _writer?.Dispose();
        _currentDate = dateStr;

        var filePath = Path.Combine(_logDirectory, $"{dateStr}.log");
        var stream = new FileStream(filePath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
        _writer = new StreamWriter(stream) { AutoFlush = false };

        CleanupOldFiles();
    }

    private void CleanupOldFiles()
    {
        var files = Directory.GetFiles(_logDirectory, "*.log")
            .OrderByDescending(f => f)
            .Skip(_maxFiles)
            .ToList();

        foreach (var file in files)
        {
            try { File.Delete(file); }
            catch { /* best effort */ }
        }
    }

    private static string FormatEntry(LogEntry entry)
    {
        var ts = entry.Timestamp.LocalDateTime.ToString("HH:mm:ss.fff");
        var level = entry.Level.ToWireString().ToUpperInvariant().PadRight(8);
        var tag = entry.Tag is not null ? $"[{entry.Tag}] " : "";
        var line = $"{ts} {level} {tag}{entry.Category}: {entry.Message}";

        if (entry.StackTrace is not null)
            line += Environment.NewLine + entry.StackTrace;

        return line;
    }
}
