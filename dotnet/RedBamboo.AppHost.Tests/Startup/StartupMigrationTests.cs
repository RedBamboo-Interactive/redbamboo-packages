using RedBamboo.AppHost.Startup;
using Xunit;

namespace RedBamboo.AppHost.Tests.Startup;

public sealed class StartupMigrationTests
{
    private const string App = "RedLeaf";
    private const string UserSid = "S-1-5-21-1-2-3-1001";
    private static readonly string SignInTask = StartupManager.SignInTaskName(App, UserSid);

    private static readonly StartupLaunchCommand Command = new(
        @"C:\Program Files\RedLeaf\launcher.exe",
        ["launch", "--background", "true"]);

    [Fact]
    public void Enable_ReplacesTheBootTaskWithOneApprovalAfterAddingTheSignInTask()
    {
        var store = WithLegacy(enabled: true, needsApproval: true);

        var status = StartupManager.Enable(store, App, Command, UserSid);

        Assert.Equal("ready", status.State);
        Assert.True(store.Has(SignInTask));
        Assert.False(store.Has(App));
        Assert.Equal(1, store.ApprovalPrompts);
        Assert.Equal(
            [$"register {SignInTask}", $"delete {App}", $"approve-delete {App}"],
            store.Operations);
    }

    [Fact]
    public void Enable_RemovesABootTaskTheUserMayDeleteWithoutAPrompt()
    {
        var store = WithLegacy(enabled: false, needsApproval: false);

        var status = StartupManager.Enable(store, App, Command, UserSid);

        Assert.Equal("ready", status.State);
        Assert.False(store.Has(App));
        Assert.Equal(0, store.ApprovalPrompts);
    }

    [Fact]
    public void Enable_WhenApprovalIsRefused_KeepsTheBootTaskAndAddsNothing()
    {
        var store = WithLegacy(enabled: true, needsApproval: true);
        store.ApprovalGranted = false;

        var error = Assert.Throws<InvalidOperationException>(() =>
            StartupManager.Enable(store, App, Command, UserSid));

        Assert.Contains("kept its old boot task", error.Message);
        Assert.Contains("approval was cancelled", error.Message);
        Assert.True(store.Has(App));
        Assert.False(store.Has(SignInTask));
        Assert.Equal("legacy_boot_task", StartupManager.Inspect(store, App, Command, UserSid).State);
    }

    [Fact]
    public void Enable_WhenApprovalIsRefused_KeepsASignInTaskThatAlreadyExisted()
    {
        var store = WithLegacy(enabled: true, needsApproval: true);
        store.AddTask(SignInTask, StartupRegistrationTests.Ready());
        store.ApprovalGranted = false;

        Assert.Throws<InvalidOperationException>(() =>
            StartupManager.Enable(store, App, Command, UserSid));

        Assert.True(store.Has(SignInTask));
        Assert.True(store.Has(App));
    }

    [Fact]
    public void Enable_KeepsAWorkingTaskSoItsLastRunSurvives()
    {
        var store = new FakeStartupTaskStore();
        store.AddTask(SignInTask, StartupRegistrationTests.Ready());

        var status = StartupManager.Enable(store, App, Command, UserSid);

        Assert.Equal("RedLeaf is verified to start when you sign in to Windows.", status.Message);
        Assert.Empty(store.Operations);
    }

    [Fact]
    public void Enable_RepairsATaskTurnedOffInTaskScheduler()
    {
        var store = new FakeStartupTaskStore();
        store.AddTask(SignInTask, StartupRegistrationTests.Ready() with { Enabled = false });

        var status = StartupManager.Enable(store, App, Command, UserSid);

        Assert.Equal("ready", status.State);
        Assert.Equal([$"register {SignInTask}"], store.Operations);
    }

    [Fact]
    public void Enable_ReplacesTheRunEntry()
    {
        var store = new FakeStartupTaskStore { RunEntry = "\"C:\\RedLeaf\\launcher.exe\"" };

        var status = StartupManager.Enable(store, App, Command, UserSid);

        Assert.Equal("ready", status.State);
        Assert.Null(store.RunEntry);
    }

    [Fact]
    public void Enable_RefusesAMissingLauncher()
    {
        var store = new FakeStartupTaskStore { ExecutablePresent = false };

        Assert.Throws<FileNotFoundException>(() =>
            StartupManager.Enable(store, App, Command, UserSid));
        Assert.Empty(store.Operations);
    }

    [Fact]
    public void StatusRead_ReplacesAnEnabledBootTaskWhenNoApprovalIsNeeded()
    {
        var store = WithLegacy(enabled: true, needsApproval: false);

        Assert.True(StartupManager.MigrateWithoutApproval(store, App, Command, UserSid));

        Assert.True(store.Has(SignInTask));
        Assert.False(store.Has(App));
        Assert.Equal(0, store.ApprovalPrompts);
        Assert.Equal("ready", StartupManager.Inspect(store, App, Command, UserSid).State);
    }

    [Fact]
    public void StatusRead_NeverPromptsAndLeavesNothingBehindWhenApprovalIsNeeded()
    {
        var store = WithLegacy(enabled: true, needsApproval: true);

        Assert.False(StartupManager.MigrateWithoutApproval(store, App, Command, UserSid));

        Assert.Equal(0, store.ApprovalPrompts);
        Assert.True(store.Has(App));
        Assert.False(store.Has(SignInTask));
        Assert.Equal("legacy_boot_task", StartupManager.Inspect(store, App, Command, UserSid).State);
    }

    [Fact]
    public void StatusRead_RemovesADisabledBootTaskWithoutTurningStartupOn()
    {
        var store = WithLegacy(enabled: false, needsApproval: false);

        Assert.True(StartupManager.MigrateWithoutApproval(store, App, Command, UserSid));

        Assert.False(store.Has(App));
        Assert.False(store.Has(SignInTask));
        Assert.Equal("disabled", StartupManager.Inspect(store, App, Command, UserSid).State);
    }

    [Fact]
    public void StatusRead_ReportsADisabledBootTaskItCannotRemove()
    {
        var store = WithLegacy(enabled: false, needsApproval: true);

        Assert.False(StartupManager.MigrateWithoutApproval(store, App, Command, UserSid));

        Assert.False(store.Has(SignInTask));
        Assert.Equal(
            "legacy_boot_task_disabled",
            StartupManager.Inspect(store, App, Command, UserSid).State);
    }

    [Fact]
    public void StatusRead_ReplacesTheRunEntry()
    {
        var store = new FakeStartupTaskStore { RunEntry = "\"C:\\RedLeaf\\launcher.exe\"" };

        Assert.True(StartupManager.MigrateWithoutApproval(store, App, Command, UserSid));

        Assert.Null(store.RunEntry);
        Assert.Equal("ready", StartupManager.Inspect(store, App, Command, UserSid).State);
    }

    [Fact]
    public void StatusRead_KeepsTheBootTaskWhileTheLauncherIsMissing()
    {
        var store = WithLegacy(enabled: true, needsApproval: false);
        store.ExecutablePresent = false;

        Assert.True(StartupManager.MigrateWithoutApproval(store, App, Command, UserSid));

        Assert.True(store.Has(App));
        Assert.Empty(store.Operations);
    }

    [Fact]
    public void StatusRead_DoesNothingWithoutALegacyRegistration()
    {
        var store = new FakeStartupTaskStore();

        Assert.True(StartupManager.MigrateWithoutApproval(store, App, Command, UserSid));

        Assert.Empty(store.Operations);
    }

    [Fact]
    public void Disable_RemovesTheBootTaskAndTheSignInTask()
    {
        var store = WithLegacy(enabled: true, needsApproval: true);
        store.AddTask(SignInTask, StartupRegistrationTests.Ready());

        var status = StartupManager.Disable(store, App, Command, UserSid);

        Assert.Equal("disabled", status.State);
        Assert.False(store.Has(App));
        Assert.False(store.Has(SignInTask));
        Assert.Equal(1, store.ApprovalPrompts);
    }

    [Fact]
    public void Disable_WhenApprovalIsRefused_ChangesNothing()
    {
        var store = WithLegacy(enabled: true, needsApproval: true);
        store.AddTask(SignInTask, StartupRegistrationTests.Ready());
        store.ApprovalGranted = false;

        Assert.Throws<InvalidOperationException>(() =>
            StartupManager.Disable(store, App, Command, UserSid));

        Assert.True(store.Has(App));
        Assert.True(store.Has(SignInTask));
    }

    private static FakeStartupTaskStore WithLegacy(bool enabled, bool needsApproval)
    {
        var store = new FakeStartupTaskStore();
        store.AddTask(App, StartupRegistrationTests.LegacyBootTask(enabled), needsApproval);
        return store;
    }
}
