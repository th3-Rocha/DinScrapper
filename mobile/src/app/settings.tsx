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
  Pencil,
  Play,
  Clock,
} from "lucide-react-native";
import Slider from "@react-native-community/slider";
import { IS_DEV } from "../utils/environment";
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

const CUSTOM_PRESET_VALUE = "__custom__";

const KEYWORD_PRESETS: { label: string; value: string; isStrict?: boolean }[] =
  [
    // --- STRICT PRESETS (GOLD BORDER) ---
    {
      label: "C# / .NET (Strict)",
      isStrict: true,
      value:
        'title:("C#" OR "C Sharp" OR "CSharp" OR ".NET" OR "ASP.NET" OR "ASPDotnet" OR "Dotnet" OR "Dot net" OR "Dot-net" OR ".NET Core")',
    },
    {
      label: "Node.js / TS (Strict)",
      isStrict: true,
      value:
        'title:("Node.js" OR "Node" OR "NestJS" OR "Nest" OR "TypeScript" OR "Express" OR "Fastify")',
    },
    {
      label: "Java / Spring (Strict)",
      isStrict: true,
      value:
        'title:("Java" OR "Spring" OR "SpringBoot" OR "Spring Boot" OR "Kotlin")',
    },
    {
      label: "Python / Django (Strict)",
      isStrict: true,
      value: 'title:("Python" OR "Django" OR "FastAPI" OR "Flask")',
    },
    {
      label: "Golang / Rust (Strict)",
      isStrict: true,
      value: 'title:("Golang" OR "Go" OR "Rust")',
    },

    // --- BROAD PRESETS ---
    {
      label: "C# / .NET (Broad)",
      value:
        '("C#" OR "CSharp" OR ".NET" OR "ASP.NET" OR "Dotnet") title:("Backend" OR "Developer" OR "Engineer" OR "Software")',
    },
    {
      label: "Node.js / TS (Broad)",
      value:
        '("Node.js" OR "Node" OR "NestJS" OR "TypeScript") title:("Backend" OR "Developer" OR "Engineer" OR "Software")',
    },
    {
      label: "Java / Spring (Broad)",
      value:
        '("Java" OR "Spring") title:("Backend" OR "Developer" OR "Engineer" OR "Software")',
    },

    // --- OTHERS ---
    {
      label: "React Native / Mobile",
      value:
        'title:("React Native" OR "React-Native" OR "Mobile" OR "iOS" OR "Android" OR "Flutter")',
    },
    {
      label: "Modern Frontend",
      value:
        '("React" OR "Next.js" OR "Vue" OR "Angular") title:("Frontend" OR "Front-end" OR "Developer" OR "Engineer")',
    },
    {
      label: "Fullstack Developer",
      value: 'title:("Fullstack" OR "Full-stack" OR "Full Stack")',
    },
    {
      label: "Data Engineering",
      value: 'title:("Data Engineer" OR "Data Engineering")',
    },
    {
      label: "DevOps / SRE / Cloud",
      value:
        'title:("DevOps" OR "SRE" OR "Site Reliability" OR "Platform" OR "Cloud" OR "AWS" OR "Azure")',
    },
    {
      label: "International (English Required)",
      value:
        '"English" title:("Backend" OR "Software" OR "Developer" OR "Engineer")',
    },
    {
      label: "Custom Query",
      value: CUSTOM_PRESET_VALUE,
    },
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
    scraping,
    triggerScrape,
    tokenRegistered,
    tokenError,
    tokenPreview,
    tokenSaving,
    registerTokenOnly,
    sendTestNotification,
  } = useSettings();

  const [form, setForm] = useState<JobSettings>(settings);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [scrapeResult, setScrapeResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [editingUrl, setEditingUrl] = useState(false);
  const [newUrlInput, setNewUrlInput] = useState("");
  const [keywordPreset, setKeywordPreset] =
    useState<string>(CUSTOM_PRESET_VALUE);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  useEffect(() => {
    const match = KEYWORD_PRESETS.find((p) => p.value === form.keywords);
    setKeywordPreset(match ? match.value : CUSTOM_PRESET_VALUE);
  }, [form.keywords]);

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
    [setApiUrl],
  );

  const handleSave = useCallback(async () => {
    try {
      await saveSettings(form);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (e) {
      Alert.alert(
        "Save failed",
        "Could not update settings. Check your connection and try again.",
      );
    }
  }, [form, saveSettings]);

  // Formata os minutos do slider para "45 min" ou "1h 30m"
  const formatInterval = (mins: number) => {
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

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

          {editingUrl ? (
            <>
              <View style={styles.inputWrapper}>
                <Pencil size={14} color={T.textMuted} />
                <TextInput
                  style={styles.input}
                  value={newUrlInput}
                  onChangeText={setNewUrlInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  placeholder="http://192.168.x.x:5056"
                  placeholderTextColor={T.textMuted}
                  returnKeyType="done"
                  autoFocus
                />
              </View>
              <View style={styles.urlEditRow}>
                <TouchableOpacity
                  style={[styles.scanButton, styles.urlEditBtn]}
                  activeOpacity={0.8}
                  onPress={async () => {
                    const trimmed = newUrlInput.trim();
                    if (!trimmed) return;
                    try {
                      await setApiUrl(trimmed);
                      setEditingUrl(false);
                      Alert.alert("Connected", "Backend address updated.");
                    } catch {
                      Alert.alert(
                        "Error",
                        "Could not save the new backend address.",
                      );
                    }
                  }}
                >
                  <Text style={styles.scanButtonText}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.scanButton, styles.urlEditBtn]}
                  activeOpacity={0.8}
                  onPress={() => setEditingUrl(false)}
                >
                  <Text style={styles.scanButtonText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.apiUrl} numberOfLines={1}>
                {apiUrl ?? "Not configured"}
              </Text>
              <View style={styles.urlActionsCol}>
                {!IS_DEV && (
                  <TouchableOpacity
                    style={styles.scanButton}
                    onPress={() => setScannerVisible(true)}
                    activeOpacity={0.8}
                  >
                    <QrCode size={15} color={T.textPrimary} />
                    <Text style={styles.scanButtonText}>Scan new QR code</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.scanButton}
                  onPress={() => {
                    setNewUrlInput(apiUrl ?? "");
                    setEditingUrl(true);
                  }}
                  activeOpacity={0.8}
                >
                  <Pencil size={15} color={T.textPrimary} />
                  <Text style={styles.scanButtonText}>Type URL manually</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

        {/* Keywords */}
        <View style={styles.field}>
          <Text style={styles.label}>Keywords</Text>

          <View style={styles.chipsWrap}>
            {KEYWORD_PRESETS.map((preset) => {
              const active = keywordPreset === preset.value;
              const strictStyle = preset.isStrict ? styles.chipStrict : {};
              const strictActiveStyle = preset.isStrict
                ? styles.chipStrictActive
                : {};

              return (
                <TouchableOpacity
                  key={preset.value}
                  style={[
                    styles.chip,
                    strictStyle,
                    active && styles.chipActive,
                    active && strictActiveStyle,
                  ]}
                  onPress={() => {
                    setKeywordPreset(preset.value);
                    if (preset.value !== CUSTOM_PRESET_VALUE) {
                      setForm((f) => ({ ...f, keywords: preset.value }));
                    } else if (
                      KEYWORD_PRESETS.some((p) => p.value === form.keywords)
                    ) {
                      setForm((f) => ({ ...f, keywords: "" }));
                    }
                  }}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      styles.chipText,
                      preset.isStrict && styles.chipTextStrict,
                      active && styles.chipTextActive,
                      active && preset.isStrict && styles.chipTextStrictActive,
                    ]}
                  >
                    {preset.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {keywordPreset === CUSTOM_PRESET_VALUE && (
            <View style={[styles.inputWrapper, styles.customKeywordsInput]}>
              <Search size={14} color={T.textMuted} />
              <TextInput
                style={styles.input}
                placeholder='title:(C# OR .NET) OR "Backend"'
                placeholderTextColor={T.textMuted}
                value={form.keywords}
                onChangeText={(text) =>
                  setForm((f) => ({ ...f, keywords: text }))
                }
                returnKeyType="next"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          )}
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

        {/* Scrape Interval Slider */}
        <View style={styles.field}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <Text style={[styles.label, { marginBottom: 0 }]}>
              Scrape interval
            </Text>
            <View style={styles.intervalBadge}>
              <Clock size={12} color={T.accent} />
              <Text style={styles.intervalBadgeText}>
                {formatInterval(form.scrapeIntervalMinutes)}
              </Text>
            </View>
          </View>

          <Slider
            style={{ width: "100%", height: 40 }}
            minimumValue={10}
            maximumValue={180}
            step={5}
            value={form.scrapeIntervalMinutes}
            onValueChange={(val) =>
              setForm((f) => ({ ...f, scrapeIntervalMinutes: val }))
            }
            minimumTrackTintColor={T.accent}
            maximumTrackTintColor={T.glassBorder}
            thumbTintColor={T.accent}
          />
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              paddingHorizontal: 5,
            }}
          >
            <Text style={{ fontSize: 10, color: T.textMuted }}>10m</Text>
            <Text style={{ fontSize: 10, color: T.textMuted }}>3h</Text>
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

        {/* Scrap Now */}
        <TouchableOpacity
          style={[styles.scrapNowButton, scraping && { opacity: 0.55 }]}
          onPress={async () => {
            const result = await triggerScrape();
            setScrapeResult(result);
            setTimeout(() => setScrapeResult(null), 4000);
          }}
          disabled={scraping}
          activeOpacity={0.8}
        >
          {scraping ? (
            <ActivityIndicator size="small" color={T.textSecondary} />
          ) : (
            <View style={styles.saveRow}>
              <Play size={14} color={T.textPrimary} fill={T.textPrimary} />
              <Text style={styles.scrapNowText}>Scrap Now</Text>
            </View>
          )}
        </TouchableOpacity>

        {scrapeResult && (
          <Text
            style={[
              styles.testResult,
              {
                color: scrapeResult.ok ? "#4ade80" : "#f87171",
                marginBottom: 4,
                marginTop: 8,
              },
            ]}
          >
            {scrapeResult.ok ? "✓ " : "✗ "}
            {scrapeResult.message}
          </Text>
        )}

        {/* Push notification status */}
        <View style={styles.notifCard}>
          <View style={styles.notifRow}>
            <View
              style={[
                styles.notifDot,
                {
                  backgroundColor: IS_DEV
                    ? "#444"
                    : tokenRegistered
                      ? "#4ade80"
                      : "#f87171",
                },
              ]}
            />
            <Text style={styles.notifLabel}>
              {IS_DEV
                ? "Push notifications disabled in dev mode"
                : tokenRegistered
                  ? "Push notifications active ✓"
                  : "Push notifications not registered"}
            </Text>
          </View>

          {!IS_DEV && tokenPreview && (
            <Text style={styles.tokenPreview} numberOfLines={1}>
              {tokenPreview}
            </Text>
          )}

          {!IS_DEV && !tokenRegistered && tokenError && (
            <Text style={styles.notifError}>{tokenError}</Text>
          )}

          {!IS_DEV && !tokenRegistered && (
            <TouchableOpacity
              style={[styles.testButton, tokenSaving && { opacity: 0.6 }]}
              onPress={async () => {
                const result = await registerTokenOnly();
                setTestResult(result);
                setTimeout(() => setTestResult(null), 4000);
              }}
              disabled={tokenSaving}
              activeOpacity={0.8}
            >
              <Text style={styles.testButtonText}>
                {tokenSaving ? "Registering…" : "Register push notifications"}
              </Text>
            </TouchableOpacity>
          )}

          {!IS_DEV && tokenRegistered && (
            <TouchableOpacity
              style={[styles.testButton, tokenSaving && { opacity: 0.6 }]}
              onPress={async () => {
                const result = await sendTestNotification();
                setTestResult(result);
                setTimeout(() => setTestResult(null), 4000);
              }}
              disabled={tokenSaving}
              activeOpacity={0.8}
            >
              <Text style={styles.testButtonText}>
                {tokenSaving ? "Sending…" : "Send test notification"}
              </Text>
            </TouchableOpacity>
          )}

          {testResult && (
            <Text
              style={[
                styles.testResult,
                { color: testResult.ok ? "#4ade80" : "#f87171", marginTop: 4 },
              ]}
            >
              {testResult.ok ? "✓ " : "✗ "}
              {testResult.message}
            </Text>
          )}
        </View>
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
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 100,
    backgroundColor: T.glass,
    borderWidth: 1,
    borderColor: T.glassBorder,
  },
  chipStrict: {
    borderColor: "rgba(250, 204, 21, 0.4)", // Dourado escurecido na borda
    backgroundColor: "rgba(250, 204, 21, 0.05)",
  },
  chipActive: {
    backgroundColor: T.accent,
    borderColor: T.accent,
  },
  chipStrictActive: {
    backgroundColor: "#facc15", // Amarelo/Dourado preenchido
    borderColor: "#facc15",
  },
  chipText: {
    fontSize: 12,
    fontWeight: "700",
    color: T.textSecondary,
  },
  chipTextStrict: {
    color: "rgba(250, 204, 21, 0.8)", // Texto dourado sutil
  },
  chipTextActive: {
    color: "#000000",
  },
  chipTextStrictActive: {
    color: "#000000", // Mantém preto para alto contraste
  },
  customKeywordsInput: {
    marginTop: 10,
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
  intervalBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 100,
    gap: 5,
  },
  intervalBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: T.accent,
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
  urlActionsCol: {
    gap: 8,
  },
  urlEditRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  urlEditBtn: {
    flex: 1,
    justifyContent: "center",
  },
  scrapNowButton: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  scrapNowText: {
    color: T.textPrimary,
    fontWeight: "700",
    fontSize: 14,
    marginLeft: 7,
  },
  notifCard: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
    gap: 10,
  },
  notifRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  notifDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  notifLabel: {
    flex: 1,
    fontSize: 12,
    color: "#888",
    lineHeight: 17,
  },
  tokenPreview: {
    fontSize: 11,
    color: "#4ade80",
    fontFamily: "monospace",
    letterSpacing: 0.2,
    opacity: 0.8,
  },
  notifError: {
    fontSize: 11,
    color: "#f87171",
    lineHeight: 16,
    marginTop: 2,
  },
  testButton: {
    alignSelf: "stretch",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 9,
    paddingVertical: 10,
    alignItems: "center",
  },
  testButtonText: {
    color: "#ededed",
    fontWeight: "600",
    fontSize: 13,
  },
  testResult: {
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
});
