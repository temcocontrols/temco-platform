using System.Net;
using Microsoft.Data.Sqlite;
using ModelContextProtocol.Protocol;

namespace Temco.Mcp.Tools;

/// <summary>
/// The two shapes every tool answers with, and the guard that keeps a failure readable. A tool that throws
/// reaches the model as "An error occurred invoking ..." with no reason, so nothing here throws.
/// </summary>
internal static class ToolResults
{
    public static CallToolResult Text(string text) =>
        new() { Content = [new TextContentBlock { Text = text }] };

    public static CallToolResult Fail(string message) =>
        new() { IsError = true, Content = [new TextContentBlock { Text = message }] };

    public static async Task<CallToolResult> Guard(Func<Task<CallToolResult>> body)
    {
        try
        {
            return await body();
        }
        catch (HttpRequestException error)
        {
            return Fail($"the platform service did not answer: {Reason(error)}");
        }
        catch (TaskCanceledException)
        {
            return Fail("the platform service did not answer in time");
        }
        catch (Exception error) when (error is InvalidOperationException or ArgumentException or SqliteException)
        {
            return Fail(error.Message);
        }
    }

    private static string Reason(HttpRequestException error) =>
        error.StatusCode == HttpStatusCode.NotFound
            ? "it has no such record"
            : $"{error.Message}{(error.StatusCode is null ? string.Empty : $" ({(int)error.StatusCode})")}";
}

