namespace RedBamboo.AppHost.Security;

/// <summary>
/// Stable location of a protected value. Its canonical representation is supplied to
/// authenticated encryption as associated data, so a ciphertext copied to another
/// owner or field cannot be decrypted there.
/// </summary>
public readonly record struct SecretAddress(string Scope, string Owner, string Name)
{
    public string Canonical
    {
        get
        {
            ValidatePart(Scope, nameof(Scope));
            ValidatePart(Owner, nameof(Owner));
            ValidatePart(Name, nameof(Name));
            return $"redbamboo-secret/v1/{Scope}/{Owner}/{Name}";
        }
    }

    public static SecretAddress Entity(Guid entityId, string fieldKey)
        => new("entity", entityId.ToString("D"), fieldKey);

    public static SecretAddress Bootstrap(string owner, string name)
        => new("bootstrap", owner, name);

    private static void ValidatePart(string value, string parameter)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Contains('/') || value.Contains('\\'))
            throw new ArgumentException("Secret address parts must be non-empty path-safe identifiers.", parameter);
    }
}
