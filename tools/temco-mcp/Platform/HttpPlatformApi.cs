using System.Net.Http.Json;
using System.Text.Json;

namespace Temco.Mcp;

public sealed class HttpPlatformApi : IPlatformApi
{
    private readonly HttpClient _http;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public HttpPlatformApi(string baseUrl, TimeSpan timeout)
    {
        _http = new HttpClient { BaseAddress = new Uri(baseUrl), Timeout = timeout };
    }

    public async Task<IReadOnlyList<DeviceInfo>> GetDevicesAsync(string? nameContains, CancellationToken cancellationToken)
    {
        var url = nameContains is null ? "/devices" : $"/devices?nameContains={Uri.EscapeDataString(nameContains)}";
        var devices = await _http.GetFromJsonAsync<List<DeviceInfo>>(url, Json, cancellationToken);
        return devices ?? [];
    }

    public async Task<PointInfo> ReadPointAsync(int serial, string pointType, int pointIndex, CancellationToken cancellationToken)
    {
        var point = await _http.GetFromJsonAsync<PointInfo>(
            $"/devices/{serial}/points/{pointType}/{pointIndex}", Json, cancellationToken);
        return point ?? throw new InvalidOperationException($"Device {serial} has no {pointType} point {pointIndex}.");
    }

    public async Task<WriteResult> WritePointAsync(int serial, string pointType, int pointIndex, double value, CancellationToken cancellationToken)
    {
        var response = await _http.PutAsJsonAsync(
            $"/devices/{serial}/points/{pointType}/{pointIndex}", new { value }, Json, cancellationToken);
        response.EnsureSuccessStatusCode();
        var result = await response.Content.ReadFromJsonAsync<WriteResult>(Json, cancellationToken);
        return result ?? new WriteResult(false, "The service returned no answer.");
    }

    public async Task<WriteResult> AcknowledgeAlarmAsync(int serial, string alarmId, CancellationToken cancellationToken)
    {
        var response = await _http.PostAsync(
            $"/devices/{serial}/alarms/{Uri.EscapeDataString(alarmId)}/acknowledge", null, cancellationToken);
        response.EnsureSuccessStatusCode();
        var result = await response.Content.ReadFromJsonAsync<WriteResult>(Json, cancellationToken);
        return result ?? new WriteResult(false, "The service returned no answer.");
    }

    public Task<string> ReadJsonAsync(string path, CancellationToken cancellationToken) =>
        _http.GetStringAsync(path, cancellationToken);
}
