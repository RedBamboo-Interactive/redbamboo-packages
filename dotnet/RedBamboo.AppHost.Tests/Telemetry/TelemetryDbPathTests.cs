using RedBamboo.AppHost.Telemetry;
using Xunit;

namespace RedBamboo.AppHost.Tests.Telemetry;

/// <summary>TelemetryOptions.DbPath is where the database goes; RedLeaf sets it from its data location.</summary>
public sealed class TelemetryDbPathTests
{
    [Fact]
    public void DbPath_CreatesItsFolderAndReadsFromThere()
    {
        var root = Path.Combine(Path.GetTempPath(), $"rb-telemetry-{Guid.NewGuid():N}");
        var dbPath = Path.Combine(root, "nested", "telemetry.db");
        try
        {
            var service = new TelemetryService(new TelemetryOptions { AppName = "NotUsedForThePath", DbPath = dbPath });
            Assert.True(Directory.Exists(Path.GetDirectoryName(dbPath)));
            Assert.NotNull(service.Reader);
            // The flight recorder keeps a connection open until the service is disposed.
            service.DisposeAsync().AsTask().GetAwaiter().GetResult();
        }
        finally
        {
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }
}
