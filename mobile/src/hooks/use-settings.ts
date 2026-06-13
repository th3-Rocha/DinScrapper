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
        setTokenRegistered(!!data.expoPushToken);
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
  const registerPushToken = useCallback(async (): Promise<string | null> => {
    // expo-notifications throws at import-time in Expo Go (SDK 53+).
    // By using require() lazily here — after the IS_DEV guard — the module
    // is never loaded in development, so Expo Go never crashes.
    if (IS_DEV) {
      console.log("[dev] Push notifications skipped in development mode");
      return null;
    }

    // Lazy requires — only evaluated in real (non-Expo-Go) builds
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications =
      require("expo-notifications") as typeof import("expo-notifications");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = (
      require("expo-constants") as typeof import("expo-constants")
    ).default;

    try {
      const { status: existingStatus } =
        await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== "granted") {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== "granted") {
        console.warn("Push notification permission was not granted");
        return null;
      }

      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          name: "default",
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }

      // Required for SDK 49+ when using EAS — falls back to undefined
      // for bare/dev setups without a configured project id.
      const projectId =
        Constants.expoConfig?.extra?.eas?.projectId ??
        Constants.easConfig?.projectId;

      const tokenResponse = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined,
      );

      return tokenResponse.data;
    } catch (e) {
      console.warn("Failed to get Expo push token:", e);
      return null;
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
        const pushToken = await registerPushToken();

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
        if (pushToken) setTokenRegistered(true);
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
    tokenSaving,
    sendTestNotification,
  };
}
