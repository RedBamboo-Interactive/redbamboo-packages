using System.Collections.Concurrent;

namespace RedBamboo.AppHost.Auth;

public sealed class InMemoryUserStore : IUserStore
{
    private readonly ConcurrentDictionary<string, AuthUser> _usersById = new();
    private readonly ConcurrentDictionary<string, string> _providerIndex = new();

    private static string ProviderKey(string provider, string providerId) =>
        $"{provider}:{providerId}";

    public Task<AuthUser?> FindByProviderAsync(string provider, string providerId)
    {
        if (_providerIndex.TryGetValue(ProviderKey(provider, providerId), out var userId) &&
            _usersById.TryGetValue(userId, out var user))
            return Task.FromResult<AuthUser?>(user);

        return Task.FromResult<AuthUser?>(null);
    }

    public Task<AuthUser?> FindByIdAsync(string id)
    {
        _usersById.TryGetValue(id, out var user);
        return Task.FromResult(user);
    }

    public Task<AuthUser> CreateOrUpdateFromExternalAsync(ExternalIdentity identity)
    {
        var key = ProviderKey(identity.Provider, identity.ProviderId);

        if (_providerIndex.TryGetValue(key, out var existingId) &&
            _usersById.TryGetValue(existingId, out var existing))
        {
            var updated = existing with
            {
                Email = identity.Email,
                Name = identity.Name,
                AvatarUrl = identity.AvatarUrl
            };
            _usersById[existingId] = updated;
            return Task.FromResult(updated);
        }

        var id = Guid.NewGuid().ToString();
        var user = new AuthUser(id, identity.Email, identity.Name, identity.AvatarUrl, ["admin"]);
        _usersById[id] = user;
        _providerIndex[key] = id;
        return Task.FromResult(user);
    }
}
