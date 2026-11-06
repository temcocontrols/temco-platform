namespace Temco.Mcp;

/// <summary>
/// Everything outside this process, as one interface: the platform service that answers for devices,
/// repositories, projects, documentation and the site.
/// </summary>
public interface IPlatformApi
{
    Task<IReadOnlyList<DeviceInfo>> GetDevicesAsync(string? nameContains, CancellationToken cancellationToken);
    Task<PointInfo> ReadPointAsync(int serial, string pointType, int pointIndex, CancellationToken cancellationToken);
    Task<WriteResult> WritePointAsync(int serial, string pointType, int pointIndex, double value, CancellationToken cancellationToken);
    Task<WriteResult> AcknowledgeAlarmAsync(int serial, string alarmId, CancellationToken cancellationToken);

    /// <summary>
    /// Any other read, as the JSON the service answered with. The tools that only pass information through
    /// use this rather than growing a method per route.
    /// </summary>
    Task<string> ReadJsonAsync(string path, CancellationToken cancellationToken);
}

public sealed record DeviceInfo(int Serial, string Name, string ProductType, string? Address, bool Online);
public sealed record PointInfo(string Label, double Value, string Units, string Description);
public sealed record WriteResult(bool Accepted, string Message);
