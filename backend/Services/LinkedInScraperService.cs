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
    // Helper: Extrai as palavras que queremos forçar a ter no título
    // ─────────────────────────────────────────────────────────────────────────
    private List<string> ExtrairPalavrasChave(string keywordQuery)
    {
        var terms = new List<string>();
        // Pega tudo que estiver entre aspas duplas na query do banco
        var matches = Regex.Matches(keywordQuery, "\"([^\"]+)\"");
        foreach (Match match in matches)
        {
            if (match.Groups.Count > 1)
                terms.Add(match.Groups[1].Value.ToLowerInvariant());
        }
        return terms;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Raspagem principal
    // ─────────────────────────────────────────────────────────────────────────
    private async Task ScrapeJobsAsync()
    {
        var sw = Stopwatch.StartNew();
        var result = new ScrapeResult { RunAt = DateTime.UtcNow };
        int deletedCount = 0;

        IBrowserContext? context = null;
        IPage? listPage = null; // A página que carrega a listagem

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

            // Extrai a lógica do Filtro Strict
            bool isStrictSearch = settings.Keywords.StartsWith("title:(");
            List<string> requiredTerms = ExtrairPalavrasChave(settings.Keywords);

            _logger.LogInformation("🔑 Keywords: {KW} | Location: {Loc} | Strict Mode: {Strict}",
                settings.Keywords, settings.Location, isStrictSearch);

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

            // ── Carrega a listagem ───────────────────────────────────────
            listPage = await context.NewPageAsync();

            // Block images/media
            await listPage.RouteAsync("**/*.{png,jpg,jpeg,gif,webp,svg,ico,woff,woff2,ttf}", async route =>
            {
                await route.AbortAsync();
            });

            _logger.LogInformation("🌐 Abrindo LinkedIn Jobs...");
            try
            {
                await listPage.GotoAsync(searchUrl, new PageGotoOptions
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

            await Task.Delay(2000);

            var pageTitle = await listPage.TitleAsync();
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

            var jobCards = await listPage.QuerySelectorAllAsync("a.base-card__full-link");
            result.JobsFound = jobCards.Count;
            _logger.LogInformation("🔍 {Count} cards de vagas encontrados na listagem.", jobCards.Count);

            if (jobCards.Count == 0)
            {
                var alt1 = (await listPage.QuerySelectorAllAsync(".job-search-card")).Count;
                var alt2 = (await listPage.QuerySelectorAllAsync("[data-entity-urn*='jobPosting']")).Count;
                result.Status = "empty";
                result.ErrorMessage = $"Seletor 'a.base-card__full-link' = 0. Seletores alt: .job-search-card={alt1}, data-entity-urn={alt2}. Título: '{pageTitle}'";
                _logger.LogWarning("⚠️ Nenhum card encontrado. Diagnóstico → .job-search-card={A1} | data-entity-urn={A2}", alt1, alt2);
                return;
            }

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
            jobCards = null!;

            // ⚠️ EXTREMAMENTE IMPORTANTE: Fecha a página de listagem para liberar RAM!
            await listPage.CloseAsync();
            listPage = null;

            int novas = 0;
            int filtradas = 0;
            int skip = 0;

            var novasVagas = new List<JobListing>();

            foreach (var (link, linkedId) in links)
            {
                if (db.Jobs.Any(j => j.LinkedInId == linkedId || j.Link == link))
                {
                    skip++;
                    continue;
                }

                IPage? detailPage = null;

                try
                {
                    // ⚠️ Cria uma aba "descartável" apenas para esta vaga
                    detailPage = await context.NewPageAsync();
                    await detailPage.RouteAsync("**/*.{png,jpg,jpeg,gif,webp,svg,ico,woff,woff2,ttf}", async route => await route.AbortAsync());

                    await detailPage.GotoAsync(link, new PageGotoOptions
                    {
                        WaitUntil = WaitUntilState.DOMContentLoaded,
                        Timeout = 20_000
                    });

                    await detailPage.WaitForSelectorAsync(".top-card-layout__title", new PageWaitForSelectorOptions { Timeout = 8000 });

                    var titleEl = await detailPage.QuerySelectorAsync(".top-card-layout__title");
                    var companyEl = await detailPage.QuerySelectorAsync(".topcard__org-name-link");
                    var locationEl = await detailPage.QuerySelectorAsync(".topcard__flavor--bullet");
                    var timeEl = await detailPage.QuerySelectorAsync(".posted-time-ago__text");
                    var applicantsEl = await detailPage.QuerySelectorAsync(".num-applicants__caption");
                    var descEl = await detailPage.QuerySelectorAsync(".description__text");
                    var topCardEl = await detailPage.QuerySelectorAsync(".top-card-layout");
                    string topText = topCardEl != null ? await topCardEl.InnerTextAsync() : "";

                    var applyBtnEl = await detailPage.QuerySelectorAsync(".jobs-apply-button--top-card button, .jobs-apply-button, .jobs-s-apply button");
                    string applyText = applyBtnEl != null ? await applyBtnEl.InnerTextAsync() : "";

                    bool easyApply = topText.Contains("Candidatura simplificada", StringComparison.OrdinalIgnoreCase) ||
                                     topText.Contains("Easy Apply", StringComparison.OrdinalIgnoreCase) ||
                                     applyText.Contains("simplificada", StringComparison.OrdinalIgnoreCase) ||
                                     applyText.Contains("Easy Apply", StringComparison.OrdinalIgnoreCase);

                    var criteria = await detailPage.QuerySelectorAllAsync(".description__job-criteria-item");
                    string empType = "";
                    if (criteria.Count >= 2)
                    {
                        empType = await criteria[1].InnerTextAsync();
                        empType = empType.Replace("Tipo de emprego", "").Replace("Employment type", "").Trim();
                    }

                    string titulo = titleEl != null ? (await titleEl.InnerTextAsync()).Trim() : "";
                    string desc = descEl != null ? (await descEl.InnerTextAsync()).Trim() : "";
                    string applicantsCount = applicantsEl != null ? (await applicantsEl.InnerTextAsync()).Trim() : "";

                    var tituloLow = titulo.ToLowerInvariant();

                    // 1. FILTRO BÁSICO (Lixo)
                    bool ruim = tituloLow.Contains("suporte") ||
                                tituloLow.Contains("help desk") ||
                                tituloLow.Contains("vendas") ||
                                tituloLow.Contains("atendimento") ||
                                tituloLow.Contains("professor") ||
                                tituloLow.Contains("tutor") ||
                                tituloLow.Contains("analista de suporte");

                    if (ruim || applicantsCount.Contains("Over 200 applicants", StringComparison.OrdinalIgnoreCase))
                    {
                        _logger.LogInformation("🗑️  Filtrada (Lixo ou Concorrência alta): \"{Title}\"", titulo);
                        filtradas++;
                        continue;
                    }

                    // 2. FILTRO STRICT (O Cão de Guarda contra falsos positivos)
                    if (isStrictSearch && requiredTerms.Count > 0)
                    {
                        bool temKeyword = false;
                        foreach (var term in requiredTerms)
                        {
                            // A palavra tem que estar no título.
                            // Tratamento especial pro C# porque o LinkedIn as vezes escreve C Sharp
                            if (tituloLow.Contains(term) || (term == "c#" && tituloLow.Contains("c sharp")))
                            {
                                temKeyword = true;
                                break;
                            }
                        }

                        if (!temKeyword)
                        {
                            _logger.LogWarning("🛡️  Filtrada (Falso Positivo do LinkedIn): \"{Title}\" não contém as linguagens exigidas.", titulo);
                            filtradas++;
                            continue;
                        }
                    }

                    string topTextLow = topText.ToLowerInvariant();
                    string wpLabelReal = "";

                    if (topTextLow.Contains("remoto") || topTextLow.Contains("remote"))
                    {
                        wpLabelReal = "Remoto";
                    }
                    else if (topTextLow.Contains("híbrido") || topTextLow.Contains("hybrid") || topTextLow.Contains("hibrido"))
                    {
                        wpLabelReal = "Híbrido";
                    }
                    else if (topTextLow.Contains("presencial") || topTextLow.Contains("on-site") || topTextLow.Contains("onsite"))
                    {
                        wpLabelReal = "Presencial";
                    }
                    else
                    {
                        wpLabelReal = wType == "2" ? "Remoto" : wType == "3" ? "Híbrido" : "Presencial";
                    }
                    string topTextLow = topText.ToLowerInvariant();
                    string wpLabelReal = "";

                    if (topTextLow.Contains("remoto") || topTextLow.Contains("remote"))
                    {
                        wpLabelReal = "Remoto";
                    }
                    else if (topTextLow.Contains("híbrido") || topTextLow.Contains("hybrid") || topTextLow.Contains("hibrido"))
                    {
                        wpLabelReal = "Híbrido";
                    }
                    else if (topTextLow.Contains("presencial") || topTextLow.Contains("on-site") || topTextLow.Contains("onsite"))
                    {
                        wpLabelReal = "Presencial";
                    }
                    else
                    {
                        wpLabelReal = wType == "2" ? "Remoto" : wType == "3" ? "Híbrido" : "Presencial";
                    }
                    bool workplaceValido = false;

                    if (wType == "2")
                    {
                        workplaceValido = (wpLabelReal == "Remoto");
                    }
                    else if (wType == "3")
                    {
                        workplaceValido = (wpLabelReal == "Híbrido" || wpLabelReal == "Remoto");
                    }
                    else if (wType == "1")
                    {
                        workplaceValido = (wpLabelReal == "Presencial");
                    }
                    else
                    {
                        workplaceValido = true;
                    }

                    if (!workplaceValido)
                    {
                        _logger.LogInformation("🗑️  Filtrada (Modelo de trabalho incorreto): \"{Title}\" é {Real}, mas você pediu {Filtro}.", titulo, wpLabelReal, wType == "2" ? "Remoto" : "Híbrido");
                        filtradas++;
                        continue;
                    }
                    var novaVaga = new JobListing
                    {
                        LinkedInId = linkedId,
                        Title = titulo != "" ? titulo : "Sem Título",
                        Company = companyEl != null ? (await companyEl.InnerTextAsync()).Trim() : "Sem Empresa",
                        Location = locationEl != null ? (await locationEl.InnerTextAsync()).Trim() : "Sem Local",
                        WorkplaceType = wpLabelReal,
                        EmploymentType = empType,
                        IsEasyApply = easyApply,
                        TimePosted = timeEl != null ? (await timeEl.InnerTextAsync()).Trim() : "",
                        ApplicantCount = applicantsCount,
                        Description = desc,
                        Link = link
                    };

                    novasVagas.Add(novaVaga);
                    novas++;
                    _logger.LogInformation("✅ Nova: \"{Title}\" @ {Company}", novaVaga.Title, novaVaga.Company);

                    await Task.Delay(500);
                }
                catch (TimeoutException)
                {
                    _logger.LogWarning("⏱️ Timeout ou bloqueio ao carregar detalhes da vaga, pulando: {Link}", link);
                    skip++;
                    continue;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning("⚠️ Erro desconhecido ao processar vaga, pulando: {Link}. Erro: {Msg}", link, ex.Message);
                    skip++;
                    continue;
                }
                finally
                {
                    // ⚠️ O SEGREDO DO HEROKU: Destrói a aba imediatamente após raspar a vaga
                    if (detailPage != null)
                    {
                        try { await detailPage.CloseAsync(); } catch { /* ignore */ }
                    }
                }
            }

            if (novasVagas.Count > 0)
            {
                db.Jobs.AddRange(novasVagas);
                await db.SaveChangesAsync();

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
            if (listPage != null)
            {
                try { await listPage.CloseAsync(); } catch { /* ignore */ }
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
