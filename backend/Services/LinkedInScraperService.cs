using System.Text.RegularExpressions;
using Backend.Data;
using Backend.Models;
using Microsoft.Playwright;
using Microsoft.EntityFrameworkCore;

namespace Backend.Services;

public class LinkedInScraperService : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<LinkedInScraperService> _logger;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ScraperTriggerService _triggerService;

    public LinkedInScraperService(
        IServiceProvider serviceProvider,
        ILogger<LinkedInScraperService> logger,
        IHttpClientFactory httpClientFactory,
        ScraperTriggerService triggerService)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
        _httpClientFactory = httpClientFactory;
        _triggerService = triggerService;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                _logger.LogInformation("==================================================");
                _logger.LogInformation("🚀 [INÍCIO] Raspagem acionada às: {Time}", DateTime.Now.ToString("HH:mm:ss"));

                _triggerService.SetScraping(true);
                await ScrapeJobsAsync();
                _triggerService.SetScraping(false);

                // Lê o intervalo do banco após cada rodada — mudanças de settings entram no próximo ciclo
                int intervalMinutes = 30;
                using (var scope = _serviceProvider.CreateScope())
                {
                    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                    var s = await db.SearchSettings.FirstOrDefaultAsync(stoppingToken);
                    if (s != null && s.ScrapeIntervalMinutes > 0)
                        intervalMinutes = s.ScrapeIntervalMinutes;
                }

                var nextRun = DateTime.Now.AddMinutes(intervalMinutes);
                _logger.LogInformation("✅ [FIM] Processo finalizado às: {Time}", DateTime.Now.ToString("HH:mm:ss"));
                _logger.LogInformation("⏳ Próxima busca em {Min}min, às {ProximaTime}", intervalMinutes, nextRun.ToString("HH:mm:ss"));
                _logger.LogInformation("==================================================\n");

                // Aguarda o intervalo OU um trigger manual — o que vier primeiro
                using var waitCts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                var delayTask = Task.Delay(TimeSpan.FromMinutes(intervalMinutes), waitCts.Token);
                var triggerTask = _triggerService.Reader.WaitToReadAsync(waitCts.Token).AsTask();

                await Task.WhenAny(delayTask, triggerTask);
                await waitCts.CancelAsync(); // cancela o que não venceu

                // Drena o canal para o próximo ciclo começar limpo
                while (_triggerService.Reader.TryRead(out _)) { }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _triggerService.SetScraping(false);
                _logger.LogError(ex, "❌ Erro durante a execução do Scraper.");
                try { await Task.Delay(TimeSpan.FromMinutes(5), stoppingToken); }
                catch (OperationCanceledException) { break; }
            }
        }
    }

    private async Task ScrapeJobsAsync()
    {
        using var scope = _serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var deletedCount = await db.Jobs
            .Where(j => j.DateScraped < DateTime.UtcNow.AddDays(-1))
            .ExecuteDeleteAsync();

        if (deletedCount > 0)
        {
            _logger.LogInformation("🧹 Faxina: {Count} vagas antigas foram removidas do banco.", deletedCount);
        }

        var settings = await db.SearchSettings.FirstOrDefaultAsync() ?? new SearchSettings();

        string keyword = Uri.EscapeDataString(settings.Keywords);
        string location = Uri.EscapeDataString(settings.Location);
        string workplaceType = settings.WorkplaceType.ToString();

        // Pega o token dinâmico salvo no banco pelo seu aplicativo
        string expoPushToken = settings.ExpoPushToken;

        string url = $"https://www.linkedin.com/jobs/search?keywords={keyword}&location={location}&f_TPR=r86400&f_WT={workplaceType}";

        using var playwright = await Playwright.CreateAsync();
        await using var browser = await playwright.Chromium.LaunchAsync(new BrowserTypeLaunchOptions { Headless = true });

        var page = await browser.NewPageAsync();
        var detailPage = await browser.NewPageAsync();

        await page.GotoAsync(url, new PageGotoOptions { WaitUntil = WaitUntilState.NetworkIdle });
        var jobCards = await page.QuerySelectorAllAsync("a.base-card__full-link");

        int novasVagasCount = 0;

        foreach (var card in jobCards)
        {
            string link = await card.GetAttributeAsync("href") ?? "";
            link = link.Split('?')[0];
            var idMatch = Regex.Match(link, @"\d{8,10}");
            long linkedinId = idMatch.Success ? long.Parse(idMatch.Value) : 0;

            bool vagaExiste = db.Jobs.Any(j => j.LinkedInId == linkedinId || j.Link == link);

            if (!vagaExiste && linkedinId != 0)
            {
                await detailPage.GotoAsync(link, new PageGotoOptions { WaitUntil = WaitUntilState.DOMContentLoaded });
                await Task.Delay(1500);

                var titleElement = await detailPage.QuerySelectorAsync(".top-card-layout__title");
                var companyElement = await detailPage.QuerySelectorAsync(".topcard__org-name-link");
                var locationElement = await detailPage.QuerySelectorAsync(".topcard__flavor--bullet");
                var timePostedElement = await detailPage.QuerySelectorAsync(".posted-time-ago__text");
                var applicantCountElement = await detailPage.QuerySelectorAsync(".num-applicants__caption");
                var descElement = await detailPage.QuerySelectorAsync(".description__text");
                var topCardElement = await detailPage.QuerySelectorAsync(".top-card-layout");
                string topCardText = topCardElement != null ? await topCardElement.InnerTextAsync() : "";

                bool isEasyApply = topCardText.Contains("Candidatura simplificada", StringComparison.OrdinalIgnoreCase) ||
                                   topCardText.Contains("Easy Apply", StringComparison.OrdinalIgnoreCase);

                var criteriaElements = await detailPage.QuerySelectorAllAsync(".description__job-criteria-item");
                string employmentType = "";

                if (criteriaElements.Count >= 2)
                {
                    employmentType = await criteriaElements[1].InnerTextAsync();
                    employmentType = employmentType.Replace("Tipo de emprego", "").Replace("Employment type", "").Trim();
                }

                string tituloVaga = titleElement != null ? (await titleElement.InnerTextAsync()).Trim() : "";
                string descricaoVaga = descElement != null ? (await descElement.InnerTextAsync()).Trim() : "";

                // ==========================================
                // NOVO FILTRO: Limpa Lixo Universal
                // ==========================================
                string tituloLower = tituloVaga.ToLower();

                bool ehVagaRuim = tituloLower.Contains("suporte") ||
                                  tituloLower.Contains("analista de suporte") ||
                                  tituloLower.Contains("help desk") ||
                                  tituloLower.Contains("vendas") ||
                                  tituloLower.Contains("atendimento") ||
                                  tituloLower.Contains("professor") ||
                                  tituloLower.Contains("tutor");

                if (ehVagaRuim)
                {
                    _logger.LogWarning("❌ Vaga descartada (Lixo/Suporte/Vendas): {Titulo}", tituloVaga);
                    continue;
                }

                var novaVaga = new JobListing
                {
                    LinkedInId = linkedinId,
                    Title = tituloVaga != "" ? tituloVaga : "Sem Título",
                    Company = companyElement != null ? (await companyElement.InnerTextAsync()).Trim() : "Sem Empresa",
                    Location = locationElement != null ? (await locationElement.InnerTextAsync()).Trim() : "Sem Local",
                    WorkplaceType = workplaceType == "2" ? "Remoto" : (workplaceType == "3" ? "Híbrido" : "Presencial"),
                    EmploymentType = employmentType,
                    IsEasyApply = isEasyApply,
                    TimePosted = timePostedElement != null ? (await timePostedElement.InnerTextAsync()).Trim() : "",
                    ApplicantCount = applicantCountElement != null ? (await applicantCountElement.InnerTextAsync()).Trim() : "",
                    Description = descricaoVaga,
                    Link = link
                };

                db.Jobs.Add(novaVaga);
                await db.SaveChangesAsync();
                novasVagasCount++;

                await SendPushNotificationAsync(expoPushToken, novaVaga);

                await Task.Delay(2000);
            }
        }

        await detailPage.CloseAsync();
        await page.CloseAsync();

        _logger.LogInformation("Raspagem concluída! {Count} novas vagas adicionadas.", novasVagasCount);
    }

    private async Task SendPushNotificationAsync(string expoPushToken, JobListing vaga)
    {
        if (string.IsNullOrEmpty(expoPushToken) || !expoPushToken.StartsWith("ExponentPushToken"))
        {
            _logger.LogInformation("🔕 Notificação ignorada: Push Token ausente ou inválido.");
            return;
        }

        var pushMessage = new
        {
            to = expoPushToken,
            title = "🚨 Nova Vaga: " + vaga.Title,
            body = $"{vaga.Company} · {vaga.WorkplaceType}\n{vaga.ApplicantCount}",
            data = new { urlVaga = vaga.Link }
        };

        try
        {
            var httpClient = _httpClientFactory.CreateClient();
            var response = await httpClient.PostAsJsonAsync(
                "https://exp.host/--/api/v2/push/send", pushMessage);

            if (response.IsSuccessStatusCode)
            {
                _logger.LogInformation("🔔 Push enviado: {Title}", vaga.Title);
            }
            else
            {
                var body = await response.Content.ReadAsStringAsync();
                _logger.LogWarning("⚠️ Expo Push API retornou erro {Status}: {Body}",
                    (int)response.StatusCode, body);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "❌ Falha ao enviar push notification.");
        }
    }
}
