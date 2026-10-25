using System.Net.Http;
using System.Net.Http.Headers;

namespace RedBamboo.AppHost.Auth;

/// <summary>
/// Puts the suite's own "system" badge on each outgoing request instead of minting one when the client
/// is built. A badge minted at construction would make a vault outage at boot crash whoever built the
/// client; minted here, a vault outage fails only the call that needed it, and in vault mode the badge is
/// cached for most of its lifetime so this costs no vault round trip per request.
/// </summary>
internal sealed class SystemAccessTokenHandler(JwtService jwtService) : DelegatingHandler(new HttpClientHandler())
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var token = jwtService.GenerateAccessToken("system", "system@redsuite", "System", ["admin"]);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return base.SendAsync(request, ct);
    }
}
