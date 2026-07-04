using Microsoft.Data.Sqlite;

namespace RedBamboo.AppHost.Telemetry;

/// <summary>
/// Read-only query surface over a telemetry SQLite database. TelemetryService wraps one
/// for its own database; a host can also point one at another local app's telemetry.db
/// (the databases are WAL-mode, so cross-process readers never block the owning app's
/// writer) to aggregate suite-wide stats without an HTTP round trip.
/// </summary>
public class TelemetryReader
{
    private readonly string _connectionString;
    private readonly Func<string, string?>? _describe;

    public TelemetryReader(string dbPath, Func<string, string?>? describe = null)
    {
        _connectionString = $"Data Source={dbPath}";
        _describe = describe;
    }

    public List<TelemetryEntry> Query(TelemetryQueryParams q)
    {
        using var conn = new SqliteConnection(_connectionString);
        conn.Open();

        var clauses = new List<string>();
        var cmd = conn.CreateCommand();

        if (q.RoutePattern is { } route)
        {
            // Match on the same expression GetStats groups by, so a route name taken
            // from the stats list always finds its entries (route_pattern is NULL for
            // requests that never matched an endpoint).
            clauses.Add("COALESCE(route_pattern, path) = @route");
            cmd.Parameters.AddWithValue("@route", route);
        }
        if (q.Method is { } method)
        {
            clauses.Add("method = @method");
            cmd.Parameters.AddWithValue("@method", method);
        }
        if (q.MinDurationMs is { } minDur)
        {
            clauses.Add("duration_ms >= @minDur");
            cmd.Parameters.AddWithValue("@minDur", minDur);
        }
        if (q.MinStatusCode is { } minStatus)
        {
            clauses.Add("status_code >= @minStatus");
            cmd.Parameters.AddWithValue("@minStatus", minStatus);
        }
        if (q.MaxStatusCode is { } maxStatus)
        {
            clauses.Add("status_code <= @maxStatus");
            cmd.Parameters.AddWithValue("@maxStatus", maxStatus);
        }
        if (q.Since is { } since)
        {
            clauses.Add("timestamp >= @since");
            cmd.Parameters.AddWithValue("@since", since.ToString("O"));
        }
        if (q.Until is { } until)
        {
            clauses.Add("timestamp <= @until");
            cmd.Parameters.AddWithValue("@until", until.ToString("O"));
        }

        var where = clauses.Count > 0 ? "WHERE " + string.Join(" AND ", clauses) : "";
        cmd.CommandText = $"""
            SELECT id, timestamp, method, path, route_pattern, status_code,
                   duration_ms, response_size, correlation_id, error, kind
            FROM requests {where}
            ORDER BY timestamp DESC
            LIMIT @limit OFFSET @offset
            """;
        cmd.Parameters.AddWithValue("@limit", q.Limit);
        cmd.Parameters.AddWithValue("@offset", q.Offset);

        var entries = new List<TelemetryEntry>();
        using var reader = cmd.ExecuteReader();

        while (reader.Read())
        {
            entries.Add(new TelemetryEntry
            {
                Id = reader.GetInt64(0),
                Timestamp = DateTimeOffset.Parse(reader.GetString(1)),
                Method = reader.GetString(2),
                Path = reader.GetString(3),
                RoutePattern = reader.IsDBNull(4) ? null : reader.GetString(4),
                StatusCode = reader.GetInt32(5),
                DurationMs = reader.GetDouble(6),
                ResponseSize = reader.IsDBNull(7) ? null : reader.GetInt64(7),
                CorrelationId = reader.IsDBNull(8) ? null : reader.GetString(8),
                Error = reader.IsDBNull(9) ? null : reader.GetString(9),
                Kind = reader.IsDBNull(10) ? null : reader.GetString(10),
            });
        }

        return entries;
    }

    public List<RouteStats> GetStats(DateTimeOffset? since = null, string? routePattern = null)
    {
        using var conn = new SqliteConnection(_connectionString);
        conn.Open();

        var clauses = new List<string>();
        using var cmd = conn.CreateCommand();

        if (since is { } s)
        {
            clauses.Add("timestamp >= @since");
            cmd.Parameters.AddWithValue("@since", s.ToString("O"));
        }
        if (routePattern is { } rp)
        {
            clauses.Add("COALESCE(route_pattern, path) = @route");
            cmd.Parameters.AddWithValue("@route", rp);
        }

        var where = clauses.Count > 0 ? "WHERE " + string.Join(" AND ", clauses) : "";

        // Everything — grouping, error counts, and percentiles — comes out of ONE scan.
        // Percentiles need every duration anyway, and a per-group SQL query can't use an
        // index (the group key is an expression), so N routes used to mean N full-table
        // scans: minutes of wall clock once the database passes ~100 MB.
        cmd.CommandText = $"""
            SELECT method, COALESCE(route_pattern, path), duration_ms, status_code,
                   response_size, timestamp, kind
            FROM requests {where}
            """;

        var groups = new Dictionary<(string Method, string Route), Group>();

        using (var reader = cmd.ExecuteReader())
        {
            while (reader.Read())
            {
                var key = (reader.GetString(0), reader.GetString(1));
                if (!groups.TryGetValue(key, out var g))
                    groups[key] = g = new Group();

                g.Durations.Add(reader.GetDouble(2));
                if (reader.GetInt32(3) >= 400) g.Errors++;
                if (!reader.IsDBNull(4)) { g.SizeSum += reader.GetInt64(4); g.SizeCount++; }

                var ts = reader.GetString(5);
                if (g.LastSeen is null || string.CompareOrdinal(ts, g.LastSeen) > 0)
                    g.LastSeen = ts;

                if (!reader.IsDBNull(6))
                {
                    var kind = reader.GetString(6);
                    if (g.Kind is null || string.CompareOrdinal(kind, g.Kind) > 0)
                        g.Kind = kind;
                }
            }
        }

        var result = new List<RouteStats>(groups.Count);

        foreach (var ((method, route), g) in groups)
        {
            var durations = g.Durations;
            durations.Sort();

            result.Add(new RouteStats
            {
                Method = method,
                RoutePattern = route,
                Count = durations.Count,
                ErrorCount = g.Errors,
                AvgMs = Math.Round(durations.Sum() / durations.Count, 2),
                MinMs = Math.Round(durations[0], 2),
                MaxMs = Math.Round(durations[^1], 2),
                P10Ms = Math.Round(Percentile(durations, 0.10), 2),
                P50Ms = Math.Round(Percentile(durations, 0.50), 2),
                P70Ms = Math.Round(Percentile(durations, 0.70), 2),
                P90Ms = Math.Round(Percentile(durations, 0.90), 2),
                P99Ms = Math.Round(Percentile(durations, 0.99), 2),
                AvgResponseSize = g.SizeCount > 0 ? (long)Math.Round((double)g.SizeSum / g.SizeCount) : null,
                LastSeen = g.LastSeen,
                Kind = g.Kind,
                Description = _describe?.Invoke($"{method} {route}"),
            });
        }

        result.Sort((a, b) => b.Count.CompareTo(a.Count));
        return result;
    }

    public int GetTotalCount(DateTimeOffset? since = null)
    {
        using var conn = new SqliteConnection(_connectionString);
        conn.Open();
        using var cmd = conn.CreateCommand();

        if (since is { } s)
        {
            cmd.CommandText = "SELECT COUNT(*) FROM requests WHERE timestamp >= @since";
            cmd.Parameters.AddWithValue("@since", s.ToString("O"));
        }
        else
        {
            cmd.CommandText = "SELECT COUNT(*) FROM requests";
        }

        return Convert.ToInt32(cmd.ExecuteScalar());
    }

    private sealed class Group
    {
        public List<double> Durations { get; } = [];
        public int Errors;
        public long SizeSum;
        public int SizeCount;
        public string? LastSeen;
        public string? Kind;
    }

    private static double Percentile(List<double> sorted, double p)
    {
        if (sorted.Count == 0) return 0;
        var index = p * (sorted.Count - 1);
        var lower = (int)Math.Floor(index);
        var upper = (int)Math.Ceiling(index);
        if (lower == upper) return sorted[lower];
        var weight = index - lower;
        return sorted[lower] * (1 - weight) + sorted[upper] * weight;
    }
}
