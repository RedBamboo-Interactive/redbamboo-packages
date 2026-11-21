using System.Collections.Concurrent;

namespace RedBamboo.AppHost.Auth;

public sealed class InMemoryRefreshTokenStore : IRefreshTokenStore
{
    // Keyed by token hash, as a persistent store would be.
    private readonly ConcurrentDictionary<string, TokenEntry> _tokens = new();
    private readonly TimeProvider _clock;

    private sealed record TokenEntry(string Id, string UserId, DateTimeOffset ExpiresAt, string? FamilyId)
    {
        public DateTimeOffset? RotatedAt { get; init; }
        public string? ReplacedByHash { get; init; }
    }

    public InMemoryRefreshTokenStore() : this(TimeProvider.System)
    {
    }

    internal InMemoryRefreshTokenStore(TimeProvider clock)
    {
        _clock = clock;
    }

    /// <summary>Rows currently held, rotated ones included (tests).</summary>
    internal int Count => _tokens.Count;

    public Task StoreAsync(string token, string userId, DateTimeOffset expiresAt)
        => StoreAsync(token, userId, expiresAt, null);

    public Task StoreAsync(string token, string userId, DateTimeOffset expiresAt, string? familyId)
    {
        _tokens[RefreshTokenHash.Of(token)] = new TokenEntry(Guid.NewGuid().ToString(), userId, expiresAt, familyId);
        Prune();
        return Task.CompletedTask;
    }

    public async Task<RefreshTokenValidation?> ValidateAsync(string token)
        => await FindAsync(token) is { RotatedAt: null } live ? live : null;

    public Task<RefreshTokenValidation?> FindAsync(string token) => FindByHashAsync(RefreshTokenHash.Of(token));

    public Task<RefreshTokenValidation?> FindByHashAsync(string tokenHash)
    {
        if (_tokens.TryGetValue(tokenHash, out var entry))
        {
            if (entry.ExpiresAt > _clock.GetUtcNow())
                return Task.FromResult<RefreshTokenValidation?>(new RefreshTokenValidation(entry.UserId, entry.Id)
                {
                    FamilyId = entry.FamilyId,
                    RotatedAt = entry.RotatedAt,
                    ReplacedByHash = entry.ReplacedByHash,
                });

            _tokens.TryRemove(tokenHash, out _);
        }

        return Task.FromResult<RefreshTokenValidation?>(null);
    }

    public Task<RotationMark> MarkRotatedAsync(string entityId, string replacedByHash, DateTimeOffset rotatedAt,
        string? familyId = null)
    {
        foreach (var kvp in _tokens)
        {
            if (kvp.Value.Id != entityId) continue;
            var marked = kvp.Value with
            {
                RotatedAt = rotatedAt,
                ReplacedByHash = replacedByHash,
                FamilyId = familyId ?? kvp.Value.FamilyId,
            };
            // Only over the row as it was read: a row revoked meanwhile stays revoked.
            return Task.FromResult(_tokens.TryUpdate(kvp.Key, marked, kvp.Value) ? RotationMark.Marked : RotationMark.Missing);
        }
        return Task.FromResult(RotationMark.Missing);
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
        _tokens.TryRemove(RefreshTokenHash.Of(token), out _);
        return Task.CompletedTask;
    }

    public Task<bool> RevokeFamilyAsync(string familyId)
    {
        foreach (var kvp in _tokens)
        {
            if (string.Equals(kvp.Value.FamilyId, familyId, StringComparison.Ordinal))
                _tokens.TryRemove(kvp.Key, out _);
        }
        return Task.FromResult(true);
    }

    public Task<bool> RevokeAllForUserAsync(string userId)
    {
        foreach (var kvp in _tokens)
        {
            if (kvp.Value.UserId == userId)
                _tokens.TryRemove(kvp.Key, out _);
        }

        return Task.FromResult(true);
    }

    /// <summary>Deletes up to <see cref="RefreshTokenRetention.PrunePerStore"/> expired or long-rotated rows.</summary>
    private void Prune()
    {
        var now = _clock.GetUtcNow();
        var rotatedBefore = now - RefreshTokenRetention.RotatedKeptFor;
        var budget = RefreshTokenRetention.PrunePerStore;
        foreach (var kvp in _tokens)
        {
            if (budget == 0) break;
            var dead = kvp.Value.ExpiresAt <= now || kvp.Value.RotatedAt < rotatedBefore;
            if (dead && _tokens.TryRemove(kvp.Key, out _)) budget--;
        }
    }
}
