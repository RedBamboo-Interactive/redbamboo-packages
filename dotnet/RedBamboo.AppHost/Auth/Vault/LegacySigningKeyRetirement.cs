using RedBamboo.AppHost.Security;

namespace RedBamboo.AppHost.Auth.Vault;

public enum LegacyKeyRetirementResult
{
    /// <summary>Not every service has confirmed vault mode yet; nothing was touched.</summary>
    NotYet,
    /// <summary>The shared key and its legacy file were present and are now deleted.</summary>
    Retired,
    /// <summary>Vault mode is confirmed everywhere and there was no shared key left to delete.</summary>
    AlreadyGone,
}

/// <summary>
/// The one step that removes the shared HS256 badge key (<c>auth/jwt-signing-key</c>) from disk, kept
/// separate on purpose so it is easy to find, review and test. It runs only after BOTH RedLeaf and
/// RedCompute have recorded that they signed and verified a real badge through Leaf Vault. It deletes
/// the key from the portable key-ring store and the pre-key-ring <c>auth-signing-key.json</c> file, the
/// only two places the key has ever lived, and never reads either value.
/// </summary>
public static class LegacySigningKeyRetirement
{
    private static readonly SecretAddress SigningKeyAddress = SecretAddress.Bootstrap("auth", "jwt-signing-key");

    public static LegacyKeyRetirementResult TryRetire(string configDir)
    {
        if (!BadgeSigningBootstrap.HasVaultModeMarker(configDir) || !BadgeSigningBootstrap.AllServicesConfirmed(configDir))
            return LegacyKeyRetirementResult.NotYet;

        var store = PortableSecretStores.ForDirectory(configDir);
        var legacyFile = Path.Combine(configDir, BadgeSigningBootstrap.LegacyKeyFile);
        var present = store.Exists(SigningKeyAddress) || File.Exists(legacyFile);
        if (!present) return LegacyKeyRetirementResult.AlreadyGone;

        store.Delete(SigningKeyAddress);
        if (File.Exists(legacyFile)) File.Delete(legacyFile);
        return LegacyKeyRetirementResult.Retired;
    }
}
