using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Temco.Mcp;
using Temco.Mcp.Tools;

// Two ways to be asked. `stdio` is one request at a time on a pipe, which is what an inspector or a script
// wants. `http` is one long-lived process on loopback, which is what the application manages: the Connection
// page starts it, stops it and shows its address. Neither mode listens anywhere but 127.0.0.1.
var mode = (Environment.GetEnvironmentVariable("TEMCO_MCP_TRANSPORT") ?? "stdio").Trim().ToLowerInvariant();
if (mode == "http")
{
    await RunHttpAsync();
}
else
{
    await RunStdioAsync();
}

static void Describe(ILoggingBuilder logging)
{
    logging.ClearProviders();
    logging.AddConsole(options => options.LogToStandardErrorThreshold = LogLevel.Trace);
    // Warning by default: the application pipes stderr into its own channel, and a per-call info line there
    // would bury the calls the reader is looking for. TEMCO_MCP_LOG=information turns it all back on.
    logging.SetMinimumLevel(
        Enum.TryParse<LogLevel>(Environment.GetEnvironmentVariable("TEMCO_MCP_LOG"), true, out var level)
            ? level
            : LogLevel.Warning);
}

static void Provide(IServiceCollection services)
{
    services.AddSingleton<IPlatformApi>(_ => new HttpPlatformApi(
        Environment.GetEnvironmentVariable("TEMCO_PLATFORM_API") ?? "http://127.0.0.1:3210",
        TimeSpan.FromSeconds(20)));
    services.AddSingleton(_ => new Audit(
        Environment.GetEnvironmentVariable("TEMCO_MCP_STATE")
            ?? Path.Combine(Path.GetTempPath(), "temco-mcp")));
    services.AddSingleton(_ => new CatalogDb(
        Environment.GetEnvironmentVariable("TEMCO_CATALOG_DB")));
}

static async Task RunStdioAsync()
{
    var builder = Host.CreateApplicationBuilder();
    Describe(builder.Logging);
    Provide(builder.Services);

    builder.Services
        .AddMcpServer(options => { options.ServerInfo = new() { Name = "temco-mcp", Version = "1.0.0" }; })
        .WithStdioServerTransport()
        .WithToolsFromAssembly();

    await builder.Build().RunAsync();
}

static async Task RunHttpAsync()
{
    // The caller picks the port: it is the one that has to know the address before anything starts.
    var port = int.TryParse(Environment.GetEnvironmentVariable("TEMCO_MCP_PORT"), out var wanted) && wanted > 0
        ? wanted
        : 3210;
    var token = (Environment.GetEnvironmentVariable("TEMCO_MCP_TOKEN") ?? string.Empty).Trim();

    var builder = WebApplication.CreateBuilder();
    Describe(builder.Logging);
    // Loopback by name, not by default: the server must never be reachable from the network.
    builder.WebHost.UseUrls($"http://127.0.0.1:{port}");
    Provide(builder.Services);

    builder.Services
        .AddMcpServer(options => { options.ServerInfo = new() { Name = "temco-mcp", Version = "1.0.0" }; })
        .WithHttpTransport()
        .WithToolsFromAssembly();

    var app = builder.Build();

    // `/health` is how the application knows the process is up. It says nothing worth hiding and needs no token.
    app.MapGet("/health", () => Results.Json(new { ok = true, name = "temco-mcp", version = "1.0.0" }));

    // A browser pointed at this port gets a sentence instead of a 401: the address is printed on a page, and someone
    // will paste it into one. GET only — the protocol itself is POST on /mcp.
    app.MapGet("/", () => Results.Json(Newcomer()));
    app.MapGet("/mcp", () => Results.Json(Newcomer()));

    // Everything else needs the token the application generated for this window: a loopback port is reachable by
    // every process on the machine, including the three calls that write.
    if (token.Length > 0)
    {
        app.Use(async (context, next) =>
        {
            if (Public(context.Request)
                || context.Request.Headers.Authorization.ToString() == $"Bearer {token}")
            {
                await next();
                return;
            }
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        });
    }

    app.MapMcp("/mcp");

    await app.RunAsync();

    // What a browser is told when it opens the address: enough to understand what it is looking at, nothing that
    // would let it call anything.
    static object Newcomer() => new
    {
        name = "temco-mcp",
        version = "1.0.0",
        protocol = "Model Context Protocol",
        transport = "streamable HTTP, stateless",
        endpoint = "POST /mcp with JSON-RPC and 'Authorization: Bearer <token>'",
        health = "GET /health",
        note = "This is not a web page. The application starts this process and holds the token.",
    };

    // The readiness probe and the two descriptions above; everything that can act needs the token.
    static bool Public(HttpRequest request) =>
        HttpMethods.IsGet(request.Method) && request.Path.Value is "/health" or "/" or "/mcp";
}
