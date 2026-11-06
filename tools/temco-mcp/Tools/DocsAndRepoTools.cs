using System.ComponentModel;
using System.Text.Json;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace Temco.Mcp.Tools;

[McpServerToolType]
public sealed class DocsTools(IPlatformApi platform, Audit audit)
{
    [McpServerTool(Name = "docs.search", Title = "Search the documentation", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("Full-text search over the documentation this product publishes. Answers with the pages that match and the line each hit is on.")]
    public Task<CallToolResult> Search(
        [Description("Words to look for.")] string query,
        [Description("How many hits to return; 10 when omitted.")] int limit = 10,
        CancellationToken cancellationToken = default) =>
        ToolResults.Guard(async () =>
        {
            var hits = await platform.ReadJsonAsync(
                $"/docs/search?q={Uri.EscapeDataString(query)}&limit={limit}", cancellationToken);
            audit.Record("docs.search", JsonSerializer.Serialize(new { query, limit }), 1);
            return ToolResults.Text(hits);
        });

    [McpServerTool(Name = "docs.read", Title = "Read a documentation page", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("One documentation page, by the path docs.search or docs.outline returned.")]
    public Task<CallToolResult> Read(
        [Description("Page path, for example temco-platform/design/authoring-and-msdn-output.md.")] string path,
        CancellationToken cancellationToken = default) =>
        ToolResults.Guard(async () =>
        {
            var page = await platform.ReadJsonAsync($"/docs/page?path={Uri.EscapeDataString(path)}", cancellationToken);
            audit.Record("docs.read", JsonSerializer.Serialize(new { path }), 1);
            return ToolResults.Text(page);
        });

    [McpServerTool(Name = "docs.outline", Title = "Outline the documentation", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("The table of contents: every documentation page with its title and section.")]
    public Task<CallToolResult> Outline(CancellationToken cancellationToken = default) =>
        ToolResults.Guard(async () =>
        {
            var outline = await platform.ReadJsonAsync("/docs/outline", cancellationToken);
            audit.Record("docs.outline", "{}", 1);
            return ToolResults.Text(outline);
        });

    [McpServerTool(Name = "docs.stale", Title = "Find stale documentation", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("Pages whose referenced code has moved since they were written, so the answer to a question may be out of date.")]
    public Task<CallToolResult> Stale(
        [Description("How many pages to report; 20 when omitted.")] int limit = 20,
        CancellationToken cancellationToken = default) =>
        ToolResults.Guard(async () =>
        {
            var stale = await platform.ReadJsonAsync($"/docs/stale?limit={limit}", cancellationToken);
            audit.Record("docs.stale", JsonSerializer.Serialize(new { limit }), 1);
            return ToolResults.Text(stale);
        });
}

[McpServerToolType]
public sealed class RepoTools(IPlatformApi platform, Audit audit)
{
    [McpServerTool(Name = "repo.list", Title = "List repositories", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("The repositories this workspace knows, with their clone state.")]
    public Task<CallToolResult> List(CancellationToken cancellationToken = default) =>
        ToolResults.Guard(async () =>
        {
            var repos = await platform.ReadJsonAsync("/repos", cancellationToken);
            audit.Record("repo.list", "{}", 1);
            return ToolResults.Text(repos);
        });

    [McpServerTool(Name = "repo.show", Title = "Show a repository", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("One repository: its remote, branch, clone path and last fetch.")]
    public Task<CallToolResult> Show(
        [Description("Repository name, as repo.list returned it.")] string name,
        CancellationToken cancellationToken = default) =>
        ToolResults.Guard(async () =>
        {
            var repo = await platform.ReadJsonAsync($"/repos/{Uri.EscapeDataString(name)}", cancellationToken);
            audit.Record("repo.show", JsonSerializer.Serialize(new { name }), 1);
            return ToolResults.Text(repo);
        });

    [McpServerTool(Name = "repo.status", Title = "Show the working tree", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("The working tree of one clone: branch, ahead and behind, and the files that differ.")]
    public Task<CallToolResult> Status(
        [Description("Repository name.")] string name,
        CancellationToken cancellationToken = default) =>
        ToolResults.Guard(async () =>
        {
            var status = await platform.ReadJsonAsync($"/repos/{Uri.EscapeDataString(name)}/status", cancellationToken);
            audit.Record("repo.status", JsonSerializer.Serialize(new { name }), 1);
            return ToolResults.Text(status);
        });

    [McpServerTool(Name = "repo.log", Title = "Read commits", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("Recent commits: sha, author, date and subject.")]
    public Task<CallToolResult> Log(
        [Description("Repository name.")] string name,
        [Description("How many commits; 20 when omitted.")] int limit = 20,
        CancellationToken cancellationToken = default) =>
        ToolResults.Guard(async () =>
        {
            var log = await platform.ReadJsonAsync($"/repos/{Uri.EscapeDataString(name)}/log?limit={limit}", cancellationToken);
            audit.Record("repo.log", JsonSerializer.Serialize(new { name, limit }), 1);
            return ToolResults.Text(log);
        });

    [McpServerTool(Name = "repo.diff", Title = "Read a diff", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("The diff of one commit or of the working tree. Reads only; nothing is applied.")]
    public Task<CallToolResult> Diff(
        [Description("Repository name.")] string name,
        [Description("Commit sha; omit for the working tree.")] string? sha = null,
        CancellationToken cancellationToken = default) =>
        ToolResults.Guard(async () =>
        {
            var path = sha is null
                ? $"/repos/{Uri.EscapeDataString(name)}/diff"
                : $"/repos/{Uri.EscapeDataString(name)}/diff?sha={Uri.EscapeDataString(sha)}";
            var diff = await platform.ReadJsonAsync(path, cancellationToken);
            audit.Record("repo.diff", JsonSerializer.Serialize(new { name, sha }), 1);
            return ToolResults.Text(diff);
        });
}
