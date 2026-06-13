import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Stack } from "expo-router";
import {
  QrCode,
  MapPin,
  Search,
  Building2,
  Home as HomeIcon,
  Laptop,
  CheckCircle2,
} from "lucide-react-native";
import { QRScanner } from "../components/qr-scanner";
import { useSettings, JobSettings, WorkplaceType } from "../hooks/use-settings";
import { T } from "../constants/theme";

const WORKPLACE_OPTIONS: {
  value: WorkplaceType;
  label: string;
  Icon: typeof Building2;
}[] = [
  { value: 1, label: "On-site", Icon: Building2 },
  { value: 2, label: "Remote", Icon: Laptop },
  { value: 3, label: "Hybrid", Icon: HomeIcon },
];

export default function SettingsScreen() {
  const {
    apiUrl,
    apiUrlLoading,
    setApiUrl,
    settings,
    loading,
    saving,
    error,
    saveSettings,
  } = useSettings();

  const [form, setForm] = useState<JobSettings>(settings);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Keep the form in sync once settings load from the backend
  useEffect(() => {
    setForm(settings);
  }, [settings]);

  const handleScanned = useCallback(
    async (data: string) => {
      try {
        await setApiUrl(data);
        setScannerVisible(false);
        Alert.alert("Connected", "Backend address updated.");
      } catch (e) {
        Alert.alert("Error", "Could not save the new backend address.");
      }
    },
    [setApiUrl]
  );

  const handleSave = useCallback(async () => {
    try {
      await saveSettings(form);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (e) {
      Alert.alert(
        "Save failed",
        "Could not update settings. Check your connection and try again."
      );
    }
  }, [form, saveSettings]);

  if (apiUrlLoading || loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={T.textSecondary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: T.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Stack.Screen options={{ title: "Settings" }} />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.heading}>Job search settings</Text>

        {/* Backend connection card */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Backend</Text>
          <Text style={styles.apiUrl} numberOfLines={1}>
            {apiUrl ?? "Not configured"}
          </Text>
          <TouchableOpacity
            style={styles.scanButton}
            onPress={() => setScannerVisible(true)}
            activeOpacity={0.8}
          >
            <QrCode size={15} color={T.textPrimary} />
            <Text style={styles.scanButtonText}>Scan new QR code</Text>
          </TouchableOpacity>
        </View>

        {/* Keywords */}
        <View style={styles.field}>
          <Text style={styles.label}>Keywords</Text>
          <View style={styles.inputWrapper}>
            <Search size={14} color={T.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="e.g. React Native Developer"
              placeholderTextColor={T.textMuted}
              value={form.keywords}
              onChangeText={(text) =>
                setForm((f) => ({ ...f, keywords: text }))
              }
              returnKeyType="next"
            />
          </View>
        </View>

        {/* Location */}
        <View style={styles.field}>
          <Text style={styles.label}>Location</Text>
          <View style={styles.inputWrapper}>
            <MapPin size={14} color={T.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="e.g. São Paulo, Brazil"
              placeholderTextColor={T.textMuted}
              value={form.location}
              onChangeText={(text) =>
                setForm((f) => ({ ...f, location: text }))
              }
              returnKeyType="done"
            />
          </View>
        </View>

        {/* Workplace type */}
        <View style={styles.field}>
          <Text style={styles.label}>Workplace type</Text>
          <View style={styles.segmentRow}>
            {WORKPLACE_OPTIONS.map(({ value, label, Icon }) => {
              const active = form.workplaceType === value;
              return (
                <TouchableOpacity
                  key={value}
                  style={[styles.segment, active && styles.segmentActive]}
                  onPress={() =>
                    setForm((f) => ({ ...f, workplaceType: value }))
                  }
                  activeOpacity={0.85}
                >
                  <Icon size={15} color={active ? "#000" : T.textSecondary} />
                  <Text
                    style={[
                      styles.segmentText,
                      active && styles.segmentTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {error && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#000" />
          ) : saveSuccess ? (
            <View style={styles.saveRow}>
              <CheckCircle2 size={16} color="#000" />
              <Text style={styles.saveButtonText}>Saved</Text>
            </View>
          ) : (
            <Text style={styles.saveButtonText}>Save settings</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.note}>
          Push notifications are registered automatically when you save your
          settings.
        </Text>
      </ScrollView>

      <Modal
        visible={scannerVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setScannerVisible(false)}
      >
        <QRScanner
          onScanned={handleScanned}
          onClose={() => setScannerVisible(false)}
          title="Update backend address"
          subtitle="Scan the new setup QR code from your backend"
        />
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: T.bg,
  },
  content: {
    padding: 20,
    paddingBottom: 48,
  },
  heading: {
    fontSize: 22,
    fontWeight: "800",
    color: T.textPrimary,
    letterSpacing: -0.6,
    marginBottom: 18,
  },
  card: {
    backgroundColor: T.glass,
    borderWidth: 1,
    borderColor: T.glassBorder,
    borderRadius: 14,
    padding: 16,
    marginBottom: 22,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: T.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  apiUrl: {
    fontSize: 13,
    color: T.textSecondary,
    marginBottom: 12,
  },
  scanButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: T.glassBorder,
    borderRadius: 10,
    paddingVertical: 11,
    gap: 8,
  },
  scanButtonText: {
    color: T.textPrimary,
    fontWeight: "700",
    fontSize: 13,
  },
  field: { marginBottom: 18 },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: T.textSecondary,
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: T.glass,
    borderWidth: 1,
    borderColor: T.glassBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  input: {
    flex: 1,
    color: T.textPrimary,
    fontSize: 14,
    paddingVertical: 12,
  },
  segmentRow: {
    flexDirection: "row",
    gap: 8,
  },
  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: T.glass,
    borderWidth: 1,
    borderColor: T.glassBorder,
    borderRadius: 10,
    paddingVertical: 12,
  },
  segmentActive: {
    backgroundColor: T.accent,
    borderColor: T.accent,
  },
  segmentText: {
    fontSize: 12,
    fontWeight: "700",
    color: T.textSecondary,
  },
  segmentTextActive: {
    color: "#000000",
  },
  errorText: {
    color: T.danger,
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 12,
    textAlign: "center",
  },
  saveButton: {
    backgroundColor: T.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
  saveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  saveButtonText: {
    color: "#000000",
    fontWeight: "700",
    fontSize: 14,
  },
  note: {
    fontSize: 11,
    color: T.textMuted,
    textAlign: "center",
    marginTop: 14,
    lineHeight: 16,
  },
});
