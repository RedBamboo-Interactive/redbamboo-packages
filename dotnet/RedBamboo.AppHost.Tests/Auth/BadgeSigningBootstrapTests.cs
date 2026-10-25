using Xunit;
using RedBamboo.AppHost.Auth;
using RedBamboo.AppHost.Auth.Vault;
using RedBamboo.AppHost.Security;

namespace RedBamboo.AppHost.Tests.Auth;

public sealed class BadgeSigningBootstrapTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "m1-bootstrap-" + Guid.NewGuid().ToString("N"));
    private static readonly SecretAddress KeyAddress = SecretAddress.Bootstrap("auth", "jwt-signing-key");

    public BadgeSigningBootstrapTests() => Directory.CreateDirectory(_dir);

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch (IOException) { }
    }

    private BadgeSigningSetup Resolve(string service, FakeBadgeVault vault, bool registered = false)
        => BadgeSigningBootstrap.Resolve(_dir, service, vault, () => registered, retryWindow: TimeSpan.Zero);

    private bool SharedKeyExists() => PortableSecretStores.ForDirectory(_dir).Exists(KeyAddress);

    // ----- the decision -----

    [Fact]
    public void No_vault_installed_means_legacy_mode_with_a_shared_key_exactly_as_today()
    {
        var vault = new FakeBadgeVault { Down = true };

        var setup = Resolve("redleaf", vault);

        Assert.Equal(BadgeSigningMode.Legacy, setup.Mode);
        Assert.False(string.IsNullOrEmpty(setup.LegacySigningKey));
        Assert.Null(setup.Authority);
        Assert.True(SharedKeyExists());
        Assert.False(BadgeSigningBootstrap.HasVaultModeMarker(_dir));
        Assert.False(new JwtService(setup.ToJwtOptions()).IsVaultMode);
    }

    [Fact]
    public void Reachable_vault_means_vault_mode_and_records_the_marker_without_creating_a_key()
    {
        var setup = Resolve("redleaf", new FakeBadgeVault());

        Assert.Equal(BadgeSigningMode.Vault, setup.Mode);
        Assert.Null(setup.LegacySigningKey);
        Assert.True(BadgeSigningBootstrap.HasVaultModeMarker(_dir));
        Assert.False(SharedKeyExists());
        var jwt = new JwtService(setup.ToJwtOptions());
        Assert.NotNull(jwt.ValidateToken(jwt.GenerateServiceAccessToken("redleaf")));
    }

    [Fact]
    public void Both_services_make_the_same_decision_from_the_same_marker()
    {
        var vault = new FakeBadgeVault();
        Assert.Equal(BadgeSigningMode.Vault, Resolve("redleaf", vault).Mode);

        vault.Down = true; // RedCompute boots later, vault momentarily down
        var other = Resolve("redcompute", vault);

        Assert.Equal(BadgeSigningMode.Vault, other.Mode);
        Assert.False(SharedKeyExists());
    }

    [Fact]
    public void Once_in_vault_mode_an_outage_never_falls_back_or_regenerates_the_shared_key()
    {
        Resolve("redleaf", new FakeBadgeVault());
        var down = new FakeBadgeVault { Down = true };

        var setup = Resolve("redleaf", down);

        Assert.Equal(BadgeSigningMode.Vault, setup.Mode);
        Assert.Null(setup.LegacySigningKey);
        Assert.False(SharedKeyExists());
        var jwt = new JwtService(setup.ToJwtOptions());
        var e = Assert.Throws<VaultUnavailableException>(() => jwt.GenerateServiceAccessToken("redleaf"));
        Assert.Equal("Leaf Vault unavailable", e.Message);
        Assert.False(jwt.VaultStatus!.Available);

        // Back up: the same process objects recover without a restart.
        down.Down = false;
        Assert.NotNull(jwt.ValidateToken(jwt.GenerateServiceAccessToken("redleaf")));
    }

    [Fact]
    public void An_installed_service_holds_the_machine_in_vault_mode_even_after_the_marker_is_deleted()
    {
        var setup = Resolve("redleaf", new FakeBadgeVault { Down = true }, registered: true);

        Assert.Equal(BadgeSigningMode.Vault, setup.Mode);
        Assert.False(SharedKeyExists());
        Assert.Throws<InvalidOperationException>(() => SigningKeyPersistence.EnsureSigningKey(_dir, () => true));
    }

    [Fact]
    public void A_pipe_squatter_is_never_trusted_and_never_causes_a_key_either_when_the_machine_uses_the_vault()
    {
        var squatter = new FakeBadgeVault { Reachability = VaultReachability.Impostor };

        Assert.Equal(BadgeSigningMode.Vault, Resolve("redleaf", squatter, registered: true).Mode);
        Assert.False(SharedKeyExists());
        Assert.Equal(BadgeSigningMode.Legacy, Resolve("redleaf", squatter, registered: false).Mode); // nothing installed: nothing to protect
    }

    [Fact]
    public void Ensure_signing_key_refuses_once_a_vault_marker_exists_and_load_hands_nothing_out()
    {
        SigningKeyPersistence.SaveSigningKey(_dir, "fake-test-key");
        Assert.Equal("fake-test-key", SigningKeyPersistence.LoadSigningKey(_dir));

        Resolve("redleaf", new FakeBadgeVault());

        Assert.Null(SigningKeyPersistence.LoadSigningKey(_dir));
        Assert.Throws<InvalidOperationException>(() => SigningKeyPersistence.EnsureSigningKey(_dir, () => false));
    }

    [Fact]
    public void Legacy_tester_who_later_installs_the_vault_moves_to_vault_mode_on_the_next_boot()
    {
        Assert.Equal(BadgeSigningMode.Legacy, Resolve("redleaf", new FakeBadgeVault { Down = true }).Mode);
        Assert.Equal(BadgeSigningMode.Vault, Resolve("redleaf", new FakeBadgeVault()).Mode);
    }

    // ----- retiring the shared key (its own step) -----

    private static (JwtService Jwt, FakeBadgeVault Vault) VaultJwt()
    {
        var vault = new FakeBadgeVault();
        var authority = new VaultBadgeAuthority(vault);
        authority.RefreshKeysAsync().GetAwaiter().GetResult();
        return (new JwtService(new JwtOptions { Vault = authority }), vault);
    }

    [Fact]
    public void Shared_key_is_deleted_only_after_both_services_have_confirmed_vault_mode()
    {
        // A machine that used the shared key first: key in the store and the pre-keyring file.
        SigningKeyPersistence.SaveSigningKey(_dir, "fake-test-key");
        File.WriteAllText(Path.Combine(_dir, BadgeSigningBootstrap.LegacyKeyFile), "{}");
        var (jwt, _) = VaultJwt();

        Assert.Equal(LegacyKeyRetirementResult.NotYet, LegacySigningKeyRetirement.TryRetire(_dir));
        Assert.True(BadgeSigningBootstrap.TryConfirm(jwt, _dir, "redleaf"));
        Assert.True(SharedKeyExists()); // RedCompute has not confirmed yet
        Assert.True(File.Exists(Path.Combine(_dir, BadgeSigningBootstrap.LegacyKeyFile)));

        Assert.True(BadgeSigningBootstrap.TryConfirm(jwt, _dir, "redcompute"));

        Assert.False(SharedKeyExists());
        Assert.False(File.Exists(Path.Combine(_dir, BadgeSigningBootstrap.LegacyKeyFile)));
        Assert.Equal(LegacyKeyRetirementResult.AlreadyGone, LegacySigningKeyRetirement.TryRetire(_dir));
    }

    [Fact]
    public void A_confirmation_needs_a_real_signed_and_verified_badge_so_a_dead_vault_confirms_nothing()
    {
        SigningKeyPersistence.SaveSigningKey(_dir, "fake-test-key");
        var (jwt, vault) = VaultJwt();
        vault.Down = true;

        Assert.False(BadgeSigningBootstrap.TryConfirm(jwt, _dir, "redleaf"));
        Assert.False(BadgeSigningBootstrap.HasConfirmed(_dir, "redleaf"));
        Assert.True(SharedKeyExists());
    }

    [Fact]
    public void Retirement_does_nothing_in_legacy_mode_even_if_both_confirmation_files_were_planted()
    {
        SigningKeyPersistence.SaveSigningKey(_dir, "fake-test-key");
        File.WriteAllText(Path.Combine(_dir, BadgeSigningBootstrap.ConfirmedMarkerPrefix + "redleaf"), "{}");
        File.WriteAllText(Path.Combine(_dir, BadgeSigningBootstrap.ConfirmedMarkerPrefix + "redcompute"), "{}");

        Assert.Equal(LegacyKeyRetirementResult.NotYet, LegacySigningKeyRetirement.TryRetire(_dir)); // no vault-mode marker
        Assert.True(SharedKeyExists());
    }

    [Fact]
    public void A_legacy_jwt_service_cannot_be_built_without_a_key()
        => Assert.Throws<ArgumentException>(() => new JwtService(new JwtOptions()));
}
