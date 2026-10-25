using System.Net.Http;
using System.Net.Http.Headers;
using RedBamboo.AppHost.Auth.Vault;

namespace RedBamboo.AppHost.Auth;

/// <summary>
/// Puts a freshly obtained badge on each outgoing request instead of fixing one when the client is built.
/// A badge fixed at construction would make a vault outage at boot crash whoever built the client (and
/// would go stale); obtained here, a vault outage fails only the call that needed it, as an ordinary
/// <see cref="HttpRequestException"/> the caller already handles. In vault mode service badges are cached,
/// so this costs no vault round trip per request.
/// </summary>
public sealed class BadgeBearerHandler(Func<string> badge, HttpMessageHandler? inner = null)
    : DelegatingHandler(inner ?? new HttpClientHandler())
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        string token;
        try { token = badge(); }
        catch (VaultUnavailableException e) { throw new HttpRequestException(e.Message, e); }
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return base.SendAsync(request, ct);
    }
}
