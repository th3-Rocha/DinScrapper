using Backend.Data;
using Backend.Services;
using Microsoft.EntityFrameworkCore;
using Backend.Models;
using QRCoder;
using System.Net;
using System.Net.Sockets;

var builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.WriteIndented = true;
});

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

builder.Services.AddHostedService<LinkedInScraperService>();
builder.Services.AddHttpClient();
builder.Services.AddSingleton<ScraperTriggerService>();

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
var port = Environment.GetEnvironmentVariable("PORT") ?? "5056";
app.Urls.Add($"http://0.0.0.0:{port}");
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
        if (newSettings.ScrapeIntervalMinutes > 0)
        {
            settings.ScrapeIntervalMinutes = newSettings.ScrapeIntervalMinutes;
        }
        if (!string.IsNullOrEmpty(newSettings.ExpoPushToken))
        {
            settings.ExpoPushToken = newSettings.ExpoPushToken;
        }
    }

    await db.SaveChangesAsync();
    return Results.Ok(settings);
});

string qrCodeAsciiGlobal = "";
byte[] qrCodeImageGlobal = Array.Empty<byte>();

string backendUrlGlobal = Environment.GetEnvironmentVariable("PUBLIC_URL");

if (string.IsNullOrEmpty(backendUrlGlobal))
{
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

        backendUrlGlobal = $"http://{localIp}:5056";
    }
}

if (!string.IsNullOrEmpty(backendUrlGlobal))
{
    using var qrGenerator = new QRCodeGenerator();
    using var qrCodeData = qrGenerator.CreateQrCode(backendUrlGlobal, QRCodeGenerator.ECCLevel.Q);

    using var asciiQrCode = new AsciiQRCode(qrCodeData);
    qrCodeAsciiGlobal = asciiQrCode.GetGraphic(1);

    using var pngQrCode = new PngByteQRCode(qrCodeData);
    qrCodeImageGlobal = pngQrCode.GetGraphic(20);

    Console.WriteLine("\n==================================================");
    Console.WriteLine($"🔗 URL de Conexão Ativa: {backendUrlGlobal}");
    Console.WriteLine($"🌐 Acesse no navegador: {backendUrlGlobal}/api/qrcode");
    Console.WriteLine("==================================================\n");
    Console.WriteLine(qrCodeAsciiGlobal);
    Console.WriteLine("==================================================\n");
}

app.MapGet("/api/qrcode", () =>
{
    if (qrCodeImageGlobal.Length == 0)
        return Results.Problem("Não foi possível gerar o QR Code (URL não definida).");

    return Results.File(qrCodeImageGlobal, "image/png");
});

app.MapPost("/api/notifications/test", async (AppDbContext db, IHttpClientFactory httpClientFactory) =>
{
    var settings = await db.SearchSettings.FirstOrDefaultAsync();

    if (settings == null || string.IsNullOrEmpty(settings.ExpoPushToken))
        return Results.BadRequest(new { error = "Nenhum push token registrado. Abra o app e salve os settings primeiro." });

    if (!settings.ExpoPushToken.StartsWith("ExponentPushToken"))
        return Results.BadRequest(new { error = "Push token inválido no banco." });

    var pushMessage = new
    {
        to = settings.ExpoPushToken,
        title = "🔔 Teste de Notificação",
        body = "JobNator conectado com sucesso! As notificações estão funcionando.",
        data = new { test = true }
    };

    try
    {
        var httpClient = httpClientFactory.CreateClient();
        var response = await httpClient.PostAsJsonAsync("https://exp.host/--/api/v2/push/send", pushMessage);
        var responseBody = await response.Content.ReadAsStringAsync();

        if (response.IsSuccessStatusCode)
        {
            return Results.Ok(new
            {
                message = "Notificação de teste enviada com sucesso!",
                tokenPreview = settings.ExpoPushToken[..Math.Min(30, settings.ExpoPushToken.Length)] + "...",
                expoResponse = responseBody
            });
        }

        return Results.Problem($"Expo API retornou erro: {responseBody}");
    }
    catch (Exception ex)
    {
        return Results.Problem($"Falha ao enviar notificação: {ex.Message}");
    }
});

app.MapPost("/api/scraper/run", async (ScraperTriggerService trigger) =>
{
    if (trigger.IsScraping)
    {
        return Results.Ok(new
        {
            message = "Scraper already running. Check server logs for progress.",
            alreadyRunning = true
        });
    }

    await trigger.TriggerAsync();
    return Results.Ok(new
    {
        message = "Scrape triggered! Jobs will appear in a few minutes.",
        alreadyRunning = false
    });
});

app.MapGet("/api/scraper/status", (ScraperTriggerService trigger) =>
    Results.Ok(new { isScraping = trigger.IsScraping }));

app.Run();
