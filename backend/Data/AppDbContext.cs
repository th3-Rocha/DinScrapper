using Microsoft.EntityFrameworkCore;
using Backend.Models;

namespace Backend.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<JobListing> Jobs => Set<JobListing>();

    // 🟢 ADICIONE ESTA LINHA AQUI:
    public DbSet<SearchSettings> SearchSettings => Set<SearchSettings>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Garante que a coluna Link seja única (Unique Constraint)
        modelBuilder.Entity<JobListing>()
            .HasIndex(j => j.Link)
            .IsUnique();
    }
}
