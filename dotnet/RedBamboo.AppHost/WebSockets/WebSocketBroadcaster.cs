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
    private sealed record ClientConnection(WebSocket Socket, SemaphoreSlim SendGate);

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

        foreach (var id in _clients.Keys)
        {
            _ = SendToClientAsync(id, segment, WebSocketMessageType.Text, true, CancellationToken.None);
        }
    }

    /// <summary>
    /// Send a local or relayed frame through the client's single writer. System.Net.WebSockets
    /// supports only one concurrent send; without this gate a kernel event racing a Compute
    /// stream frame can fault the upstream relay and strand the browser on a local-only socket.
    /// </summary>
    internal async Task<bool> SendToClientAsync(
        string id,
        ArraySegment<byte> payload,
        WebSocketMessageType messageType,
        bool endOfMessage,
        CancellationToken ct)
    {
        if (!_clients.TryGetValue(id, out var client)) return false;

        await client.SendGate.WaitAsync(ct);
        try
        {
            if (client.Socket.State != WebSocketState.Open)
            {
                _clients.TryRemove(id, out _);
                return false;
            }

            await client.Socket.SendAsync(payload, messageType, endOfMessage, ct);
            return true;
        }
        catch (Exception ex) when (ex is WebSocketException or OperationCanceledException or ObjectDisposedException)
        {
            _clients.TryRemove(id, out _);
            return false;
        }
        finally
        {
            client.SendGate.Release();
        }
    }

    internal void AddClient(string id, WebSocket ws)
        => _clients[id] = new ClientConnection(ws, new SemaphoreSlim(1, 1));

    internal bool RemoveClient(string id) => _clients.TryRemove(id, out _);

    internal int ClientCount => _clients.Count;
}
