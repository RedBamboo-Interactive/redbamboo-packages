using Xunit;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using RedBamboo.AppHost.Auth;

namespace RedBamboo.AppHost.Tests.Auth;

public class RedLeafUserStoreTests
{
    private static readonly Guid UserId = Guid.Parse("11111111-2222-3333-4444-555555555555");

    [Fact]
    public async Task ExternalSignInKeepsFieldsOwnedByOthers()
    {
        var redLeaf = new FakeRedLeaf(new JsonObject
        {
            ["email"] = "owner@example.test",
            ["display_name"] = "Owner",
            ["auth_provider"] = "google",
            ["provider_id"] = "g-1",
            ["roles"] = "[\"admin\"]",
            ["status"] = "active",
            ["discord_user_id"] = "100000000000000001",
        });
        var store = new RedLeafUserStore(redLeaf.Client());

        var user = await store.CreateOrUpdateFromExternalAsync(
            new ExternalIdentity("g-1", "renamed@example.test", "Owner Renamed", "https://avatar.test/a.png", "google"));

        Assert.Equal(UserId.ToString(), user.Id);
        Assert.Equal(["admin"], user.Roles);
        var data = redLeaf.Data;
        Assert.Equal("100000000000000001", (string?)data["discord_user_id"]);
        Assert.Equal("[\"admin\"]", (string?)data["roles"]);
        Assert.Equal("renamed@example.test", (string?)data["email"]);
        Assert.Equal("Owner Renamed", (string?)data["display_name"]);
        Assert.Equal("https://avatar.test/a.png", (string?)data["avatar_url"]);
        Assert.Equal("active", (string?)data["status"]);
        Assert.NotNull((string?)data["last_login_at"]);
        Assert.Equal("Owner Renamed", redLeaf.Name);
    }

    /// <summary>
    /// The two RedLeaf entity writes the store uses, with their real semantics: PUT replaces
    /// data when it carries data, PATCH .../data merges shallowly.
    /// </summary>
    private sealed class FakeRedLeaf(JsonObject data) : HttpMessageHandler
    {
        public JsonObject Data { get; private set; } = data;
        public string Name { get; private set; } = "Owner";

        public HttpClient Client() => new(this) { BaseAddress = new Uri("http://redleaf.test/") };

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri!.AbsolutePath;
            var body = request.Content is null
                ? null
                : JsonNode.Parse(await request.Content.ReadAsStringAsync(cancellationToken))!.AsObject();

            if (request.Method == HttpMethod.Get && path == "/api/entities")
                return Json(new JsonObject { ["items"] = new JsonArray(Entity()), ["total"] = 1 });

            if (request.Method == HttpMethod.Patch && path == $"/api/entities/{UserId}/data")
            {
                foreach (var (key, value) in body!)
                    Data[key] = value?.DeepClone();
                return Json(Entity());
            }

            if (request.Method == HttpMethod.Put && path == $"/api/entities/{UserId}")
            {
                if (body!["name"] is { } name) Name = (string)name!;
                if (body["data"] is JsonObject replaced) Data = (JsonObject)replaced.DeepClone();
                return Json(Entity());
            }

            return new HttpResponseMessage(HttpStatusCode.NotFound);
        }

        private JsonObject Entity() => new()
        {
            ["id"] = UserId.ToString(),
            ["typeSlug"] = "user",
            ["slug"] = "owner",
            ["name"] = Name,
            ["data"] = Data.ToJsonString(),
        };

        private static HttpResponseMessage Json(JsonNode node) => new(HttpStatusCode.OK)
        {
            Content = new StringContent(node.ToJsonString(), Encoding.UTF8, "application/json"),
        };
    }
}
