import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "expo-router/react-navigation";
import { Stack } from "expo-router";
import { useColorScheme, View, ActivityIndicator } from "react-native";
import { useApiUrl } from "../hooks/use-api-url";
import { SetupScreen } from "../components/setup-screen";
import { T } from "../constants/theme";
import "../global.css";

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { apiUrl, loading, setApiUrl } = useApiUrl();

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      {loading ? (
        <View
          style={{
            flex: 1,
            backgroundColor: T.bg,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ActivityIndicator size="large" color={T.textSecondary} />
        </View>
      ) : !apiUrl ? (
        <SetupScreen onScanned={setApiUrl} />
      ) : (
        <Stack screenOptions={{ headerShown: false }} />
      )}
    </ThemeProvider>
  );
}
