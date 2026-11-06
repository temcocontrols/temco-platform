using System.ComponentModel;
using System.Text.Json;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace Temco.Mcp.Tools;

[McpServerToolType]
public sealed class DeviceTools(IPlatformApi platform, Audit audit)
{
    [McpServerTool(Name = "device.list", Title = "List devices", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("Every T3000 device known to the panel: serial, name, product type, address, and whether it is online.")]
    public Task<CallToolResult> ListDevices(
        [Description("Optional text; only devices whose name contains it are returned.")] string? nameContains = null,
        CancellationToken cancellationToken = default) =>
        ToolResults.Guard(async () =>
        {
            var devices = await platform.GetDevicesAsync(nameContains, cancellationToken);
            audit.Record("device.list", JsonSerializer.Serialize(new { nameContains }), devices.Count);
            return ToolResults.Text(JsonSerializer.Serialize(devices));
        });

    [McpServerTool(Name = "device.describe", Title = "Describe a device", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("One device in full: serial, name, product type, address, panel, and whether it is online.")]
    public Task<CallToolResult> Describe(
        [Description("Device serial number.")] int serial,
        CancellationToken cancellationToken = default) =>
        ToolResults.Guard(async () =>
        {
            var device = await platform.ReadJsonAsync($"/devices/{serial}", cancellationToken);
            audit.Record("device.describe", JsonSerializer.Serialize(new { serial }), 1);
            return ToolResults.Text(device);
        });

    [McpServerTool(Name = "device.read_point", Title = "Read a point", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("Read one input, output or variable of a device: its value, units, and range.")]
    public Task<CallToolResult> ReadPoint(
        [Description("Device serial number.")] int serial,
        [Description("Point type: INPUT, OUTPUT or VARIABLE.")] string pointType,
        [Description("One-based point index, as the point list shows it.")] int pointIndex,
        CancellationToken cancellationToken = default) =>
        ToolResults.Guard(async () =>
        {
            if (pointType is not ("INPUT" or "OUTPUT" or "VARIABLE"))
            {
                return ToolResults.Fail($"pointType must be INPUT, OUTPUT or VARIABLE, not '{pointType}'.");
            }
            var point = await platform.ReadPointAsync(serial, pointType, pointIndex, cancellationToken);
            audit.Record("device.read_point", JsonSerializer.Serialize(new { serial, pointType, pointIndex }), 1);
            return ToolResults.Text(JsonSerializer.Serialize(point));
        });

    [McpServerTool(Name = "device.write_point", Title = "Write a point", ReadOnly = false, Destructive = true, Idempotent = false, OpenWorld = true)]
    [Description("Write one point. Changes equipment state, so it is never called without an approval from the person at the keyboard.")]
    public Task<CallToolResult> WritePoint(
        [Description("Device serial number.")] int serial,
        [Description("Point type: OUTPUT or VARIABLE.")] string pointType,
        [Description("One-based point index.")] int pointIndex,
        [Description("The value to write.")] double value,
        CancellationToken cancellationToken = default) =>
        ToolResults.Guard(async () =>
        {
            ArgumentNullException.ThrowIfNull(pointType);
            if (pointType is not ("OUTPUT" or "VARIABLE"))
            {
                return ToolResults.Fail($"pointType must be OUTPUT or VARIABLE, not '{pointType}'.");
            }
            var result = await platform.WritePointAsync(serial, pointType, pointIndex, value, cancellationToken);
            audit.Record("device.write_point", JsonSerializer.Serialize(new { serial, pointType, pointIndex, value }), 1);
            return ToolResults.Text(JsonSerializer.Serialize(result));
        });

    [McpServerTool(Name = "device.trendlog_list", Title = "List trendlogs", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("The trendlogs a device records, with their interval and buffer size.")]
    public Task<CallToolResult> TrendlogList(
        [Description("Device serial number.")] int serial,
        CancellationToken cancellationToken = default) =>
        ToolResults.Guard(async () =>
        {
            var logs = await platform.ReadJsonAsync($"/devices/{serial}/trendlogs", cancellationToken);
            audit.Record("device.trendlog_list", JsonSerializer.Serialize(new { serial }), 1);
            return ToolResults.Text(logs);
        });

    [McpServerTool(Name = "device.trendlog_query", Title = "Query a trendlog", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("The recorded history of one point between two times.")]
    public Task<CallToolResult> TrendlogQuery(
        [Description("Device serial number.")] int serial,
        [Description("Point type: INPUT, OUTPUT or VARIABLE.")] string pointType,
        [Description("One-based point index.")] int pointIndex,
        [Description("Start of the range, ISO 8601.")] string from,
        [Description("End of the range, ISO 8601.")] string to,
        CancellationToken cancellationToken = default) =>
        ToolResults.Guard(async () =>
        {
            var values = await platform.ReadJsonAsync(
                $"/devices/{serial}/points/{pointType}/{pointIndex}/history?from={Uri.EscapeDataString(from)}&to={Uri.EscapeDataString(to)}",
                cancellationToken);
            audit.Record("device.trendlog_query", JsonSerializer.Serialize(new { serial, pointType, pointIndex, from, to }), 1);
            return ToolResults.Text(values);
        });

    [McpServerTool(Name = "device.alarm_list", Title = "List alarms", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("Alarms on one device, or on every device when no serial is given.")]
    public Task<CallToolResult> AlarmList(
        [Description("Only unacknowledged alarms.")] bool activeOnly = false,
        [Description("Device serial number; omit for every device.")] int? serial = null,
        CancellationToken cancellationToken = default) =>
        ToolResults.Guard(async () =>
        {
            var path = serial is null ? "/alarms" : $"/devices/{serial}/alarms";
            var alarms = await platform.ReadJsonAsync(
                activeOnly ? $"{path}?activeOnly=true" : path,
                cancellationToken);
            audit.Record("device.alarm_list", JsonSerializer.Serialize(new { serial, activeOnly }), 1);
            return ToolResults.Text(alarms);
        });

    [McpServerTool(Name = "device.alarm_acknowledge", Title = "Acknowledge an alarm", ReadOnly = false, Destructive = true, Idempotent = true, OpenWorld = true)]
    [Description("Acknowledge one alarm. Silences it for everyone, so it is never called without an approval.")]
    public Task<CallToolResult> AlarmAcknowledge(
        [Description("Device serial number.")] int serial,
        [Description("Alarm id, as the alarm list shows it.")] string alarmId,
        CancellationToken cancellationToken = default) =>
        ToolResults.Guard(async () =>
        {
            var result = await platform.AcknowledgeAlarmAsync(serial, alarmId, cancellationToken);
            audit.Record("device.alarm_acknowledge", JsonSerializer.Serialize(new { serial, alarmId }), 1);
            return ToolResults.Text(JsonSerializer.Serialize(result));
        });
}

