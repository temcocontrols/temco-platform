using Microsoft.Data.Sqlite;

namespace Temco.Mcp;

/// <summary>
/// The catalog the extension maintains, opened read-only: journal_mode is already WAL there, so a reader here
/// never blocks its writes, and this process never changes it.
/// </summary>
public sealed class CatalogDb
{
    private readonly string? _connectionString;

    public CatalogDb(string? path)
    {
        _connectionString = string.IsNullOrWhiteSpace(path) || !File.Exists(path)
            ? null
            : new SqliteConnectionStringBuilder
            {
                DataSource = path,
                Mode = SqliteOpenMode.ReadOnly,
                Pooling = true,
            }.ToString();
    }

    public bool Available => _connectionString is not null;

    public async Task<IReadOnlyList<IReadOnlyDictionary<string, object?>>> QueryAsync(
        string sql, CancellationToken cancellationToken)
    {
        var connectionString = _connectionString
            ?? throw new InvalidOperationException("no catalog database is available on this machine");

        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync(cancellationToken);

        await using (var pragma = connection.CreateCommand())
        {
            // Read-only, but still a shared file: wait rather than fail while a writer holds the lock.
            pragma.CommandText = "PRAGMA busy_timeout = 5000;";
            await pragma.ExecuteNonQueryAsync(cancellationToken);
        }

        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        var rows = new List<IReadOnlyDictionary<string, object?>>();
        while (await reader.ReadAsync(cancellationToken))
        {
            var row = new Dictionary<string, object?>(StringComparer.Ordinal);
            for (var i = 0; i < reader.FieldCount; i++)
            {
                row[reader.GetName(i)] = await reader.IsDBNullAsync(i, cancellationToken) ? null : reader.GetValue(i);
            }
            rows.Add(row);
        }
        return rows;
    }

    public async Task<IReadOnlyList<string>> TablesAsync(CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            cancellationToken);
        return rows.Select(row => Convert.ToString(row["name"]) ?? string.Empty).ToList();
    }
}
