using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.IdentityModel.Tokens;

namespace RedBamboo.AppHost.Auth;

public sealed class JwtService
{
    private readonly JwtOptions _options;
    private readonly SymmetricSecurityKey _signingKey;

    public JwtService(JwtOptions options)
    {
        _options = options;
        _signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(options.SigningKey));
    }

    public string GenerateAccessToken(string userId, string email, string? name, string[] roles, string? avatarUrl = null)
    {
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, userId),
            new(JwtRegisteredClaimNames.Email, email),
            new("roles", JsonSerializer.Serialize(roles), JsonClaimValueTypes.JsonArray)
        };

        if (name is not null)
            claims.Add(new(JwtRegisteredClaimNames.Name, name));

        if (avatarUrl is not null)
            claims.Add(new("picture", avatarUrl));

        var credentials = new SigningCredentials(_signingKey, SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer: _options.Issuer,
            audience: _options.Audience,
            claims: claims,
            notBefore: DateTime.UtcNow,
            expires: DateTime.UtcNow.Add(_options.AccessTokenLifetime),
            signingCredentials: credentials
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    /// <summary>
    /// Mint a narrowly identified suite-service token. Delegation and verified provenance are
    /// explicit claims so loopback location alone never grants either trust boundary.
    /// </summary>
    public string GenerateServiceAccessToken(string serviceId, bool computeProvenance = false,
        bool computeDelegateUser = false)
    {
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, $"service:{serviceId}"),
            new(JwtRegisteredClaimNames.Email, $"{serviceId}@redsuite"),
            new(JwtRegisteredClaimNames.Name, serviceId),
            new("roles", JsonSerializer.Serialize(new[] { "service" }), JsonClaimValueTypes.JsonArray),
            new("client_id", serviceId),
            new("compute_provenance", computeProvenance ? "true" : "false"),
            new("compute_delegate_user", computeDelegateUser ? "true" : "false"),
        };

        var credentials = new SigningCredentials(_signingKey, SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer: _options.Issuer,
            audience: _options.Audience,
            claims: claims,
            notBefore: DateTime.UtcNow,
            expires: DateTime.UtcNow.Add(_options.AccessTokenLifetime),
            signingCredentials: credentials);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public string GenerateExecutionToken(
        ExecutionIdentity identity,
        ExecutionPrincipal principal,
        DateTimeOffset expiresAt)
    {
        identity.Validate(principal.SubjectId);
        if (expiresAt <= DateTimeOffset.UtcNow)
            throw new ExecutionIdentityValidationException("execution token expiry must be in the future");

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, principal.SubjectId),
            new(JwtRegisteredClaimNames.Email, principal.Email),
            new("roles", JsonSerializer.Serialize(principal.Roles), JsonClaimValueTypes.JsonArray),
            new(JwtRegisteredClaimNames.Jti, identity.ExecutionId),
            new(ExecutionIdentityClaims.TokenUseClaim, ExecutionIdentityClaims.TokenUse),
            new(ExecutionIdentityClaims.IdentityClaim,
                ExecutionIdentityClaims.Serialize(identity), JsonClaimValueTypes.Json),
            new("client_id", identity.App.Id),
        };

        if (principal.Name is not null)
            claims.Add(new Claim(JwtRegisteredClaimNames.Name, principal.Name));
        if (principal.Avatar is not null)
            claims.Add(new Claim("picture", principal.Avatar));

        var credentials = new SigningCredentials(_signingKey, SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer: _options.Issuer,
            audience: _options.Audience,
            claims: claims,
            notBefore: DateTime.UtcNow,
            expires: expiresAt.UtcDateTime,
            signingCredentials: credentials);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public string GenerateRefreshToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        return Convert.ToHexStringLower(bytes);
    }

    public ClaimsPrincipal? ValidateToken(string token)
    {
        var handler = new JwtSecurityTokenHandler();
        handler.InboundClaimTypeMap.Clear();
        var parameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = _options.Issuer,
            ValidateAudience = true,
            ValidAudience = _options.Audience,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = _signingKey,
            ClockSkew = _options.ClockSkew
        };

        try
        {
            return handler.ValidateToken(token, parameters, out _);
        }
        catch
        {
            return null;
        }
    }
}
