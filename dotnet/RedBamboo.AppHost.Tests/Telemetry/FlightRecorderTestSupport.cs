using Microsoft.Data.Sqlite;
using RedBamboo.AppHost.Telemetry.FlightRecorder;

namespace RedBamboo.AppHost.Tests.Telemetry;

/// <summary>A clock the test moves by hand.</summary>
internal sealed class FakeTime : TimeProvider
{
    private long _ticks;
    private DateTimeOffset _utc = new(2026, 11, 28, 12, 0, 0, TimeSpan.Zero);

    public override long TimestampFrequency => TimeSpan.TicksPerSecond;
    public override long GetTimestamp() => _ticks;
    public override DateTimeOffset GetUtcNow() => _utc;

    public void Advance(TimeSpan by)
    {
        _ticks += by.Ticks;
        _utc += by;
    }
}

/// <summary>Counters the test sets; each read returns the current values.</summary>
internal sealed class FakeCounters : IRuntimeCounterSource
{
    public RuntimeCounters Value;
    public int Reads;

    public void Read(ref RuntimeCounters counters)
    {
        Reads++;
        counters = Value;
    }
}

internal sealed class FakeGroup(string name) : IProcessGroupProbe
{
    public ProcessGroupReading? Next;
    public string Name { get; } = name;

    public bool TryRead(out ProcessGroupReading reading)
    {
        reading = Next ?? default;
        return Next is not null;
    }
}

internal sealed class FakePool : IDatabasePoolProbe
{
    public DatabasePoolReading? Next;

    public bool TryRead(out DatabasePoolReading reading)
    {
        reading = Next ?? default;
        return Next is not null;
    }
}

/// <summary>A throwaway telemetry database with the flight recorder schema.</summary>
internal sealed class TempTelemetryDb : IDisposable
{
    public TempTelemetryDb()
    {
        Directory = Path.Combine(Path.GetTempPath(), $"rb-flight-{Guid.NewGuid():N}");
        System.IO.Directory.CreateDirectory(Directory);
        Path_ = System.IO.Path.Combine(Directory, "telemetry.db");
        ConnectionString = $"Data Source={Path_}";
    }

    public string Directory { get; }
    public string Path_ { get; }
    public string ConnectionString { get; }

    public void EnsureRecorderSchema()
    {
        using var connection = new SqliteConnection(ConnectionString);
        connection.Open();
        using (var wal = connection.CreateCommand())
        {
            wal.CommandText = "PRAGMA journal_mode=WAL";   // as TelemetryService opens the real store
            wal.ExecuteNonQuery();
        }
        FlightRecorderStore.EnsureSchema(connection);
    }

    public long Scalar(string sql)
    {
        using var connection = new SqliteConnection(ConnectionString);
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        return Convert.ToInt64(command.ExecuteScalar());
    }

    public void Execute(string sql)
    {
        using var connection = new SqliteConnection(ConnectionString);
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        try { System.IO.Directory.Delete(Directory, recursive: true); } catch { }
    }
}
