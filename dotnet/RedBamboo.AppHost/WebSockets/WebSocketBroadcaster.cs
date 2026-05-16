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
    private readonly ConcurrentDictionary<string, WebSocket> _clients = new();
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

        foreach (var (id, ws) in _clients)
        {
            if (ws.State != WebSocketState.Open)
            {
                _clients.TryRemove(id, out _);
                continue;
            }

            try
            {
                _ = ws.SendAsync(segment, WebSocketMessageType.Text, true, CancellationToken.None);
            }
            catch
            {
                _clients.TryRemove(id, out _);
            }
        }
    }

    internal void AddClient(string id, WebSocket ws) => _clients[id] = ws;

    internal bool RemoveClient(string id) => _clients.TryRemove(id, out _);

    internal int ClientCount => _clients.Count;
}
