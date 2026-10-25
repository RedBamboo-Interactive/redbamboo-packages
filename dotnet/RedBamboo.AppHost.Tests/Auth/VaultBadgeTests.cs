using Xunit;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.IdentityModel.Tokens;
using RedBamboo.AppHost.Auth;
using RedBamboo.AppHost.Auth.Vault;

namespace RedBamboo.AppHost.Tests.Auth;

public class VaultBadgeTests
{
    private const string LegacyKey = "legacy-test-shared-key-0123456789012345678901234567890123456789";

    private static (JwtService Jwt, VaultBadgeAuthority Authority, FakeBadgeVault Vault) VaultMode(TimeProvider? time = null)
    {
        var vault = new FakeBadgeVault(time);
        var authority = new VaultBadgeAuthority(vault, time);
        authority.RefreshKeysAsync().GetAwaiter().GetResult();
        return (new JwtService(new JwtOptions { Vault = authority }), authority, vault);
    }

    private static JsonElement Claims(string sub, string? net = "local")
    {
        var d = new Dictionary<string, object?> { ["iss"] = "redsuite", ["aud"] = "redsuite", ["sub"] = sub, ["roles"] = new[] { "admin" } };
        if (net is not null) d["net"] = net;
        return JsonSerializer.SerializeToElement(d);
    }

    private static long Now() => DateTimeOffset.UtcNow.ToUnixTimeSeconds();

    [Fact]
    public void Service_badge_is_es256_local_and_round_trips()
    {
        var (jwt, _, _) = VaultMode();
        var token = jwt.GenerateServiceAccessToken("redleaf", computeProvenance: true, computeDelegateUser: true);

        var principal = jwt.ValidateToken(token);

        Assert.NotNull(principal);
        Assert.Equal("service:redleaf", principal!.FindFirstValue("sub"));
        Assert.Equal("local", principal.FindFirstValue("net"));
        Assert.Equal("true", principal.FindFirstValue("compute_provenance"));
        Assert.Equal(["service"], ExecutionIdentityClaims.ReadRoles(principal));
        Assert.Contains("\"alg\":\"ES256\"", Encoding.UTF8.GetString(Base64UrlEncoder.DecodeBytes(token.Split('.')[0])));
    }

    [Fact]
    public void Browser_badge_is_remote_and_lasts_one_hour_while_internal_user_badges_are_local()
    {
        var (jwt, _, _) = VaultMode();

        var browser = jwt.ValidateToken(jwt.GenerateBrowserAccessToken("u1", "u1@example.test", "U", ["user"]))!;
        var internalUser = jwt.ValidateToken(jwt.GenerateAccessToken("system", "system@redsuite", "System", ["admin"]))!;

        Assert.Equal("remote", browser.FindFirstValue("net"));
        Assert.Equal(3600, long.Parse(browser.FindFirstValue("exp")!) - long.Parse(browser.FindFirstValue("iat")!));
        Assert.Equal("local", internalUser.FindFirstValue("net"));
        Assert.Equal(TimeSpan.FromHours(1), jwt.BrowserAccessTokenLifetime);
    }

    [Fact]
    public void Legacy_mode_is_unchanged_hs256_without_a_net_claim()
    {
        var jwt = new JwtService(new JwtOptions { SigningKey = LegacyKey });

        var token = jwt.GenerateBrowserAccessToken("u1", "u1@example.test", "U", ["user"]);
        var principal = jwt.ValidateToken(token)!;

        Assert.False(jwt.IsVaultMode);
        Assert.Null(principal.FindFirst("net"));
        Assert.Contains("HS256", Encoding.UTF8.GetString(Base64UrlEncoder.DecodeBytes(token.Split('.')[0])));
        Assert.Equal(TimeSpan.FromDays(365), jwt.BrowserAccessTokenLifetime);
        Assert.Equal(principal.FindFirstValue("sub"), "u1");
    }

    [Fact]
    public void Vault_mode_rejects_an_hs256_badge_even_with_net_and_a_matching_kid()
    {
        var (jwt, _, vault) = VaultMode();
        var legacy = new JwtService(new JwtOptions { SigningKey = LegacyKey });
        var forged = legacy.GenerateServiceAccessToken("redcompute");

        Assert.Null(jwt.ValidateToken(forged));

        // Same, hand-crafted: HS256 header naming the vault's kid, claims carry net=local.
        var header = Base64UrlEncoder.Encode(JsonSerializer.SerializeToUtf8Bytes(new { alg = "HS256", typ = "JWT", kid = vault.Kid }));
        var payload = Base64UrlEncoder.Encode(JsonSerializer.SerializeToUtf8Bytes(new { iss = "redsuite", aud = "redsuite", sub = "service:redcompute", net = "local", exp = Now() + 600 }));
        var input = header + "." + payload;
        var mac = System.Security.Cryptography.HMACSHA256.HashData(Encoding.UTF8.GetBytes(LegacyKey), Encoding.ASCII.GetBytes(input));
        Assert.Null(jwt.ValidateToken(input + "." + Base64UrlEncoder.Encode(mac)));
    }

    [Fact]
    public void Vault_mode_rejects_alg_none_and_an_unsigned_badge()
    {
        var (jwt, _, vault) = VaultMode();
        var header = Base64UrlEncoder.Encode(JsonSerializer.SerializeToUtf8Bytes(new { alg = "none", typ = "JWT", kid = vault.Kid }));
        var payload = Base64UrlEncoder.Encode(JsonSerializer.SerializeToUtf8Bytes(new { iss = "redsuite", aud = "redsuite", sub = "admin", net = "local", exp = Now() + 600 }));

        Assert.Null(jwt.ValidateToken($"{header}.{payload}."));
        Assert.Null(jwt.ValidateToken($"{header}.{payload}"));
    }

    [Fact]
    public void Vault_mode_rejects_es256_signed_by_a_key_the_vault_does_not_publish()
    {
        var (jwt, _, vault) = VaultMode();
        var attacker = new FakeBadgeVault();
        var forged = attacker.SignRaw(Claims("admin"), Now(), Now() + 600, kid: vault.Kid);

        Assert.Null(jwt.ValidateToken(forged));
    }

    [Fact]
    public void Vault_mode_rejects_a_badge_without_a_net_claim()
    {
        var (jwt, _, vault) = VaultMode();
        var noNet = vault.SignRaw(Claims("admin", net: null), Now(), Now() + 600);
        var badNet = vault.SignRaw(Claims("admin", net: "anywhere"), Now(), Now() + 600);

        Assert.Null(jwt.ValidateToken(noNet));
        Assert.Null(jwt.ValidateToken(badNet));
        Assert.NotNull(jwt.ValidateToken(vault.SignRaw(Claims("admin"), Now(), Now() + 600)));
    }

    [Fact]
    public void Vault_mode_rejects_expired_and_wrong_audience_badges()
    {
        var (jwt, _, vault) = VaultMode();
        Assert.Null(jwt.ValidateToken(vault.SignRaw(Claims("admin"), Now() - 7200, Now() - 3600)));
        var wrongAudience = JsonSerializer.SerializeToElement(new { iss = "redsuite", aud = "someone-else", sub = "admin", net = "local" });
        Assert.Null(jwt.ValidateToken(vault.SignRaw(wrongAudience, Now(), Now() + 600)));
    }

    [Fact]
    public void Vault_cannot_be_asked_for_a_longer_remote_badge_than_an_hour()
    {
        var (_, authority, _) = VaultMode();
        var claims = new Dictionary<string, object?> { ["sub"] = "u" };

        var e = Assert.Throws<VaultUnavailableException>(() => authority.Sign(claims, BadgeNet.Remote, TimeSpan.FromHours(2)));
        Assert.Equal("lifetime_exceeds_cap", e.Code);
    }

    [Fact]
    public void Kid_rotation_is_learned_on_sign_and_old_badges_die_once_the_vault_drops_the_key()
    {
        var (jwt, authority, vault) = VaultMode();
        var before = jwt.GenerateExecutionTokenForTest();
        Assert.NotNull(jwt.ValidateToken(before));
        Assert.Equal(["kid-1"], authority.TrustedKids);

        vault.Rotate();
        var after = jwt.GenerateBrowserAccessToken("u1", "u1@example.test", "U", ["user"]); // not cached: signs, sees kid-2, refreshes

        Assert.Equal(["kid-2"], authority.TrustedKids);
        Assert.NotNull(jwt.ValidateToken(after));
        Assert.Null(jwt.ValidateToken(before)); // kill switch: the old key is gone
    }

    [Fact]
    public void Verifier_that_never_signed_learns_a_rotated_kid_from_the_unknown_kid_refresh()
    {
        var time = new ManualTime();
        var vault = new FakeBadgeVault(time);
        var authority = new VaultBadgeAuthority(vault, time);
        authority.RefreshKeysAsync().GetAwaiter().GetResult();
        var verifier = new JwtService(new JwtOptions { Vault = authority });
        vault.Rotate();
        var badge = vault.SignRaw(Claims("service:x"), time.GetUtcNow().ToUnixTimeSeconds(), time.GetUtcNow().ToUnixTimeSeconds() + 600);

        // Real validation uses the wall clock, so a manual-time badge is only checked for key resolution here.
        var kid = new System.IdentityModel.Tokens.Jwt.JwtSecurityToken(badge).Header.Kid;
        Assert.Single(authority.ResolveKeys(kid));
        Assert.Equal(["kid-2"], authority.TrustedKids);
        Assert.NotNull(verifier);
    }

    [Fact]
    public void Unknown_kid_refreshes_are_rate_limited_so_forged_kids_cannot_hammer_the_vault()
    {
        var time = new ManualTime();
        var vault = new FakeBadgeVault(time);
        var authority = new VaultBadgeAuthority(vault, time);
        authority.RefreshKeysAsync().GetAwaiter().GetResult();
        var baseline = vault.JwksCalls;

        for (var i = 0; i < 50; i++) Assert.Empty(authority.ResolveKeys($"forged-{i}"));
        Assert.Equal(baseline + 1, vault.JwksCalls);

        time.Advance(VaultBadgeAuthority.UnknownKidRefreshInterval + TimeSpan.FromSeconds(1));
        Assert.Empty(authority.ResolveKeys("forged-again"));
        Assert.Equal(baseline + 2, vault.JwksCalls);
    }

    [Fact]
    public void Vault_down_blocks_new_badges_in_plain_words_but_existing_ones_keep_verifying()
    {
        var (jwt, authority, vault) = VaultMode();
        var existing = jwt.GenerateBrowserAccessToken("u1", "u1@example.test", "U", ["user"]);
        vault.Down = true;

        var e = Assert.Throws<VaultUnavailableException>(() => jwt.GenerateBrowserAccessToken("u2", "u2@example.test", "U", ["user"]));

        Assert.Equal("Leaf Vault unavailable", e.Message);
        Assert.False(jwt.VaultStatus!.Available);
        Assert.Equal("Leaf Vault unavailable", jwt.VaultStatus.Message);
        Assert.NotNull(jwt.ValidateToken(existing));
        Assert.Null(jwt.ValidateToken(vault.SignRaw(Claims("x"), Now(), Now() + 60, kid: "never-seen"))); // unknown kid, no keys, no throw
        Assert.Equal(["kid-1"], authority.TrustedKids);

        vault.Down = false;
        Assert.NotNull(jwt.ValidateToken(jwt.GenerateBrowserAccessToken("u2", "u2@example.test", "U", ["user"])));
        Assert.True(jwt.VaultStatus.Available);
    }

    [Fact]
    public void Failure_messages_never_contain_the_badge_or_its_claims()
    {
        var (jwt, _, vault) = VaultMode();
        vault.Down = true;
        var e = Assert.Throws<VaultUnavailableException>(() => jwt.GenerateBrowserAccessToken("secret-user-id", "secret@example.test", "N", ["admin"]));

        Assert.DoesNotContain("secret", e.Message);
        Assert.DoesNotContain("secret", jwt.VaultStatus!.Message);
    }

    [Fact]
    public void Service_badges_are_cached_until_80_percent_of_their_life_and_dropped_on_rotation()
    {
        var time = new ManualTime();
        var (jwt, authority, vault) = VaultMode(time);

        var first = jwt.GenerateServiceAccessToken("redleaf");
        var again = jwt.GenerateServiceAccessToken("redleaf");
        Assert.Equal(first, again);
        Assert.Equal(1, vault.SignCalls);
        Assert.NotEqual(first, jwt.GenerateServiceAccessToken("redcompute"));
        Assert.Equal(2, vault.SignCalls);

        time.Advance(TimeSpan.FromDays(365 * 0.79));
        Assert.Equal(first, jwt.GenerateServiceAccessToken("redleaf"));
        time.Advance(TimeSpan.FromDays(365 * 0.02));
        Assert.NotEqual(first, jwt.GenerateServiceAccessToken("redleaf"));

        var calls = vault.SignCalls;
        vault.Rotate();
        authority.RefreshKeysAsync().GetAwaiter().GetResult();
        jwt.GenerateServiceAccessToken("redleaf");
        Assert.Equal(calls + 1, vault.SignCalls); // the cached badge named a dead kid
    }

    [Fact]
    public void Self_test_signs_and_verifies_a_throwaway_badge_and_fails_when_the_vault_is_down()
    {
        var (jwt, _, vault) = VaultMode();
        Assert.True(jwt.SelfTestVault());
        vault.Down = true;
        Assert.False(jwt.SelfTestVault());
    }

    [Fact]
    public void Execution_badge_round_trips_through_the_vault_with_its_signed_identity()
    {
        var (jwt, _, _) = VaultMode();
        var identity = new ExecutionIdentity(ExecutionIdentity.CurrentSchemaVersion, Guid.NewGuid().ToString(),
            new ExecutionAppIdentity("nova", "nova"), new ExecutionActorIdentity("agent", "nova", "nova"),
            new ExecutionBeneficiaryIdentity("user", "user-1", "Laurent"), [new ExecutionContextReference("discussion", "d-1")]);
        var principal = new ExecutionPrincipal("user-1", "user@example.test", "Laurent", ["admin"], null);

        var token = jwt.GenerateExecutionToken(identity, principal, DateTimeOffset.UtcNow.AddMinutes(30));
        var validated = jwt.ValidateToken(token)!;

        Assert.Equal("local", validated.FindFirstValue("net"));
        Assert.True(ExecutionIdentityClaims.TryRead(validated, out var read, out var error), error);
        Assert.Equal(identity.ExecutionId, read!.ExecutionId);
        Assert.Equal(["admin"], ExecutionIdentityClaims.ReadRoles(validated));
    }
}

internal static class JwtServiceTestExtensions
{
    /// <summary>A cheap uncached local badge for tests that only need "some badge signed with the current kid".</summary>
    public static string GenerateExecutionTokenForTest(this JwtService jwt)
    {
        var identity = new ExecutionIdentity(ExecutionIdentity.CurrentSchemaVersion, Guid.NewGuid().ToString(),
            new ExecutionAppIdentity("nova", "nova"), new ExecutionActorIdentity("agent", "nova", "nova"),
            new ExecutionBeneficiaryIdentity("user", "user-1", "L"), [new ExecutionContextReference("discussion", "d-1")]);
        return jwt.GenerateExecutionToken(identity, new ExecutionPrincipal("user-1", "u@example.test", "L", ["admin"], null),
            DateTimeOffset.UtcNow.AddMinutes(30));
    }
}
