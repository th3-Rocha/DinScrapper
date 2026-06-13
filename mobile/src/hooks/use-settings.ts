import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { Platform } from "react-native";

import { useApiUrl } from "./use-api-url";
import { IS_DEV } from "../utils/environment";

/** 1 = On-site, 2 = Remote, 3 = Hybrid (matches the C# backend enum) */
export type WorkplaceType = 1 | 2 | 3;

/** Intervalo em minutos entre raspagens automáticas */
export type ScrapeInterval = 15 | 30 | 60 | 180;

export interface JobSettings {
  keywords: string;
  location: string;
  workplaceType: WorkplaceType;
  scrapeIntervalMinutes: ScrapeInterval;
}

const DEFAULT_SETTINGS: JobSettings = {
  keywords: "",
  location: "",
  workplaceType: 2,
  scrapeIntervalMinutes: 30,
};

/** Trunca o token para exibição: ExponentPushToken[...últimos8] */
function formatTokenPreview(token: string): string {
  const m = token.match(/^(ExponentPushToken\[)(.+)(\])$/);
  if (!m) return `${token.slice(0, 22)}\u2026`;
  return `${m[1]}\u2026${m[2].slice(-8)}${m[3]}`;
}

export function useSettings() {
  const {
    apiUrl,
    loading: apiUrlLoading,
    setApiUrl,
    clearApiUrl,
  } = useApiUrl();

  const [settings, setSettings] = useState<JobSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scraping, setScraping] = useState(false);
  const [tokenRegistered, setTokenRegistered] = useState(false);
  const [tokenSaving, setTokenSaving] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenPreview, setTokenPreview] = useState<string | null>(null);

  /** GET /api/settings — pulls current backend config into local state */
  const fetchSettings = useCallback(
    async (urlOverride?: string) => {
      const url = urlOverride ?? apiUrl;
      if (!url) return;

      try {
        const res = await axios.get(`${url}/api/settings`, { timeout: 8000 });
        const data = res.data ?? {};
        setSettings({
          keywords: data.keywords ?? "",
          location: data.location ?? "",
          workplaceType: (Number(data.workplaceType) as WorkplaceType) ?? 2,
          scrapeIntervalMinutes: (Number(data.scrapeIntervalMinutes) ||
            30) as ScrapeInterval,
        });
        const tok: string = data.expoPushToken ?? "";
        setTokenRegistered(!!tok);
        setTokenPreview(tok ? formatTokenPreview(tok) : null);
      } catch (e) {
        console.warn("Failed to fetch settings:", e);
        // Non-fatal: keep defaults / previous values so the form is still usable
      }
    },
    [apiUrl],
  );

  // Load settings once we know the API URL
  useEffect(() => {
    if (apiUrlLoading) return;

    let mounted = true;
    (async () => {
      setLoading(true);
      if (apiUrl) {
        await fetchSettings(apiUrl);
      }
      if (mounted) setLoading(false);
    })();

    return () => {
      mounted = false;
    };
  }, [apiUrlLoading, apiUrl, fetchSettings]);

  /**
   * Requests notification permission (if needed) and returns the
   * Expo push token so it can be sent to the backend.
   * Returns null if the user denies permission or it's unavailable
   * (e.g. on a simulator).
   */
  const registerPushToken = useCallback(async (): Promise<{
    token: string | null;
    error: string | null;
  }> => {
    if (IS_DEV) {
      return { token: null, error: "Notifications disabled in dev mode" };
    }

    // Lazy requires — não carregados no Expo Go, apenas em builds reais
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notif =
      require("expo-notifications") as typeof import("expo-notifications");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = (
      require("expo-constants") as typeof import("expo-constants")
    ).default;

    try {
      // 1. Verifica / pede permissão
      const { status: existing } = await Notif.getPermissionsAsync();
      let final = existing;
      if (existing !== "granted") {
        const { status } = await Notif.requestPermissionsAsync();
        final = status;
      }
      if (final !== "granted") {
        return {
          token: null,
          error:
            "Permission denied \u2014 enable notifications in device Settings > Apps.",
        };
      }

      // 2. Canal Android
      if (Platform.OS === "android") {
        await Notif.setNotificationChannelAsync("default", {
          name: "JobNator Alerts",
          importance: Notif.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#208AEF",
        });
      }

      // 3. Obtém o Expo Push Token
      const projectId =
        Constants.expoConfig?.extra?.eas?.projectId ??
        Constants.easConfig?.projectId;

      if (!projectId) {
        return {
          token: null,
          error: "EAS projectId not found in app config.",
        };
      }

      const resp = await Notif.getExpoPushTokenAsync({ projectId });
      return { token: resp.data, error: null };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[registerPushToken] error:", msg);
      return { token: null, error: msg };
    }
  }, []);

  /**
   * POST /api/settings — saves filters and (re)registers the push token
   * so the backend knows where to send alerts for this device.
   */
  const saveSettings = useCallback(
    async (newSettings: JobSettings) => {
      if (!apiUrl) {
        throw new Error("API URL is not configured");
      }

      setSaving(true);
      setError(null);

      try {
        const { token: pushToken, error: pushError } =
          await registerPushToken();

        if (pushError && !IS_DEV) setTokenError(pushError);

        const payload = {
          keywords: newSettings.keywords.trim(),
          location: newSettings.location.trim(),
          workplaceType: newSettings.workplaceType,
          scrapeIntervalMinutes: newSettings.scrapeIntervalMinutes,
          expoPushToken: pushToken,
          platform: Platform.OS,
        };

        await axios.post(`${apiUrl}/api/settings`, payload, {
          timeout: 10000,
        });

        setSettings(newSettings);
        if (pushToken) {
          setTokenRegistered(true);
          setTokenPreview(formatTokenPreview(pushToken));
          setTokenError(null);
        }
        return true;
      } catch (e) {
        setError(
          "Failed to save settings. Check your connection and try again.",
        );
        throw e;
      } finally {
        setSaving(false);
      }
    },
    [apiUrl, registerPushToken],
  );

  /**
   * POST /api/notifications/test — sends a test push to the registered device.
   * Only works in release builds where a push token has been registered.
   */
  const sendTestNotification = useCallback(async (): Promise<{
    ok: boolean;
    message: string;
  }> => {
    if (!apiUrl) return { ok: false, message: "API URL not configured" };
    if (IS_DEV)
      return { ok: false, message: "Notifications disabled in dev mode" };

    setTokenSaving(true);
    try {
      const res = await axios.post(
        `${apiUrl}/api/notifications/test`,
        {},
        { timeout: 10000 },
      );
      return { ok: true, message: res.data?.message ?? "Sent!" };
    } catch (e: unknown) {
      const msg =
        axios.isAxiosError(e) && e.response?.data?.error
          ? e.response.data.error
          : "Failed to send test notification";
      return { ok: false, message: msg };
    } finally {
      setTokenSaving(false);
    }
  }, [apiUrl]);

  /**
   * POST /api/scraper/run — dispara uma raspagem imediata no servidor.
   * Faz polling em /api/scraper/status por até 30 s para capturar o resultado.
   */
  const triggerScrape = useCallback(async (): Promise<{
    ok: boolean;
    message: string;
  }> => {
    if (!apiUrl) return { ok: false, message: "API URL not configured" };
    setScraping(true);
    try {
      // Dispara o scrape
      const res = await axios.post(
        `${apiUrl}/api/scraper/run`,
        {},
        { timeout: 8000 },
      );

      if (res.data?.alreadyRunning) {
        return { ok: true, message: "Scraper already running…" };
      }

      // Polling por até 30s (15 checks × 2s) para capturar o resultado rapidamente.
      // Se o scrape demorar mais, retorna mensagem de "em andamento".
      for (let i = 0; i < 15; i++) {
        await new Promise<void>((r) => setTimeout(r, 2000));
        try {
          const status = await axios.get(`${apiUrl}/api/scraper/status`, {
            timeout: 3000,
          });
          const data = status.data;

          if (!data?.isScraping) {
            const last = data?.lastResult;
            if (!last) return { ok: true, message: "Scrape completed." };

            switch (last.status as string) {
              case "ok":
                return {
                  ok: true,
                  message:
                    last.jobsNew > 0
                      ? `${last.jobsNew} new job${last.jobsNew !== 1 ? "s" : ""} found!`
                      : "Done — no new jobs this time.",
                };
              case "auth_wall":
                return {
                  ok: false,
                  message: "🔒 LinkedIn blocked: login wall detected.",
                };
              case "captcha":
                return {
                  ok: false,
                  message: "🤖 LinkedIn blocked: CAPTCHA detected.",
                };
              case "empty":
                return {
                  ok: false,
                  message: "⚠ No job cards found — selectors may have changed.",
                };
              case "timeout":
                return {
                  ok: false,
                  message: "⏱ LinkedIn navigation timed out.",
                };
              default:
                return {
                  ok: false,
                  message: last.errorMessage ?? "Scrape failed.",
                };
            }
          }
        } catch {
          // Falha de rede durante polling — continua tentando
        }
      }

      // Após 30s ainda está rodando — retorna feedback positivo e para o spinner
      return {
        ok: true,
        message: "Scraping in progress… Jobs will appear soon.",
      };
    } catch {
      return { ok: false, message: "Failed to trigger scrape." };
    } finally {
      setScraping(false);
    }
  }, [apiUrl]);

  /**
   * Registra o push token de forma independente (sem precisar salvar os outros settings).
   * Útil para o botão "Register" na UI de settings.
   */
  const registerTokenOnly = useCallback(async (): Promise<{
    ok: boolean;
    message: string;
  }> => {
    if (!apiUrl) return { ok: false, message: "API URL not configured" };
    if (IS_DEV) return { ok: false, message: "Disabled in dev mode" };

    setTokenSaving(true);
    try {
      const { token, error } = await registerPushToken();
      if (error || !token) {
        setTokenError(error ?? "Unknown error");
        return { ok: false, message: error ?? "Failed to get push token" };
      }

      await axios.post(
        `${apiUrl}/api/settings/push-token`,
        { expoPushToken: token },
        { timeout: 10000 },
      );

      setTokenRegistered(true);
      setTokenPreview(formatTokenPreview(token));
      setTokenError(null);
      return { ok: true, message: "Push notifications registered!" };
    } catch (e: unknown) {
      const msg =
        axios.isAxiosError(e) && e.response?.data?.error
          ? e.response.data.error
          : "Failed to register with backend";
      setTokenError(msg);
      return { ok: false, message: msg };
    } finally {
      setTokenSaving(false);
    }
  }, [apiUrl, registerPushToken]);

  return {
    // connection
    apiUrl,
    apiUrlLoading,
    setApiUrl,
    clearApiUrl,
    // settings form
    settings,
    setSettings,
    loading,
    saving,
    error,
    fetchSettings,
    saveSettings,
    registerPushToken,
    scraping,
    triggerScrape,
    tokenRegistered,
    tokenError,
    tokenPreview,
    tokenSaving,
    registerTokenOnly,
    sendTestNotification,
  };
}
