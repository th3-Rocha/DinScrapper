using System.Threading.Channels;

namespace Backend.Services;

/// <summary>
/// Singleton que permite endpoints HTTP dispararem uma raspagem
/// imediata e consultarem se já está rodando.
/// </summary>
public class ScraperTriggerService
{
    // Capacidade 1: triggers extras são descartados (não acumula fila)
    private readonly Channel<bool> _channel = Channel.CreateBounded<bool>(
        new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropOldest });

    private volatile bool _isScraping;

    public bool IsScraping => _isScraping;

    public void SetScraping(bool value) => _isScraping = value;

    public ChannelReader<bool> Reader => _channel.Reader;

    /// <summary>Sinaliza o background service para rodar agora.</summary>
    public ValueTask TriggerAsync(CancellationToken ct = default)
        => _channel.Writer.WriteAsync(true, ct);
}
