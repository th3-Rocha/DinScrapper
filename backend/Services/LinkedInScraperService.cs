using System.Diagnostics;
using System.Text.RegularExpressions;
using Backend.Data;
using Backend.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Playwright;

namespace Backend.Services;

public class LinkedInScraperService : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<LinkedInScraperService> _logger;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ScraperTriggerService _triggerService;

    // ── Browser reuse across scrape cycles ──────────────────────────────────
    private IPlaywright? _playwright;
    private IBrowser? _browser;

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

    // ─────────────────────────────────────────────────────────────────────────
    // Browser singleton — reused across cycles to avoid re-launch overhead
    // ─────────────────────────────────────────────────────────────────────────
    private async Task<IBrowser> GetBrowserAsync()
    {
        if (_browser is { IsConnected: true })
            return _browser;

        // Dispose stale instances if browser disconnected
        if (_browser != null)
        {
            try { await _browser.DisposeAsync(); } catch { /* ignore */ }
            _browser = null;
        }
        if (_playwright != null)
        {
            try { _playwright.Dispose(); } catch { /* ignore */ }
            _playwright = null;
        }

        _playwright = await Playwright.CreateAsync();
        _browser = await _playwright.Chromium.LaunchAsync(new BrowserTypeLaunchOptions
        {
            Headless = true,
            Args = new[]
            {
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",                   // fewer OS processes = less RAM
                "--disable-extensions",
                "--disable-blink-features=AutomationControlled",
                "--disable-images",                          // images not needed for scraping
                "--blink-settings=imagesEnabled=false",
                "--js-flags=--max-old-space-size=128",       // cap V8 heap
                "--window-size=1280,800",
            }
        });

        _logger.LogInformation("🌐 Browser Chromium iniciado.");
        return _browser;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Loop principal
    // ─────────────────────────────────────────────────────────────────────────
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                _logger.LogInformation("══════════════════════════════════════════════════");
                _logger.LogInformation("🚀 Raspagem iniciada às {Time}", DateTime.Now.ToString("HH:mm:ss"));

                _triggerService.SetScraping(true);
                await ScrapeJobsAsync();
                _triggerService.SetScraping(false);

                // Lê o intervalo do banco — mudanças entram no próximo ciclo
                int intervalMinutes = 30;
                using (var scope = _serviceProvider.CreateScope())
                {
                    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                    var s = await db.SearchSettings.FirstOrDefaultAsync(stoppingToken);
                    if (s != null && s.ScrapeIntervalMinutes > 0)
                        intervalMinutes = s.ScrapeIntervalMinutes;
                }

                _logger.LogInformation("⏳ Próxima raspagem em {Min}min (às {Time})",
                    intervalMinutes, DateTime.Now.AddMinutes(intervalMinutes).ToString("HH:mm:ss"));
                _logger.LogInformation("══════════════════════════════════════════════════\n");

                // Aguarda o intervalo OU um trigger manual — o que vier primeiro
                using var waitCts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                var delayTask = Task.Delay(TimeSpan.FromMinutes(intervalMinutes), waitCts.Token);
                var triggerTask = _triggerService.Reader.WaitToReadAsync(waitCts.Token).AsTask();

                await Task.WhenAny(delayTask, triggerTask);
                await waitCts.CancelAsync();

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
                _logger.LogError(ex, "❌ Erro fatal no loop do Scraper: {ExType}", ex.GetType().Name);
                try { await Task.Delay(TimeSpan.FromMinutes(5), stoppingToken); }
                catch (OperationCanceledException) { break; }
            }
        }

        // Cleanup browser on shutdown
        await DisposeBrowserAsync();
    }

    private async Task DisposeBrowserAsync()
    {
        if (_browser != null)
        {
            try { await _browser.DisposeAsync(); } catch { /* ignore */ }
            _browser = null;
        }
        if (_playwright != null)
        {
            try { _playwright.Dispose(); } catch { /* ignore */ }
            _playwright = null;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Raspagem principal
    // ─────────────────────────────────────────────────────────────────────────
    private async Task ScrapeJobsAsync()
    {
        var sw = Stopwatch.StartNew();
        var result = new ScrapeResult { RunAt = DateTime.UtcNow };
        int deletedCount = 0;

        // Context/page declared outside try so we can close them in finally
        IBrowserContext? context = null;
        IPage? page = null;

        try
        {
            using var scope = _serviceProvider.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            // ── Limpeza de vagas antigas ─────────────────────────────────────
            deletedCount = await db.Jobs
                .Where(j => j.DateScraped < DateTime.UtcNow.AddDays(-1))
                .ExecuteDeleteAsync();
            result.JobsDeleted = deletedCount;
            if (deletedCount > 0)
                _logger.LogInformation("🧹 {Count} vagas antigas removidas.", deletedCount);

            // ── Configurações ────────────────────────────────────────────────
            var settings = await db.SearchSettings.FirstOrDefaultAsync() ?? new SearchSettings();
            string keyword = Uri.EscapeDataString(settings.Keywords);
            string location = Uri.EscapeDataString(settings.Location);
            string wType = settings.WorkplaceType.ToString();
            string token = settings.ExpoPushToken;

            _logger.LogInformation("🔑 Keywords: {KW} | Location: {Loc} | Workplace: {WT}",
                settings.Keywords, settings.Location, wType);

            string searchUrl = $"https://www.linkedin.com/jobs/search?keywords={keyword}&location={location}&f_TPR=r86400&f_WT={wType}";

            // ── Playwright — reuse browser, create fresh context per cycle ───
            var browser = await GetBrowserAsync();

            context = await browser.NewContextAsync(new BrowserNewContextOptions
            {
                UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
                ViewportSize = new ViewportSize { Width = 1280, Height = 800 },
                Locale = "en-US",
                ExtraHTTPHeaders = new Dictionary<string, string>
                {
                    ["Accept-Language"] = "en-US,en;q=0.9",
                }
            });

            // ── Single page only (was two pages before — saves ~80MB) ────────
            page = await context.NewPageAsync();

            // Block images/media at the network level for extra memory savings
            await page.RouteAsync("**/*.{png,jpg,jpeg,gif,webp,svg,ico,woff,woff2,ttf}", async route =>
            {
                await route.AbortAsync();
            });

            // ── Navega para a listagem ───────────────────────────────────────
            _logger.LogInformation("🌐 Abrindo LinkedIn Jobs...");
            try
            {
                await page.GotoAsync(searchUrl, new PageGotoOptions
                {
                    WaitUntil = WaitUntilState.DOMContentLoaded,
                    Timeout = 30_000
                });
            }
            catch (TimeoutException)
            {
                result.Status = "timeout";
                result.ErrorMessage = "Timeout (30s) ao navegar para a listagem do LinkedIn.";
                _logger.LogError("⏱️ Timeout ao carregar a página de listagem.");
                return;
            }

            // Pequena pausa para JS carregar os cards
            await Task.Delay(2000);

            // ── Detecção de bloqueio ─────────────────────────────────────────
            var pageTitle = await page.TitleAsync();
            var pageTitleLow = pageTitle.ToLowerInvariant();
            result.PageTitle = pageTitle;
            _logger.LogInformation("📄 Título da página: \"{Title}\"", pageTitle);

            if (pageTitleLow.Contains("login") || pageTitleLow.Contains("sign in") || pageTitleLow.Contains("join linkedin"))
            {
                result.Status = "auth_wall";
                result.ErrorMessage = $"LinkedIn exigiu login. Título: '{pageTitle}'";
                _logger.LogWarning("🔒 Auth Wall detectado — LinkedIn está bloqueando o scraper com pedido de login.");
                return;
            }
            if (pageTitleLow.Contains("captcha") || pageTitleLow.Contains("security check") ||
                pageTitleLow.Contains("robot") || pageTitleLow.Contains("challenge"))
            {
                result.Status = "captcha";
                result.ErrorMessage = $"CAPTCHA/challenge detectado. Título: '{pageTitle}'";
                _logger.LogWarning("🤖 CAPTCHA detectado — LinkedIn bloqueou o scraper.");
                return;
            }

            // ── Coleta todos os links primeiro (evita manter IElementHandles vivos) ──
            var jobCards = await page.QuerySelectorAllAsync("a.base-card__full-link");
            result.JobsFound = jobCards.Count;
            _logger.LogInformation("🔍 {Count} cards de vagas encontrados na listagem.", jobCards.Count);

            if (jobCards.Count == 0)
            {
                var alt1 = (await page.QuerySelectorAllAsync(".job-search-card")).Count;
                var alt2 = (await page.QuerySelectorAllAsync("[data-entity-urn*='jobPosting']")).Count;
                result.Status = "empty";
                result.ErrorMessage = $"Seletor 'a.base-card__full-link' = 0. Seletores alt: .job-search-card={alt1}, data-entity-urn={alt2}. Título: '{pageTitle}'";
                _logger.LogWarning("⚠️ Nenhum card encontrado. Diagnóstico → .job-search-card={A1} | data-entity-urn={A2}", alt1, alt2);
                return;
            }

            // Collect all links upfront, then release the element handles
            var links = new List<(string link, long linkedId)>();
            foreach (var card in jobCards)
            {
                string href = await card.GetAttributeAsync("href") ?? "";
                href = href.Split('?')[0];
                var idMatch = Regex.Match(href, @"\d{8,10}");
                long linkedId = idMatch.Success ? long.Parse(idMatch.Value) : 0;
                if (linkedId != 0)
                    links.Add((href, linkedId));
            }
            // Release element handles — frees JS heap on the page
            jobCards = null!;

            // ── Processa cada link usando a mesma page (sem detailPage separada) ─
            int novas = 0;
            int filtradas = 0;
            int skip = 0;

            // Collect new jobs in memory, save all at once at the end
            var novasVagas = new List<JobListing>();

            foreach (var (link, linkedId) in links)
            {
                // Check DB before loading page
                if (db.Jobs.Any(j => j.LinkedInId == linkedId || j.Link == link))
                {
                    skip++;
                    continue;
                }

                try
                {
                    await page.GotoAsync(link, new PageGotoOptions
                    {
                        WaitUntil = WaitUntilState.DOMContentLoaded,
                        Timeout = 20_000
                    });
                }
                catch (TimeoutException)
                {
                    _logger.LogWarning("⏱️ Timeout no detalhe, pulando: {Link}", link);
                    skip++;
                    continue;
                }

                await Task.Delay(1000);

                var titleEl = await page.QuerySelectorAsync(".top-card-layout__title");
                var companyEl = await page.QuerySelectorAsync(".topcard__org-name-link");
                var locationEl = await page.QuerySelectorAsync(".topcard__flavor--bullet");
                var timeEl = await page.QuerySelectorAsync(".posted-time-ago__text");
                var applicantsEl = await page.QuerySelectorAsync(".num-applicants__caption");
                var descEl = await page.QuerySelectorAsync(".description__text");
                var topCardEl = await page.QuerySelectorAsync(".top-card-layout");
                string topText = topCardEl != null ? await topCardEl.InnerTextAsync() : "";

                bool easyApply = topText.Contains("Candidatura simplificada", StringComparison.OrdinalIgnoreCase) ||
                                 topText.Contains("Easy Apply", StringComparison.OrdinalIgnoreCase);

                var criteria = await page.QuerySelectorAllAsync(".description__job-criteria-item");
                string empType = "";
                if (criteria.Count >= 2)
                {
                    empType = await criteria[1].InnerTextAsync();
                    empType = empType.Replace("Tipo de emprego", "").Replace("Employment type", "").Trim();
                }

                string titulo = titleEl != null ? (await titleEl.InnerTextAsync()).Trim() : "";
                string desc = descEl != null ? (await descEl.InnerTextAsync()).Trim() : "";

                // Pega a string de candidatos em texto limpo
                string applicantsCount = applicantsEl != null ? (await applicantsEl.InnerTextAsync()).Trim() : "";

                var tituloLow = titulo.ToLowerInvariant();
                bool ruim = tituloLow.Contains("suporte") ||
                            tituloLow.Contains("help desk") ||
                            tituloLow.Contains("vendas") ||
                            tituloLow.Contains("atendimento") ||
                            tituloLow.Contains("professor") ||
                            tituloLow.Contains("tutor") ||
                            tituloLow.Contains("analista de suporte");

                if (ruim)
                {
                    _logger.LogInformation("🗑️  Filtrada: \"{Title}\"", titulo);
                    filtradas++;
                    continue;
                }

                // ========================================================
                // NOVO FILTRO: Descarta se tiver mais de 200 candidatos
                // ========================================================
                if (applicantsCount.Contains("Over 200 applicants", StringComparison.OrdinalIgnoreCase))
                {
                    _logger.LogInformation("🗑️  Filtrada (Concorrência muito alta): \"{Title}\" [{Applicants}]", titulo, applicantsCount);
                    filtradas++;
                    continue;
                }

                string wpLabel = wType == "2" ? "Remoto" : wType == "3" ? "Híbrido" : "Presencial";

                var novaVaga = new JobListing
                {
                    LinkedInId = linkedId,
                    Title = titulo != "" ? titulo : "Sem Título",
                    Company = companyEl != null ? (await companyEl.InnerTextAsync()).Trim() : "Sem Empresa",
                    Location = locationEl != null ? (await locationEl.InnerTextAsync()).Trim() : "Sem Local",
                    WorkplaceType = wpLabel,
                    EmploymentType = empType,
                    IsEasyApply = easyApply,
                    TimePosted = timeEl != null ? (await timeEl.InnerTextAsync()).Trim() : "",
                    ApplicantCount = applicantsCount, // Reaproveitamos a variável limpa
                    Description = desc,
                    Link = link
                };

                novasVagas.Add(novaVaga);
                novas++;
                _logger.LogInformation("✅ Nova: \"{Title}\" @ {Company}", novaVaga.Title, novaVaga.Company);

                await Task.Delay(1500);
            }

            // ── Single batch SaveChanges instead of one per job ──────────────
            if (novasVagas.Count > 0)
            {
                db.Jobs.AddRange(novasVagas);
                await db.SaveChangesAsync();

                // Send push notifications after saving
                foreach (var vaga in novasVagas)
                    await SendPushNotificationAsync(token, vaga);
            }

            result.Status = "ok";
            result.Success = true;
            result.JobsNew = novas;
            result.JobsFiltered = filtradas;
            result.JobsSkipped = skip;

            _logger.LogInformation(
                "📊 Resultado final → {New} novas | {Filtered} filtradas | {Skip} já existentes | {Del} removidas",
                novas, filtradas, skip, deletedCount);
        }
        catch (Exception ex)
        {
            result.Status = "error";
            result.Success = false;
            result.ErrorMessage = $"{ex.GetType().Name}: {ex.Message}";
            _logger.LogError(ex, "❌ Exceção em ScrapeJobsAsync — {ExType}: {Msg}",
                ex.GetType().Name, ex.Message);
            throw;
        }
        finally
        {
            // Always close page and context — browser stays alive for reuse
            if (page != null)
            {
                try { await page.CloseAsync(); } catch { /* ignore */ }
            }
            if (context != null)
            {
                try { await context.DisposeAsync(); } catch { /* ignore */ }
            }

            sw.Stop();
            result.DurationSeconds = sw.Elapsed.TotalSeconds;
            _triggerService.SetLastResult(result);
            _logger.LogInformation("⏱️ Duração: {Sec:F1}s", sw.Elapsed.TotalSeconds);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Push notification
    // ─────────────────────────────────────────────────────────────────────────
    private async Task SendPushNotificationAsync(string expoPushToken, JobListing vaga)
    {
        if (string.IsNullOrEmpty(expoPushToken) || !expoPushToken.StartsWith("ExponentPushToken"))
        {
            _logger.LogInformation("🔕 Push ignorado: token ausente ou inválido.");
            return;
        }

        string cleanDesc = Regex.Replace(vaga.Description ?? "", @"\s+", " ").Trim();
        string shortDesc = cleanDesc.Length > 90 ? cleanDesc.Substring(0, 90) + "..." : cleanDesc;

        var pushMessage = new
        {
            to = expoPushToken,
            title = "New Job: " + vaga.Title,
            body = $"{vaga.Company} · {vaga.WorkplaceType} | {vaga.ApplicantCount}\n{shortDesc}",
            data = new { urlVaga = vaga.Link }
        };

        try
        {
            var http = _httpClientFactory.CreateClient();
            var response = await http.PostAsJsonAsync("https://exp.host/--/api/v2/push/send", pushMessage);

            if (response.IsSuccessStatusCode)
                _logger.LogInformation("🔔 Push enviado: \"{Title}\"", vaga.Title);
            else
            {
                var body = await response.Content.ReadAsStringAsync();
                _logger.LogWarning("⚠️ Expo Push erro {Status}: {Body}", (int)response.StatusCode, body);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "❌ Falha ao enviar push notification.");
        }
    }
}
