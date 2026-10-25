using System.Net;
using System.Net.Http;
using RedBamboo.AppHost.Auth;
using RedBamboo.AppHost.Auth.Vault;
using Xunit;

namespace RedBamboo.AppHost.Tests.Auth;

public class BadgeBearerHandlerTests
{
    private sealed class Echo : HttpMessageHandler
    {
        public string? Seen;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Seen = request.Headers.Authorization?.ToString();
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK));
        }
    }

    [Fact]
    public async Task A_badge_is_fetched_per_request_so_building_the_client_needs_no_vault()
    {
        var calls = 0;
        var echo = new Echo();
        using var client = new HttpClient(new BadgeBearerHandler(() => $"fake-{++calls}", echo));
        Assert.Equal(0, calls);

        await client.GetAsync("http://127.0.0.1/x");
        Assert.Equal("Bearer fake-1", echo.Seen);
        await client.GetAsync("http://127.0.0.1/x");
        Assert.Equal("Bearer fake-2", echo.Seen);
    }

    [Fact]
    public async Task A_vault_outage_surfaces_as_an_ordinary_http_failure_in_plain_words()
    {
        using var client = new HttpClient(new BadgeBearerHandler(() => throw new VaultUnavailableException("Leaf Vault unavailable"), new Echo()));

        var e = await Assert.ThrowsAsync<HttpRequestException>(() => client.GetAsync("http://127.0.0.1/x"));
        Assert.Equal("Leaf Vault unavailable", e.Message);
    }
}
