using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using RedBamboo.AppHost.Auth;
using Xunit;

namespace RedBamboo.AppHost.Tests.Auth;

/// <summary>
/// The RedLeaf refresh-token store against a fake of RedLeaf's entity API (list with <c>data.*</c> filters,
/// <c>limit</c> clamped to 500, <c>offset</c>, <c>__lt</c> text comparison; create; PATCH data, 404 for a
/// missing row; delete).
/// </summary>
public class RedLeafRefreshTokenStoreTests
{
    private sealed class FakeEntityApi : HttpMessageHandler
    {
        public List<(Guid Id, JsonObject Data)> Rows { get; } = [];
        public HashSet<Guid> UndeletableIds { get; } = [];
        public bool RefusePatch { get; set; }
        public bool FailLists { get; set; }
        public int ListCalls { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var path = request.RequestUri!.AbsolutePath;
            var query = System.Web.HttpUtility.ParseQueryString(request.RequestUri.Query);
            if (request.Method == HttpMethod.Get && path == "/api/entities")
            {
                ListCalls++;
                if (FailLists) return new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);
                var filters = query.AllKeys.Where(k => k!.StartsWith("data.")).ToDictionary(k => k![5..], k => query[k]);
                var limit = Math.Min(int.Parse(query["limit"] ?? "100"), 500);
                var offset = int.Parse(query["offset"] ?? "0");
                var matched = Rows.Where(r => filters.All(f => Matches(r.Data, f.Key, f.Value!))).ToList();
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
                if (index < 0) return new HttpResponseMessage(HttpStatusCode.NotFound);
                if (RefusePatch) return new HttpResponseMessage(HttpStatusCode.Forbidden);
                var patch = JsonNode.Parse(await request.Content!.ReadAsStringAsync(ct))!.AsObject();
                foreach (var (key, value) in patch) Rows[index].Data[key] = value?.DeepClone();
                return Json(new { ok = true });
            }
            return new HttpResponseMessage(HttpStatusCode.NotFound);
        }

        private static bool Matches(JsonObject data, string key, string value)
        {
            if (key.EndsWith("__lt", StringComparison.Ordinal))
                return data[key[..^4]]?.GetValue<string>() is { } text && string.CompareOrdinal(text, value) < 0;
            return data[key]?.GetValue<string>() == value;
        }

        private static HttpResponseMessage Json(object value) => new(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(value), Encoding.UTF8, "application/json"),
        };

        public void Seed(string userId, int count, string? family = null, DateTimeOffset? expiresAt = null,
            DateTimeOffset? rotatedAt = null)
        {
            for (var i = 0; i < count; i++)
            {
                var data = new JsonObject
                {
                    ["token_hash"] = RefreshTokenHash.Of(Guid.NewGuid().ToString()),
                    ["user_id"] = userId,
                    ["expires_at"] = (expiresAt ?? DateTimeOffset.UtcNow.AddDays(30)).ToUniversalTime().ToString("o"),
                };
                if (family is not null) data["family"] = family;
                if (rotatedAt is not null) data["rotated_at"] = rotatedAt.Value.ToUniversalTime().ToString("o");
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

        Assert.True(await store.RevokeAllForUserAsync("owner"));

        Assert.DoesNotContain(api.Rows, r => r.Data["user_id"]!.GetValue<string>() == "owner");
        Assert.Equal(3, api.Rows.Count);
    }

    [Fact]
    public async Task Rows_whose_delete_fails_do_not_stop_the_sweep_or_loop_it_forever()
    {
        var (api, store) = Create();
        api.Seed("owner", 1_200);
        foreach (var (id, _) in api.Rows.Take(600)) api.UndeletableIds.Add(id);

        Assert.False(await store.RevokeAllForUserAsync("owner"));  // reported, so the caller can log it

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

        Assert.True(await store.RevokeFamilyAsync("dev_A"));

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
        Assert.Equal(RotationMark.Marked, await store.MarkRotatedAsync(stored.EntityId, RefreshTokenHash.Of("token-2"), at));

        var rotated = (await store.FindAsync("token-1"))!;
        Assert.Equal(at.ToUnixTimeMilliseconds(), rotated.RotatedAt!.Value.ToUnixTimeMilliseconds());
        Assert.Null(await store.ValidateAsync("token-1"));
        Assert.Equal(RefreshTokenHash.Of("token-2"), api.Rows.Single().Data["replaced_by_hash"]!.GetValue<string>());
        Assert.Equal(RefreshTokenHash.Of("token-2"), rotated.ReplacedByHash);
        Assert.DoesNotContain(api.Rows, r => r.Data.ToJsonString().Contains("token-1"));
    }

    [Fact]
    public async Task A_token_the_store_cannot_mark_is_deleted_rather_than_left_usable()
    {
        var (api, store) = Create();
        api.RefusePatch = true;
        await store.StoreAsync("token-1", "owner", DateTimeOffset.UtcNow.AddDays(30), "dev_A");
        var stored = (await store.FindAsync("token-1"))!;

        Assert.Equal(RotationMark.Deleted,
            await store.MarkRotatedAsync(stored.EntityId, RefreshTokenHash.Of("token-2"), DateTimeOffset.UtcNow));

        Assert.Empty(api.Rows);
    }

    [Fact]
    public async Task Marking_a_row_whose_family_was_revoked_meanwhile_reports_it_missing()
    {
        var (api, store) = Create();
        await store.StoreAsync("token-1", "owner", DateTimeOffset.UtcNow.AddDays(30), "dev_A");
        var stored = (await store.FindAsync("token-1"))!;
        await store.RevokeFamilyAsync("dev_A");

        Assert.Equal(RotationMark.Missing,
            await store.MarkRotatedAsync(stored.EntityId, RefreshTokenHash.Of("token-2"), DateTimeOffset.UtcNow));
        Assert.Empty(api.Rows);
    }

    [Fact]
    public async Task Marking_an_adopted_row_writes_its_new_family()
    {
        var (_, store) = Create();
        await store.StoreAsync("old", "owner", DateTimeOffset.UtcNow.AddDays(30));
        var stored = (await store.FindAsync("old"))!;

        await store.MarkRotatedAsync(stored.EntityId, RefreshTokenHash.Of("new"), DateTimeOffset.UtcNow, familyId: "dev_A");

        Assert.Equal("dev_A", (await store.FindAsync("old"))!.FamilyId);
    }

    [Fact]
    public async Task A_sweep_whose_list_fails_reports_failure_instead_of_success()
    {
        var (api, store) = Create();
        api.Seed("owner", 3, family: "dev_A");
        api.FailLists = true;

        Assert.False(await store.RevokeFamilyAsync("dev_A"));
        Assert.False(await store.RevokeAllForUserAsync("owner"));
        Assert.Equal(3, api.Rows.Count);
    }

    [Fact]
    public async Task Storing_a_token_prunes_a_bounded_number_of_expired_and_long_rotated_rows()
    {
        var (api, store) = Create();
        var now = DateTimeOffset.UtcNow;
        api.Seed("owner", 15, expiresAt: now.AddDays(-1));
        api.Seed("owner", 15, rotatedAt: now - RefreshTokenRetention.RotatedKeptFor - TimeSpan.FromHours(1));
        api.Seed("owner", 4, rotatedAt: now - TimeSpan.FromDays(1));
        api.Seed("owner", 3);

        await store.StoreAsync("token-new", "owner", now.AddDays(30), "dev_A");

        // 38 rows and at most 20 deletions per store: every expired row first, then 5 of the long-rotated ones.
        Assert.Equal(38 - RefreshTokenRetention.PrunePerStore, api.Rows.Count);
        Assert.DoesNotContain(api.Rows, r => DateTimeOffset.Parse(r.Data["expires_at"]!.GetValue<string>()) <= now);

        await store.StoreAsync("token-newer", "owner", now.AddDays(30), "dev_A");

        // The other 10 long-rotated rows go next time. Rows rotated a day ago, live rows and both new ones stay.
        Assert.Equal(4 + 3 + 2, api.Rows.Count);
        Assert.NotNull(await store.ValidateAsync("token-new"));
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
