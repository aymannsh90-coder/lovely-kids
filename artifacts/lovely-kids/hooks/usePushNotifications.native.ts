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

async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  if (!Device.isDevice) return null;

  const existing = await Notifications.getPermissionsAsync() as { status: string };
  let isGranted = existing.status === "granted";

  if (!isGranted) {
    const requested = await Notifications.requestPermissionsAsync() as { status: string };
    isGranted = requested.status === "granted";
  }

  if (!isGranted) return null;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

  if (!projectId) {
    console.warn("Push registration skipped: no EAS projectId found in app config.");
    return null;
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
  return tokenData.data;
}

async function saveTokenToServer(
  token: string,
  phone?: string | null,
  getAuthToken?: (() => Promise<string | null>) | null
) {
  try {
    const authToken = getAuthToken ? await getAuthToken() : null;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

    await fetch(`${API_BASE}/api/push-tokens`, {
      method: "POST",
      headers,
      body: JSON.stringify({ token, phone: phone ?? undefined }),
    });
  } catch {
  }
}

export function usePushNotifications(
  phone?: string | null,
  getAuthToken?: (() => Promise<string | null>) | null
) {
  useEffect(() => {
    registerForPushNotificationsAsync()
      .then((token) => {
        if (token) saveTokenToServer(token, phone, getAuthToken);
      })
      .catch((error) => {
        console.warn("Push notification registration failed:", error);
      });
  // Re-register whenever the user's identity or auth changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, getAuthToken]);
}
