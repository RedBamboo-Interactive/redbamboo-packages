using System.Text;

namespace RedBamboo.AppHost.Startup;

public sealed record StartupLaunchCommand(
    string ExecutablePath,
    IReadOnlyList<string> Arguments)
{
    public string ToRegistryValue()
    {
        if (!Path.IsPathFullyQualified(ExecutablePath))
            throw new ArgumentException("Startup executable path must be absolute.", nameof(ExecutablePath));

        return string.Join(" ", new[] { Quote(ExecutablePath) }.Concat(Arguments.Select(Quote)));
    }

    private static string Quote(string value)
    {
        if (value.Length > 0 && value.All(character =>
                !char.IsWhiteSpace(character) && character != '"'))
            return value;

        var result = new StringBuilder(value.Length + 2).Append('"');
        var backslashes = 0;
        foreach (var character in value)
        {
            if (character == '\\')
            {
                backslashes++;
                continue;
            }

            if (character == '"')
                result.Append('\\', backslashes * 2 + 1);
            else
                result.Append('\\', backslashes);
            result.Append(character);
            backslashes = 0;
        }

        result.Append('\\', backslashes * 2).Append('"');
        return result.ToString();
    }
}
