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

        // =========================================================
        // 🧹 FAXINA: Deleta vagas com mais de 24 horas (Performance máxima via ExecuteDeleteAsync)
        // =========================================================
        var deletedCount = await db.Jobs
            .Where(j => j.DateScraped < DateTime.UtcNow.AddDays(-1))
            .ExecuteDeleteAsync();

        if (deletedCount > 0)
        {
            _logger.LogInformation("🧹 Faxina: {Count} vagas antigas foram removidas do banco.", deletedCount);
        }

        // =========================================================
        // ⚙️ LER CONFIGURAÇÕES DO BANCO
        // =========================================================
        var settings = await db.SearchSettings.FirstOrDefaultAsync() ?? new SearchSettings();

        string keyword = Uri.EscapeDataString(settings.Keywords);
        string location = Uri.EscapeDataString(settings.Location);
        string workplaceType = Uri.EscapeDataString(settings.WorkplaceType);
        string expoPushToken = settings.ExpoPushToken;

        string url = $"https://www.linkedin.com/jobs/search?keywords={keyword}&location={location}&f_TPR=r86400&f_WT={workplaceType}";

        // ... O resto do seu código do Playwright continua exatamente igual ...
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
            link = link.Split('?')[0]; // Remove parâmetros de rastreio

            // Extrai o ID numérico do LinkedIn direto da URL usando Regex (geralmente tem 8 a 10 dígitos)
            var idMatch = Regex.Match(link, @"\d{8,10}");
            long linkedinId = idMatch.Success ? long.Parse(idMatch.Value) : 0;

            // Verifica pelo Link OU pelo ID do LinkedIn para evitar duplicadas
            bool vagaExiste = db.Jobs.Any(j => j.LinkedInId == linkedinId || j.Link == link);

            if (!vagaExiste && linkedinId != 0)
            {
                await detailPage.GotoAsync(link, new PageGotoOptions { WaitUntil = WaitUntilState.DOMContentLoaded });
                await Task.Delay(1500);
                // Extração dos elementos da página de detalhes
                var titleElement = await detailPage.QuerySelectorAsync(".top-card-layout__title");
                var companyElement = await detailPage.QuerySelectorAsync(".topcard__org-name-link");
                var locationElement = await detailPage.QuerySelectorAsync(".topcard__flavor--bullet");
                var timePostedElement = await detailPage.QuerySelectorAsync(".posted-time-ago__text");
                var applicantCountElement = await detailPage.QuerySelectorAsync(".num-applicants__caption");
                var descElement = await detailPage.QuerySelectorAsync(".description__text");

                // Identifica se é "Candidatura Simplificada" (Easy Apply)
                // O botão de aplicar do próprio LinkedIn costuma ter textos específicos ou abrir modais
                // Identifica se é "Candidatura Simplificada" (Easy Apply) lendo todo o cabeçalho
                var topCardElement = await detailPage.QuerySelectorAsync(".top-card-layout");
                string topCardText = topCardElement != null ? await topCardElement.InnerTextAsync() : "";

                bool isEasyApply = topCardText.Contains("Candidatura simplificada", StringComparison.OrdinalIgnoreCase) ||
                                   topCardText.Contains("Easy Apply", StringComparison.OrdinalIgnoreCase);
                // Extrai todos os critérios da vaga (Tempo Integral, Pleno-Sênior, etc)
                var criteriaElements = await detailPage.QuerySelectorAllAsync(".description__job-criteria-item");
                string employmentType = "";

                // No LinkedIn, o 2º item da lista (índice 1) costuma ser o "Tipo de Emprego"
                if (criteriaElements.Count >= 2)
                {
                    employmentType = await criteriaElements[1].InnerTextAsync();
                    employmentType = employmentType.Replace("Tipo de emprego", "").Replace("Employment type", "").Trim();
                }
                string tituloVaga = titleElement != null ? (await titleElement.InnerTextAsync()).Trim() : "";
                string descricaoVaga = descElement != null ? (await descElement.InnerTextAsync()).Trim() : "";

                // =========================================================
                // 🛡️ PENEIRA DE OURO: Validação Estrita de Vaga
                // =========================================================
                string textoCompleto = (tituloVaga + " " + descricaoVaga).ToLower();

                // Aqui você define as linguagens e frameworks que OBRIGATORIAMENTE
                // precisam estar na vaga para valer a pena você se candidatar.
                bool ehVagaDeDev = textoCompleto.Contains("c#") ||
                                   textoCompleto.Contains(".net") ||
                                   textoCompleto.Contains("asp.net") ||
                                   textoCompleto.Contains("backend developer");

                // Palavras-chave negativas (se tiver isso no título, pula a vaga na hora)
                bool ehVagaRuim = tituloVaga.ToLower().Contains("suporte") ||
                                  tituloVaga.ToLower().Contains("analista de suporte") ||
                                  tituloVaga.ToLower().Contains("help desk") ||
                                  tituloVaga.ToLower().Contains("vendas");

                // Se não for vaga de dev, ou se for uma vaga ruim, ignora e vai para o próximo card
                if (!ehVagaDeDev || ehVagaRuim)
                {
                    _logger.LogWarning("❌ Vaga descartada (Fora do perfil): {Titulo}", tituloVaga);
                    continue; // Pula todo o código de inserção e vai para a próxima
                }
                // =========================================================

                // Agora sim, você cria a entidade JobListing e salva no banco
                var novaVaga = new JobListing
                {
                    LinkedInId = linkedinId,
                    Title = titleElement != null ? (await titleElement.InnerTextAsync()).Trim() : "Sem Título",
                    Company = companyElement != null ? (await companyElement.InnerTextAsync()).Trim() : "Sem Empresa",
                    Location = locationElement != null ? (await locationElement.InnerTextAsync()).Trim() : "Sem Local",

                    // Se passamos "2" no filtro, podemos forçar o dado como Remoto, ou ler do locationElement
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
