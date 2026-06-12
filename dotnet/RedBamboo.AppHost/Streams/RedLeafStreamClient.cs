using System.Collections.Concurrent;
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
/// Declares an entity type this app upserts entities into. Created in RedLeaf
/// on first use if missing (never overwritten). The slugified Name must equal
/// Slug — RedLeaf derives the slug from the name on create.
/// </summary>
public sealed record EntityTypeDefinition(
    string Slug,
    string Name,
    string Description,
    string? Icon = null,
    string? Color = null,
    bool Versioning = true,
    object[]? Fields = null);

/// <summary>
/// Fire-and-forget shipper to RedLeaf for suite apps. Two write shapes:
/// append-only records to /api/streams (bounded channel, drop-oldest, bulk
/// batches), and entity upserts via PUT by-slug (latest-wins per slug,
/// debounced). Designed so the app keeps working when RedLeaf is down:
/// records drop after capped retries, upserts retry on the next flush tick.
/// </summary>
public sealed class RedLeafStreamClient : IAsyncDisposable
{
    private const int ChannelCapacity = 10_000;
    private const int MaxBatch = 200;
    private static readonly TimeSpan FlushInterval = TimeSpan.FromMilliseconds(500);
    private static readonly TimeSpan[] RetryDelays = [TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(15)];
    private static readonly TimeSpan WarnInterval = TimeSpan.FromMinutes(5);

    private const int MaxUpsertAttempts = 10;

    private sealed record Pending(string Stream, string DataJson, Guid? EntityId, string? EntitySlug, string? UserId, DateTimeOffset CreatedAt);
    private sealed record PendingUpsert(string Slug, string TypeSlug, string Name, string DataJson, int Attempts = 0);

    private readonly HttpClient _http;
    private readonly string _appName;
    private readonly LogService? _log;
    private readonly Channel<Pending> _channel;
    private readonly CancellationTokenSource _cts = new();
    private readonly Task _consumerTask;

    private readonly Dictionary<string, StreamDefinition> _streamDefs = new();
    private readonly HashSet<string> _streamsRegistered = [];
    private readonly Dictionary<string, EntityTypeDefinition> _typeDefs = new();
    private readonly HashSet<string> _typesRegistered = [];
    private readonly ConcurrentDictionary<string, PendingUpsert> _pendingUpserts = new();
    private readonly ConcurrentDictionary<string, Guid> _entityIds = new();
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

        _consumerTask = Task.Run(() => RunAsync(_cts.Token));
    }

    /// <summary>Declare a stream this app writes to. Call once at startup per stream.</summary>
    public void DefineStream(StreamDefinition definition)
    {
        lock (_streamDefs)
            _streamDefs[definition.Slug] = definition;
    }

    /// <summary>Declare an entity type this app upserts into. Call once at startup per type.</summary>
    public void DefineEntityType(EntityTypeDefinition definition)
    {
        lock (_typeDefs)
            _typeDefs[definition.Slug] = definition;
    }

    /// <summary>
    /// Queue a record for shipping. Non-blocking; the enqueue timestamp is
    /// preserved as the record's created_at so buffering doesn't skew times.
    /// Pass <paramref name="createdAt"/> explicitly when backfilling
    /// historical rows.
    /// </summary>
    public void Enqueue(string stream, object data, Guid? entityId = null, string? userId = null, DateTimeOffset? createdAt = null)
    {
        var json = JsonSerializer.Serialize(data);
        _channel.Writer.TryWrite(new Pending(stream, json, entityId, null, userId, createdAt ?? DateTimeOffset.UtcNow));
    }

    /// <summary>
    /// Queue a record linked to an upserted entity by slug. The entity's GUID
    /// is resolved (from the upsert cache, or a lookup) before shipping, so
    /// callers don't need to know server-assigned IDs.
    /// </summary>
    public void EnqueueForEntity(string stream, string entitySlug, object data, string? userId = null)
    {
        var json = JsonSerializer.Serialize(data);
        _channel.Writer.TryWrite(new Pending(stream, json, null, entitySlug, userId, DateTimeOffset.UtcNow));
    }

    /// <summary>
    /// Queue an entity upsert (PUT by-slug). Latest-wins per slug between
    /// flushes, so high-frequency updates (status, token counts) coalesce
    /// instead of producing one HTTP call each.
    /// </summary>
    public void UpsertEntity(string slug, string typeSlug, string name, object data)
    {
        var json = JsonSerializer.Serialize(data);
        _pendingUpserts[slug] = new PendingUpsert(slug, typeSlug, name, json);
    }

    private async Task RunAsync(CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                await Task.Delay(FlushInterval, ct);
                await FlushUpsertsAsync(ct);
                await FlushRecordsAsync(ct);
            }
        }
        catch (OperationCanceledException)
        {
            // shutdown — one best-effort pass with a short grace window
            using var graceCts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            try
            {
                await FlushUpsertsAsync(graceCts.Token);
                await FlushRecordsAsync(graceCts.Token);
            }
            catch { /* best effort on shutdown */ }
        }
    }

    private async Task FlushUpsertsAsync(CancellationToken ct)
    {
        if (_pendingUpserts.IsEmpty) return;

        foreach (var slug in _pendingUpserts.Keys.ToList())
        {
            if (!_pendingUpserts.TryRemove(slug, out var upsert)) continue;

            try
            {
                if (!await EnsureEntityTypeAsync(upsert.TypeSlug, ct))
                {
                    _pendingUpserts.TryAdd(slug, upsert); // retry next tick
                    return;
                }

                var body = $"{{\"name\":{JsonSerializer.Serialize(upsert.Name)},\"type_slug\":{JsonSerializer.Serialize(upsert.TypeSlug)},\"data\":{upsert.DataJson}}}";
                using var content = new StringContent(body, Encoding.UTF8, "application/json");
                var response = await _http.PutAsync($"api/entities/by-slug/{Uri.EscapeDataString(slug)}", content, ct);

                if (response.IsSuccessStatusCode)
                {
                    var json = await response.Content.ReadAsStringAsync(ct);
                    using var doc = JsonDocument.Parse(json);
                    if (doc.RootElement.TryGetProperty("id", out var idEl) && Guid.TryParse(idEl.GetString(), out var id))
                        _entityIds[slug] = id;
                    continue;
                }

                if (response.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.Conflict)
                {
                    // Not transient — drop and report rather than retrying forever.
                    Warn($"RedLeaf rejected upsert of '{slug}': {(int)response.StatusCode} {await response.Content.ReadAsStringAsync(ct)}");
                    continue;
                }

                // A deterministically failing payload (e.g. one the server
                // 500s on) must not stall the queue forever — cap attempts.
                if (upsert.Attempts + 1 >= MaxUpsertAttempts)
                {
                    Warn($"Dropping upsert of '{slug}' after {MaxUpsertAttempts} failed attempts (last status {(int)response.StatusCode})");
                    continue;
                }

                _pendingUpserts.TryAdd(slug, upsert with { Attempts = upsert.Attempts + 1 });
                return; // server unhappy — stop this pass, retry next tick
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                _pendingUpserts.TryAdd(slug, upsert);
                throw;
            }
            catch (Exception)
            {
                _pendingUpserts.TryAdd(slug, upsert);
                return; // network failure — retry next tick
            }
        }
    }

    private async Task FlushRecordsAsync(CancellationToken ct)
    {
        var batch = new List<Pending>(MaxBatch);
        while (true)
        {
            batch.Clear();
            while (batch.Count < MaxBatch && _channel.Reader.TryRead(out var item))
                batch.Add(item);
            if (batch.Count == 0) return;

            foreach (var group in batch.GroupBy(p => p.Stream))
                await ShipAsync(group.Key, [.. group], ct);

            if (batch.Count < MaxBatch) return; // drained
        }
    }

    private async Task ShipAsync(string stream, List<Pending> records, CancellationToken ct)
    {
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                if (!await EnsureStreamAsync(stream, ct))
                    break; // unregistered and registration failed — drop, retry on next batch

                var payload = await BuildPayloadAsync(records, ct);
                using var content = new StringContent(payload, Encoding.UTF8, "application/json");
                var response = await _http.PostAsync($"api/streams/{stream}/records", content, ct);

                if (response.IsSuccessStatusCode)
                    return;

                if (response.StatusCode == HttpStatusCode.NotFound)
                {
                    // Stream registration raced or was deleted — re-register next pass.
                    lock (_streamDefs) _streamsRegistered.Remove(stream);
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

    private async Task<bool> EnsureStreamAsync(string stream, CancellationToken ct)
    {
        StreamDefinition? definition;
        lock (_streamDefs)
        {
            if (_streamsRegistered.Contains(stream)) return true;
            _streamDefs.TryGetValue(stream, out definition);
        }

        // Create-if-missing only: an existing registration may carry retention
        // tuned by the user in RedLeaf — never overwrite it.
        var existing = await _http.GetAsync($"api/entities/{stream}", ct);
        if (existing.IsSuccessStatusCode)
        {
            lock (_streamDefs) _streamsRegistered.Add(stream);
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

        lock (_streamDefs) _streamsRegistered.Add(stream);
        _log?.Info("streams", $"Registered stream '{stream}' in RedLeaf");
        return true;
    }

    private async Task<bool> EnsureEntityTypeAsync(string typeSlug, CancellationToken ct)
    {
        EntityTypeDefinition? definition;
        lock (_typeDefs)
        {
            if (_typesRegistered.Contains(typeSlug)) return true;
            _typeDefs.TryGetValue(typeSlug, out definition);
        }

        var existing = await _http.GetAsync($"api/entity-types/{typeSlug}", ct);
        if (existing.IsSuccessStatusCode)
        {
            lock (_typeDefs) _typesRegistered.Add(typeSlug);
            return true;
        }

        if (definition is null)
        {
            Warn($"Entity type '{typeSlug}' does not exist in RedLeaf and no EntityTypeDefinition was provided");
            return false;
        }

        // Omit absent optionals entirely — the create endpoint treats a JSON
        // null `fields` as an array and faults.
        var payload = new Dictionary<string, object?>
        {
            ["name"] = definition.Name,
            ["description"] = definition.Description,
            ["versioning"] = definition.Versioning,
        };
        if (definition.Icon is not null) payload["icon"] = definition.Icon;
        if (definition.Color is not null) payload["color"] = definition.Color;
        if (definition.Fields is not null) payload["fields"] = definition.Fields;
        var body = JsonSerializer.Serialize(payload);

        using var content = new StringContent(body, Encoding.UTF8, "application/json");
        var response = await _http.PostAsync("api/entity-types", content, ct);
        if (!response.IsSuccessStatusCode)
        {
            Warn($"Failed to create entity type '{typeSlug}' in RedLeaf: {(int)response.StatusCode}");
            return false;
        }

        lock (_typeDefs) _typesRegistered.Add(typeSlug);
        _log?.Info("streams", $"Created entity type '{typeSlug}' in RedLeaf");
        return true;
    }

    private async Task<Guid?> ResolveEntityIdAsync(string slug, CancellationToken ct)
    {
        if (_entityIds.TryGetValue(slug, out var cached)) return cached;

        try
        {
            var response = await _http.GetAsync($"api/entities/{Uri.EscapeDataString(slug)}", ct);
            if (!response.IsSuccessStatusCode) return null;
            var json = await response.Content.ReadAsStringAsync(ct);
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("id", out var idEl) && Guid.TryParse(idEl.GetString(), out var id))
            {
                _entityIds[slug] = id;
                return id;
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch { /* resolution is best-effort; record ships unlinked */ }

        return null;
    }

    private async Task<string> BuildPayloadAsync(List<Pending> records, CancellationToken ct)
    {
        var sb = new StringBuilder(records.Count * 128);
        sb.Append("{\"records\":[");
        for (var i = 0; i < records.Count; i++)
        {
            if (i > 0) sb.Append(',');
            var r = records[i];

            var entityId = r.EntityId;
            if (entityId is null && r.EntitySlug is { } slug)
                entityId = await ResolveEntityIdAsync(slug, ct);

            sb.Append("{\"data\":").Append(r.DataJson);
            if (entityId is { } eid)
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
