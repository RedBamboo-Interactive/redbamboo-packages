using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using Google.Apis.Auth;

namespace RedBamboo.AppHost.Auth;

public sealed class GoogleAuthProvider : IAuthProvider
{
    private readonly GoogleAuthOptions _options;
    private readonly HttpClient _httpClient;

    public GoogleAuthProvider(GoogleAuthOptions options, HttpClient httpClient)
    {
        _options = options;
        _httpClient = httpClient;
    }

    public string Name => "google";

    public string GetAuthorizeUrl(string redirectUri, string state)
    {
        var scopes = new List<string>
        {
            "openid email profile",
            "https://www.googleapis.com/auth/calendar.readonly",
            "https://www.googleapis.com/auth/fitness.activity.read"
        };
        scopes.AddRange(_options.ExtraScopes);

        var query = string.Join("&",
            $"client_id={Uri.EscapeDataString(_options.ClientId)}",
            $"redirect_uri={Uri.EscapeDataString(redirectUri)}",
            $"response_type=code",
            $"scope={Uri.EscapeDataString(string.Join(" ", scopes))}",
            $"access_type=offline",
            $"prompt=consent",
            $"state={Uri.EscapeDataString(state)}"
        );
        return $"https://accounts.google.com/o/oauth2/v2/auth?{query}";
    }

    public async Task<ExternalIdentity> ExchangeCodeAsync(string code, string redirectUri)
    {
        var payload = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["code"] = code,
            ["client_id"] = _options.ClientId,
            ["client_secret"] = _options.ClientSecret,
            ["redirect_uri"] = redirectUri,
            ["grant_type"] = "authorization_code"
        });

        var response = await _httpClient.PostAsync("https://oauth2.googleapis.com/token", payload);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        var idToken = json.GetProperty("id_token").GetString()
            ?? throw new InvalidOperationException("No id_token in token response");

        var validationSettings = new GoogleJsonWebSignature.ValidationSettings
        {
            Audience = [_options.ClientId]
        };
        var googlePayload = await GoogleJsonWebSignature.ValidateAsync(idToken, validationSettings);

        var accessToken = json.TryGetProperty("access_token", out var at) ? at.GetString() : null;
        var refreshToken = json.TryGetProperty("refresh_token", out var rt) ? rt.GetString() : null;
        var expiresIn = json.TryGetProperty("expires_in", out var ei) ? ei.GetInt32() : 3600;

        return new ExternalIdentity(
            ProviderId: googlePayload.Subject,
            Email: googlePayload.Email,
            Name: googlePayload.Name,
            AvatarUrl: googlePayload.Picture,
            Provider: Name,
            AccessToken: accessToken,
            RefreshToken: refreshToken,
            ExpiresIn: expiresIn
        );
    }
}
