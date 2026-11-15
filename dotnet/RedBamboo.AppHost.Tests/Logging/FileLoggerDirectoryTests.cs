using RedBamboo.AppHost.Logging;
using Xunit;

namespace RedBamboo.AppHost.Tests.Logging;

/// <summary>A host that decides where its data lives can point the log at it; the app-name form is unchanged.</summary>
public sealed class FileLoggerDirectoryTests
{
    [Fact]
    public async Task ForDirectory_WritesTheDailyFileThere()
    {
        var root = Path.Combine(Path.GetTempPath(), $"rb-filelogger-{Guid.NewGuid():N}");
        var logs = Path.Combine(root, "Logs");
        try
        {
            var logger = FileLogger.ForDirectory(logs);
            Assert.Equal(logs, logger.LogDirectory);
            Assert.True(Directory.Exists(logs));

            var at = new DateTimeOffset(2026, 11, 15, 12, 0, 0, TimeSpan.Zero);
            logger.Write(new LogEntry { Id = "1", Source = "test", Timestamp = at, Level = LogLevel.Info, Category = "test", Message = "hello" });
            await logger.DisposeAsync();

            var file = Path.Combine(logs, $"{at.LocalDateTime:yyyy-MM-dd}.log");
            Assert.Contains("test: hello", File.ReadAllText(file), StringComparison.Ordinal);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("relative/Logs")]
    public void ForDirectory_RefusesAPathThatIsNotAbsolute(string directory)
        => Assert.Throws<ArgumentException>(() => FileLogger.ForDirectory(directory));

    [Fact]
    public void AppNameConstructor_KeepsLocalAppDataAppNameLogs()
    {
        var appName = $"rb-filelogger-default-{Guid.NewGuid():N}";
        var expected = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), appName, "Logs");
        try
        {
            Assert.Equal(expected, new FileLogger(appName).LogDirectory);
        }
        finally
        {
            var appRoot = Path.GetDirectoryName(expected)!;
            if (Directory.Exists(appRoot)) Directory.Delete(appRoot, recursive: true);
        }
    }
}
