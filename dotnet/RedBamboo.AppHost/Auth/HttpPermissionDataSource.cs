using System.Net.Http;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace RedBamboo.AppHost.Auth;

public class PermissionDataSourceOptions
{
    public string RedLeafBaseUrl { get; set; } = "http://localhost:18804";
}

public sealed class HttpPermissionDataSource : IPermissionDataSource
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private readonly HttpClient _http;
    private readonly PermissionDataSourceOptions _options;
    private readonly ILogger<HttpPermissionDataSource> _logger;

    public HttpPermissionDataSource(
        HttpClient http,
        PermissionDataSourceOptions options,
        ILogger<HttpPermissionDataSource> logger)
    {
        _http = http;
        _options = options;
        _logger = logger;
    }

    public async Task<List<RolePermissions>> LoadRolesAsync()
    {
        try
        {
            var url = $"{_options.RedLeafBaseUrl.TrimEnd('/')}/api/entities?type=role";
            var response = await _http.GetAsync(url);
            response.EnsureSuccessStatusCode();

            var json = await response.Content.ReadAsStringAsync();
            var entities = JsonSerializer.Deserialize<List<RoleEntity>>(json, JsonOptions);

            if (entities is null)
                return [];

            var results = new List<RolePermissions>();

            foreach (var entity in entities)
            {
                if (entity.Slug is null || entity.Data?.Permissions is null)
                    continue;

                var permissionSet = JsonSerializer.Deserialize<PermissionSet>(
                    entity.Data.Permissions, JsonOptions);

                if (permissionSet?.Grants is null)
                    continue;

                results.Add(new RolePermissions(entity.Slug, permissionSet.Grants));
            }

            return results;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to load role permissions from RedLeaf at {BaseUrl}",
                _options.RedLeafBaseUrl);
            return [];
        }
    }

    private record RoleEntity(string? Slug, RoleEntityData? Data);
    private record RoleEntityData(string? Permissions);
}
