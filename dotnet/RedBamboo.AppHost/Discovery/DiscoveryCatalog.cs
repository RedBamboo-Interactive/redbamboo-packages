using System.Collections.Concurrent;
using System.IO.Pipelines;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Schema;
using System.Text.Json.Serialization.Metadata;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Patterns;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using HttpJsonOptions = Microsoft.AspNetCore.Http.Json.JsonOptions;

namespace RedBamboo.AppHost.Discovery;

/// <summary>A part of the service beyond the kernel, such as a plugin, and the route prefix it owns.</summary>
public sealed record DiscoveryArea(
    string Id,
    string Name,
    string Kind,
    string RoutePrefix,
    string? Summary = null,
    string? PublicPrefix = null,
    IReadOnlyList<DiscoveryConcept>? Concepts = null);

/// <summary>An entity type an area owns: the vocabulary an Agent must know to use its routes.</summary>
public sealed record DiscoveryConcept(
    string Type,
    string Name,
    string? Description = null,
    IReadOnlyList<DiscoveryField>? Fields = null);

public sealed record DiscoveryField(string Name, string Type, bool Required = false, string? Description = null);

public sealed record CatalogRoute(
    string Method,
    string Path,
    string Area,
    string? Description = null,
    IReadOnlyList<ParameterDescriptor>? Parameters = null,
    object? RequestBody = null,
    object? Response = null,
    string? Auth = null,
    IReadOnlyList<string>? ContentTypes = null,
    bool Public = false)
{
    /// <summary>The path as a caller writes it, without routing constraints.</summary>
    public string CleanPath => DiscoveryCatalog.StripConstraints(Path);
}

/// <summary>
/// One view of everything this service can do, built from the live route table. The registry and
/// the capability lists add what they know by hand; plugin routes arrive with no plugin change.
/// A kernel route stays out unless the registry describes it, because some are deliberately unlisted.
/// </summary>
public sealed class DiscoveryCatalog
{
    private static readonly ConcurrentDictionary<Type, JsonNode?> SchemaCache = new();
    private static readonly HashSet<string> Stopwords = new(StringComparer.Ordinal)
    {
        "a", "an", "and", "the", "to", "of", "for", "in", "on", "how", "do", "i", "my", "with", "or", "is", "can",
    };

    public IReadOnlyList<CatalogRoute> Routes { get; }
    public IReadOnlyList<DiscoveryArea> Areas { get; }
    public IReadOnlyList<CapabilityDescriptor> Capabilities { get; }

    private DiscoveryCatalog(
        IReadOnlyList<CatalogRoute> routes,
        IReadOnlyList<DiscoveryArea> areas,
        IReadOnlyList<CapabilityDescriptor> capabilities)
    {
        Routes = routes;
        Areas = areas;
        Capabilities = capabilities;
    }

    public static DiscoveryCatalog Build(
        IEnumerable<EndpointDataSource> sources,
        IReadOnlyList<EndpointDescriptor> registered,
        IReadOnlyList<CapabilityDescriptor> capabilities,
        IReadOnlyList<DiscoveryArea> areas,
        JsonSerializerOptions? jsonOptions = null)
    {
        var table = new Dictionary<string, RouteEndpoint>(StringComparer.OrdinalIgnoreCase);
        var tableRoutes = new List<(string Method, string Path, RouteEndpoint Endpoint)>();
        foreach (var endpoint in sources.SelectMany(source => source.Endpoints).OfType<RouteEndpoint>())
        {
            if (endpoint.Metadata.GetMetadata<IExcludeFromDescriptionMetadata>()?.ExcludeFromDescription == true)
                continue;
            var path = "/" + (endpoint.RoutePattern.RawText ?? "").TrimStart('/');
            foreach (var method in endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods ?? ["ANY"])
            {
                table[Key(method, path)] = endpoint;
                tableRoutes.Add((method, path, endpoint));
            }
        }

        var options = jsonOptions ?? JsonSerializerOptions.Web;
        var listedBy = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var capability in capabilities)
            foreach (var endpoint in capability.Endpoints ?? [])
                listedBy.TryAdd(Key(endpoint.Method, endpoint.Path), capability.Slug);

        var routes = new Dictionary<string, CatalogRoute>(StringComparer.OrdinalIgnoreCase);

        void AddDescribed(EndpointDescriptor described)
        {
            var key = Key(described.Method, described.Path);
            if (routes.TryGetValue(key, out var existing))
            {
                routes[key] = existing with
                {
                    Description = existing.Description ?? NullIfEmpty(described.Description),
                    Parameters = existing.Parameters ?? described.Parameters,
                    RequestBody = existing.RequestBody ?? described.RequestBody,
                    Response = existing.Response ?? described.Response,
                    Auth = existing.Auth ?? described.Auth,
                };
                return;
            }

            table.TryGetValue(key, out var endpoint);
            var route = FromEndpoint(described.Method, endpoint is null ? described.Path : RawPath(endpoint),
                endpoint, areas, listedBy, options);
            routes[key] = route with
            {
                Description = NullIfEmpty(described.Description) ?? route.Description,
                Parameters = described.Parameters ?? route.Parameters,
                RequestBody = described.RequestBody ?? route.RequestBody,
                Response = described.Response ?? route.Response,
                Auth = described.Auth ?? route.Auth,
            };
        }

        foreach (var described in registered) AddDescribed(described);
        foreach (var capability in capabilities)
            foreach (var described in capability.Endpoints ?? [])
                AddDescribed(described);

        foreach (var (method, path, endpoint) in tableRoutes)
        {
            if (FindOwner(path, areas) is null) continue;
            routes.TryAdd(Key(method, path), FromEndpoint(method, path, endpoint, areas, listedBy, options));
        }

        return new DiscoveryCatalog(
            routes.Values.OrderBy(route => route.Path, StringComparer.Ordinal).ThenBy(route => route.Method).ToList(),
            areas,
            capabilities);
    }

    /// <summary>The document at /discover for a signed-in caller: what exists, and where to look next.</summary>
    public object Map(IServiceDescriptor descriptor, string? authMode, object? management, object? proxies) => new
    {
        schema = "leaf.discover/2",
        service = descriptor.ServiceName,
        name = descriptor.ServiceName,
        version = descriptor.Version,
        description = descriptor.Description,
        api_base = descriptor.ApiBase,
        descriptor.IconClass,
        descriptor.IconColor,
        authMode,
        how = "Search with find, or open one area for its routes, schemas and concepts. Send your token on every call; "
            + "a blank auth field on a route does not make it public.",
        find = "/discover/find?q={words}",
        openapi = "/openapi.json",
        previousFormat = "/discover?format=v1",
        areas = AreaSummaries(),
        proxies,
        management,
    };

    public object? Area(string id, bool includePublic)
    {
        var area = Areas.FirstOrDefault(item => string.Equals(item.Id, id, StringComparison.OrdinalIgnoreCase));
        var capability = Capabilities.FirstOrDefault(item => string.Equals(item.Slug, id, StringComparison.OrdinalIgnoreCase));
        var routes = Routes.Where(route => string.Equals(route.Area, id, StringComparison.OrdinalIgnoreCase)).ToList();
        if (area is null && capability is null && routes.Count == 0) return null;

        var visible = routes.Where(route => includePublic || !route.Public).ToList();
        var publicCount = routes.Count(route => route.Public);
        return new
        {
            id = area?.Id ?? capability?.Slug ?? routes[0].Area,
            name = area?.Name ?? capability?.DisplayName ?? id,
            kind = area?.Kind ?? "kernel",
            status = capability?.Status,
            summary = area?.Summary ?? capability?.Description,
            guide = OwnDocument(routes),
            concepts = area?.Concepts,
            routes = visible.Select(RouteDetail).ToList(),
            undescribedRoutes = NullIfZero(visible.Count(route => route.Description is null)),
            publicRoutes = NullIfZero(includePublic ? 0 : publicCount),
            publicRoutesHref = !includePublic && publicCount > 0 ? $"/discover/{area?.Id ?? id}?public=true" : null,
        };
    }

    public object Find(string? query, int limit, bool includePublic)
    {
        var words = QueryWords(query);
        var clamped = Math.Clamp(limit, 1, 50);
        if (words.Count == 0)
            return new { query, total = 0, routes = Array.Empty<object>(), hint = "Give find a few words, for example q=register repository." };

        var needed = (words.Count + 1) / 2;
        var hits = Routes
            .Where(route => includePublic || !route.Public)
            .Select(route => (Route: route, Score: ScoreRoute(route, words)))
            .Where(hit => hit.Score.Matched >= needed)
            .OrderByDescending(hit => hit.Score.Matched)
            .ThenByDescending(hit => hit.Score.Weight)
            .ThenBy(hit => hit.Route.Path.Length)
            .ToList();

        var concepts = Areas
            .SelectMany(area => (area.Concepts ?? []).Select(concept => (Area: area, Concept: concept)))
            .Where(item => words.Any(word => WordsOf(item.Concept.Type).Contains(word) || WordsOf(item.Concept.Name).Contains(word)))
            .Select(item => new
            {
                type = item.Concept.Type,
                name = item.Concept.Name,
                area = item.Area.Id,
                href = $"/discover/{item.Area.Id}",
                description = item.Concept.Description,
            })
            .Take(10)
            .ToList();

        return new
        {
            query,
            total = hits.Count,
            routes = hits.Take(clamped).Select(hit => new
            {
                method = hit.Route.Method,
                path = hit.Route.Path,
                area = hit.Route.Area,
                description = hit.Route.Description,
                href = $"/discover/{hit.Route.Area}",
            }).ToList(),
            concepts = concepts.Count > 0 ? concepts : null,
        };
    }

    /// <summary>
    /// What to tell a caller whose request matched no route. Finds the route they probably meant, so the
    /// answer can say "wrong method" or "bad value" rather than claiming the endpoint doesn't exist.
    /// </summary>
    public RouteMiss Explain(string method, string path)
    {
        var segments = path.Trim('/').Split('/');
        var matches = new List<CatalogRoute>();
        var nearMisses = new List<CatalogRoute>();
        foreach (var route in Routes)
        {
            switch (MatchShape(route.Path, segments))
            {
                case ShapeMatch.Full: matches.Add(route); break;
                case ShapeMatch.BadValue: nearMisses.Add(route); break;
            }
        }

        var allowed = matches.Select(route => route.Method)
            .Where(item => item is not ("ANY" or "WS"))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var area = matches.FirstOrDefault()?.Area ?? nearMisses.FirstOrDefault()?.Area;
        var badValue = nearMisses.FirstOrDefault(route => string.Equals(route.Method, method, StringComparison.OrdinalIgnoreCase));

        var query = string.Join(' ', segments.Where(segment => segment is not ("api" or "apps" or "extensions")));
        var findable = Routes.Where(route => !route.Public);
        var words = QueryWords(query);
        var closest = words.Count == 0
            ? []
            : findable
                .Select(route => (Route: route, Score: ScoreRoute(route, words)))
                .Where(hit => hit.Score.Matched > 0)
                .OrderByDescending(hit => string.Equals(hit.Route.Method, method, StringComparison.OrdinalIgnoreCase))
                .ThenByDescending(hit => hit.Score.Matched)
                .ThenByDescending(hit => hit.Score.Weight)
                .ThenBy(hit => hit.Route.Path.Length)
                .Take(5)
                .Select(hit => hit.Route)
                .ToList();

        return new RouteMiss(allowed, badValue, area, closest,
            words.Count == 0 ? "/discover" : "/discover/find?q=" + Uri.EscapeDataString(query));
    }

    private object AreaSummaries()
    {
        var byArea = Routes.Where(route => !route.Public)
            .GroupBy(route => route.Area, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.ToList(), StringComparer.OrdinalIgnoreCase);
        var ids = byArea.Keys
            .Concat(Areas.Where(area => area.Concepts is { Count: > 0 }).Select(area => area.Id))
            .Concat(Capabilities.Select(capability => capability.Slug))
            .Distinct(StringComparer.OrdinalIgnoreCase);

        return ids.Select(id =>
            {
                var area = Areas.FirstOrDefault(item => string.Equals(item.Id, id, StringComparison.OrdinalIgnoreCase));
                var capability = Capabilities.FirstOrDefault(item => string.Equals(item.Slug, id, StringComparison.OrdinalIgnoreCase));
                var routes = byArea.GetValueOrDefault(id) ?? [];
                return new
                {
                    id,
                    name = area?.Name ?? capability?.DisplayName ?? id,
                    kind = area?.Kind ?? "kernel",
                    status = capability?.Status,
                    summary = FirstSentence(area?.Summary ?? capability?.Description),
                    routes = routes.Count,
                    undescribed = NullIfZero(routes.Count(route => route.Description is null)),
                    concepts = area?.Concepts is { Count: > 0 } owned ? owned.Select(concept => concept.Type).ToList() : null,
                    href = $"/discover/{id}",
                };
            })
            .OrderBy(item => item.kind == "kernel" ? 0 : 1)
            .ThenBy(item => item.id, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static object RouteDetail(CatalogRoute route) => new
    {
        method = route.Method,
        path = route.Path,
        description = route.Description,
        parameters = route.Parameters,
        requestBody = route.RequestBody,
        response = route.Response,
        contentTypes = route.ContentTypes,
        auth = route.Auth,
    };

    /// <summary>A plugin's hand-written document when it publishes one at its own /discover.</summary>
    private static string? OwnDocument(IEnumerable<CatalogRoute> routes) => routes
        .FirstOrDefault(route => route.Method == "GET" && !route.Public
            && route.Path.EndsWith("/discover", StringComparison.OrdinalIgnoreCase))?.Path;

    private static CatalogRoute FromEndpoint(
        string method,
        string path,
        RouteEndpoint? endpoint,
        IReadOnlyList<DiscoveryArea> areas,
        IReadOnlyDictionary<string, string> listedBy,
        JsonSerializerOptions options)
    {
        var owner = FindOwner(path, areas);
        var isPublic = owner is { PublicPrefix: { } publicPrefix } && IsUnder(path, publicPrefix);
        var area = owner?.Id
            ?? (listedBy.TryGetValue(Key(method, path), out var capability) ? capability : KernelArea(path));
        if (endpoint is null)
            return new CatalogRoute(method, path, area, Public: isPublic);

        var accepts = endpoint.Metadata.GetMetadata<IAcceptsMetadata>();
        var produces = endpoint.Metadata.OfType<IProducesResponseTypeMetadata>()
            .FirstOrDefault(item => item.StatusCode == StatusCodes.Status200OK && item.Type is not null);
        var contentTypes = accepts?.ContentTypes is { Count: > 0 } types
            && !types.Any(type => type.Contains("json", StringComparison.OrdinalIgnoreCase))
                ? types.ToList()
                : null;

        return new CatalogRoute(
            method,
            path,
            area,
            DescribeEndpoint(endpoint),
            DeriveParameters(endpoint),
            SchemaFor(accepts?.RequestType, options),
            SchemaFor(produces?.Type, options),
            null,
            contentTypes,
            isPublic);
    }

    private static string RawPath(RouteEndpoint endpoint) => "/" + (endpoint.RoutePattern.RawText ?? "").TrimStart('/');

    private static string? DescribeEndpoint(RouteEndpoint endpoint)
    {
        var summary = endpoint.Metadata.GetMetadata<IEndpointSummaryMetadata>()?.Summary;
        var description = endpoint.Metadata.GetMetadata<IEndpointDescriptionMetadata>()?.Description;
        if (!string.IsNullOrWhiteSpace(summary))
            return string.IsNullOrWhiteSpace(description) ? summary : $"{summary} {description}";
        if (!string.IsNullOrWhiteSpace(description)) return description;

        // Without a hand-given name ASP.NET makes one from the route, which says nothing new.
        var name = endpoint.DisplayName;
        return string.IsNullOrWhiteSpace(name) || name.StartsWith("HTTP: ", StringComparison.Ordinal) ? null : name;
    }

    internal static IReadOnlyList<ParameterDescriptor>? DeriveParameters(RouteEndpoint endpoint)
    {
        var parameters = new List<ParameterDescriptor>();
        var routeNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var part in endpoint.RoutePattern.Parameters)
        {
            routeNames.Add(part.Name);
            parameters.Add(new ParameterDescriptor(part.Name, ConstraintType(part), !part.IsOptional, Location: ParamLocation.Path));
        }

        var handler = endpoint.Metadata.GetMetadata<MethodInfo>();
        if (handler is not null)
        {
            foreach (var parameter in handler.GetParameters())
            {
                if (parameter.Name is null || routeNames.Contains(parameter.Name)) continue;
                if (!IsQueryCandidate(parameter)) continue;
                var required = !parameter.HasDefaultValue && !IsNullable(parameter);
                parameters.Add(new ParameterDescriptor(parameter.Name, TypeName(parameter.ParameterType), required, Location: ParamLocation.Query));
            }
        }

        return parameters.Count > 0 ? parameters : null;
    }

    private static bool IsQueryCandidate(ParameterInfo parameter)
    {
        foreach (var attribute in parameter.GetCustomAttributes(inherit: true))
        {
            switch (attribute)
            {
                case FromQueryAttribute: return true;
                case FromBodyAttribute or FromServicesAttribute or FromHeaderAttribute or FromFormAttribute
                    or FromRouteAttribute or AsParametersAttribute or FromKeyedServicesAttribute:
                    return false;
            }
        }

        var type = Nullable.GetUnderlyingType(parameter.ParameterType) ?? parameter.ParameterType;
        if (type.IsArray) type = type.GetElementType()!;
        return type.IsPrimitive || type.IsEnum || type == typeof(string) || type == typeof(decimal)
            || type == typeof(Guid) || type == typeof(DateTime) || type == typeof(DateTimeOffset)
            || type == typeof(DateOnly) || type == typeof(TimeOnly) || type == typeof(Uri);
    }

    private static bool IsNullable(ParameterInfo parameter)
    {
        if (Nullable.GetUnderlyingType(parameter.ParameterType) is not null) return true;
        if (parameter.ParameterType.IsValueType) return false;
        try
        {
            return new NullabilityInfoContext().Create(parameter).WriteState == NullabilityState.Nullable;
        }
        catch (InvalidOperationException)
        {
            return true;
        }
    }

    private static string TypeName(Type type)
    {
        var inner = Nullable.GetUnderlyingType(type) ?? type;
        if (inner.IsArray) return "array";
        if (inner == typeof(bool)) return "boolean";
        if (inner == typeof(int) || inner == typeof(long) || inner == typeof(short) || inner == typeof(byte)) return "integer";
        if (inner == typeof(double) || inner == typeof(float) || inner == typeof(decimal)) return "number";
        return "string";
    }

    private static string ConstraintType(RoutePatternParameterPart part)
    {
        foreach (var policy in part.ParameterPolicies)
        {
            switch (policy.Content)
            {
                case "int" or "long": return "integer";
                case "bool": return "boolean";
                case "guid": return "guid";
            }
        }
        return "string";
    }

    internal static JsonNode? SchemaFor(Type? type, JsonSerializerOptions options)
    {
        if (type is null || !IsDescribableBody(type)) return null;
        return SchemaCache.GetOrAdd(type, candidate =>
        {
            try
            {
                var schema = JsonSchemaExporter.GetJsonSchemaAsNode(ForSchema(options), candidate,
                    new JsonSchemaExporterOptions { TreatNullObliviousAsNonNullable = true });
                DropNullableFromRequired(schema);
                return schema;
            }
            catch (Exception ex) when (ex is InvalidOperationException or NotSupportedException or ArgumentException)
            {
                return null;
            }
        });
    }

    private static JsonSerializerOptions ForSchema(JsonSerializerOptions options)
    {
        if (options.TypeInfoResolver is not null && options.IsReadOnly) return options;
        return new JsonSerializerOptions(options)
        {
            TypeInfoResolver = options.TypeInfoResolver ?? new DefaultJsonTypeInfoResolver(),
        };
    }

    private static bool IsDescribableBody(Type type)
    {
        if (type == typeof(object) || type == typeof(string) || type == typeof(Stream) || type == typeof(PipeReader))
            return false;
        if (typeof(IResult).IsAssignableFrom(type) || typeof(JsonNode).IsAssignableFrom(type)) return false;
        if (type == typeof(JsonElement) || type == typeof(JsonDocument) || type == typeof(IFormFile)
            || type == typeof(IFormFileCollection) || type == typeof(IFormCollection))
            return false;
        return true;
    }

    /// <summary>
    /// The exporter lists every constructor parameter of a record as required, including nullable
    /// ones the handler treats as optional. Callers would believe those fields are mandatory.
    /// </summary>
    internal static void DropNullableFromRequired(JsonNode? node)
    {
        switch (node)
        {
            case JsonArray array:
                foreach (var item in array) DropNullableFromRequired(item);
                break;
            case JsonObject schema:
                if (schema["required"] is JsonArray required && schema["properties"] is JsonObject properties)
                {
                    var kept = required
                        .Select(item => item?.GetValue<string>())
                        .Where(name => name is not null && !AllowsNull(properties[name]))
                        .ToList();
                    if (kept.Count == 0) schema.Remove("required");
                    else
                    {
                        required.Clear();
                        foreach (var name in kept) required.Add(name);
                    }
                }
                foreach (var (_, child) in schema) DropNullableFromRequired(child);
                break;
        }
    }

    private static bool AllowsNull(JsonNode? property) =>
        property?["type"] is JsonArray types && types.Any(type => type?.GetValue<string>() == "null");

    private static DiscoveryArea? FindOwner(string path, IReadOnlyList<DiscoveryArea> areas) =>
        areas.FirstOrDefault(area => IsUnder(path, area.RoutePrefix)
            || (area.PublicPrefix is { } publicPrefix && IsUnder(path, publicPrefix)));

    private static bool IsUnder(string path, string prefix) =>
        path.Equals(prefix, StringComparison.OrdinalIgnoreCase)
        || path.StartsWith(prefix + "/", StringComparison.OrdinalIgnoreCase);

    private static string KernelArea(string path)
    {
        var segments = path.Trim('/').Split('/');
        var first = segments[0] == "api" && segments.Length > 1 ? segments[1] : segments[0];
        return first.Length > 0 ? first : "root";
    }

    private static string Key(string method, string path) => method.ToUpperInvariant() + " " + StripConstraints(path);

    internal static string StripConstraints(string path)
    {
        var builder = new System.Text.StringBuilder(path.Length);
        var skipping = false;
        foreach (var character in path)
        {
            if (character == ':' && builder.Length > 0 && !skipping && InsideParameter(builder)) skipping = true;
            else if (character == '}') { skipping = false; builder.Append(character); }
            else if (!skipping) builder.Append(character);
        }
        return builder.ToString();
    }

    private static bool InsideParameter(System.Text.StringBuilder builder)
    {
        for (var index = builder.Length - 1; index >= 0; index--)
        {
            if (builder[index] == '{') return true;
            if (builder[index] == '}') return false;
        }
        return false;
    }

    private enum ShapeMatch { None, Full, BadValue }

    private static ShapeMatch MatchShape(string routePath, string[] segments)
    {
        var parts = routePath.Trim('/').Split('/');
        var badValue = false;
        for (var index = 0; index < parts.Length; index++)
        {
            var part = parts[index];
            if (part.StartsWith("{**", StringComparison.Ordinal) || part.StartsWith("{*", StringComparison.Ordinal))
                return badValue ? ShapeMatch.BadValue : ShapeMatch.Full;
            if (index >= segments.Length)
                return part.EndsWith("?}", StringComparison.Ordinal) ? (badValue ? ShapeMatch.BadValue : ShapeMatch.Full) : ShapeMatch.None;

            if (part.StartsWith('{') && part.EndsWith('}'))
            {
                if (!ValueFits(part, segments[index])) badValue = true;
            }
            else if (!string.Equals(part, segments[index], StringComparison.OrdinalIgnoreCase))
            {
                return ShapeMatch.None;
            }
        }
        if (segments.Length != parts.Length) return ShapeMatch.None;
        return badValue ? ShapeMatch.BadValue : ShapeMatch.Full;
    }

    private static bool ValueFits(string part, string value)
    {
        if (part.Contains(":guid", StringComparison.Ordinal)) return Guid.TryParse(value, out _);
        if (part.Contains(":int", StringComparison.Ordinal)) return int.TryParse(value, out _);
        if (part.Contains(":long", StringComparison.Ordinal)) return long.TryParse(value, out _);
        if (part.Contains(":bool", StringComparison.Ordinal)) return bool.TryParse(value, out _);
        return true;
    }

    private (int Matched, int Weight) ScoreRoute(CatalogRoute route, IReadOnlyList<string> words)
    {
        var pathWords = WordsOf(route.CleanPath);
        var descriptionWords = route.Description is null ? [] : WordsOf(route.Description);
        var areaWords = WordsOf(route.Area);
        var owner = Areas.FirstOrDefault(area => string.Equals(area.Id, route.Area, StringComparison.OrdinalIgnoreCase));
        if (owner is not null)
        {
            areaWords.UnionWith(WordsOf(owner.Name));
            foreach (var concept in owner.Concepts ?? []) areaWords.UnionWith(WordsOf(concept.Type));
        }

        var matched = 0;
        var weight = 0;
        foreach (var word in words)
        {
            var hit = 0;
            if (pathWords.Contains(word)) hit += 4;
            if (areaWords.Contains(word)) hit += 2;
            if (descriptionWords.Contains(word)) hit += 1;
            if (string.Equals(route.Method, word, StringComparison.OrdinalIgnoreCase)) hit += 2;
            if (hit > 0) matched++;
            weight += hit;
        }
        return (matched, weight);
    }

    private static List<string> QueryWords(string? query) =>
        string.IsNullOrWhiteSpace(query)
            ? []
            : WordsOf(query).Where(word => !Stopwords.Contains(word)).ToList();

    private static HashSet<string> WordsOf(string text)
    {
        var words = new HashSet<string>(StringComparer.Ordinal);
        var current = new System.Text.StringBuilder();
        void Flush()
        {
            if (current.Length == 0) return;
            words.Add(Stem(current.ToString()));
            current.Clear();
        }

        for (var index = 0; index < text.Length; index++)
        {
            var character = text[index];
            if (!char.IsLetterOrDigit(character)) { Flush(); continue; }
            if (char.IsUpper(character) && index > 0 && char.IsLower(text[index - 1])) Flush();
            current.Append(char.ToLowerInvariant(character));
        }
        Flush();
        return words;
    }

    private static string Stem(string word)
    {
        if (word.Length > 4 && word.EndsWith("ies", StringComparison.Ordinal)) return word[..^3] + "y";
        if (word.Length > 3 && word.EndsWith('s') && !word.EndsWith("ss", StringComparison.Ordinal)) return word[..^1];
        return word;
    }

    private static string? FirstSentence(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var end = text.IndexOf(". ", StringComparison.Ordinal);
        var sentence = end > 0 ? text[..(end + 1)] : text;
        return sentence.Length <= 160 ? sentence : sentence[..157] + "...";
    }

    private static string? NullIfEmpty(string? text) => string.IsNullOrWhiteSpace(text) ? null : text;
    private static int? NullIfZero(int value) => value == 0 ? null : value;

    internal static JsonSerializerOptions? HttpOptions(IServiceProvider services) =>
        services.GetService<IOptions<HttpJsonOptions>>()?.Value.SerializerOptions;
}

public sealed record RouteMiss(
    IReadOnlyList<string> Allowed,
    CatalogRoute? BadValue,
    string? Area,
    IReadOnlyList<CatalogRoute> Closest,
    string Find);

/// <summary>Holds the catalog for one running service, rebuilt shortly after routes or capabilities change.</summary>
public sealed class DiscoveryCatalogProvider(
    IEndpointRouteBuilder routes,
    IServiceDescriptor descriptor)
{
    private static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(30);
    private readonly SemaphoreSlim _gate = new(1, 1);
    private volatile DiscoveryCatalog? _catalog;
    private DateTime _builtAt;

    /// <summary>
    /// Only the first call waits for a build, which takes a couple of seconds. After that a caller gets
    /// the current catalog at once and an old one is rebuilt behind them, since routes rarely change.
    /// </summary>
    public async Task<DiscoveryCatalog> GetAsync()
    {
        if (_catalog is { } current)
        {
            if (DateTime.UtcNow - _builtAt >= Lifetime) _ = Task.Run(RefreshAsync);
            return current;
        }

        await _gate.WaitAsync();
        try
        {
            return _catalog ?? await BuildAsync();
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task RefreshAsync()
    {
        if (!await _gate.WaitAsync(0)) return;
        try
        {
            await BuildAsync();
        }
        catch
        {
            // Keep serving the last good catalog; the next caller tries again.
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task<DiscoveryCatalog> BuildAsync()
    {
        var capabilities = await descriptor.GetCapabilitiesAsync();
        var areas = await descriptor.GetAreasAsync();
        var catalog = DiscoveryCatalog.Build(routes.DataSources, descriptor.GetAppEndpoints(), capabilities, areas,
            DiscoveryCatalog.HttpOptions(routes.ServiceProvider));
        _builtAt = DateTime.UtcNow;
        _catalog = catalog;
        return catalog;
    }
}
