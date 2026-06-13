using System.Threading.Channels;

namespace Backend.Services;

/// <summary>Resultado estruturado de uma rodada de raspagem.</summary>
public sealed class ScrapeResult
{
    public DateTime RunAt { get; init; } = DateTime.UtcNow;
    public bool Success { get; set; }
    /// <summary>"ok" | "auth_wall" | "captcha" | "empty" | "timeout" | "error"</summary>
    public string Status { get; set; } = "unknown";
    public string PageTitle { get; set; } = "";
    public int JobsFound { get; set; }
    public int JobsNew { get; set; }
    public int JobsFiltered { get; set; }
    public int JobsSkipped { get; set; }
    public int JobsDeleted { get; set; }
    public string? ErrorMessage { get; set; }
    public double DurationSeconds { get; set; }
}

/// <summary>
/// Singleton que permite endpoints HTTP dispararem uma raspagem
/// imediata e consultarem o estado/resultado mais recente.
/// </summary>
public class ScraperTriggerService
{
    private readonly Channel<bool> _channel = Channel.CreateBounded<bool>(
        new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropOldest });

    private volatile bool _isScraping;
    private ScrapeResult? _lastResult;

    public bool IsScraping => _isScraping;
    public ScrapeResult? LastResult => _lastResult;

    public void SetScraping(bool value) => _isScraping = value;
    public void SetLastResult(ScrapeResult result) => _lastResult = result;

    public ChannelReader<bool> Reader => _channel.Reader;

    /// <summary>Sinaliza o background service para rodar agora.</summary>
    public ValueTask TriggerAsync(CancellationToken ct = default)
        => _channel.Writer.WriteAsync(true, ct);
}
