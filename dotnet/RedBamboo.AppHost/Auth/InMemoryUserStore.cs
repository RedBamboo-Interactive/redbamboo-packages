using System.Collections.Concurrent;

namespace RedBamboo.AppHost.Auth;

/// <summary>
/// Process-local user store with the same fail-closed sign-in rule as <see cref="RedLeafUserStore"/>:
/// known accounts sign in while active, the very first one may be created when the caller allows the
/// first-user setup, and everyone else is refused.
/// </summary>
public sealed class InMemoryUserStore : IUserStore
{
    private readonly ConcurrentDictionary<string, AuthUser> _usersById = new();
    private readonly ConcurrentDictionary<string, string> _providerIndex = new();
    private readonly object _gate = new();

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

    /// <summary>Sets an account's status, as an administrator would on the user entity.</summary>
    public void SetStatus(string id, string? status)
    {
        lock (_gate)
        {
            if (_usersById.TryGetValue(id, out var user))
                _usersById[id] = user with { Status = status };
        }
    }

    public Task<AuthUser> CreateOrUpdateFromExternalAsync(ExternalIdentity identity, bool mayBootstrapFirstUser = false)
    {
        var key = ProviderKey(identity.Provider, identity.ProviderId);

        lock (_gate)
        {
            if (_providerIndex.TryGetValue(key, out var existingId) &&
                _usersById.TryGetValue(existingId, out var existing))
            {
                if (!existing.IsActive)
                    throw new ExternalSignInDeniedException(ExternalSignInDeniedException.AccountDisabled,
                        $"The account for {identity.Email} is {existing.Status}.");

                var updated = existing with
                {
                    Email = identity.Email,
                    Name = identity.Name,
                    AvatarUrl = identity.AvatarUrl
                };
                _usersById[existingId] = updated;
                return Task.FromResult(updated);
            }

            if (!_usersById.IsEmpty || !mayBootstrapFirstUser)
                throw new ExternalSignInDeniedException(ExternalSignInDeniedException.NotAllowed,
                    $"No account on this installation is set up for {identity.Email}.");

            var id = Guid.NewGuid().ToString();
            var user = new AuthUser(id, identity.Email, identity.Name, identity.AvatarUrl, ["admin"], AuthUser.ActiveStatus);
            _usersById[id] = user;
            _providerIndex[key] = id;
            return Task.FromResult(user);
        }
    }
}
