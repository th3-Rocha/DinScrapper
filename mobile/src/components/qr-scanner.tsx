import { useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import {
  CameraView,
  useCameraPermissions,
  BarcodeScanningResult,
} from "expo-camera";
import { X, ScanLine } from "lucide-react-native";
import { T } from "../constants/theme";
import { IS_DEV } from "../utils/environment";

interface QRScannerProps {
  /** Called with the raw scanned string once a valid URL is detected */
  onScanned: (data: string) => void;
  /** Called when the user taps "Cancel" (ignored if showCancel is false) */
  onClose: () => void;
  title?: string;
  subtitle?: string;
  /** Hide the cancel button — useful for a mandatory first-run setup screen */
  showCancel?: boolean;
}

export function QRScanner({
  onScanned,
  onClose,
  title = "Scan setup QR code",
  subtitle = "Point the camera at the QR code shown by your backend",
  showCancel = true,
}: QRScannerProps) {
  // Safety guard — camera must not be rendered in Expo Go / dev mode
  if (IS_DEV) {
    return (
      <View style={styles.center}>
        <View style={styles.iconCircle}>
          <ScanLine size={26} color={T.textMuted} />
        </View>
        <Text style={styles.title}>Camera disabled</Text>
        <Text style={styles.subtitle}>
          QR scanning is not available in development mode.
        </Text>
        {showCancel && (
          <TouchableOpacity style={styles.secondaryButton} onPress={onClose}>
            <Text style={styles.secondaryButtonText}>Go back</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (locked) return;

      const raw = result.data?.trim();
      if (!raw) return;

      if (!/^https?:\/\//i.test(raw)) {
        setErrorMsg("That QR code doesn't contain a valid URL");
        return;
      }

      setLocked(true);
      setErrorMsg(null);
      onScanned(raw);
    },
    [locked, onScanned],
  );

  // Permission state still loading
  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={T.textSecondary} />
      </View>
    );
  }

  // Permission denied or not yet granted
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <View style={styles.iconCircle}>
          <ScanLine size={26} color={T.textMuted} />
        </View>
        <Text style={styles.title}>Camera access needed</Text>
        <Text style={styles.subtitle}>
          We need camera access to scan the setup QR code from your backend.
        </Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant permission</Text>
        </TouchableOpacity>
        {showCancel && (
          <TouchableOpacity style={styles.secondaryButton} onPress={onClose}>
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={handleScanned}
      />

      <View style={styles.overlay}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>

        <View style={styles.frame}>
          <ScanLine size={28} color={T.textPrimary} />
        </View>

        <View style={styles.footer}>
          {errorMsg && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{errorMsg}</Text>
              <TouchableOpacity onPress={() => setErrorMsg(null)}>
                <Text style={styles.errorRetry}>Try again</Text>
              </TouchableOpacity>
            </View>
          )}

          {showCancel && (
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <X size={18} color={T.textPrimary} />
              <Text style={styles.closeText}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: T.bg,
    padding: 32,
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: T.glass,
    borderWidth: 1,
    borderColor: T.glassBorder,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "space-between",
    padding: 24,
  },
  header: { marginTop: 40, alignItems: "center" },
  title: {
    color: T.textPrimary,
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 6,
  },
  subtitle: {
    color: T.textSecondary,
    fontSize: 13,
    textAlign: "center",
    paddingHorizontal: 24,
    lineHeight: 18,
  },
  frame: {
    alignSelf: "center",
    width: 220,
    height: 220,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  footer: { alignItems: "center", gap: 12 },
  errorBox: {
    alignSelf: "center",
    backgroundColor: "rgba(248,113,113,0.12)",
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.3)",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: "center",
  },
  errorText: { color: T.danger, fontSize: 13, fontWeight: "600" },
  errorRetry: {
    color: T.textPrimary,
    fontSize: 12,
    marginTop: 6,
    fontWeight: "700",
  },
  closeButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: T.glass,
    borderWidth: 1,
    borderColor: T.glassBorder,
    borderRadius: 100,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  closeText: {
    color: T.textPrimary,
    fontWeight: "700",
    marginLeft: 8,
    fontSize: 13,
  },
  button: {
    backgroundColor: T.accent,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 18,
  },
  buttonText: { color: "#000", fontWeight: "700", fontSize: 14 },
  secondaryButton: { marginTop: 12 },
  secondaryButtonText: { color: T.textSecondary, fontSize: 13 },
});
