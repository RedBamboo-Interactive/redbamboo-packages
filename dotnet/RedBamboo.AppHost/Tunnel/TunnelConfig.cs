namespace RedBamboo.AppHost.Tunnel;

public class TunnelConfig
{
    public bool Enabled { get; set; }
    public string? TunnelToken { get; set; }
    public string? Hostname { get; set; }
    public string? CloudflaredPath { get; set; }
    public string? AccessToken { get; set; }
    public bool DetectExternalTunnel { get; set; }
}
