using System.Diagnostics;
using RedBamboo.AppHost.Startup;
using Xunit;

namespace RedBamboo.AppHost.Tests.Startup;

public sealed class StartupManagerElevationTests
{
    [Fact]
    public void BuildElevatedSchtasksCommandLine_QuotesEveryArgumentInsideOneCmdPair()
    {
        var commandLine = StartupManager.BuildElevatedSchtasksCommandLine(
            @"C:\Windows\System32\schtasks.exe",
            @"C:\Users\Some One\AppData\Local\RedBamboo\Startup\out.log",
            ["/Create", "/TN", "Red Leaf", "/XML", @"C:\x y\task.xml", "/F"]);

        Assert.Equal(
            "/d /s /c \"\"C:\\Windows\\System32\\schtasks.exe\" \"/Create\" \"/TN\" \"Red Leaf\" \"/XML\" \"C:\\x y\\task.xml\" \"/F\" > \"C:\\Users\\Some One\\AppData\\Local\\RedBamboo\\Startup\\out.log\" 2>&1\"",
            commandLine);
    }

    [Theory]
    [InlineData("Red\"Leaf")]
    [InlineData("%TEMP%")]
    public void BuildElevatedSchtasksCommandLine_RejectsCmdMetacharacters(string argument)
    {
        Assert.Throws<ArgumentException>(() =>
            StartupManager.BuildElevatedSchtasksCommandLine(
                @"C:\Windows\System32\schtasks.exe",
                @"C:\out.log",
                ["/Query", "/TN", argument]));
    }

    [Fact]
    public void BuildElevatedSchtasksCommandLine_CapturesSchtasksErrorThroughCmd()
    {
        var directory = Directory.CreateTempSubdirectory("startup elevation ");
        try
        {
            var outputFile = Path.Combine(directory.FullName, "out.log");
            var startInfo = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.SystemDirectory, "cmd.exe"),
                Arguments = StartupManager.BuildElevatedSchtasksCommandLine(
                    Path.Combine(Environment.SystemDirectory, "schtasks.exe"),
                    outputFile,
                    ["/Query", "/TN", $"RedBambooMissing {Guid.NewGuid():N}"]),
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            using var process = Process.Start(startInfo)!;
            process.WaitForExit();

            Assert.NotEqual(0, process.ExitCode);
            Assert.False(string.IsNullOrWhiteSpace(File.ReadAllText(outputFile)));
        }
        finally
        {
            directory.Delete(recursive: true);
        }
    }
}
