using System.Collections.Concurrent;

namespace RedBamboo.AppHost.Auth;

public sealed class InMemoryRefreshTokenStore : IRefreshTokenStore
{
    private readonly ConcurrentDictionary<string, TokenEntry> _tokens = new();
    private int _operationCount;

    private record TokenEntry(string Id, string UserId, DateTimeOffset ExpiresAt);

    public Task StoreAsync(string token, string userId, DateTimeOffset expiresAt)
    {
        _tokens[token] = new TokenEntry(Guid.NewGuid().ToString(), userId, expiresAt);
        if (Interlocked.Increment(ref _operationCount) % 100 == 0)
            CleanupExpired();
        return Task.CompletedTask;
    }

    public Task<RefreshTokenValidation?> ValidateAsync(string token)
    {
        if (_tokens.TryGetValue(token, out var entry))
        {
            if (entry.ExpiresAt > DateTimeOffset.UtcNow)
                return Task.FromResult<RefreshTokenValidation?>(new RefreshTokenValidation(entry.UserId, entry.Id));

            _tokens.TryRemove(token, out _);
        }

        return Task.FromResult<RefreshTokenValidation?>(null);
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
