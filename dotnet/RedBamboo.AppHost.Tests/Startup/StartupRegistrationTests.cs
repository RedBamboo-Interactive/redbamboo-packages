using System.Xml.Linq;
using RedBamboo.AppHost.Startup;
using Xunit;

namespace RedBamboo.AppHost.Tests.Startup;

public sealed class StartupRegistrationTests
{
    private const string UserSid = "S-1-5-21-1-2-3-1001";
    private static readonly XNamespace Ns = "http://schemas.microsoft.com/windows/2004/02/mit/task";

    private static readonly StartupLaunchCommand Command = new(
        @"C:\Program Files\RedLeaf\launcher.exe",
        ["launch", "--background", "true"]);

    [Fact]
    public void TaskXml_StartsAtThisUsersSignInWithTheirStandardToken()
    {
        var root = XDocument.Parse(StartupManager.BuildTaskXml("RedLeaf", Command, UserSid)).Root!;

        var triggers = root.Element(Ns + "Triggers")!;
        Assert.Empty(triggers.Elements(Ns + "BootTrigger"));
        var logon = Assert.Single(triggers.Elements(Ns + "LogonTrigger"));
        Assert.Equal(UserSid, logon.Element(Ns + "UserId")?.Value);
        Assert.Equal("PT10S", logon.Element(Ns + "Delay")?.Value);

        var principal = Assert.Single(root.Element(Ns + "Principals")!.Elements(Ns + "Principal"));
        Assert.Equal(UserSid, principal.Element(Ns + "UserId")?.Value);
        Assert.Equal("InteractiveToken", principal.Element(Ns + "LogonType")?.Value);
        Assert.Equal("LeastPrivilege", principal.Element(Ns + "RunLevel")?.Value);
    }

    [Fact]
    public void TaskXml_RunsTheLauncherAtNormalPriorityWithoutATimeLimit()
    {
        var root = XDocument.Parse(StartupManager.BuildTaskXml("RedLeaf", Command, UserSid)).Root!;

        var action = Assert.Single(root.Element(Ns + "Actions")!.Elements(Ns + "Exec"));
        Assert.Equal(Command.ExecutablePath, action.Element(Ns + "Command")?.Value);
        Assert.Equal("launch --background true", action.Element(Ns + "Arguments")?.Value);
        Assert.Equal(@"C:\Program Files\RedLeaf", action.Element(Ns + "WorkingDirectory")?.Value);

        var settings = root.Element(Ns + "Settings")!;
        Assert.Equal("5", settings.Element(Ns + "Priority")?.Value);
        Assert.Equal("PT0S", settings.Element(Ns + "ExecutionTimeLimit")?.Value);
        Assert.Equal("IgnoreNew", settings.Element(Ns + "MultipleInstancesPolicy")?.Value);
        Assert.Equal("false", settings.Element(Ns + "Hidden")?.Value);
        Assert.Equal("false", settings.Element(Ns + "DisallowStartIfOnBatteries")?.Value);
    }

    [Fact]
    public void TaskXml_QuotesArgumentsWithoutRepeatingTheExecutable()
    {
        var command = new StartupLaunchCommand(
            @"C:\RedLeaf\launcher.exe",
            ["launch", "--state-root", @"C:\RedLeaf State\"]);

        var registration = StartupManager.ParseTaskXml(
            StartupManager.BuildTaskXml("RedLeaf", command, UserSid));

        Assert.Equal(@"C:\RedLeaf\launcher.exe", registration.ExecutablePath);
        Assert.Equal("launch --state-root \"C:\\RedLeaf State\\\\\"", registration.Arguments);
    }

    [Fact]
    public void TaskXml_RoundTripsToARegistrationThatStillNeedsProof()
    {
        var registration = StartupManager.ParseTaskXml(
            StartupManager.BuildTaskXml("RedLeaf", Command, UserSid), lastResult: 0x00041303);

        var status = Evaluate(registration);

        Assert.True(status.Enabled);
        Assert.False(status.Verified);
        Assert.Equal("not_yet_proven", status.State);
    }

    [Fact]
    public void DefaultCommand_TellsTheAppItWasStartedBySignIn()
    {
        Assert.Equal(["--started-by", "windows-sign-in"], StartupManager.SignInArguments);
        Assert.True(StartupManager.IsSignInStart(["launch", "--started-by", "windows-sign-in"]));
        Assert.False(StartupManager.IsSignInStart(["launch", "--background", "true"]));
        Assert.False(StartupManager.IsSignInStart(["--started-by"]));
    }

    [Fact]
    public void TaskNames_KeepTheLegacyNameAndGiveEachUserTheirOwnSignInTask()
    {
        Assert.Equal("RedLeaf", StartupManager.LegacyTaskName("RedLeaf"));
        Assert.Equal($"RedLeaf sign-in {UserSid}", StartupManager.SignInTaskName("RedLeaf", UserSid));
        Assert.Throws<ArgumentException>(() => StartupManager.SignInTaskName(@"Red\Leaf", UserSid));
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0x00041303)]
    [InlineData(0)]
    [InlineData(0x00041301)]
    [InlineData(0x00041325)]
    [InlineData(unchecked((int)0x8004131F))]
    public void NoRecordedStart_IsNotYetProven(int? lastResult)
    {
        // A launcher that exited 0 has not shown that RedLeaf finished starting.
        var status = Evaluate(Ready() with { LastResult = lastResult });

        Assert.True(status.Enabled);
        Assert.True(status.Registered);
        Assert.False(status.Verified);
        Assert.Equal("not_yet_proven", status.State);
        Assert.Equal(
            "RedLeaf will start the next time you sign in to Windows. It is verified once a start from sign-in has finished.",
            status.Message);
        Assert.Null(status.LastSignInStart);
    }

    [Fact]
    public void RecordedSuccessfulStart_IsReady()
    {
        var record = Recorded(StartupSignInRecord.Succeeded);

        var status = Evaluate(Ready(), lastSignInStart: record);

        Assert.True(status.Enabled);
        Assert.True(status.Verified);
        Assert.Equal("ready", status.State);
        Assert.Equal(
            "RedLeaf is verified: it finished starting the last time you signed in to Windows.",
            status.Message);
        Assert.Equal(record, status.LastSignInStart);
    }

    [Fact]
    public void RecordedFailedStart_IsLastStartFailedWithTheReason()
    {
        var record = Recorded(
            StartupSignInRecord.Failed,
            "PostgreSQL did not start: RedLeaf is running elevated (as administrator).");

        var status = Evaluate(Ready(), lastSignInStart: record);

        Assert.True(status.Enabled);
        Assert.False(status.Verified);
        Assert.Equal("last_start_failed", status.State);
        Assert.Equal(
            "RedLeaf started when you signed in to Windows, but it did not finish starting: PostgreSQL did not start: RedLeaf is running elevated (as administrator).",
            status.Message);
        Assert.Equal(record, status.LastSignInStart);
    }

    [Fact]
    public void RecordedFailure_ExplainsMoreThanTheLauncherResult()
    {
        var status = Evaluate(
            Ready() with { LastResult = 1 },
            lastSignInStart: Recorded(StartupSignInRecord.Failed, "the database did not start."));

        Assert.Equal("last_start_failed", status.State);
        Assert.EndsWith("the database did not start.", status.Message);
    }

    [Theory]
    [InlineData(2)]
    [InlineData(unchecked((int)0xE0434352))]
    [InlineData(unchecked((int)0x800710E0))]
    public void LauncherFailed_IsLastStartFailedEvenAfterAnEarlierSuccess(int lastResult)
    {
        // The launcher failed before RedLeaf could record anything about this sign-in.
        var status = Evaluate(
            Ready() with { LastResult = lastResult },
            lastSignInStart: Recorded(StartupSignInRecord.Succeeded));

        Assert.True(status.Enabled);
        Assert.True(status.Registered);
        Assert.False(status.Verified);
        Assert.Equal("last_start_failed", status.State);
        Assert.Contains($"0x{lastResult:X8}", status.Message);
    }

    [Fact]
    public void StartStillInProgress_IsStarting()
    {
        var status = Evaluate(
            Ready() with { LastResult = 0x00041301 },
            lastSignInStart: Recorded(StartupSignInRecord.Starting),
            lastSignInStartRunning: true);

        Assert.True(status.Enabled);
        Assert.False(status.Verified);
        Assert.Equal("starting", status.State);
    }

    [Fact]
    public void StartWhoseProcessEndedUnfinished_IsLastStartFailed()
    {
        var status = Evaluate(
            Ready(),
            lastSignInStart: Recorded(StartupSignInRecord.Starting),
            lastSignInStartRunning: false);

        Assert.False(status.Verified);
        Assert.Equal("last_start_failed", status.State);
        Assert.Contains("stopped before it finished starting", status.Message);
    }

    [Fact]
    public void BrokenTaskContract_OutranksARecordedSuccess()
    {
        var status = Evaluate(
            Ready() with { Arguments = "launch" },
            lastSignInStart: Recorded(StartupSignInRecord.Succeeded));

        Assert.False(status.Enabled);
        Assert.False(status.Verified);
        Assert.Equal("command_mismatch", status.State);
    }

    [Fact]
    public void TaskTurnedOffInTaskScheduler_IsDisabledByWindows()
    {
        var status = Evaluate(Ready() with { Enabled = false });

        Assert.False(status.Enabled);
        Assert.True(status.Registered);
        Assert.Equal("disabled_by_windows", status.State);
        Assert.Contains("Task Scheduler", status.Message);
    }

    [Fact]
    public void EnabledLegacyBootTask_IsReportedPlainlyAndNotEnabled()
    {
        var status = Evaluate(registration: null, legacyBootTask: LegacyBootTask(enabled: true));

        Assert.False(status.Enabled);
        Assert.True(status.Registered);
        Assert.False(status.Verified);
        Assert.Equal("legacy_boot_task", status.State);
        Assert.Contains("old boot task", status.Message);
        Assert.Contains("administrator approval", status.Message);
    }

    [Fact]
    public void DisabledLegacyBootTask_IsReportedPlainly()
    {
        var status = Evaluate(registration: null, legacyBootTask: LegacyBootTask(enabled: false));

        Assert.False(status.Enabled);
        Assert.Equal("legacy_boot_task_disabled", status.State);
        Assert.Contains("old boot task is turned off", status.Message);
    }

    [Fact]
    public void LegacyBootTask_OutranksAWorkingSignInTask()
    {
        var status = Evaluate(Ready(), legacyBootTask: LegacyBootTask(enabled: true));

        Assert.False(status.Enabled);
        Assert.Equal("legacy_boot_task", status.State);
    }

    [Fact]
    public void LegacyRunEntry_IsNotReportedAsVerified()
    {
        var status = Evaluate(registration: null, legacyRunEntry: @"C:\RedLeaf\launcher.exe");

        Assert.False(status.Enabled);
        Assert.True(status.Registered);
        Assert.Equal("legacy_run_entry", status.State);
    }

    [Fact]
    public void NothingRegistered_IsDisabled()
    {
        var status = Evaluate(registration: null);

        Assert.False(status.Enabled);
        Assert.False(status.Registered);
        Assert.False(status.Verified);
        Assert.Equal("disabled", status.State);
    }

    [Theory]
    [InlineData("boot trigger", "boot_trigger_present")]
    [InlineData("no logon trigger", "logon_trigger_missing")]
    [InlineData("logon trigger for another user", "logon_trigger_missing")]
    [InlineData("logon trigger for any user", "logon_trigger_missing")]
    [InlineData("S4U", "not_interactive")]
    [InlineData("stored password", "not_interactive")]
    [InlineData("another principal", "wrong_user")]
    [InlineData("highest privileges", "elevated_task")]
    [InlineData("old executable", "command_mismatch")]
    [InlineData("old arguments", "command_mismatch")]
    [InlineData("old working directory", "command_mismatch")]
    public void BrokenTaskContracts_AreRegisteredButNotEnabled(
        string broken,
        string expectedState)
    {
        var registration = broken switch
        {
            "boot trigger" => Ready() with { HasBootTrigger = true },
            "no logon trigger" => Ready() with { HasLogonTrigger = false },
            "logon trigger for another user" => Ready() with { LogonTriggerUserId = "S-1-5-21-9-9-9-1002" },
            "logon trigger for any user" => Ready() with { LogonTriggerUserId = null },
            "S4U" => Ready() with { LogonType = "S4U" },
            "stored password" => Ready() with { LogonType = "Password" },
            "another principal" => Ready() with { UserId = "S-1-5-21-9-9-9-1002" },
            "highest privileges" => Ready() with { RunLevel = "HighestAvailable" },
            "old executable" => Ready() with { ExecutablePath = @"C:\Program Files\RedLeaf\old.exe" },
            "old arguments" => Ready() with { Arguments = "launch" },
            "old working directory" => Ready() with { WorkingDirectory = @"C:\" },
            _ => throw new ArgumentOutOfRangeException(nameof(broken)),
        };

        var status = Evaluate(registration);

        Assert.False(status.Enabled);
        Assert.True(status.Registered);
        Assert.False(status.Verified);
        Assert.Equal(expectedState, status.State);
    }

    [Fact]
    public void MissingLauncher_IsReported()
    {
        var status = Evaluate(Ready(), executableExists: false);

        Assert.Equal("executable_missing", status.State);
    }

    private static StartupRegistrationStatus Evaluate(
        ScheduledStartupRegistration? registration,
        bool executableExists = true,
        string? legacyRunEntry = null,
        ScheduledStartupRegistration? legacyBootTask = null,
        StartupSignInRecord? lastSignInStart = null,
        bool lastSignInStartRunning = false)
        => StartupManager.Evaluate(
            registration,
            Command,
            executableExists,
            legacyRunEntry,
            UserSid,
            legacyBootTask,
            lastSignInStart,
            lastSignInStartRunning);

    internal static StartupSignInRecord Recorded(string outcome, string? reason = null)
    {
        var startedAt = new DateTimeOffset(2026, 10, 28, 8, 0, 12, TimeSpan.Zero);
        return new(
            startedAt,
            outcome,
            outcome == StartupSignInRecord.Starting ? null : startedAt.AddSeconds(40),
            reason,
            4242,
            startedAt.AddSeconds(-1));
    }

    internal static ScheduledStartupRegistration Ready()
        => new(
            Command.ExecutablePath,
            "launch --background true",
            @"C:\Program Files\RedLeaf",
            Enabled: true,
            HasBootTrigger: false,
            HasLogonTrigger: true,
            UserId: UserSid,
            LogonType: "InteractiveToken",
            RunLevel: "LeastPrivilege",
            LastResult: 0,
            LogonTriggerUserId: UserSid);

    internal static ScheduledStartupRegistration LegacyBootTask(bool enabled)
        => new(
            Command.ExecutablePath,
            "launch --background true",
            @"C:\Program Files\RedLeaf",
            Enabled: enabled,
            HasBootTrigger: true,
            HasLogonTrigger: true,
            UserId: UserSid,
            LogonType: "S4U",
            RunLevel: "LeastPrivilege",
            LastResult: 0,
            LogonTriggerUserId: UserSid);
}
