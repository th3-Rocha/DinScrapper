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
{
    var connectionString =
        Environment.GetEnvironmentVariable("DATABASE_URL")
        ?? builder.Configuration.GetConnectionString("DefaultConnection")
        ?? throw new InvalidOperationException(
            "No database connection string found. " +
            "Set the DATABASE_URL environment variable or add DefaultConnection to appsettings.json.");

    options.UseNpgsql(connectionString);
});


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

// ── GET /api/jobs ────────────────────────────────────────────────────────────
app.MapGet("/api/jobs", async (AppDbContext db) =>
{
    var jobs = await db.Jobs
        .OrderByDescending(j => j.DateScraped)
        .ToListAsync();

    return Results.Ok(jobs);
});

// ── DELETE /api/jobs ─────────────────────────────────────────────────────────
app.MapDelete("/api/jobs", async (AppDbContext db) =>
{
    var deletedCount = await db.Jobs.ExecuteDeleteAsync();
    return Results.Ok(new { message = "All jobs deleted successfully.", count = deletedCount });
});

// ── GET /api/settings ────────────────────────────────────────────────────────
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

// ── POST /api/settings ───────────────────────────────────────────────────────
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
            settings.ScrapeIntervalMinutes = newSettings.ScrapeIntervalMinutes;
        if (!string.IsNullOrEmpty(newSettings.ExpoPushToken))
            settings.ExpoPushToken = newSettings.ExpoPushToken;
    }

    await db.SaveChangesAsync();
    return Results.Ok(settings);
});

// ── POST /api/settings/push-token ────────────────────────────────────────────
app.MapPost("/api/settings/push-token", async (AppDbContext db, PushTokenRequest req) =>
{
    if (string.IsNullOrEmpty(req.ExpoPushToken) || !req.ExpoPushToken.StartsWith("ExponentPushToken"))
        return Results.BadRequest(new { error = "Invalid or missing push token." });

    var settings = await db.SearchSettings.FirstOrDefaultAsync();
    if (settings == null)
    {
        settings = new SearchSettings { ExpoPushToken = req.ExpoPushToken };
        db.SearchSettings.Add(settings);
    }
    else
    {
        settings.ExpoPushToken = req.ExpoPushToken;
    }

    await db.SaveChangesAsync();
    return Results.Ok(new
    {
        message = "Push token updated successfully.",
        tokenPreview = req.ExpoPushToken[..Math.Min(30, req.ExpoPushToken.Length)] + "..."
    });
});

// ── QR Code generation ───────────────────────────────────────────────────────
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
        backendUrlGlobal = $"http://{localIp}:5056";
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
    Console.WriteLine($"🔗 Active Connection URL: {backendUrlGlobal}");
    Console.WriteLine($"🌐 Open in browser: {backendUrlGlobal}/api/qrcode");
    Console.WriteLine("==================================================\n");
    Console.WriteLine(qrCodeAsciiGlobal);
    Console.WriteLine("==================================================\n");
}

// ── GET /api/qrcode ──────────────────────────────────────────────────────────
app.MapGet("/api/qrcode", () =>
{
    if (qrCodeImageGlobal.Length == 0)
        return Results.Problem("Could not generate QR Code (URL not defined).");

    return Results.File(qrCodeImageGlobal, "image/png");
});

// ── POST /api/notifications/test ─────────────────────────────────────────────
app.MapPost("/api/notifications/test", async (AppDbContext db, IHttpClientFactory httpClientFactory) =>
{
    var settings = await db.SearchSettings.FirstOrDefaultAsync();

    if (settings == null || string.IsNullOrEmpty(settings.ExpoPushToken))
        return Results.BadRequest(new { error = "No push token registered. Open the app and save settings first." });

    if (!settings.ExpoPushToken.StartsWith("ExponentPushToken"))
        return Results.BadRequest(new { error = "Invalid push token in database." });

    var pushMessage = new
    {
        to = settings.ExpoPushToken,
        title = "🔔 Test Notification",
        body = "JobNator connected successfully! Push notifications are working.",
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
                message = "Test notification sent successfully!",
                tokenPreview = settings.ExpoPushToken[..Math.Min(30, settings.ExpoPushToken.Length)] + "...",
                expoResponse = responseBody
            });
        }

        return Results.Problem($"Expo API returned an error: {responseBody}");
    }
    catch (Exception ex)
    {
        return Results.Problem($"Failed to send notification: {ex.Message}");
    }
});

// ── POST /api/scraper/run ────────────────────────────────────────────────────
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

// ── GET /api/scraper/status ──────────────────────────────────────────────────
app.MapGet("/api/scraper/status", (ScraperTriggerService trigger) =>
    Results.Ok(new
    {
        isScraping = trigger.IsScraping,
        lastResult = trigger.LastResult
    }));

app.Run();

record PushTokenRequest(string ExpoPushToken);
