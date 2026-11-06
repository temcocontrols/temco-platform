using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Temco.Mcp;
using Temco.Mcp.Tools;

var builder = Host.CreateApplicationBuilder(args);

// stdout is the protocol. Every log line must go to stderr, or the first write breaks the stream.
builder.Logging.ClearProviders();
builder.Logging.AddConsole(options => options.LogToStandardErrorThreshold = LogLevel.Trace);
// Warning by default: the extension pipes stderr into its own channel, and a per-call info line there would
// bury the tool calls the reader is looking for. `TEMCO_MCP_LOG=information` turns it all back on.
builder.Logging.SetMinimumLevel(
    Enum.TryParse<LogLevel>(Environment.GetEnvironmentVariable("TEMCO_MCP_LOG"), true, out var level)
        ? level
        : LogLevel.Warning);

builder.Services.AddSingleton<IPlatformApi>(_ => new HttpPlatformApi(
    Environment.GetEnvironmentVariable("TEMCO_PLATFORM_API") ?? "http://127.0.0.1:3210",
    TimeSpan.FromSeconds(20)));
builder.Services.AddSingleton(_ => new Audit(
    Environment.GetEnvironmentVariable("TEMCO_MCP_STATE")
        ?? Path.Combine(Path.GetTempPath(), "temco-mcp")));

// The catalog is optional: the extension passes its path, and a machine without one still gets every tool
// that does not read it.
builder.Services.AddSingleton(provider => new CatalogDb(
    Environment.GetEnvironmentVariable("TEMCO_CATALOG_DB")));

builder.Services
    .AddMcpServer(options =>
    {
        options.ServerInfo = new() { Name = "temco-mcp", Version = "1.0.0" };
    })
    .WithStdioServerTransport()
    .WithToolsFromAssembly();

await builder.Build().RunAsync();
