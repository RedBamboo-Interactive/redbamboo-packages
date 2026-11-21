using System.Collections.Concurrent;

namespace RedBamboo.AppHost.Auth;

public sealed class InMemoryRefreshTokenStore : IRefreshTokenStore
{
    private readonly ConcurrentDictionary<string, TokenEntry> _tokens = new();
    private int _operationCount;

    private sealed record TokenEntry(string Id, string UserId, DateTimeOffset ExpiresAt, string? FamilyId)
    {
        public DateTimeOffset? RotatedAt { get; init; }
        public string? ReplacedByHash { get; init; }
    }

    /// <summary>Rows currently held, rotated ones included (tests).</summary>
    internal int Count => _tokens.Count;

    public Task StoreAsync(string token, string userId, DateTimeOffset expiresAt)
        => StoreAsync(token, userId, expiresAt, null);

    public Task StoreAsync(string token, string userId, DateTimeOffset expiresAt, string? familyId)
    {
        _tokens[token] = new TokenEntry(Guid.NewGuid().ToString(), userId, expiresAt, familyId);
        if (Interlocked.Increment(ref _operationCount) % 100 == 0)
            CleanupExpired();
        return Task.CompletedTask;
    }

    public async Task<RefreshTokenValidation?> ValidateAsync(string token)
        => await FindAsync(token) is { RotatedAt: null } live ? live : null;

    public Task<RefreshTokenValidation?> FindAsync(string token)
    {
        if (_tokens.TryGetValue(token, out var entry))
        {
            if (entry.ExpiresAt > DateTimeOffset.UtcNow)
                return Task.FromResult<RefreshTokenValidation?>(new RefreshTokenValidation(entry.UserId, entry.Id)
                {
                    FamilyId = entry.FamilyId,
                    RotatedAt = entry.RotatedAt,
                });

            _tokens.TryRemove(token, out _);
        }

        return Task.FromResult<RefreshTokenValidation?>(null);
    }

    public Task MarkRotatedAsync(string entityId, string replacedByHash, DateTimeOffset rotatedAt)
    {
        foreach (var kvp in _tokens)
        {
            if (kvp.Value.Id != entityId) continue;
            _tokens[kvp.Key] = kvp.Value with { RotatedAt = rotatedAt, ReplacedByHash = replacedByHash };
            break;
        }
        return Task.CompletedTask;
    }

    public Task RevokeByIdAsync(string entityId)
    {
        foreach (var kvp in _tokens)
        {
            if (kvp.Value.Id == entityId)
            {
                _tokens.TryRemove(kvp.Key, out _);
                break;
            }
        }
        return Task.CompletedTask;
    }

    public Task RevokeByTokenAsync(string token)
    {
        _tokens.TryRemove(token, out _);
        return Task.CompletedTask;
    }

    public Task RevokeFamilyAsync(string familyId)
    {
        foreach (var kvp in _tokens)
        {
            if (string.Equals(kvp.Value.FamilyId, familyId, StringComparison.Ordinal))
                _tokens.TryRemove(kvp.Key, out _);
        }
        return Task.CompletedTask;
    }

    public Task RevokeAllForUserAsync(string userId)
    {
        foreach (var kvp in _tokens)
        {
            if (kvp.Value.UserId == userId)
                _tokens.TryRemove(kvp.Key, out _);
        }

        return Task.CompletedTask;
    }

    private void CleanupExpired()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var kvp in _tokens)
        {
            if (kvp.Value.ExpiresAt <= now)
                _tokens.TryRemove(kvp.Key, out _);
        }
    }
}
