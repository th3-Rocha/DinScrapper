namespace Backend.Models;

public class JobListing
{
    public int Id { get; set; }

    public long LinkedInId { get; set; }

    public string Title { get; set; } = string.Empty;
    public string Company { get; set; } = string.Empty;
    public string Location { get; set; } = string.Empty;

    public string WorkplaceType { get; set; } = string.Empty;
    public string EmploymentType { get; set; } = string.Empty;
    public bool IsEasyApply { get; set; }

    public string TimePosted { get; set; } = string.Empty;
    public string ApplicantCount { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Link { get; set; } = string.Empty;

    public DateTime DateScraped { get; set; } = DateTime.UtcNow;
}
