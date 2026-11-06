using System.ComponentModel;
using System.Text.Json;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace Temco.Mcp.Tools;

[McpServerToolType]
public sealed class ProjectTools(IPlatformApi platform, Audit audit)
{
    [McpServerTool(Name = "project.list", Title = "List projects", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("The documentation projects in this workspace, with their sources and destinations.")]
    public Task<CallToolResult> List(CancellationToken cancellationToken = default) =>
        ToolResults.Guard(async () =>
        {
            var projects = await platform.ReadJsonAsync("/projects", cancellationToken);
            audit.Record("project.list", "{}", 1);
            return ToolResults.Text(projects);
        });

    [McpServerTool(Name = "project.create", Title = "Create a project", ReadOnly = false, Destructive = true, Idempotent = false, OpenWorld = false)]
    [Description("Create a documentation project from a name and a source folder. Writes to the workspace, so it is never called without an approval.")]
    public Task<CallToolResult> Create(
        [Description("Project name.")] string name,
        [Description("Folder the project documents.")] string source,
        CancellationToken cancellationToken = default) =>
        ToolResults.Guard(async () =>
        {
            var created = await platform.ReadJsonAsync(
                $"/projects/create?name={Uri.EscapeDataString(name)}&source={Uri.EscapeDataString(source)}",
                cancellationToken);
            audit.Record("project.create", JsonSerializer.Serialize(new { name, source }), 1);
            return ToolResults.Text(created);
        });
}

[McpServerToolType]
public sealed class CatalogTools(CatalogDb catalog, Audit audit)
{
    [McpServerTool(Name = "catalog.tables", Title = "List catalog tables", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("Every table in this workspace's catalog database.")]
    public Task<CallToolResult> Tables(CancellationToken cancellationToken = default) =>
        ToolResults.Guard(async () =>
        {
            var tables = await catalog.TablesAsync(cancellationToken);
            audit.Record("catalog.tables", "{}", tables.Count);
            return ToolResults.Text(JsonSerializer.Serialize(tables));
        });

    [McpServerTool(Name = "catalog.query", Title = "Query the catalog", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("Run one read-only SELECT against this workspace's catalog database and get the rows back as JSON.")]
    public Task<CallToolResult> Query(
        [Description("A single SELECT or WITH statement.")] string sql,
        [Description("How many rows to return; 100 when omitted.")] int limit = 100,
        CancellationToken cancellationToken = default) =>
        ToolResults.Guard(async () =>
        {
            var trimmed = sql.TrimStart();
            if (!(trimmed.StartsWith("SELECT", StringComparison.OrdinalIgnoreCase)
                  || trimmed.StartsWith("WITH", StringComparison.OrdinalIgnoreCase)))
            {
                return ToolResults.Fail("catalog.query runs one SELECT or WITH statement; the catalog is read-only.");
            }
            var rows = await catalog.QueryAsync(sql, cancellationToken);
            var page = rows.Take(limit).ToList();
            audit.Record("catalog.query", JsonSerializer.Serialize(new { sql }), page.Count);
            return ToolResults.Text(JsonSerializer.Serialize(page));
        });
}

[McpServerToolType]
public sealed class LearnTools(IPlatformApi platform, Audit audit)
{
    [McpServerTool(Name = "learn.search", Title = "Search the site", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("Search the published Temco Learn content: topics, replies and release notes.")]
    public Task<CallToolResult> Search(
        [Description("Words to look for.")] string query,
        CancellationToken cancellationToken = default) =>
        ToolResults.Guard(async () =>
        {
            var hits = await platform.ReadJsonAsync($"/learn/search?q={Uri.EscapeDataString(query)}", cancellationToken);
            audit.Record("learn.search", JsonSerializer.Serialize(new { query }), 1);
            return ToolResults.Text(hits);
        });

    [McpServerTool(Name = "learn.post_status", Title = "Read a topic's publication state", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("Whether a topic is a draft, in review, or published, and when it last changed.")]
    public Task<CallToolResult> PostStatus(
        [Description("Topic id or slug.")] string topic,
        CancellationToken cancellationToken = default) =>
        ToolResults.Guard(async () =>
        {
            var state = await platform.ReadJsonAsync($"/learn/topics/{Uri.EscapeDataString(topic)}", cancellationToken);
            audit.Record("learn.post_status", JsonSerializer.Serialize(new { topic }), 1);
            return ToolResults.Text(state);
        });
}
