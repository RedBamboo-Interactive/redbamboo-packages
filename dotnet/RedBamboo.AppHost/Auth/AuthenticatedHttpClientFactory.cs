using System.Net.Http;

namespace RedBamboo.AppHost.Auth;

public sealed class AuthenticatedHttpClientFactory
{
    private readonly JwtService _jwtService;
    private readonly List<HttpClient> _clients = [];
    private readonly object _lock = new();
    private string? _currentUserId;
    private string? _currentToken;

    public AuthenticatedHttpClientFactory(JwtService jwtService)
    {
        _jwtService = jwtService;
    }

    public HttpClient CreateClient(string baseAddress, TimeSpan? timeout = null)
    {
        var client = new HttpClient
        {
            BaseAddress = new Uri(baseAddress),
            Timeout = timeout ?? TimeSpan.FromSeconds(30),
        };

        lock (_lock)
        {
            if (_currentToken is not null)
                ApplyToken(client, _currentToken);
            _clients.Add(client);
        }

        return client;
    }

    public void OnUserAuthenticated(string userId, string email, string? name)
    {
        lock (_lock)
        {
            if (userId == _currentUserId) return;
            _currentUserId = userId;
            _currentToken = _jwtService.GenerateAccessToken(userId, email, name, ["admin"]);
            foreach (var client in _clients)
                ApplyToken(client, _currentToken);
        }
    }

    public string? CurrentToken
    {
        get { lock (_lock) return _currentToken; }
    }

    private static void ApplyToken(HttpClient client, string token)
    {
        client.DefaultRequestHeaders.Remove("Authorization");
        client.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", $"Bearer {token}");
    }
}
