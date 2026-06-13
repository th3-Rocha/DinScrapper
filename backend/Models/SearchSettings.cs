namespace Backend.Models;

public class SearchSettings
{
    public int Id { get; set; }
    public string Keywords { get; set; } = "title:(C# OR .NET) OR \"Backend\"";
    public string Location { get; set; } = "Brazil";
    public int WorkplaceType { get; set; } = 2;
    public string ExpoPushToken { get; set; } = "";
    /// <summary>Intervalo entre raspagens automáticas. Valores válidos: 15, 30, 60, 180.</summary>
    public int ScrapeIntervalMinutes { get; set; } = 30;
}
