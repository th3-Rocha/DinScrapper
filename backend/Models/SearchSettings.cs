namespace Backend.Models;

public class SearchSettings
{
    public int Id { get; set; }
    public string Keywords { get; set; } = "title:(C# OR .NET) OR \"Backend\"";
    public string Location { get; set; } = "Brazil";
    public string WorkplaceType { get; set; } = "2";
    public string ExpoPushToken { get; set; } = "";
}
