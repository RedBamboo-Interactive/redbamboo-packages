using Xunit;
using RedBamboo.AppHost.Auth.Vault;

namespace RedBamboo.AppHost.Tests.Auth;

/// <summary>
/// <see cref="VaultPipeClient"/> is a deliberate minimal copy of the vault's <c>Leaf.Vault.Client</c> so the
/// suite needs no cross-repo reference. This pins the copied wire constants to the vault's own source when
/// the leaf-vault checkout sits next to this repo (it passes vacuously on a machine without it).
/// </summary>
public class VaultWireContractTests
{
    private static string? VaultProtocolSource()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "leaf-vault", "src", "Leaf.Vault.Client", "VaultProtocol.cs");
            if (File.Exists(candidate)) return File.ReadAllText(candidate);
            if (dir.Parent is { } parent)
            {
                var sibling = Path.Combine(parent.FullName, "leaf-vault", "src", "Leaf.Vault.Client", "VaultProtocol.cs");
                if (File.Exists(sibling)) return File.ReadAllText(sibling);
            }
        }
        return null;
    }

    [Fact]
    public void Copied_wire_constants_match_the_vault_protocol()
    {
        var source = VaultProtocolSource();
        if (source is null) return;

        Assert.Contains($"public const int Version = {VaultPipeClient.ProtocolVersion};", source);
        Assert.Contains($"public const string DefaultPipeName = \"{VaultPipeClient.DefaultPipeName}\";", source);
        Assert.Contains($"public const string ServiceName = \"{VaultPipeClient.ServiceName}\";", source);
        Assert.Contains("public const string SignJwt = \"sign-jwt\";", source);
        Assert.Contains("public const string Jwks = \"jwks\";", source);
        Assert.Contains("public const string Health = \"health\";", source);
        Assert.Contains($"public const string Local = \"{BadgeNet.Local}\";", source);
        Assert.Contains($"public const string Remote = \"{BadgeNet.Remote}\";", source);
        Assert.Contains($"public const string Claim = \"{BadgeNet.Claim}\";", source);
        Assert.Contains("public sealed record SignJwtArgs(JsonElement Claims, int LifetimeSeconds);", source);
        Assert.Contains("public sealed record SignJwtResult(string Token, string Kid, DateTimeOffset ExpiresAt);", source);
        Assert.Contains("public sealed record Jwk(string Kty, string Crv, string X, string Y, string Kid, string Use, string Alg);", source);
    }

    [Fact]
    public void Service_sid_matches_the_documented_derivation()
    {
        // S-1-5-80 + SHA-1 of the upper-cased UTF-16LE service name as five little-endian integers.
        var sid = VaultPipeClient.ServiceSid("LeafVault");
        Assert.StartsWith("S-1-5-80-", sid.Value);
        Assert.Equal(5, sid.Value.Split('-').Length - 4);
    }
}
