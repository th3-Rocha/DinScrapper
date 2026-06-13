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

    public LinkedInScraperService(IServiceProvider serviceProvider, ILogger<LinkedInScraperService> logger)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        TimeSpan intervalo = TimeSpan.FromMinutes(30);
        using var timer = new PeriodicTimer(intervalo);

        do
        {
            try
            {
                _logger.LogInformation("==================================================");
                _logger.LogInformation("🚀 [INÍCIO] Raspagem acionada às: {Time}", DateTime.Now.ToString("HH:mm:ss"));

                await ScrapeJobsAsync();

                var proximaExecucao = DateTime.Now.Add(intervalo);

                _logger.LogInformation("✅ [FIM] Processo finalizado às: {Time}", DateTime.Now.ToString("HH:mm:ss"));
                _logger.LogInformation("⏳ O robô entrou em repouso. Próxima busca programada para: {ProximaTime}", proximaExecucao.ToString("HH:mm:ss"));
                _logger.LogInformation("==================================================\n");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Erro durante a execução do Scraper.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
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
        string workplaceType = Uri.EscapeDataString(settings.WorkplaceType);
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

                string textoCompleto = (tituloVaga + " " + descricaoVaga).ToLower();
                bool ehVagaDeDev = textoCompleto.Contains("c#") ||
                                   textoCompleto.Contains(".net") ||
                                   textoCompleto.Contains("asp.net") ||
                                   textoCompleto.Contains("backend developer");

                bool ehVagaRuim = tituloVaga.ToLower().Contains("suporte") ||
                                  tituloVaga.ToLower().Contains("analista de suporte") ||
                                  tituloVaga.ToLower().Contains("help desk") ||
                                  tituloVaga.ToLower().Contains("vendas");

                if (!ehVagaDeDev || ehVagaRuim)
                {
                    _logger.LogWarning("❌ Vaga descartada (Fora do perfil): {Titulo}", tituloVaga);
                    continue;
                }

                var novaVaga = new JobListing
                {
                    LinkedInId = linkedinId,
                    Title = titleElement != null ? (await titleElement.InnerTextAsync()).Trim() : "Sem Título",
                    Company = companyElement != null ? (await companyElement.InnerTextAsync()).Trim() : "Sem Empresa",
                    Location = locationElement != null ? (await locationElement.InnerTextAsync()).Trim() : "Sem Local",

                    WorkplaceType = workplaceType == "2" ? "Remoto" : (workplaceType == "3" ? "Híbrido" : "Presencial"),
                    EmploymentType = employmentType,
                    IsEasyApply = isEasyApply,

                    TimePosted = timePostedElement != null ? (await timePostedElement.InnerTextAsync()).Trim() : "",
                    ApplicantCount = applicantCountElement != null ? (await applicantCountElement.InnerTextAsync()).Trim() : "",
                    Description = descElement != null ? (await descElement.InnerTextAsync()).Trim() : "",
                    Link = link
                };

                db.Jobs.Add(novaVaga);
                await db.SaveChangesAsync();
                novasVagasCount++;


                string seuExpoPushToken = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]";

                var pushMessage = new
                {
                    to = seuExpoPushToken,
                    title = "🚨 Nova Vaga: " + novaVaga.Title,
                    body = $"{novaVaga.Company} - {novaVaga.WorkplaceType}\nCandidaturas: {novaVaga.ApplicantCount}",
                    data = new { urlVaga = novaVaga.Link }
                };

                using var httpClient = new HttpClient();
                await httpClient.PostAsJsonAsync("https://exp.host/--/api/v2/push/send", pushMessage);

                await Task.Delay(2000);
            }
        }

        await detailPage.CloseAsync();
        await page.CloseAsync();

        _logger.LogInformation("Raspagem concluída! {Count} novas vagas adicionadas.", novasVagasCount);
    }
}
