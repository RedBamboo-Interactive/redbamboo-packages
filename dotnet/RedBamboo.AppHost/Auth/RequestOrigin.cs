using System.Net;
using Microsoft.AspNetCore.Http;

namespace RedBamboo.AppHost.Auth;

/// <summary>
/// Whether a request genuinely arrived on this machine. cloudflared connects to Kestrel over loopback,
/// so the peer address alone cannot tell a tunnel request from a local one; Cloudflare always adds
/// Cf-Connecting-Ip and Cf-Ray and a remote caller cannot remove them. A peer that reached us through
/// a trusted loopback proxy has its address replaced by X-Forwarded-For before this runs (see
/// <c>UseAppHostForwardedHeaders</c>), so a remote client behind the tunnel never looks like loopback.
/// Both services bind 127.0.0.1 only; a peer on any other interface (LAN) is not local.
///
/// Any other same-machine proxy (nginx, Caddy, ngrok, tailscale serve) also connects over loopback.
/// The forwarded-headers middleware removes an X-Forwarded-For it consumed (the original peer moves to
/// X-Original-For), so one still present was not applied: unparseable, or a chain longer than the one
/// hop we trust. That, or an RFC 7239 <c>Forwarded</c> header, which the middleware never reads, means
/// a proxy is describing a client we did not resolve, and the request is not local.
/// </summary>
public static class RequestOrigin
{
    public static bool ArrivedThroughTunnel(HttpContext context)
        => context.Request.Headers.ContainsKey("Cf-Connecting-Ip") || context.Request.Headers.ContainsKey("Cf-Ray");

    /// <summary>
    /// A proxy described the client and the forwarded-headers middleware did not resolve it: an RFC 7239
    /// <c>Forwarded</c> header, or an <c>X-Forwarded-For</c> left behind (a consumed one is removed).
    /// </summary>
    public static bool CarriesUnresolvedForwarding(HttpContext context)
        => context.Request.Headers.ContainsKey("Forwarded") || context.Request.Headers.ContainsKey("X-Forwarded-For");

    public static bool IsLocal(HttpContext context)
    {
        if (ArrivedThroughTunnel(context)) return false;
        if (CarriesUnresolvedForwarding(context)) return false;

        var remote = context.Connection.RemoteIpAddress;
        if (remote == null) return true;
        if (IPAddress.IsLoopback(remote)) return true;
        if (remote.Equals(context.Connection.LocalIpAddress)) return true;
        return false;
    }

    /// <summary>
    /// Vault-mode rule: a badge stamped <c>net: local</c> (agents, services, plugins, executions) is only
    /// good on a request that arrived locally. <c>remote</c> badges work everywhere. A badge with no
    /// <c>net</c> claim comes from legacy mode and is not restricted.
    /// </summary>
    public static bool BadgeReachAllows(System.Security.Claims.ClaimsPrincipal principal, HttpContext context)
        => principal.FindFirst(Vault.BadgeNet.Claim)?.Value switch
        {
            Vault.BadgeNet.Local => IsLocal(context),
            _ => true,
        };
}
