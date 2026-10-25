using System.Text.Json;

namespace RedBamboo.AppHost.Auth.Vault;

public enum BadgeSigningMode
{
    /// <summary>No vault on this machine: HS256 with the shared key, as before.</summary>
    Legacy,
    /// <summary>Leaf Vault signs every badge; no shared key is read, created or accepted.</summary>
    Vault,
}

/// <summary>The outcome of the boot decision, identical in RedLeaf and RedCompute.</summary>
public sealed record BadgeSigningSetup(
    BadgeSigningMode Mode,
    string? LegacySigningKey,
    VaultBadgeAuthority? Authority,
    string Reason)
{
    /// <summary>Options for <see cref="JwtService"/> in whichever mode was chosen.</summary>
    public JwtOptions ToJwtOptions() => Mode == BadgeSigningMode.Vault
        ? new JwtOptions { Vault = Authority }
        : new JwtOptions { SigningKey = LegacySigningKey! };
}

/// <summary>
/// The per-machine, one-way badge signing decision, made once at boot with the same rules in every
/// service.
/// <list type="bullet">
/// <item>Vault reachable (pipe answers and is owned by the LeafVault service): vault mode.</item>
/// <item>Vault not reachable but this machine ever ran vault mode (non-secret marker file) or the
/// LeafVault service is registered: still vault mode, signing blocked until the vault is back. There
/// is never a fall back to the shared key, and the shared key is never regenerated.</item>
/// <item>Neither: legacy mode, today's behaviour (testers without the vault).</item>
/// </list>
/// The marker lives in the suite's config directory, which the user account can write; that is
/// acceptable because it only ever moves a machine toward vault mode, never away from it, and a
/// machine whose marker is deleted is still held in vault mode by the registered service.
/// </summary>
public static class BadgeSigningBootstrap
{
    public const string ModeMarkerFile = "auth-mode.json";
    public const string ConfirmedMarkerPrefix = "auth-vault-confirmed.";
    public const string LegacyKeyFile = "auth-signing-key.json";
    private static readonly string[] ConfirmingServices = ["redleaf", "redcompute"];

    public static BadgeSigningSetup Resolve(string configDir, string serviceId, IBadgeVault? vault = null,
        Func<bool>? serviceRegistered = null, Action<string>? log = null, TimeSpan? retryWindow = null)
    {
        vault ??= new VaultPipeClient();
        serviceRegistered ??= IsVaultServiceRegistered;
        log ??= _ => { };

        var markerPresent = HasVaultModeMarker(configDir);
        var registered = serviceRegistered();
        var heldInVaultMode = markerPresent || registered;

        // Ride out a vault that is restarting at boot, but only when this machine is known to use it.
        var deadline = DateTimeOffset.UtcNow + (heldInVaultMode ? retryWindow ?? TimeSpan.FromSeconds(10) : TimeSpan.Zero);
        VaultReachability reach;
        while (true)
        {
            reach = Probe(vault);
            if (reach == VaultReachability.Reachable || DateTimeOffset.UtcNow >= deadline) break;
            Thread.Sleep(1000);
        }

        if (reach == VaultReachability.Reachable)
        {
            var authority = new VaultBadgeAuthority(vault);
            try
            {
                authority.RefreshKeysAsync().GetAwaiter().GetResult();
                WriteModeMarker(configDir, serviceId);
                log($"{serviceId}: badges are signed by Leaf Vault (ES256).");
                return new BadgeSigningSetup(BadgeSigningMode.Vault, null, authority, "vault reachable");
            }
            catch (VaultUnavailableException e)
            {
                log($"{serviceId}: Leaf Vault answered but would not give its public keys ({e.Message}).");
                if (!heldInVaultMode) return Legacy(configDir, serviceId, log, serviceRegistered);
                return new BadgeSigningSetup(BadgeSigningMode.Vault, null, authority, "vault keys unavailable");
            }
        }

        if (heldInVaultMode)
        {
            log($"{serviceId}: Leaf Vault unavailable. This machine uses the vault, so no badges can be issued until it is back, and the shared key is not used.");
            return new BadgeSigningSetup(BadgeSigningMode.Vault, null, new VaultBadgeAuthority(vault),
                markerPresent ? "vault mode recorded, vault unavailable" : "vault service installed, vault unavailable");
        }

        return Legacy(configDir, serviceId, log, serviceRegistered);
    }

    private static BadgeSigningSetup Legacy(string configDir, string serviceId, Action<string> log, Func<bool> serviceRegistered)
    {
        log($"{serviceId}: no Leaf Vault on this machine; badges use the shared key.");
        return new BadgeSigningSetup(BadgeSigningMode.Legacy, SigningKeyPersistence.EnsureSigningKey(configDir, serviceRegistered), null,
            "no vault installed");
    }

    private static VaultReachability Probe(IBadgeVault vault)
    {
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            return Task.Run(() => vault.ProbeAsync(cts.Token)).GetAwaiter().GetResult();
        }
        catch (Exception)
        {
            return VaultReachability.Unavailable;
        }
    }

    /// <summary>
    /// True once any service on this machine has run in vault mode, or the LeafVault service is
    /// registered. Either one forbids reading, creating or regenerating the shared key.
    /// </summary>
    public static bool IsHeldInVaultMode(string configDir) => HasVaultModeMarker(configDir) || IsVaultServiceRegistered();

    public static bool HasVaultModeMarker(string configDir) => File.Exists(Path.Combine(configDir, ModeMarkerFile));

    /// <summary>Whether the Windows service LeafVault exists (its registry key is readable by every user).</summary>
    public static bool IsVaultServiceRegistered()
    {
        if (!OperatingSystem.IsWindows()) return false;
        try
        {
            using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(
                @"SYSTEM\CurrentControlSet\Services\" + VaultPipeClient.ServiceName);
            return key is not null;
        }
        catch (Exception)
        {
            return false;
        }
    }

    private static void WriteModeMarker(string configDir, string serviceId)
    {
        var path = Path.Combine(configDir, ModeMarkerFile);
        if (File.Exists(path)) return;
        // Non-secret: the mode, who recorded it first, when. Never a key, a badge or a claim.
        WriteAtomic(path, JsonSerializer.Serialize(new { mode = "vault", recordedBy = serviceId, recordedAt = DateTimeOffset.UtcNow }));
    }

    /// <summary>
    /// Run after boot, once the service is up: prove vault mode end to end (sign and verify a
    /// throwaway badge), record that this service confirmed it, and when both RedLeaf and RedCompute
    /// have confirmed, retire the shared key. Retries while the vault is down; gives up after a day.
    /// </summary>
    public static Task ConfirmInBackground(JwtService jwt, string configDir, string serviceId,
        Action<string>? log = null, TimeSpan? retryDelay = null, CancellationToken ct = default)
    {
        log ??= _ => { };
        return Task.Run(async () =>
        {
            if (!jwt.IsVaultMode) return;
            var delay = retryDelay ?? TimeSpan.FromSeconds(60);
            var giveUpAt = DateTimeOffset.UtcNow.AddHours(24);
            while (!ct.IsCancellationRequested && DateTimeOffset.UtcNow < giveUpAt)
            {
                if (TryConfirm(jwt, configDir, serviceId, log)) return;
                try { await Task.Delay(delay, ct).ConfigureAwait(false); }
                catch (OperationCanceledException) { return; }
            }
        }, CancellationToken.None);
    }

    /// <summary>One attempt of the confirmation described on <see cref="ConfirmInBackground"/>.</summary>
    public static bool TryConfirm(JwtService jwt, string configDir, string serviceId, Action<string>? log = null)
    {
        log ??= _ => { };
        if (!jwt.IsVaultMode) return false;
        if (!jwt.SelfTestVault())
        {
            log($"{serviceId}: vault mode is not working yet ({jwt.VaultStatus?.Message}).");
            return false;
        }
        WriteModeMarker(configDir, serviceId);
        WriteAtomic(Path.Combine(configDir, ConfirmedMarkerPrefix + serviceId),
            JsonSerializer.Serialize(new { service = serviceId, confirmedAt = DateTimeOffset.UtcNow }));
        log($"{serviceId}: vault mode confirmed (a badge was signed and verified).");
        try
        {
            if (LegacySigningKeyRetirement.TryRetire(configDir) == LegacyKeyRetirementResult.Retired)
                log($"{serviceId}: the old shared badge key was deleted.");
        }
        catch (Exception e)
        {
            // Never fatal: the key stays unused and the next boot tries again.
            log($"{serviceId}: could not delete the old shared badge key ({e.GetType().Name}).");
        }
        return true;
    }

    public static bool HasConfirmed(string configDir, string serviceId)
        => File.Exists(Path.Combine(configDir, ConfirmedMarkerPrefix + serviceId));

    public static bool AllServicesConfirmed(string configDir) => ConfirmingServices.All(s => HasConfirmed(configDir, s));

    internal static void WriteAtomic(string path, string content)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temp, content);
            File.Move(temp, path, overwrite: true);
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
        }
    }
}
