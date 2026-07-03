using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace RedBamboo.AppHost.Auth;

public record CalendarEvent(
    string? Id,
    string? Summary,
    DateTimeOffset? Start,
    DateTimeOffset? End,
    string? Location,
    string? HtmlLink
);

public class GoogleApiProxy
{
    private readonly GoogleTokenStore _tokenStore;
    private readonly HttpClient _httpClient;

    public GoogleApiProxy(GoogleTokenStore tokenStore, HttpClient httpClient)
    {
        _tokenStore = tokenStore;
        _httpClient = httpClient;
    }

    public async Task<List<CalendarEvent>> GetCalendarEventsAsync(
        string userId, DateTimeOffset timeMin, DateTimeOffset timeMax)
    {
        var token = await _tokenStore.GetValidAccessTokenAsync(userId);
        if (token is null) return [];

        var url = "https://www.googleapis.com/calendar/v3/calendars/primary/events" +
            $"?timeMin={Uri.EscapeDataString(timeMin.UtcDateTime.ToString("o"))}" +
            $"&timeMax={Uri.EscapeDataString(timeMax.UtcDateTime.ToString("o"))}" +
            "&singleEvents=true&orderBy=startTime";

        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        var events = new List<CalendarEvent>();

        if (!json.TryGetProperty("items", out var items)) return events;
        foreach (var item in items.EnumerateArray())
        {
            events.Add(new CalendarEvent(
                Id: item.TryGetProperty("id", out var id) ? id.GetString() : null,
                Summary: item.TryGetProperty("summary", out var summary) ? summary.GetString() : null,
                Start: ParseGoogleDateTime(item, "start"),
                End: ParseGoogleDateTime(item, "end"),
                Location: item.TryGetProperty("location", out var loc) ? loc.GetString() : null,
                HtmlLink: item.TryGetProperty("htmlLink", out var link) ? link.GetString() : null
            ));
        }
        return events;
    }

    public async Task<int?> GetStepsAsync(string userId, DateOnly date)
    {
        var token = await _tokenStore.GetValidAccessTokenAsync(userId);
        if (token is null) return null;

        var startMs = new DateTimeOffset(date.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero).ToUnixTimeMilliseconds();
        var endMs = new DateTimeOffset(date.AddDays(1).ToDateTime(TimeOnly.MinValue), TimeSpan.Zero).ToUnixTimeMilliseconds();

        var body = new
        {
            aggregateBy = new[] { new { dataTypeName = "com.google.step_count.delta" } },
            bucketByTime = new { durationMillis = 86400000 },
            startTimeMillis = startMs,
            endTimeMillis = endMs
        };

        using var request = new HttpRequestMessage(HttpMethod.Post,
            "https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Content = JsonContent.Create(body);

        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadFromJsonAsync<JsonElement>();

        var total = 0;
        if (!json.TryGetProperty("bucket", out var buckets)) return total;
        foreach (var bucket in buckets.EnumerateArray())
        {
            if (!bucket.TryGetProperty("dataset", out var datasets)) continue;
            foreach (var dataset in datasets.EnumerateArray())
            {
                if (!dataset.TryGetProperty("point", out var points)) continue;
                foreach (var point in points.EnumerateArray())
                {
                    if (!point.TryGetProperty("value", out var values)) continue;
                    foreach (var val in values.EnumerateArray())
                    {
                        if (val.TryGetProperty("intVal", out var intVal))
                            total += intVal.GetInt32();
                    }
                }
            }
        }
        return total;
    }

    private static DateTimeOffset? ParseGoogleDateTime(JsonElement item, string key)
    {
        if (!item.TryGetProperty(key, out var dt)) return null;
        if (dt.TryGetProperty("dateTime", out var dateTime) &&
            DateTimeOffset.TryParse(dateTime.GetString(), out var result))
            return result;
        if (dt.TryGetProperty("date", out var date) &&
            DateOnly.TryParse(date.GetString(), out var d))
            return new DateTimeOffset(d.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
        return null;
    }
}
