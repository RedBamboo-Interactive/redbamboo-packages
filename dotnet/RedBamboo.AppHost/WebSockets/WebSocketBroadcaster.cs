using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RedBamboo.AppHost.WebSockets;

public record WsEventSchema(
    string Type,
    string Description,
    string? DataSchema = null,
    IReadOnlyList<string>? Fields = null);

public class WebSocketBroadcaster
{
    internal const string LogEntryEventType = "log.entry";

    /// <summary>The close code a device's sockets get when its session ends (4000-4999 are the app's own).</summary>
    public const WebSocketCloseStatus SessionRevokedCloseStatus = (WebSocketCloseStatus)4401;

    /// <summary>How long a closed socket may take to acknowledge before its receive loop is abandoned.</summary>
    public static readonly TimeSpan SessionCloseGrace = TimeSpan.FromSeconds(2);

    private sealed record ClientConnection(WebSocket Socket, bool AllowsLogEvents, WebSocketPrincipal Principal,
        CancellationTokenSource? Lifetime)
    {
        public SemaphoreSlim MessageGate { get; } = new(1, 1);
        public SemaphoreSlim SendGate { get; } = new(1, 1);

        public async ValueTask SendFrameAsync(ReadOnlyMemory<byte> payload, WebSocketMessageType messageType,
            bool endOfMessage, CancellationToken ct)
        {
            await SendGate.WaitAsync(ct);
            try
            {
                if (Socket.State != WebSocketState.Open)
                    throw new WebSocketException(WebSocketError.InvalidState);
                await Socket.SendAsync(payload, messageType, endOfMessage, ct);
            }
            finally
            {
                SendGate.Release();
            }
        }
    }

    private readonly ConcurrentDictionary<string, ClientConnection> _clients = new();
    private readonly List<WsEventSchema> _schemas = new();

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter() }
    };

    public void RegisterEvent(WsEventSchema schema) => _schemas.Add(schema);

    public IReadOnlyList<WsEventSchema> GetEventSchemas() => _schemas;

    public void Broadcast<T>(string type, T data)
    {
        var segment = Serialize(type, data);

        foreach (var (id, client) in _clients)
        {
            if (type == LogEntryEventType && !client.AllowsLogEvents) continue;
            _ = SendToClientAsync(id, segment, WebSocketMessageType.Text, true, CancellationToken.None);
        }
    }

    /// <summary>
    /// Sends an event only to <paramref name="userId"/>'s own browsers: person connections of that user and,
    /// when <paramref name="includeLocalAccess"/>, tokenless loopback ones (the host decides whether the
    /// person at this computer is that user). Agent, execution and service connections never receive it.
    /// Returns how many connections it was sent to.
    /// </summary>
    public int SendToUser<T>(string userId, string type, T data, bool includeLocalAccess = false)
    {
        var segment = Serialize(type, data);
        var sent = 0;
        foreach (var (id, client) in _clients)
        {
            var principal = client.Principal;
            var mine = principal.Kind == WebSocketPrincipalKind.Person
                && string.Equals(principal.UserId, userId, StringComparison.Ordinal);
            if (!mine && !(includeLocalAccess && principal.Kind == WebSocketPrincipalKind.LocalAccess)) continue;
            if (type == LogEntryEventType && !client.AllowsLogEvents) continue;
            _ = SendToClientAsync(id, segment, WebSocketMessageType.Text, true, CancellationToken.None);
            sent++;
        }
        return sent;
    }

    /// <summary>
    /// Closes every connection of device session <paramref name="sessionId"/> with
    /// <see cref="SessionRevokedCloseStatus"/>, so the browser knows it was signed out rather than cut off.
    /// A connection that does not acknowledge within <see cref="SessionCloseGrace"/> has its receive loop
    /// abandoned, which also ends its upstream relays. Returns how many connections were closing.
    /// </summary>
    public async Task<int> CloseSessionAsync(string sessionId, string description = "session_revoked",
        CancellationToken ct = default)
    {
        var targets = _clients
            .Where(c => string.Equals(c.Value.Principal.SessionId, sessionId, StringComparison.Ordinal))
            .ToList();
        var closing = 0;
        foreach (var (id, client) in targets)
        {
            bool sent;
            using (var sendTimeout = CancellationTokenSource.CreateLinkedTokenSource(ct))
            {
                sendTimeout.CancelAfter(SessionCloseGrace);
                sent = await CloseClientAsync(id, SessionRevokedCloseStatus, description, sendTimeout.Token);
            }
            try
            {
                if (sent) client.Lifetime?.CancelAfter(SessionCloseGrace);
                else client.Lifetime?.Cancel();
            }
            catch (ObjectDisposedException) { }
            if (sent) closing++;
        }
        return closing;
    }

    private static ArraySegment<byte> Serialize<T>(string type, T data)
        => new(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { type, data }, JsonOptions)));

    /// <summary>
    /// Send a local message or relay notification through the client's single writer.
    /// </summary>
    internal Task<bool> SendToClientAsync(
        string id,
        ArraySegment<byte> payload,
        WebSocketMessageType messageType,
        bool endOfMessage,
        CancellationToken ct)
        => SendToClientAsync(id, (payload, messageType, endOfMessage),
            static (client, frame, token) =>
                client.SendFrameAsync(frame.payload.AsMemory(), frame.messageType, frame.endOfMessage, token), ct);

    // Keep continuations together so a local event or another relay cannot enter mid-message.
    internal Task<bool> SendToClientAsync(string id, WebSocketLogRelay.MessageReader relay, CancellationToken ct)
        => SendToClientAsync(id, relay, static (client, reader, token) =>
            reader.SendMessageAsync(client.Socket, client.SendFrameAsync, token), ct);

    private async Task<bool> SendToClientAsync<T>(
        string id,
        T message,
        Func<ClientConnection, T, CancellationToken, ValueTask> send,
        CancellationToken ct)
    {
        if (!_clients.TryGetValue(id, out var client)) return false;

        await client.MessageGate.WaitAsync(ct);
        try
        {
            if (client.Socket.State != WebSocketState.Open)
            {
                _clients.TryRemove(id, out _);
                return false;
            }

            await send(client, message, ct);
            return true;
        }
        catch (Exception ex) when (ex is WebSocketException or OperationCanceledException or ObjectDisposedException)
        {
            _clients.TryRemove(id, out _);
            return false;
        }
        finally
        {
            client.MessageGate.Release();
        }
    }

    /// <summary>
    /// Start the close handshake through the client's single writer (a close frame is a send),
    /// including between fragments of a relayed message. False when the client is gone or closed.
    /// </summary>
    internal async Task<bool> CloseClientAsync(
        string id,
        WebSocketCloseStatus status,
        string description,
        CancellationToken ct)
    {
        if (!_clients.TryGetValue(id, out var client)) return false;

        try
        {
            await client.SendGate.WaitAsync(ct);
        }
        catch (OperationCanceledException)
        {
            return false;
        }
        try
        {
            if (client.Socket.State != WebSocketState.Open) return false;
            await client.Socket.CloseOutputAsync(status, description, ct);
            return true;
        }
        catch (Exception ex) when (ex is WebSocketException or OperationCanceledException or ObjectDisposedException)
        {
            return false;
        }
        finally
        {
            client.SendGate.Release();
        }
    }

    internal void AddClient(string id, WebSocket ws, bool allowsLogEvents)
        => AddClientFor(id, ws, allowsLogEvents, WebSocketPrincipal.Anonymous, null);

    /// <summary>
    /// <see cref="AddClient"/> with who holds the connection. A separate name on purpose: consumers' tests find
    /// <c>AddClient</c> by reflection, and an overload would make that lookup ambiguous.
    /// </summary>
    /// <param name="lifetime">Cancelled to abandon the connection's receive loop (session revoked).</param>
    internal void AddClientFor(string id, WebSocket ws, bool allowsLogEvents, WebSocketPrincipal principal,
        CancellationTokenSource? lifetime)
        => _clients[id] = new ClientConnection(ws, allowsLogEvents, principal, lifetime);

    /// <summary>Who holds connection <paramref name="id"/> (tests).</summary>
    internal WebSocketPrincipal? PrincipalOf(string id) => _clients.TryGetValue(id, out var c) ? c.Principal : null;

    internal bool RemoveClient(string id) => _clients.TryRemove(id, out _);

    internal int ClientCount => _clients.Count;
}
