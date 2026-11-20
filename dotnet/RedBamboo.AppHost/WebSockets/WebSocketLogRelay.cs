using System.Net.WebSockets;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using RedBamboo.AppHost.Auth;

namespace RedBamboo.AppHost.WebSockets;

/// <summary>Relays the AppHost event stream with the original caller's operational log access.</summary>
public static class WebSocketLogRelay
{
    private const string SuppressHeader = "X-AppHost-Suppress-Log-Events";
    private const string SuppressValue = "1";

    /// <summary>
    /// Before connecting to a trusted AppHost upstream, ask it to suppress operational log events
    /// if the incoming request lacks access. Pass the result to <see cref="RelayAsync"/>.
    /// </summary>
    public static bool ConfigureUpstream(HttpContext context, ClientWebSocketOptions options)
    {
        var restrictLogEvents = !AllowsLogEvents(context);
        if (restrictLogEvents) RequestSuppression(options);
        return restrictLogEvents;
    }

    /// <summary>
    /// Pump a connected AppHost /ws upstream to its downstream socket. The caller owns the
    /// reverse pump, if any, and socket shutdown. This must be the downstream's sole data writer.
    /// </summary>
    public static async Task RelayAsync(ClientWebSocket upstream, WebSocket downstream, bool restrictLogEvents,
        CancellationToken ct)
    {
        var relay = new MessageReader(upstream, restrictLogEvents);
        while (downstream.State == WebSocketState.Open && await relay.ReadMessageStartAsync(ct))
            await relay.SendMessageAsync(downstream, downstream.SendAsync, ct);
    }

    // A caller can only narrow the access granted by InfrastructureAccess. This header never
    // changes request origin, credentials, or authorization for any other route or event.
    internal static bool AllowsLogEvents(HttpContext context)
        => !context.Request.Headers.ContainsKey(SuppressHeader) && InfrastructureAccess.Allows(context);

    internal static void RequestSuppression(ClientWebSocketOptions options)
    {
        options.SetRequestHeader(SuppressHeader, SuppressValue);
        options.CollectHttpResponseDetails = true;
    }

    internal static void AcknowledgeSuppression(HttpContext context)
    {
        if (context.Request.Headers.ContainsKey(SuppressHeader))
            context.Response.Headers[SuppressHeader] = SuppressValue;
    }

    private static bool UpstreamSuppressesLogs(ClientWebSocket upstream)
        => upstream.HttpResponseHeaders is { } headers &&
           headers.TryGetValue(SuppressHeader, out var values) && values.Contains(SuppressValue);

    internal sealed class MessageReader(ClientWebSocket upstream, bool restrictLogEvents)
    {
        private const int ReadSize = 8192;
        private static ReadOnlySpan<byte> TypeProperty => "{\"type\":"u8;
        // The longest spelling of the log type is six bytes (\uXXXX) per character, plus quotes.
        private static readonly int MaxPrefixBytes = TypeProperty.Length + 2 + 6 * WebSocketBroadcaster.LogEntryEventType.Length;

        private readonly bool _inspectPrefix = restrictLogEvents && !UpstreamSuppressesLogs(upstream);
        private readonly byte[] _buffer = new byte[ReadSize + MaxPrefixBytes];
        private ValueWebSocketReceiveResult _first;
        private int _firstCount;

        internal async Task<bool> ReadMessageStartAsync(CancellationToken ct)
        {
            var pending = 0;
            var dropping = false;
            while (upstream.State == WebSocketState.Open)
            {
                var result = await upstream.ReceiveAsync(_buffer.AsMemory(pending, ReadSize), ct);
                if (result.MessageType == WebSocketMessageType.Close) return false;
                if (!dropping)
                {
                    var count = pending + result.Count;
                    var decision = _inspectPrefix && result.MessageType == WebSocketMessageType.Text
                        ? InspectPrefix(_buffer.AsSpan(0, count), result.EndOfMessage)
                        : Decision.Relay;

                    if (decision == Decision.Relay)
                    {
                        _first = result;
                        _firstCount = count;
                        return true;
                    }
                    if (decision == Decision.ReadMore)
                    {
                        pending = count;
                        continue;
                    }
                }

                pending = 0;
                dropping = !result.EndOfMessage;
            }

            return false;
        }

        internal async ValueTask SendMessageAsync(WebSocket downstream,
            Func<ReadOnlyMemory<byte>, WebSocketMessageType, bool, CancellationToken, ValueTask> sendFrame,
            CancellationToken ct)
        {
            var result = _first;
            await sendFrame(_buffer.AsMemory(0, _firstCount), result.MessageType, result.EndOfMessage, ct);
            try
            {
                while (!result.EndOfMessage)
                {
                    result = await upstream.ReceiveAsync(_buffer.AsMemory(0, ReadSize), ct);
                    if (result.MessageType == WebSocketMessageType.Close)
                        throw new WebSocketException(WebSocketError.ConnectionClosedPrematurely);
                    await sendFrame(_buffer.AsMemory(0, result.Count), result.MessageType, result.EndOfMessage, ct);
                }
            }
            catch
            {
                // The downstream has an unfinished message. It must reconnect to receive another.
                if (downstream.State == WebSocketState.Open) downstream.Abort();
                throw;
            }
        }

        private enum Decision { ReadMore, Drop, Relay }

        private static Decision InspectPrefix(ReadOnlySpan<byte> payload, bool endOfMessage)
        {
            var headerLength = Math.Min(payload.Length, TypeProperty.Length);
            if (!payload[..headerLength].SequenceEqual(TypeProperty[..headerLength])) return Decision.Drop;
            if (payload.Length == headerLength) return endOfMessage ? Decision.Drop : Decision.ReadMore;
            if (payload[headerLength] != (byte)'"') return Decision.Drop;

            // For peers without the upgrade acknowledgement, require the broadcaster's canonical
            // type-first envelope. Inspect the type alone and stream data without a size limit.
            var prefix = payload[..Math.Min(payload.Length, MaxPrefixBytes)];
            try
            {
                var reader = new Utf8JsonReader(prefix[headerLength..], isFinalBlock: false, state: default);
                if (reader.Read())
                    return reader.ValueTextEquals(WebSocketBroadcaster.LogEntryEventType) ? Decision.Drop : Decision.Relay;
            }
            catch (JsonException)
            {
                return Decision.Drop;
            }

            if (endOfMessage && payload.Length == prefix.Length) return Decision.Drop;
            // A string still open at the limit cannot spell the log discriminator, even escaped.
            return prefix.Length == MaxPrefixBytes ? Decision.Relay : Decision.ReadMore;
        }
    }
}
