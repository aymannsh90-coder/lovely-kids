import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { Platform } from "react-native";

import { API_BASE } from "@/constants/api";

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

/** Mask all but the first 4 and last 4 characters — safe to log. */
export function maskToken(t: string): string {
  if (t.length <= 10) return "ExpoToken[***]";
  return t.slice(0, 4) + "…" + t.slice(-4);
}

/**
 * Request permission, create the Android channel, and obtain the
 * ExponentPushToken for this device.
 * Throws on any unrecoverable error so the caller can surface it.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (Platform.OS === "web") return null;

  console.log("[Push] Device.isDevice:", Device.isDevice);
  if (!Device.isDevice) {
    console.warn("[Push] Skipped — not a physical device (emulator)");
    return null;
  }

  // Android 8+ (API 26+) requires an explicit notification channel.
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
    console.log("[Push] Android notification channel 'default' ensured");
  }

  const existing = await Notifications.getPermissionsAsync();
  console.log("[Push] Permission status:", existing.status);
  let isGranted = existing.status === "granted";

  if (!isGranted) {
    const requested = await Notifications.requestPermissionsAsync();
    console.log("[Push] Permission after request:", requested.status);
    isGranted = requested.status === "granted";
  }

  if (!isGranted) {
    console.warn("[Push] Permission denied — registration skipped");
    return null;
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  console.log("[Push] projectId:", projectId ?? "MISSING");

  if (!projectId) {
    throw new Error("[Push] EAS projectId is missing from app config");
  }

  const expoPushToken = (
    await Notifications.getExpoPushTokenAsync({ projectId })
  ).data;

  console.log("[Push] ExpoPushToken obtained:", maskToken(expoPushToken));
  return expoPushToken;
}

/**
 * POST the push token to the API so the server can target this device.
 * Returns a result object so callers (e.g. the debug screen) can surface errors.
 * Never logs the session/auth token.
 */
export async function saveTokenToServer(
  token: string,
  phone?: string | null,
  getAuthToken?: (() => Promise<string | null>) | null
): Promise<{ ok: boolean; error?: string }> {
  const endpoint = `${API_BASE}/api/push-tokens`;
  console.log("[Push] Registering token →", endpoint);
  console.log("[Push] Token (masked):", maskToken(token));

  try {
    const authToken = getAuthToken ? await getAuthToken() : null;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ token, phone: phone ?? undefined }),
    });

    const responseText = await res.text();
    console.log(`[Push] POST /api/push-tokens → HTTP ${res.status}`, responseText);

    if (!res.ok) {
      const errMsg = `HTTP ${res.status}: ${responseText}`;
      console.error("[Push] Token registration failed:", errMsg);
      return { ok: false, error: errMsg };
    }

    return { ok: true };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[Push] Token registration error:", errMsg);
    return { ok: false, error: errMsg };
  }
}

export function usePushNotifications(
  phone?: string | null,
  getAuthToken?: (() => Promise<string | null>) | null
) {
  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      attempt++;
      try {
        const token = await registerForPushNotificationsAsync();
        if (!token || stopped) return;

        const result = await saveTokenToServer(token, phone, getAuthToken);
        if (result.ok || stopped) return;
      } catch (err) {
        console.error("[Push] Registration failed:", err);
      }

      if (attempt < 5 && !stopped) {
        timer = setTimeout(run, attempt * 5000);
      }
    };

    void run();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [phone, getAuthToken]);
}
