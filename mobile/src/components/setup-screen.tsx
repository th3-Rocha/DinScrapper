import { useCallback, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { QRScanner } from "./qr-scanner";
import { T } from "../constants/theme";
import { IS_DEV } from "../utils/environment";
import { ScanLine, Link, ArrowLeft, Wifi } from "lucide-react-native";

type Step = "choose" | "qr" | "manual";

interface SetupScreenProps {
  /**
   * Called after the URL is validated and saved. The parent (_layout)
   * holds its own useApiUrl() state — this just needs to call setApiUrl.
   */
  onScanned: (url: string) => Promise<unknown> | void;
}

/**
 * Rendered directly from src/app/_layout.tsx (NOT a route) when
 * AsyncStorage has no API_URL yet.
 *
 * - Release build  → shows "Scan QR Code" and "Type URL" options
 * - Dev mode       → skips straight to the manual URL input (camera disabled)
 */
export function SetupScreen({ onScanned }: SetupScreenProps) {
  // In dev mode skip directly to manual entry — camera won't work in Expo Go
  const [step, setStep] = useState<Step>(IS_DEV ? "manual" : "choose");
  const [url, setUrl] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Validates + saves the URL (called from both QR and manual paths) */
  const handleConnect = useCallback(
    async (data: string) => {
      const trimmed = data.trim();
      if (!trimmed) {
        setError("Enter a URL to connect");
        return;
      }
      if (!/^https?:\/\//i.test(trimmed)) {
        setError("URL must start with http:// or https://");
        return;
      }
      setError(null);
      setConnecting(true);
      try {
        await onScanned(trimmed);
      } catch {
        setError("Could not connect. Please check the URL and try again.");
        setConnecting(false);
      }
    },
    [onScanned],
  );

  // ── Connecting spinner ────────────────────────────────────────────────────
  if (connecting) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={T.textSecondary} />
        <Text style={styles.connectingText}>Connecting…</Text>
      </View>
    );
  }

  // ── QR Scanner step ───────────────────────────────────────────────────────
  if (step === "qr") {
    return (
      <QRScanner
        onScanned={handleConnect}
        onClose={() => setStep("choose")}
        showCancel
        title="Connect to your backend"
        subtitle="Scan the setup QR code shown on your server's console or dashboard"
      />
    );
  }

  // ── Manual URL entry step ─────────────────────────────────────────────────
  if (step === "manual") {
    return (
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.center}>
          <View style={styles.iconCircle}>
            <Link size={24} color={T.textPrimary} />
          </View>

          <Text style={styles.title}>Enter Backend URL</Text>
          <Text style={styles.subtitle}>
            Type the address shown on your server's console.{"\n"}
            e.g. http://192.168.x.x:5056
          </Text>

          {IS_DEV && (
            <View style={styles.devBanner}>
              <Text style={styles.devBannerText}>
                🛠 Dev mode — QR scanner disabled
              </Text>
            </View>
          )}

          <View style={styles.inputRow}>
            <TextInput
              style={styles.textInput}
              placeholder="http://192.168.x.x:5056"
              placeholderTextColor={T.textMuted}
              value={url}
              onChangeText={(t) => {
                setUrl(t);
                if (error) setError(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={() => handleConnect(url)}
            />
          </View>

          {error && <Text style={styles.errorText}>{error}</Text>}

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => handleConnect(url)}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>Connect</Text>
          </TouchableOpacity>

          {!IS_DEV && (
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => setStep("choose")}
              activeOpacity={0.8}
            >
              <ArrowLeft size={14} color={T.textSecondary} />
              <Text style={styles.backButtonText}>Back</Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ── Choose step (default in release) ─────────────────────────────────────
  return (
    <View style={styles.center}>
      <View style={styles.iconCircle}>
        <Wifi size={24} color={T.textPrimary} />
      </View>

      <Text style={styles.title}>Connect to Backend</Text>
      <Text style={styles.subtitle}>
        How would you like to connect to your server?
      </Text>

      <View style={styles.optionsRow}>
        <TouchableOpacity
          style={styles.optionCard}
          onPress={() => setStep("qr")}
          activeOpacity={0.8}
        >
          <View style={styles.optionIconCircle}>
            <ScanLine size={22} color={T.textPrimary} />
          </View>
          <Text style={styles.optionTitle}>Scan QR Code</Text>
          <Text style={styles.optionSubtitle}>
            Point the camera at the QR code from the server
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.optionCard}
          onPress={() => setStep("manual")}
          activeOpacity={0.8}
        >
          <View style={styles.optionIconCircle}>
            <Link size={22} color={T.textPrimary} />
          </View>
          <Text style={styles.optionTitle}>Type URL</Text>
          <Text style={styles.optionSubtitle}>
            Manually enter the backend address
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: T.bg },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: T.bg,
    padding: 32,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: T.glass,
    borderWidth: 1,
    borderColor: T.glassBorder,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  title: {
    color: T.textPrimary,
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  subtitle: {
    color: T.textSecondary,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
    paddingHorizontal: 8,
    marginBottom: 28,
  },
  devBanner: {
    backgroundColor: "rgba(255,200,0,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,200,0,0.2)",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 20,
    alignSelf: "stretch",
    alignItems: "center",
  },
  devBannerText: {
    color: "rgba(255,200,0,0.85)",
    fontSize: 12,
    fontWeight: "600",
  },
  inputRow: {
    alignSelf: "stretch",
    backgroundColor: T.glass,
    borderWidth: 1,
    borderColor: T.glassBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  textInput: {
    color: T.textPrimary,
    fontSize: 14,
    paddingVertical: 14,
  },
  errorText: {
    color: T.danger,
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 12,
    textAlign: "center",
  },
  primaryButton: {
    alignSelf: "stretch",
    backgroundColor: T.accent,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 4,
  },
  primaryButtonText: {
    color: "#000000",
    fontWeight: "700",
    fontSize: 15,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 20,
  },
  backButtonText: {
    color: T.textSecondary,
    fontSize: 13,
  },
  connectingText: {
    color: T.textSecondary,
    fontSize: 13,
    marginTop: 12,
  },
  // ── Choose screen ─────────────────────────────────────────────────────────
  optionsRow: {
    alignSelf: "stretch",
    flexDirection: "row",
    gap: 12,
  },
  optionCard: {
    flex: 1,
    backgroundColor: T.glass,
    borderWidth: 1,
    borderColor: T.glassBorder,
    borderRadius: 16,
    padding: 18,
    alignItems: "center",
  },
  optionIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: T.glassBorder,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  optionTitle: {
    color: T.textPrimary,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 6,
    textAlign: "center",
  },
  optionSubtitle: {
    color: T.textMuted,
    fontSize: 11,
    textAlign: "center",
    lineHeight: 16,
  },
});
