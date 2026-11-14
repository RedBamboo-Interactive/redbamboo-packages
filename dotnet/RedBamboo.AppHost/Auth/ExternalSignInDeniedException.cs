namespace RedBamboo.AppHost.Auth;

/// <summary>
/// An external identity proved who it is but this installation does not let it in. Thrown by
/// <see cref="IUserStore.CreateOrUpdateFromExternalAsync"/>; the sign-in callback answers it with a
/// refusal and issues no session. Any other exception from the store is an outage, and also issues no
/// session.
/// </summary>
public sealed class ExternalSignInDeniedException(string reason, string message) : Exception(message)
{
    /// <summary>The account exists but its status is not active.</summary>
    public const string AccountDisabled = "account_disabled";

    /// <summary>No user entity matches and this is not the first-user setup.</summary>
    public const string NotAllowed = "account_not_allowed";

    public string Reason { get; } = reason;
}
