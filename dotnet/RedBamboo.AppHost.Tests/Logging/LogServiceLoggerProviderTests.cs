using Microsoft.Extensions.Logging;
using RedBamboo.AppHost.Logging;
using Xunit;
using AppHostLogLevel = RedBamboo.AppHost.Logging.LogLevel;

namespace RedBamboo.AppHost.Tests.Logging;

public sealed class LogServiceLoggerProviderTests
{
    private static (LogService Service, ILoggerFactory Factory) Create()
    {
        var service = new LogService(new LogServiceOptions { Source = "test" });
        var factory = LoggerFactory.Create(builder => builder.AddLogService(service));
        return (service, factory);
    }

    [Fact]
    public void Plugin_errors_reach_the_log_service_with_their_stack_trace()
    {
        var (service, factory) = Create();
        using var _ = factory;
        var logger = factory.CreateLogger("Leaf.Plugins.Nova.MessagePipeline");

        logger.LogError(new InvalidOperationException("boom"), "Session creation failed for {AgentId}", "nova");
        logger.LogWarning("RedCompute refused session creation");

        var entries = service.Query();
        Assert.Equal(2, entries.Count);
        Assert.All(entries, entry => Assert.Equal("Leaf.Plugins.Nova.MessagePipeline", entry.Category));
        Assert.Equal(AppHostLogLevel.Error, entries[0].Level);
        Assert.Equal("Session creation failed for nova", entries[0].Message);
        Assert.Contains("InvalidOperationException: boom", entries[0].StackTrace);
        Assert.Equal(AppHostLogLevel.Warn, entries[1].Level);
    }

    [Fact]
    public void Non_framework_information_is_forwarded_and_debug_is_not()
    {
        var (service, factory) = Create();
        using var _ = factory;
        var logger = factory.CreateLogger("Leaf.Plugins.LeafDiscord.DiscordBotService");

        logger.LogDebug("noise");
        logger.LogInformation("bot connected");

        var entry = Assert.Single(service.Query());
        Assert.Equal("bot connected", entry.Message);
        Assert.Equal(AppHostLogLevel.Info, entry.Level);
    }

    [Fact]
    public void Framework_categories_are_kept_to_warnings()
    {
        var (service, factory) = Create();
        using var _ = factory;

        factory.CreateLogger("Microsoft.EntityFrameworkCore.Database.Command").LogInformation("SELECT 1");
        factory.CreateLogger("System.Net.Http.HttpClient.Default").LogInformation("GET /");
        factory.CreateLogger("Microsoft.AspNetCore.Server.Kestrel").LogWarning("slow request");

        var entry = Assert.Single(service.Query());
        Assert.Equal("slow request", entry.Message);
    }

    [Fact]
    public void A_listener_that_logs_through_ILogger_does_not_recurse()
    {
        var (service, factory) = Create();
        using var _ = factory;
        var logger = factory.CreateLogger("Leaf.Plugins.Echo");
        service.OnLogEntry += _ => logger.LogWarning("echo");

        logger.LogWarning("original");

        var entry = Assert.Single(service.Query());
        Assert.Equal("original", entry.Message);
    }
}
