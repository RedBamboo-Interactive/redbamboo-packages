using RedBamboo.AppHost.Tunnel;
using Xunit;

namespace RedBamboo.AppHost.Tests.Tunnel;

/// <summary>A host that decides where its data lives chooses the cloudflared state file; the default is unchanged.</summary>
public sealed class CloudflareTunnelStateFileTests
{
    [Fact]
    public void WithStateFile_UsesThatFile()
    {
        var path = Path.Combine(Path.GetTempPath(), $"rb-tunnel-{Guid.NewGuid():N}", "cloudflared-process.json");
        Assert.Equal(path, CloudflareTunnelService.WithStateFile(path).StateFilePath);
    }

    [Theory]
    [InlineData("")]
    [InlineData("cloudflared-process.json")]
    public void WithStateFile_RefusesAPathThatIsNotAbsolute(string path)
        => Assert.Throws<ArgumentException>(() => CloudflareTunnelService.WithStateFile(path));

    [Fact]
    public void DefaultConstructor_KeepsLocalAppDataEntryAssemblyName()
    {
        var appName = System.Reflection.Assembly.GetEntryAssembly()?.GetName().Name;
        if (string.IsNullOrWhiteSpace(appName)) appName = "RedBamboo";
        var expected = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), appName, "cloudflared-process.json");

        Assert.Equal(expected, new CloudflareTunnelService(logger: null).StateFilePath);
    }
}
