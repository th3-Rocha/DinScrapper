import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useApiUrl } from "../hooks/use-api-url";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Linking,
  Alert,
  Platform,
  RefreshControl,
  Animated,
  StatusBar,
  ActivityIndicator,
} from "react-native";
import axios from "axios";
import {
  MapPin,
  Briefcase,
  Clock,
  Users,
  Zap,
  RefreshCw,
  WifiOff,
  CheckCircle2,
  Circle,
  SendHorizonal,
  Settings as SettingsIcon,
  Trash2,
  ListFilter,
} from "lucide-react-native";
import { useRouter } from "expo-router";

// ─── Theme tokens ────────────────────────────────────────────────────────────
const T = {
  bg: "#000000",
  surface: "#0a0a0a",
  glass: "rgba(255,255,255,0.04)",
  glassBorder: "rgba(255,255,255,0.08)",
  textPrimary: "#ededed",
  textSecondary: "#888888",
  textMuted: "#555555",
  accent: "#ffffff",
  danger: "#f87171",
  success: "#4ade80",
  appliedBg: "rgba(34,197,94,0.06)",
  appliedBorder: "rgba(34,197,94,0.2)",
  appliedStripe: "#22c55e",
};

const BADGE = {
  location: { bg: "rgba(139,92,246,0.12)", text: "#a78bfa", icon: "#8b5cf6" },
  time: { bg: "rgba(234,179,8,0.12)", text: "#fbbf24", icon: "#eab308" },
  applicants: { bg: "rgba(14,165,233,0.12)", text: "#38bdf8", icon: "#0ea5e9" },
  easyApply: { bg: "rgba(34,197,94,0.12)", text: "#4ade80", icon: "#22c55e" },
};

const ACCENTS = ["#6366f1", "#06b6d4", "#10b981", "#f59e0b", "#ec4899"];

interface Job {
  id: number;
  title: string;
  company: string;
  location: string;
  workplaceType: string;
  link: string;
  timePosted: string;
  applicantCount: string;
  isEasyApply: boolean;
  postedAt?: string;
}

type FilterMode = "RECENT_SCRAPED" | "FEWEST_APPLICANTS" | "RECENT_POSTED";

// ─── Sorting Helpers ─────────────────────────────────────────────────────────
function parseApplicantCount(countStr: string): number {
  if (!countStr) return 9999;
  const lower = countStr.toLowerCase();

  if (lower.includes("first 25")) return 10;
  if (lower.includes("over 200")) return 201;

  // Extract number if present "45 applicants" -> 45
  const match = lower.match(/(\d+)/);
  if (match) {
    return parseInt(match[1], 10);
  }

  if (lower.includes("25-199")) return 100;
  return 9999;
}

function parseTimePosted(timeStr: string): number {
  if (!timeStr) return 999999;
  const lower = timeStr.toLowerCase();
  const match = lower.match(/(\d+)/);
  const val = match ? parseInt(match[1], 10) : 1;

  if (lower.includes("second")) return val / 60;
  if (lower.includes("minute")) return val;
  if (lower.includes("hour")) return val * 60;
  if (lower.includes("day")) return val * 60 * 24;
  if (lower.includes("week")) return val * 60 * 24 * 7;
  if (lower.includes("month")) return val * 60 * 24 * 30;

  return 999999; // fallback
}

// ─── Animated Checkbox ───────────────────────────────────────────────────────
function ApplyCheckbox({
  applied,
  onToggle,
}: {
  applied: boolean;
  onToggle: () => void;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const checkAnim = useRef(new Animated.Value(applied ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(checkAnim, {
      toValue: applied ? 1 : 0,
      useNativeDriver: true,
      tension: 180,
      friction: 10,
    }).start();
  }, [applied]);

  const handlePress = () => {
    Animated.sequence([
      Animated.spring(scaleAnim, {
        toValue: 0.82,
        useNativeDriver: true,
        speed: 80,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        speed: 80,
      }),
    ]).start();
    onToggle();
  };

  const checkScale = checkAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.5, 1],
  });

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.9}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={{ flexDirection: "row", alignItems: "center", gap: 7 }}
    >
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        {applied ? (
          <Animated.View
            style={{ transform: [{ scale: checkScale }], opacity: checkAnim }}
          >
            <CheckCircle2 size={20} color={T.appliedStripe} strokeWidth={2.5} />
          </Animated.View>
        ) : (
          <Circle size={20} color={T.textMuted} strokeWidth={1.5} />
        )}
      </Animated.View>
      <Text
        style={{
          fontSize: 12,
          fontWeight: applied ? "700" : "400",
          color: applied ? T.appliedStripe : T.textMuted,
          letterSpacing: 0.1,
        }}
      >
        {applied ? "Applied" : "Mark as applied"}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Job card ────────────────────────────────────────────────────────────────
function JobCard({
  item,
  index,
  applied,
  onToggleApplied,
}: {
  item: Job;
  index: number;
  applied: boolean;
  onToggleApplied: (id: number) => void;
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const appliedAnim = useRef(new Animated.Value(applied ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(appliedAnim, {
      toValue: applied ? 1 : 0,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [applied]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 320,
        delay: Math.min(index * 55, 500), // Cap animation delay
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 320,
        delay: Math.min(index * 55, 500),
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const accent = applied ? T.appliedStripe : ACCENTS[item.id % ACCENTS.length];
  const initial = item.company ? item.company.charAt(0).toUpperCase() : "💼";

  const borderColor = appliedAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [T.glassBorder, T.appliedBorder],
  });
  const bgColor = appliedAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [T.glass, T.appliedBg],
  });

  return (
    <Animated.View
      style={{
        opacity: fadeAnim,
        transform: [{ translateY: slideAnim }, { scale: scaleAnim }],
        marginBottom: 12,
      }}
    >
      <Animated.View
        style={{
          backgroundColor: bgColor,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: borderColor,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            height: 1,
            backgroundColor: accent,
            opacity: applied ? 1 : 0.7,
          }}
        />
        <View style={{ padding: 18 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 10,
                backgroundColor: accent + "18",
                borderWidth: 1,
                borderColor: accent + "30",
                alignItems: "center",
                justifyContent: "center",
                marginRight: 12,
              }}
            >
              <Text style={{ fontSize: 17, fontWeight: "800", color: accent }}>
                {initial}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: "700",
                  color: applied ? T.textSecondary : T.textPrimary,
                  lineHeight: 20,
                  letterSpacing: -0.2,
                  textDecorationLine: applied ? "line-through" : "none",
                }}
                numberOfLines={2}
              >
                {item.title}
              </Text>
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: "500",
                  color: T.textSecondary,
                  marginTop: 2,
                }}
              >
                {item.company}
              </Text>
            </View>
            {applied && (
              <View
                style={{
                  backgroundColor: "rgba(34,197,94,0.12)",
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 100,
                  marginLeft: 8,
                  alignSelf: "flex-start",
                }}
              >
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: "700",
                    color: T.appliedStripe,
                  }}
                >
                  ✓ Sent
                </Text>
              </View>
            )}
          </View>

          {item.location ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                marginTop: 12,
              }}
            >
              <MapPin size={12} color={T.textMuted} />
              <Text style={{ fontSize: 12, color: T.textMuted, marginLeft: 5 }}>
                {item.location}
              </Text>
            </View>
          ) : null}

          <View
            style={{
              height: 1,
              backgroundColor: T.glassBorder,
              marginVertical: 14,
            }}
          />

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
            <Badge
              icon={<MapPin size={11} color={BADGE.location.icon} />}
              label={item.workplaceType}
              style={BADGE.location}
            />
            <Badge
              icon={<Clock size={11} color={BADGE.time.icon} />}
              label={item.timePosted || "Recent"}
              style={BADGE.time}
            />
            {item.applicantCount ? (
              <Badge
                icon={<Users size={11} color={BADGE.applicants.icon} />}
                label={item.applicantCount}
                style={BADGE.applicants}
              />
            ) : null}
            {item.isEasyApply && (
              <Badge
                icon={<Zap size={11} color={BADGE.easyApply.icon} />}
                label="Easy Apply"
                style={BADGE.easyApply}
              />
            )}
          </View>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 16,
              gap: 10,
            }}
          >
            <ApplyCheckbox
              applied={applied}
              onToggle={() => onToggleApplied(item.id)}
            />
            <TouchableOpacity
              onPress={() => Linking.openURL(item.link)}
              activeOpacity={0.8}
              style={{
                flex: 1,
                backgroundColor: applied ? "rgba(255,255,255,0.06)" : T.accent,
                paddingVertical: 11,
                borderRadius: 10,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                borderWidth: applied ? 1 : 0,
                borderColor: T.glassBorder,
              }}
            >
              {applied ? (
                <SendHorizonal size={14} color={T.textMuted} />
              ) : (
                <Briefcase size={14} color="#000000" />
              )}
              <Text
                style={{
                  color: applied ? T.textMuted : "#000000",
                  fontWeight: "700",
                  fontSize: 13,
                  marginLeft: 6,
                }}
              >
                {applied ? "View posting" : "Apply Now"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

// ─── Badge ───────────────────────────────────────────────────────────────────
function Badge({
  icon,
  label,
  style,
}: {
  icon: React.ReactNode;
  label: string;
  style: { bg: string; text: string };
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: style.bg,
        paddingHorizontal: 9,
        paddingVertical: 4,
        borderRadius: 100,
      }}
    >
      {icon}
      <Text
        style={{
          fontSize: 11,
          fontWeight: "600",
          color: style.text,
          marginLeft: 5,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────
function EmptyState({ onRefresh }: { onRefresh: () => void }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingTop: 80,
      }}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 16,
          backgroundColor: T.glass,
          borderWidth: 1,
          borderColor: T.glassBorder,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 14,
        }}
      >
        <Briefcase size={28} color={T.textMuted} />
      </View>
      <Text
        style={{
          color: T.textPrimary,
          fontSize: 17,
          fontWeight: "700",
          marginBottom: 6,
        }}
      >
        No jobs found
      </Text>
      <Text
        style={{
          color: T.textSecondary,
          fontSize: 13,
          textAlign: "center",
          marginBottom: 24,
          paddingHorizontal: 40,
        }}
      >
        Pull down to refresh or tap below to try again
      </Text>
      <TouchableOpacity
        onPress={onRefresh}
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: T.glass,
          paddingHorizontal: 18,
          paddingVertical: 11,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: T.glassBorder,
        }}
      >
        <RefreshCw size={14} color={T.textSecondary} />
        <Text
          style={{
            color: T.textSecondary,
            fontWeight: "600",
            marginLeft: 7,
            fontSize: 13,
          }}
        >
          Refresh
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Root screen ─────────────────────────────────────────────────────────────
export default function Home() {
  const { apiUrl } = useApiUrl();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [appliedIds, setAppliedIds] = useState<Set<number>>(new Set());
  const [filterMode, setFilterMode] = useState<FilterMode>("RECENT_SCRAPED");
  const router = useRouter();

  const toggleApplied = useCallback((id: number) => {
    setAppliedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const fetchJobs = useCallback(
    async (isRefresh = false) => {
      if (!apiUrl) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(false);
      try {
        const res = await axios.get(`${apiUrl}/api/jobs`, { timeout: 10000 });
        setJobs(res.data); // Keep raw data, will sort in useMemo
        setLastUpdated(new Date());
      } catch (err) {
        console.error("Failed to fetch jobs:", err);
        setError(true);
      } finally {
        setRefreshing(false);
        setLoading(false);
      }
    },
    [apiUrl],
  );

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const onRefresh = useCallback(() => fetchJobs(true), [fetchJobs]);

  const handleDeleteAllJobs = useCallback(() => {
    Alert.alert(
      "Delete All Jobs",
      "Are you sure you want to permanently delete all jobs from your database?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await axios.delete(`${apiUrl}/api/jobs`);
              setJobs([]);
              Alert.alert("Success", "All jobs have been deleted.");
            } catch (err) {
              Alert.alert("Error", "Could not delete jobs from the server.");
            }
          },
        },
      ],
    );
  }, [apiUrl]);

  const cycleFilter = () => {
    setFilterMode((prev) => {
      if (prev === "RECENT_SCRAPED") return "FEWEST_APPLICANTS";
      if (prev === "FEWEST_APPLICANTS") return "RECENT_POSTED";
      return "RECENT_SCRAPED";
    });
  };

  const processedJobs = useMemo(() => {
    let sorted = [...jobs];

    if (filterMode === "RECENT_SCRAPED") {
      sorted.sort((a, b) => b.id - a.id);
    } else if (filterMode === "FEWEST_APPLICANTS") {
      sorted.sort((a, b) => {
        const rankA = parseApplicantCount(a.applicantCount);
        const rankB = parseApplicantCount(b.applicantCount);
        if (rankA === rankB) return b.id - a.id;
        return rankA - rankB;
      });
    } else if (filterMode === "RECENT_POSTED") {
      sorted.sort((a, b) => {
        const timeA = parseTimePosted(a.timePosted);
        const timeB = parseTimePosted(b.timePosted);
        if (timeA === timeB) return b.id - a.id;
        return timeA - timeB;
      });
    }

    return sorted;
  }, [jobs, filterMode]);

  const formatLastUpdated = () => {
    if (!lastUpdated) return "";
    const mins = Math.floor((Date.now() - lastUpdated.getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins === 1) return "1 min ago";
    return `${mins} min ago`;
  };

  const appliedCount = appliedIds.size;

  const renderFilterIcon = () => {
    if (filterMode === "RECENT_SCRAPED")
      return <ListFilter size={14} color={T.textSecondary} />;
    if (filterMode === "FEWEST_APPLICANTS")
      return <Users size={14} color={T.textSecondary} />;
    if (filterMode === "RECENT_POSTED")
      return <Clock size={14} color={T.textSecondary} />;
  };

  const filterLabels = {
    RECENT_SCRAPED: "Scraped",
    FEWEST_APPLICANTS: "Applicants",
    RECENT_POSTED: "Recent",
  };

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <StatusBar barStyle="light-content" backgroundColor={T.bg} />

      <View
        style={{
          paddingTop: Platform.OS === "ios" ? 58 : 46,
          paddingHorizontal: 20,
          paddingBottom: 14,
          borderBottomWidth: 1,
          borderBottomColor: T.glassBorder,
          backgroundColor: T.bg,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View>
            <Text
              style={{
                fontSize: 22,
                fontWeight: "800",
                color: T.textPrimary,
                letterSpacing: -0.6,
              }}
            >
              Job<Text style={{ color: T.textMuted }}>nator</Text>
            </Text>
            {lastUpdated && !loading && (
              <Text style={{ fontSize: 11, color: T.textMuted, marginTop: 1 }}>
                {error ? (
                  <Text style={{ color: T.danger }}>⚠ Failed to load</Text>
                ) : (
                  `Updated ${formatLastUpdated()}`
                )}
              </Text>
            )}
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: error
                  ? "rgba(248,113,113,0.08)"
                  : "rgba(74,222,128,0.08)",
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 100,
                borderWidth: 1,
                borderColor: error
                  ? "rgba(248,113,113,0.2)"
                  : "rgba(74,222,128,0.2)",
              }}
            >
              {error ? (
                <WifiOff size={11} color={T.danger} />
              ) : (
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: T.success,
                    marginRight: 5,
                  }}
                />
              )}
              <Text
                style={{
                  color: error ? T.danger : T.success,
                  fontWeight: "700",
                  fontSize: 12,
                  marginLeft: error ? 5 : 0,
                }}
              >
                {loading ? "—" : error ? "Offline" : `${jobs.length} open`}
              </Text>
            </View>

            {/* Filter Toggle Button */}
            <TouchableOpacity
              onPress={cycleFilter}
              style={{
                height: 34,
                paddingHorizontal: 10,
                borderRadius: 9,
                backgroundColor: T.glass,
                borderWidth: 1,
                borderColor: T.glassBorder,
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "row",
                gap: 5,
              }}
            >
              {renderFilterIcon()}
              <Text
                style={{
                  fontSize: 10,
                  fontWeight: "600",
                  color: T.textSecondary,
                }}
              >
                {filterLabels[filterMode]}
              </Text>
            </TouchableOpacity>

            {/* Delete All Button */}
            <TouchableOpacity
              onPress={handleDeleteAllJobs}
              style={{
                width: 34,
                height: 34,
                borderRadius: 9,
                backgroundColor: T.glass,
                borderWidth: 1,
                borderColor: T.glassBorder,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Trash2 size={14} color={T.danger} />
            </TouchableOpacity>

            {/* Settings Button */}
            <TouchableOpacity
              onPress={() => router.push("/settings")}
              style={{
                width: 34,
                height: 34,
                borderRadius: 9,
                backgroundColor: T.glass,
                borderWidth: 1,
                borderColor: T.glassBorder,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <SettingsIcon size={14} color={T.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {loading ? (
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <ActivityIndicator size="large" color={T.textSecondary} />
          <Text style={{ color: T.textMuted, marginTop: 10, fontSize: 13 }}>
            Loading jobs…
          </Text>
        </View>
      ) : (
        <FlatList
          data={processedJobs}
          keyExtractor={(item) => item.id.toString()}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: 14,
            paddingTop: 14,
            paddingBottom: 48,
            flexGrow: 1,
          }}
          renderItem={({ item, index }) => (
            <JobCard
              item={item}
              index={index}
              applied={appliedIds.has(item.id)}
              onToggleApplied={toggleApplied}
            />
          )}
          ListEmptyComponent={<EmptyState onRefresh={onRefresh} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={T.textSecondary}
              colors={[T.textSecondary]}
              progressBackgroundColor={T.surface}
            />
          }
          removeClippedSubviews={true}
          maxToRenderPerBatch={8}
          windowSize={10}
          initialNumToRender={5}
        />
      )}
    </View>
  );
}
