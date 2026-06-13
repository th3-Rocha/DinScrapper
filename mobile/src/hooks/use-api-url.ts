import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const API_URL_STORAGE_KEY = "@jobnator/api_url";

/**
 * Strips trailing slashes and whitespace so we can safely do
 * `${apiUrl}/api/whatever` everywhere else.
 */
export function normalizeApiUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/**
 * Reads/writes the backend base URL from AsyncStorage.
 *
 * `loading` is true until the initial read completes — the root layout
 * uses this to decide whether to render the Setup (QR scan) screen or
 * the rest of the app via <Slot />.
 */
export function useApiUrl() {
  const [apiUrl, setApiUrlState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    AsyncStorage.getItem(API_URL_STORAGE_KEY)
      .then((value) => {
        if (mounted) setApiUrlState(value);
      })
      .catch((e) => {
        console.warn("Failed to read API URL from storage:", e);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const setApiUrl = useCallback(async (url: string) => {
    const normalized = normalizeApiUrl(url);
    await AsyncStorage.setItem(API_URL_STORAGE_KEY, normalized);
    setApiUrlState(normalized);
    return normalized;
  }, []);

  const clearApiUrl = useCallback(async () => {
    await AsyncStorage.removeItem(API_URL_STORAGE_KEY);
    setApiUrlState(null);
  }, []);

  return { apiUrl, loading, setApiUrl, clearApiUrl };
}
