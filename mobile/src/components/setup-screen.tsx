import { useCallback, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet, Alert } from "react-native";
import { QRScanner } from "./qr-scanner";
import { T } from "../constants/theme";

interface SetupScreenProps {
  /**
   * Called after the URL is successfully saved. The parent (_layout)
   * holds its own useApiUrl() state, so this just needs to call its
   * setApiUrl — the resulting re-render swaps Setup out for <Slot />.
   */
  onScanned: (url: string) => Promise<void> | void;
}

/**
 * Rendered directly from src/app/_layout.tsx (NOT a route) when
 * AsyncStorage has no API_URL yet. Forces the user to scan the QR
 * code shown by the backend before the rest of the app is reachable.
 */
export function SetupScreen({ onScanned }: SetupScreenProps) {
  const [connecting, setConnecting] = useState(false);

  const handleScanned = useCallback(
    async (data: string) => {
      setConnecting(true);
      try {
        await onScanned(data);
      } catch (e) {
        console.warn("Failed to save API URL:", e);
        Alert.alert(
          "Setup failed",
          "Could not save the backend address. Please try scanning again."
        );
      } finally {
        setConnecting(false);
      }
    },
    [onScanned]
  );

  if (connecting) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={T.textSecondary} />
        <Text style={styles.text}>Connecting…</Text>
      </View>
    );
  }

  return (
    <QRScanner
      onScanned={handleScanned}
      onClose={() => {}}
      showCancel={false}
      title="Connect to your backend"
      subtitle="Scan the setup QR code shown on your server's console or dashboard"
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: T.bg,
  },
  text: { color: T.textSecondary, marginTop: 12, fontSize: 13 },
});
