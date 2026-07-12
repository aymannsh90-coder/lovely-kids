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

async function saveTokenToServer(token: string, phone?: string | null) {
  try {
    await fetch(`${API_BASE}/api/push-tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, phone: phone ?? undefined }),
    });
  } catch {
  }
}

export function usePushNotifications(phone?: string | null) {
  useEffect(() => {
    registerForPushNotificationsAsync()
      .then((token) => {
        if (token) saveTokenToServer(token, phone);
      })
      .catch((error) => {
        console.warn("Push notification registration failed:", error);
      });
  }, [phone]);
}
