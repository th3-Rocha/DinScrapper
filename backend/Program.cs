using Backend.Data;
using Backend.Services;
using Microsoft.EntityFrameworkCore;
using Backend.Models;
using QRCoder;
using System.Net;
using System.Net.Sockets;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

builder.Services.AddHostedService<LinkedInScraperService>();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyMethod()
              .AllowAnyHeader();
    });
});

var app = builder.Build();

app.UseCors("AllowAll");
app.Urls.Add("http://0.0.0.0:5056");
app.MapGet("/api/jobs", async (AppDbContext db) =>
{
    var jobs = await db.Jobs
        .OrderByDescending(j => j.DateScraped)
        .ToListAsync();

    return Results.Ok(jobs);
});


app.MapGet("/api/settings", async (AppDbContext db) =>
{
    var settings = await db.SearchSettings.FirstOrDefaultAsync();
    if (settings == null)
    {
        settings = new SearchSettings();
        db.SearchSettings.Add(settings);
        await db.SaveChangesAsync();
    }
    return Results.Ok(settings);
});

app.MapPost("/api/settings", async (AppDbContext db, SearchSettings newSettings) =>
{
    var settings = await db.SearchSettings.FirstOrDefaultAsync();

    if (settings == null)
    {
        db.SearchSettings.Add(newSettings);
    }
    else
    {
        settings.Keywords = newSettings.Keywords;
        settings.Location = newSettings.Location;
        settings.WorkplaceType = newSettings.WorkplaceType;
        if (!string.IsNullOrEmpty(newSettings.ExpoPushToken))
        {
            settings.ExpoPushToken = newSettings.ExpoPushToken;
        }
    }

    await db.SaveChangesAsync();
    return Results.Ok(settings);
});


string localIp = "";
var host = await Dns.GetHostEntryAsync(Dns.GetHostName());
foreach (var ip in host.AddressList)
{
    if (ip.AddressFamily == AddressFamily.InterNetwork && !ip.ToString().StartsWith("127."))
    {
        localIp = ip.ToString();
        break;
    }
}

if (!string.IsNullOrEmpty(localIp))
{
    string backendUrl = $"http://{localIp}:5056";

    // Cria o gerador de QR Code
    using var qrGenerator = new QRCodeGenerator();
    using var qrCodeData = qrGenerator.CreateQrCode(backendUrl, QRCodeGenerator.ECCLevel.Q);
    using var qrCode = new AsciiQRCode(qrCodeData);

    // Renderiza em formato de texto para o console do Linux
    string qrCodeAsAscii = qrCode.GetGraphic(1);

    Console.WriteLine("\n==================================================");
    Console.WriteLine($"🚀 BACKEND DA PENEIRA DE OURO ONLINE!");
    Console.WriteLine($"🔗 URL de Conexão: {backendUrl}");
    Console.WriteLine("📱 Aponte a câmera do aplicativo para o QR Code abaixo:");
    Console.WriteLine("==================================================\n");
    Console.WriteLine(qrCodeAsAscii);
    Console.WriteLine("==================================================\n");
}


app.Run();
