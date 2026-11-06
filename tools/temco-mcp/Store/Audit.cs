using Microsoft.Data.Sqlite;

namespace Temco.Mcp;

/// <summary>One row per call, so what the assistant did can be read back later.</summary>
public sealed class Audit
{
    private readonly string _path;

    public Audit(string appDataDirectory)
    {
        _path = Path.Combine(appDataDirectory, "temco-mcp", "audit.db");
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        using var connection = new SqliteConnection($"Data Source={_path}");
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE IF NOT EXISTS calls (
                at TEXT NOT NULL,
                tool TEXT NOT NULL,
                arguments TEXT NOT NULL,
                rows INTEGER NOT NULL
            );
            """;
        command.ExecuteNonQuery();
    }

    public void Record(string tool, string arguments, int rows)
    {
        using var connection = new SqliteConnection($"Data Source={_path}");
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO calls (at, tool, arguments, rows) VALUES ($at, $tool, $arguments, $rows);
            """;
        command.Parameters.AddWithValue("$at", DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$tool", tool);
        command.Parameters.AddWithValue("$arguments", arguments);
        command.Parameters.AddWithValue("$rows", rows);
        command.ExecuteNonQuery();
    }
}
