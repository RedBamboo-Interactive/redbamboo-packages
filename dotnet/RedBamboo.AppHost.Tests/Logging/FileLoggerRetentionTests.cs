using RedBamboo.AppHost.Logging;
using Xunit;

namespace RedBamboo.AppHost.Tests.Logging;

/// <summary>Retention keeps the newest daily logs by date; a log named for a future day cannot hold a slot forever.</summary>
public sealed class FileLoggerRetentionTests
{
    [Fact]
    public async Task A_log_named_for_a_future_day_is_pruned_instead_of_outranking_every_real_day()
    {
        var logs = Path.Combine(Path.GetTempPath(), $"rb-filelogger-retention-{Guid.NewGuid():N}");
        Directory.CreateDirectory(logs);
        try
        {
            var today = DateTime.Now.Date;
            for (var day = 1; day <= 12; day++)
                Touch(logs, today.AddDays(-day), written: today.AddDays(-day).AddHours(12));
            // The 8 Oct 2026 clock change wrote 2026-12-24.log, dated that day inside and out.
            var future = Touch(logs, today.AddDays(40), written: today.AddDays(40));
            // A future name with a sane write time is placed by the write time.
            var renamed = Touch(logs, today.AddDays(30), written: today.AddDays(-2).AddHours(18));
            var foreign = Path.Combine(logs, "launcher.log");
            File.WriteAllText(foreign, "not a daily log");

            var logger = FileLogger.ForDirectory(logs, maxFiles: 10);
            logger.Write(new LogEntry
            {
                Id = "1", Source = "test", Timestamp = DateTimeOffset.Now, Level = LogLevel.Info, Category = "test",
                Message = "today",
            });
            await logger.DisposeAsync();

            var kept = Directory.GetFiles(logs, "*.log").Select(Path.GetFileName).ToHashSet();
            Assert.DoesNotContain(Path.GetFileName(future), kept);
            Assert.Contains(Path.GetFileName(renamed), kept);
            Assert.Contains("launcher.log", kept);
            Assert.Contains($"{today:yyyy-MM-dd}.log", kept);
            // Today, the renamed one (2 days ago) and the 8 newest real days: 10 daily logs.
            for (var day = 1; day <= 8; day++) Assert.Contains($"{today.AddDays(-day):yyyy-MM-dd}.log", kept);
            for (var day = 9; day <= 12; day++) Assert.DoesNotContain($"{today.AddDays(-day):yyyy-MM-dd}.log", kept);
            Assert.Equal(11, kept.Count);
        }
        finally
        {
            if (Directory.Exists(logs)) Directory.Delete(logs, recursive: true);
        }
    }

    private static string Touch(string logs, DateTime day, DateTime written)
    {
        var path = Path.Combine(logs, $"{day:yyyy-MM-dd}.log");
        File.WriteAllText(path, "x");
        File.SetLastWriteTime(path, written);
        return path;
    }
}
