using System.Collections.Concurrent;

namespace RedBamboo.AppHost.Auth;

public sealed class InMemoryRefreshTokenStore : IRefreshTokenStore
{
    private readonly ConcurrentDictionary<string, TokenEntry> _tokens = new();

    private record TokenEntry(string UserId, DateTimeOffset ExpiresAt);

    public Task StoreAsync(string token, string userId, DateTimeOffset expiresAt)
    {
        _tokens[token] = new TokenEntry(userId, expiresAt);
        return Task.CompletedTask;
    }

    public Task<string?> ValidateAndGetUserIdAsync(string token)
    {
        if (_tokens.TryGetValue(token, out var entry))
        {
            if (entry.ExpiresAt > DateTimeOffset.UtcNow)
                return Task.FromResult<string?>(entry.UserId);

            _tokens.TryRemove(token, out _);
        }

        return Task.FromResult<string?>(null);
    }

    public Task RevokeAsync(string token)
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
}
