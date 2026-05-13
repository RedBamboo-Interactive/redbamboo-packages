namespace RedBamboo.AppHost.Logging;

public class FileLogger : IAsyncDisposable
{
    private readonly string _logDirectory;
    private readonly int _maxFiles;
    private readonly Lock _lock = new();
    private StreamWriter? _writer;
    private string? _currentDate;

    public FileLogger(string appName, int maxFiles = 10)
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        _logDirectory = Path.Combine(localAppData, appName, "Logs");
        _maxFiles = maxFiles;
        Directory.CreateDirectory(_logDirectory);
    }

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
        _writer = new StreamWriter(filePath, append: true) { AutoFlush = false };

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
