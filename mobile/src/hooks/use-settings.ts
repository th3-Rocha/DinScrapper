import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { Platform } from "react-native";
//import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { useApiUrl } from "./use-api-url";

/** 1 = On-site, 2 = Remote, 3 = Hybrid (matches the C# backend enum) */
export type WorkplaceType = 1 | 2 | 3;

export interface JobSettings {
  keywords: string;
  location: string;
  workplaceType: WorkplaceType;
}

const DEFAULT_SETTINGS: JobSettings = {
  keywords: "",
  location: "",
  workplaceType: 2,
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
          workplaceType: (data.workplaceType as WorkplaceType) ?? 2,
        });
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
    try {
      // const { status: existingStatus } =
      //   await Notifications.getPermissionsAsync();
      // let finalStatus = existingStatus;

      // if (existingStatus !== "granted") {
      //   const { status } = await Notifications.requestPermissionsAsync();
      //   finalStatus = status;
      // }

      // if (finalStatus !== "granted") {
      //   console.warn("Push notification permission was not granted");
      //   return null;
      // }

      // if (Platform.OS === "android") {
      //   await Notifications.setNotificationChannelAsync("default", {
      //     name: "default",
      //     importance: Notifications.AndroidImportance.DEFAULT,
      //   });
      // }

      // // Required for SDK 49+ when using EAS — falls back to undefined
      // // for bare/dev setups without a configured project id.
      // const projectId =
      //   Constants.expoConfig?.extra?.eas?.projectId ??
      //   Constants.easConfig?.projectId;

      // const tokenResponse = await Notifications.getExpoPushTokenAsync(
      //   projectId ? { projectId } : undefined
      // );

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
          expoPushToken: pushToken,
          platform: Platform.OS,
        };

        await axios.post(`${apiUrl}/api/settings`, payload, {
          timeout: 10000,
        });

        setSettings(newSettings);
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
  };
}
