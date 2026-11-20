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

    private sealed record ClientConnection(WebSocket Socket, bool AllowsLogEvents)
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
        var message = JsonSerializer.Serialize(new { type, data }, JsonOptions);
        var bytes = Encoding.UTF8.GetBytes(message);
        var segment = new ArraySegment<byte>(bytes);

        foreach (var (id, client) in _clients)
        {
            if (type == LogEntryEventType && !client.AllowsLogEvents) continue;
            _ = SendToClientAsync(id, segment, WebSocketMessageType.Text, true, CancellationToken.None);
        }
    }

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
        => _clients[id] = new ClientConnection(ws, allowsLogEvents);

    internal bool RemoveClient(string id) => _clients.TryRemove(id, out _);

    internal int ClientCount => _clients.Count;
}
