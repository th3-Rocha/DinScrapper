import Constants from "expo-constants";

/**
 * true  → running inside Expo Go (expo start) or Metro dev server
 * false → standalone APK / EAS production or preview build
 *
 * Use this to gate features that only work in a real build:
 *   - expo-camera (QR scanning)
 *   - expo-notifications (push tokens)
 */
export const IS_DEV = __DEV__;
