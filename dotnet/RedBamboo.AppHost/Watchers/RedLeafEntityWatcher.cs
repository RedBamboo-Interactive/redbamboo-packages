using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using RedBamboo.AppHost.Auth;
using RedBamboo.AppHost.Logging;

namespace RedBamboo.AppHost.Watchers;

public sealed record EntityChange(string Id, string TypeSlug, string Slug, string Name);
public delegate Task EntityChangeHandler(EntityChange change, CancellationToken ct);

public sealed class RedLeafEntityWatcher : IAsyncDisposable
{
    private readonly string _redLeafBaseUrl;
    private readonly JwtService _jwtService;
    private readonly LogService? _log;
    private readonly EntityWatcherOptions _options;
    private readonly List<EntityChangeHandler> _anyHandlers = new();
    private readonly Dictionary<string, List<(string? EventType, EntityChangeHandler Handler)>> _typeHandlers = new();
    private CancellationTokenSource? _cts;
    private Task? _loop;

    public RedLeafEntityWatcher(string redLeafBaseUrl, JwtService jwtService, LogService? log = null, EntityWatcherOptions? options = null)
    {
        _redLeafBaseUrl = redLeafBaseUrl;
        _jwtService = jwtService;
        _log = log;
        _options = options ?? new EntityWatcherOptions();
    }

    public void On(string typeSlug, EntityChangeHandler handler)
    {
        if (!_typeHandlers.TryGetValue(typeSlug, out var list))
            _typeHandlers[typeSlug] = list = new();
        list.Add((null, handler));
    }

    public void On(string eventType, string typeSlug, EntityChangeHandler handler)
    {
        if (!_typeHandlers.TryGetValue(typeSlug, out var list))
            _typeHandlers[typeSlug] = list = new();
        list.Add((eventType, handler));
    }

    public void OnAny(EntityChangeHandler handler)
        => _anyHandlers.Add(handler);

    public void Start(CancellationToken ct)
    {
        _cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _loop = RunAsync(_cts.Token);
    }

    public async Task StopAsync()
    {
        _cts?.Cancel();
        if (_loop != null)
        {
            try { await _loop; }
            catch (OperationCanceledException) { }
        }
    }

    public HttpClient CreateRedLeafClient(TimeSpan? timeout = null)
    {
        var token = _jwtService.GenerateAccessToken("system", "system@redsuite", "System", ["admin"]);
        var http = new HttpClient
        {
            BaseAddress = new Uri(_redLeafBaseUrl.TrimEnd('/') + "/"),
            Timeout = timeout ?? TimeSpan.FromSeconds(10),
        };
        http.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", $"Bearer {token}");
        return http;
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
        _cts?.Dispose();
    }

    private async Task RunAsync(CancellationToken ct)
    {
        _log?.Info(_options.LogCategory, "Watching entity changes via RedLeaf WS");

        var backoff = _options.InitialBackoff;

        while (!ct.IsCancellationRequested)
        {
            var connected = false;
            try
            {
                await ConnectAndListenAsync(ct, onConnected: () =>
                {
                    connected = true;
                    backoff = _options.InitialBackoff;
                });
            }
            catch (OperationCanceledException) { return; }
            catch (Exception ex)
            {
                if (!connected)
                    _log?.Warn(_options.LogCategory, $"WS connect failed: {ex.Message} — retrying in {backoff.TotalSeconds}s");
                else
                    _log?.Warn(_options.LogCategory, $"WS disconnected: {ex.Message} — reconnecting in {backoff.TotalSeconds}s");
            }

            try { await Task.Delay(backoff, ct); }
            catch (OperationCanceledException) { return; }

            if (!connected)
                backoff = TimeSpan.FromSeconds(Math.Min(backoff.TotalSeconds * _options.BackoffMultiplier, _options.MaxBackoff.TotalSeconds));
        }
    }

    private async Task ConnectAndListenAsync(CancellationToken ct, Action onConnected)
    {
        using var ws = new ClientWebSocket();
        var token = _jwtService.GenerateAccessToken("system", "system@redsuite", "System", ["admin"]);
        ws.Options.SetRequestHeader("Authorization", $"Bearer {token}");

        var wsUri = new Uri(_redLeafBaseUrl
            .Replace("https://", "wss://", StringComparison.OrdinalIgnoreCase)
            .Replace("http://", "ws://", StringComparison.OrdinalIgnoreCase)
            .TrimEnd('/') + "/ws");

        await ws.ConnectAsync(wsUri, ct);
        onConnected();

        var buffer = new byte[16384];
        using var ms = new MemoryStream();

        while (!ct.IsCancellationRequested && ws.State == WebSocketState.Open)
        {
            ms.SetLength(0);
            WebSocketReceiveResult result;
            do
            {
                result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
                if (result.MessageType == WebSocketMessageType.Close) return;
                ms.Write(buffer, 0, result.Count);
            }
            while (!result.EndOfMessage);

            await HandleMessageAsync(Encoding.UTF8.GetString(ms.GetBuffer(), 0, (int)ms.Length), ct);
        }
    }

    private async Task HandleMessageAsync(string json, CancellationToken ct)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            if (!root.TryGetProperty("type", out var typeEl)) return;
            var eventType = typeEl.GetString();

            if (eventType != "entity.updated" && eventType != "entity.deleted") return;

            if (!root.TryGetProperty("data", out var data)) return;

            var id = data.TryGetProperty("id", out var idEl) ? idEl.GetString() ?? "" : "";
            var typeSlug = data.TryGetProperty("typeSlug", out var tsEl) ? tsEl.GetString() ?? "" : "";
            var slug = data.TryGetProperty("slug", out var slugEl) ? slugEl.GetString() ?? "" : "";
            var name = data.TryGetProperty("name", out var nameEl) ? nameEl.GetString() ?? "" : "";

            var change = new EntityChange(id, typeSlug, slug, name);

            foreach (var handler in _anyHandlers)
            {
                try { await handler(change, ct); }
                catch (Exception ex) { _log?.Warn(_options.LogCategory, $"OnAny handler error: {ex.Message}"); }
            }

            if (_typeHandlers.TryGetValue(typeSlug, out var handlers))
            {
                foreach (var (et, h) in handlers)
                {
                    if (et != null && et != eventType) continue;
                    try { await h(change, ct); }
                    catch (Exception ex) { _log?.Warn(_options.LogCategory, $"On({typeSlug}) handler error: {ex.Message}"); }
                }
            }
        }
        catch (Exception ex)
        {
            _log?.Warn(_options.LogCategory, $"Handle message failed: {ex.Message}");
        }
    }
}
