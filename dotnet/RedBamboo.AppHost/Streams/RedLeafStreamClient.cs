using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using RedBamboo.AppHost.Auth;
using RedBamboo.AppHost.Logging;

namespace RedBamboo.AppHost.Streams;

/// <summary>
/// Declares a record stream this app writes to. Registered in RedLeaf as a
/// `stream` entity on first use — only if it doesn't already exist, so
/// retention tuned in the RedLeaf UI survives app restarts.
/// </summary>
public sealed record StreamDefinition(
    string Slug,
    string Name,
    string Description,
    int? RetentionDays = null,
    string? ParentType = null);

/// <summary>
/// Fire-and-forget shipper for append-only records to RedLeaf's /api/streams
/// endpoints. Records are buffered in a bounded channel (drop-oldest), batched
/// per stream, and shipped in bulk. Designed for telemetry-class data: the app
/// must keep working when RedLeaf is down, so persistent failures drop the
/// batch after capped retries rather than blocking or growing memory.
/// </summary>
public sealed class RedLeafStreamClient : IAsyncDisposable
{
    private const int ChannelCapacity = 10_000;
    private const int MaxBatch = 200;
    private static readonly TimeSpan Linger = TimeSpan.FromMilliseconds(500);
    private static readonly TimeSpan[] RetryDelays = [TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(15)];
    private static readonly TimeSpan WarnInterval = TimeSpan.FromMinutes(5);

    private sealed record Pending(string Stream, string DataJson, Guid? EntityId, string? UserId, DateTimeOffset CreatedAt);

    private readonly HttpClient _http;
    private readonly string _appName;
    private readonly LogService? _log;
    private readonly Channel<Pending> _channel;
    private readonly CancellationTokenSource _cts = new();
    private readonly Task _consumerTask;
    private readonly Dictionary<string, StreamDefinition> _definitions = new();
    private readonly HashSet<string> _registered = [];
    private DateTimeOffset _lastWarn = DateTimeOffset.MinValue;

    public RedLeafStreamClient(string redLeafBaseUrl, string appName, JwtService jwtService, LogService? log = null)
    {
        _appName = appName;
        _log = log;

        var token = jwtService.GenerateAccessToken("system", "system@redsuite", "System", ["admin"]);
        _http = new HttpClient
        {
            BaseAddress = new Uri(redLeafBaseUrl.TrimEnd('/') + "/"),
            Timeout = TimeSpan.FromSeconds(15),
        };
        _http.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", $"Bearer {token}");

        _channel = Channel.CreateBounded<Pending>(
            new BoundedChannelOptions(ChannelCapacity) { FullMode = BoundedChannelFullMode.DropOldest });

        _consumerTask = Task.Run(() => ConsumeAsync(_cts.Token));
    }

    /// <summary>Declare a stream this app writes to. Call once at startup per stream.</summary>
    public void DefineStream(StreamDefinition definition)
    {
        lock (_definitions)
            _definitions[definition.Slug] = definition;
    }

    /// <summary>
    /// Queue a record for shipping. Non-blocking; the enqueue timestamp is
    /// preserved as the record's created_at so buffering doesn't skew times.
    /// </summary>
    public void Enqueue(string stream, object data, Guid? entityId = null, string? userId = null)
    {
        var json = JsonSerializer.Serialize(data);
        _channel.Writer.TryWrite(new Pending(stream, json, entityId, userId, DateTimeOffset.UtcNow));
    }

    private async Task ConsumeAsync(CancellationToken ct)
    {
        var batch = new List<Pending>(MaxBatch);
        try
        {
            while (await _channel.Reader.WaitToReadAsync(ct))
            {
                batch.Clear();
                while (batch.Count < MaxBatch && _channel.Reader.TryRead(out var item))
                    batch.Add(item);

                // Brief linger to coalesce bursts into fewer HTTP calls.
                if (batch.Count < MaxBatch)
                {
                    await Task.Delay(Linger, ct);
                    while (batch.Count < MaxBatch && _channel.Reader.TryRead(out var item))
                        batch.Add(item);
                }

                foreach (var group in batch.GroupBy(p => p.Stream))
                    await ShipAsync(group.Key, [.. group], ct);
            }
        }
        catch (OperationCanceledException)
        {
            // shutdown — drain whatever is left with a short grace window
            batch.Clear();
            while (batch.Count < MaxBatch && _channel.Reader.TryRead(out var item))
                batch.Add(item);
            if (batch.Count > 0)
            {
                using var graceCts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                foreach (var group in batch.GroupBy(p => p.Stream))
                {
                    try { await ShipAsync(group.Key, [.. group], graceCts.Token); }
                    catch { /* best effort on shutdown */ }
                }
            }
        }
    }

    private async Task ShipAsync(string stream, List<Pending> records, CancellationToken ct)
    {
        var payload = BuildPayload(records);

        for (var attempt = 0; ; attempt++)
        {
            try
            {
                if (!await EnsureRegisteredAsync(stream, ct))
                    break; // unregistered and registration failed — drop, retry on next batch

                using var content = new StringContent(payload, Encoding.UTF8, "application/json");
                var response = await _http.PostAsync($"api/streams/{stream}/records", content, ct);

                if (response.IsSuccessStatusCode)
                    return;

                if (response.StatusCode == HttpStatusCode.NotFound)
                {
                    // Stream registration raced or was deleted — re-register next pass.
                    lock (_definitions) _registered.Remove(stream);
                }
                else if (response.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.Forbidden)
                {
                    // Not transient — retrying the same payload can't succeed.
                    Warn($"RedLeaf rejected {records.Count} record(s) for '{stream}': {(int)response.StatusCode}");
                    return;
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception)
            {
                // network failure — fall through to retry/drop
            }

            if (attempt >= RetryDelays.Length)
            {
                Warn($"Dropping {records.Count} record(s) for stream '{stream}' — RedLeaf unreachable after {attempt + 1} attempts");
                return;
            }

            await Task.Delay(RetryDelays[attempt], ct);
        }
    }

    private async Task<bool> EnsureRegisteredAsync(string stream, CancellationToken ct)
    {
        StreamDefinition? definition;
        lock (_definitions)
        {
            if (_registered.Contains(stream)) return true;
            _definitions.TryGetValue(stream, out definition);
        }

        // Create-if-missing only: an existing registration may carry retention
        // tuned by the user in RedLeaf — never overwrite it.
        var existing = await _http.GetAsync($"api/entities/{stream}", ct);
        if (existing.IsSuccessStatusCode)
        {
            lock (_definitions) _registered.Add(stream);
            return true;
        }

        if (definition is null)
        {
            Warn($"Stream '{stream}' is not registered in RedLeaf and no StreamDefinition was provided");
            return false;
        }

        var body = JsonSerializer.Serialize(new
        {
            name = definition.Name,
            type_slug = "stream",
            data = new Dictionary<string, object?>
            {
                ["description"] = definition.Description,
                ["retention_days"] = definition.RetentionDays,
                ["parent_type"] = definition.ParentType,
                ["app"] = _appName,
            },
        });

        using var content = new StringContent(body, Encoding.UTF8, "application/json");
        var response = await _http.PutAsync($"api/entities/by-slug/{stream}", content, ct);
        if (!response.IsSuccessStatusCode)
        {
            Warn($"Failed to register stream '{stream}' in RedLeaf: {(int)response.StatusCode}");
            return false;
        }

        lock (_definitions) _registered.Add(stream);
        _log?.Info("streams", $"Registered stream '{stream}' in RedLeaf");
        return true;
    }

    private static string BuildPayload(List<Pending> records)
    {
        var sb = new StringBuilder(records.Count * 128);
        sb.Append("{\"records\":[");
        for (var i = 0; i < records.Count; i++)
        {
            if (i > 0) sb.Append(',');
            var r = records[i];
            sb.Append("{\"data\":").Append(r.DataJson);
            if (r.EntityId is { } eid)
                sb.Append(",\"entity_id\":\"").Append(eid).Append('"');
            if (r.UserId is { } uid)
                sb.Append(",\"user_id\":").Append(JsonSerializer.Serialize(uid));
            sb.Append(",\"created_at\":\"").Append(r.CreatedAt.ToString("O")).Append("\"}");
        }
        sb.Append("]}");
        return sb.ToString();
    }

    private void Warn(string message)
    {
        var now = DateTimeOffset.UtcNow;
        if (now - _lastWarn < WarnInterval) return;
        _lastWarn = now;
        _log?.Warn("streams", message);
    }

    public async ValueTask DisposeAsync()
    {
        _channel.Writer.TryComplete();
        _cts.Cancel();
        try { await _consumerTask.WaitAsync(TimeSpan.FromSeconds(8)); } catch { }
        _cts.Dispose();
        _http.Dispose();
    }
}
