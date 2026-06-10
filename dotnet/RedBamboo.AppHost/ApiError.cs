using Microsoft.AspNetCore.Http;

namespace RedBamboo.AppHost;

/// <summary>
/// Standard Red Suite error envelope: { ok: false, error: { code, message, details? } }.
/// `code` is a stable snake_case machine code; `message` is human-readable and should
/// include remediation hints where possible (e.g. "Wake it via POST /control/wake/{slug}").
/// </summary>
public static class ApiError
{
    public static object Of(string code, string message, object? details = null)
    {
        var error = new Dictionary<string, object?>
        {
            ["code"] = code,
            ["message"] = message,
        };
        if (details is not null) error["details"] = details;
        return new Dictionary<string, object?>
        {
            ["ok"] = false,
            ["error"] = error,
        };
    }

    public static IResult BadRequest(string code, string message, object? details = null)
        => Results.Json(Of(code, message, details), statusCode: StatusCodes.Status400BadRequest);

    public static IResult Unauthorized(string code, string message, object? details = null)
        => Results.Json(Of(code, message, details), statusCode: StatusCodes.Status401Unauthorized);

    public static IResult Forbidden(string code, string message, object? details = null)
        => Results.Json(Of(code, message, details), statusCode: StatusCodes.Status403Forbidden);

    public static IResult NotFound(string code, string message, object? details = null)
        => Results.Json(Of(code, message, details), statusCode: StatusCodes.Status404NotFound);

    public static IResult Conflict(string code, string message, object? details = null)
        => Results.Json(Of(code, message, details), statusCode: StatusCodes.Status409Conflict);

    public static IResult Gone(string code, string message, object? details = null)
        => Results.Json(Of(code, message, details), statusCode: StatusCodes.Status410Gone);

    public static IResult UnprocessableEntity(string code, string message, object? details = null)
        => Results.Json(Of(code, message, details), statusCode: StatusCodes.Status422UnprocessableEntity);

    public static IResult ServerError(string code, string message, object? details = null)
        => Results.Json(Of(code, message, details), statusCode: StatusCodes.Status500InternalServerError);

    public static IResult BadGateway(string code, string message, object? details = null)
        => Results.Json(Of(code, message, details), statusCode: StatusCodes.Status502BadGateway);

    public static IResult ServiceUnavailable(string code, string message, object? details = null)
        => Results.Json(Of(code, message, details), statusCode: StatusCodes.Status503ServiceUnavailable);
}
