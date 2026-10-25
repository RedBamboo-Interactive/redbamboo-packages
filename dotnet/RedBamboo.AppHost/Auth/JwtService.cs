using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.IdentityModel.Tokens;
using RedBamboo.AppHost.Auth.Vault;

namespace RedBamboo.AppHost.Auth;

public sealed class JwtService
{
    private readonly JwtOptions _options;
    private readonly SymmetricSecurityKey? _signingKey;
    private readonly VaultBadgeAuthority? _vault;

    /// <summary>
    /// Legacy mode (no <see cref="JwtOptions.Vault"/>): HS256 with the shared key, exactly as before.
    /// Vault mode: every badge is signed by Leaf Vault (ES256) and verified against its public keys;
    /// this process holds no signing key and no HS256 or unsigned badge is ever accepted.
    /// </summary>
    public JwtService(JwtOptions options)
    {
        _options = options;
        _vault = options.Vault;
        if (_vault is null)
        {
            if (string.IsNullOrEmpty(options.SigningKey))
                throw new ArgumentException("A signing key is required when Leaf Vault signs no badges.", nameof(options));
            _signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(options.SigningKey));
        }
    }

    public bool IsVaultMode => _vault is not null;

    /// <summary>Null in legacy mode. In vault mode: whether the vault is answering, in plain words.</summary>
    public VaultBadgeStatus? VaultStatus => _vault?.Status;

    public VaultBadgeAuthority? VaultAuthority => _vault;

    /// <summary>How long a browser login badge lasts: one hour in vault mode, the old access lifetime otherwise.</summary>
    public TimeSpan BrowserAccessTokenLifetime
        => _vault is null ? _options.AccessTokenLifetime : _options.BrowserAccessTokenLifetime;

    /// <summary>
    /// A user-identity badge for the suite's own processes (service-to-service calls made on a user's
    /// or the system's behalf). In vault mode it is <c>net: local</c> and is refused on any request that
    /// arrives through the tunnel. Use <see cref="GenerateBrowserAccessToken"/> for a login.
    /// </summary>
    public string GenerateAccessToken(string userId, string email, string? name, string[] roles, string? avatarUrl = null)
    {
        if (_vault is not null)
            return _vault.SignCached(UserClaims(userId, email, name, roles, avatarUrl), BadgeNet.Local, _options.AccessTokenLifetime);

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
    /// A badge for a person logging in from a browser. Vault mode: <c>net: remote</c>, lasting
    /// <see cref="JwtOptions.BrowserAccessTokenLifetime"/> (the vault caps remote badges at an hour),
    /// renewed by the rotating refresh cookie. Legacy mode: identical to <see cref="GenerateAccessToken"/>.
    /// </summary>
    public string GenerateBrowserAccessToken(string userId, string email, string? name, string[] roles, string? avatarUrl = null)
        => _vault is null
            ? GenerateAccessToken(userId, email, name, roles, avatarUrl)
            : _vault.Sign(UserClaims(userId, email, name, roles, avatarUrl), BadgeNet.Remote, _options.BrowserAccessTokenLifetime);

    private Dictionary<string, object?> BaseClaims(string sub) => new()
    {
        [JwtRegisteredClaimNames.Iss] = _options.Issuer,
        [JwtRegisteredClaimNames.Aud] = _options.Audience,
        [JwtRegisteredClaimNames.Sub] = sub,
    };

    private Dictionary<string, object?> UserClaims(string userId, string email, string? name, string[] roles, string? avatarUrl)
    {
        var claims = BaseClaims(userId);
        claims[JwtRegisteredClaimNames.Email] = email;
        claims["roles"] = roles;
        if (name is not null) claims[JwtRegisteredClaimNames.Name] = name;
        if (avatarUrl is not null) claims["picture"] = avatarUrl;
        return claims;
    }

    /// <summary>
    /// Mint a narrowly identified suite-service token. Delegation and verified provenance are
    /// explicit claims so loopback location alone never grants either trust boundary.
    /// </summary>
    public string GenerateServiceAccessToken(string serviceId, bool computeProvenance = false,
        bool computeDelegateUser = false, string[]? roles = null)
    {
        if (_vault is not null)
        {
            var vaultClaims = BaseClaims($"service:{serviceId}");
            vaultClaims[JwtRegisteredClaimNames.Email] = $"{serviceId}@redsuite";
            vaultClaims[JwtRegisteredClaimNames.Name] = serviceId;
            vaultClaims["roles"] = roles ?? ["service"];
            vaultClaims["client_id"] = serviceId;
            vaultClaims["compute_provenance"] = computeProvenance ? "true" : "false";
            vaultClaims["compute_delegate_user"] = computeDelegateUser ? "true" : "false";
            return _vault.SignCached(vaultClaims, BadgeNet.Local, _options.AccessTokenLifetime);
        }

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, $"service:{serviceId}"),
            new(JwtRegisteredClaimNames.Email, $"{serviceId}@redsuite"),
            new(JwtRegisteredClaimNames.Name, serviceId),
            new("roles", JsonSerializer.Serialize(roles ?? ["service"]), JsonClaimValueTypes.JsonArray),
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

        if (_vault is not null)
        {
            var vaultClaims = BaseClaims(principal.SubjectId);
            vaultClaims[JwtRegisteredClaimNames.Email] = principal.Email;
            vaultClaims["roles"] = principal.Roles;
            vaultClaims[JwtRegisteredClaimNames.Jti] = identity.ExecutionId;
            vaultClaims[ExecutionIdentityClaims.TokenUseClaim] = ExecutionIdentityClaims.TokenUse;
            using (var identityJson = JsonDocument.Parse(ExecutionIdentityClaims.Serialize(identity)))
                vaultClaims[ExecutionIdentityClaims.IdentityClaim] = identityJson.RootElement.Clone();
            vaultClaims["client_id"] = identity.App.Id;
            if (principal.Name is not null) vaultClaims[JwtRegisteredClaimNames.Name] = principal.Name;
            if (principal.Avatar is not null) vaultClaims["picture"] = principal.Avatar;
            // Execution and session-execution badges only ever travel between local processes.
            return _vault.Sign(vaultClaims, BadgeNet.Local, expiresAt - DateTimeOffset.UtcNow);
        }

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
        => _vault is null ? ValidateLegacy(token) : ValidateVault(token);

    private ClaimsPrincipal? ValidateVault(string token)
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
            RequireExpirationTime = true,
            RequireSignedTokens = true,
            ValidateIssuerSigningKey = true,
            // Pinned: only the vault's ES256 keys. HS256 (the retired shared key) and "none" never verify.
            ValidAlgorithms = [SecurityAlgorithms.EcdsaSha256],
            IssuerSigningKeyResolver = (_, _, kid, _) => _vault!.ResolveKeys(kid),
            ClockSkew = _options.ClockSkew,
        };

        try
        {
            var principal = handler.ValidateToken(token, parameters, out _);
            // The vault stamps net on every badge it signs; one without it is not one of ours.
            return BadgeNet.IsValid(principal.FindFirst(BadgeNet.Claim)?.Value) ? principal : null;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Sign and verify a throwaway badge to prove vault mode works end to end in this process.
    /// Never returns or logs the badge.
    /// </summary>
    public bool SelfTestVault()
    {
        if (_vault is null) return false;
        try
        {
            var claims = BaseClaims("probe:m1");
            claims["roles"] = Array.Empty<string>();
            var token = _vault.Sign(claims, BadgeNet.Local, TimeSpan.FromSeconds(60));
            return ValidateVault(token)?.FindFirst(JwtRegisteredClaimNames.Sub)?.Value == "probe:m1";
        }
        catch (VaultUnavailableException)
        {
            return false;
        }
    }

    private ClaimsPrincipal? ValidateLegacy(string token)
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
