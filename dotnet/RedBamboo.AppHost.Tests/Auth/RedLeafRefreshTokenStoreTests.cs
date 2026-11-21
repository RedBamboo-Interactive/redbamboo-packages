using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using RedBamboo.AppHost.Auth;
using Xunit;

namespace RedBamboo.AppHost.Tests.Auth;

/// <summary>
/// The RedLeaf refresh-token store against a fake of RedLeaf's entity API (list with <c>data.*</c> filters,
/// <c>limit</c> clamped to 500, <c>offset</c>; create; PATCH data; delete).
/// </summary>
public class RedLeafRefreshTokenStoreTests
{
    private sealed class FakeEntityApi : HttpMessageHandler
    {
        public List<(Guid Id, JsonObject Data)> Rows { get; } = [];
        public HashSet<Guid> UndeletableIds { get; } = [];
        public bool RefusePatch { get; set; }
        public int ListCalls { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var path = request.RequestUri!.AbsolutePath;
            var query = System.Web.HttpUtility.ParseQueryString(request.RequestUri.Query);
            if (request.Method == HttpMethod.Get && path == "/api/entities")
            {
                ListCalls++;
                var filters = query.AllKeys.Where(k => k!.StartsWith("data.")).ToDictionary(k => k![5..], k => query[k]);
                var limit = Math.Min(int.Parse(query["limit"] ?? "100"), 500);
                var offset = int.Parse(query["offset"] ?? "0");
                var matched = Rows.Where(r => filters.All(f => r.Data[f.Key]?.GetValue<string>() == f.Value)).ToList();
                var items = matched.Skip(offset).Take(limit)
                    .Select(r => new { id = r.Id, typeSlug = "refresh-token", data = r.Data.ToJsonString() });
                return Json(new { items, total = matched.Count });
            }
            if (request.Method == HttpMethod.Post && path == "/api/entities")
            {
                var body = JsonNode.Parse(await request.Content!.ReadAsStringAsync(ct))!;
                Rows.Add((Guid.NewGuid(), body["data"]!.AsObject().DeepClone().AsObject()));
                return new HttpResponseMessage(HttpStatusCode.Created);
            }
            var id = Guid.Parse(path.Split('/')[3]);
            var index = Rows.FindIndex(r => r.Id == id);
            if (request.Method == HttpMethod.Delete)
            {
                if (UndeletableIds.Contains(id)) return new HttpResponseMessage(HttpStatusCode.InternalServerError);
                if (index < 0) return new HttpResponseMessage(HttpStatusCode.NotFound);
                Rows.RemoveAt(index);
                return new HttpResponseMessage(HttpStatusCode.NoContent);
            }
            if (request.Method == HttpMethod.Patch && path.EndsWith("/data"))
            {
                if (RefusePatch || index < 0) return new HttpResponseMessage(HttpStatusCode.Forbidden);
                var patch = JsonNode.Parse(await request.Content!.ReadAsStringAsync(ct))!.AsObject();
                foreach (var (key, value) in patch) Rows[index].Data[key] = value?.DeepClone();
                return Json(new { ok = true });
            }
            return new HttpResponseMessage(HttpStatusCode.NotFound);
        }

        private static HttpResponseMessage Json(object value) => new(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(value), Encoding.UTF8, "application/json"),
        };

        public void Seed(string userId, int count, string? family = null)
        {
            for (var i = 0; i < count; i++)
            {
                var data = new JsonObject
                {
                    ["token_hash"] = RefreshTokenHash.Of(Guid.NewGuid().ToString()),
                    ["user_id"] = userId,
                    ["expires_at"] = DateTimeOffset.UtcNow.AddDays(30).ToString("o"),
                };
                if (family is not null) data["family"] = family;
                Rows.Add((Guid.NewGuid(), data));
            }
        }
    }

    private static (FakeEntityApi Api, RedLeafRefreshTokenStore Store) Create()
    {
        var api = new FakeEntityApi();
        return (api, new RedLeafRefreshTokenStore(api, "http://redleaf.test"));
    }

    [Fact]
    public async Task Revoking_all_of_a_user_reaches_past_the_first_page()
    {
        var (api, store) = Create();
        api.Seed("owner", 1_150);
        api.Seed("someone-else", 3);

        await store.RevokeAllForUserAsync("owner");

        Assert.DoesNotContain(api.Rows, r => r.Data["user_id"]!.GetValue<string>() == "owner");
        Assert.Equal(3, api.Rows.Count);
    }

    [Fact]
    public async Task Rows_whose_delete_fails_do_not_stop_the_sweep_or_loop_it_forever()
    {
        var (api, store) = Create();
        api.Seed("owner", 1_200);
        foreach (var (id, _) in api.Rows.Take(600)) api.UndeletableIds.Add(id);

        await store.RevokeAllForUserAsync("owner");

        Assert.Equal(600, api.Rows.Count);
        Assert.All(api.Rows, r => Assert.Contains(r.Id, api.UndeletableIds));
        Assert.True(api.ListCalls < RedLeafRefreshTokenStore.MaxPages);
    }

    [Fact]
    public async Task A_family_is_revoked_without_touching_the_others()
    {
        var (api, store) = Create();
        api.Seed("owner", 3, family: "dev_A");
        api.Seed("owner", 2, family: "dev_B");

        await store.RevokeFamilyAsync("dev_A");

        Assert.Equal(2, api.Rows.Count);
        Assert.All(api.Rows, r => Assert.Equal("dev_B", r.Data["family"]!.GetValue<string>()));
    }

    [Fact]
    public async Task A_token_carries_its_family_and_rotation_through_the_entity_data()
    {
        var (api, store) = Create();
        await store.StoreAsync("token-1", "owner", DateTimeOffset.UtcNow.AddDays(30), "dev_A");
        var stored = (await store.FindAsync("token-1"))!;
        Assert.Equal("dev_A", stored.FamilyId);
        Assert.Null(stored.RotatedAt);

        var at = DateTimeOffset.UtcNow;
        await store.MarkRotatedAsync(stored.EntityId, RefreshTokenHash.Of("token-2"), at);

        var rotated = (await store.FindAsync("token-1"))!;
        Assert.Equal(at.ToUnixTimeMilliseconds(), rotated.RotatedAt!.Value.ToUnixTimeMilliseconds());
        Assert.Null(await store.ValidateAsync("token-1"));
        Assert.Equal(RefreshTokenHash.Of("token-2"), api.Rows.Single().Data["replaced_by_hash"]!.GetValue<string>());
        Assert.DoesNotContain(api.Rows, r => r.Data.ToJsonString().Contains("token-1"));
    }

    [Fact]
    public async Task A_token_the_store_cannot_mark_is_deleted_rather_than_left_usable()
    {
        var (api, store) = Create();
        api.RefusePatch = true;
        await store.StoreAsync("token-1", "owner", DateTimeOffset.UtcNow.AddDays(30), "dev_A");
        var stored = (await store.FindAsync("token-1"))!;

        await store.MarkRotatedAsync(stored.EntityId, RefreshTokenHash.Of("token-2"), DateTimeOffset.UtcNow);

        Assert.Empty(api.Rows);
    }

    [Fact]
    public async Task Rows_stored_before_sessions_still_validate_with_no_family()
    {
        var (_, store) = Create();
        await store.StoreAsync("old", "owner", DateTimeOffset.UtcNow.AddDays(30));
        var found = (await store.ValidateAsync("old"))!;
        Assert.Equal("owner", found.UserId);
        Assert.Null(found.FamilyId);
    }
}
