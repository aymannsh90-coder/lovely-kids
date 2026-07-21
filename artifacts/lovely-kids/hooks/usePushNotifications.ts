import { useEffect } from "react";
import { API_BASE } from "@/constants/api";

type GetAuthToken = (() => Promise<string | null>) | null;

type WebPushData = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export function maskToken(_token: string): string {
  return "***";
}

function isWebPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const raw = window.atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function getPublicKey(): Promise<string> {
  const response = await fetch(
    `${API_BASE}/api/web-push-public-key`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json() as {
    publicKey?: string;
  };

  if (!data.publicKey) {
    throw new Error("VAPID public key is missing");
  }

  return data.publicKey;
}

async function getSubscription(): Promise<WebPushData | null> {
  if (!isWebPushSupported()) return null;
  if (Notification.permission !== "granted") return null;

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    const publicKey = await getPublicKey();

    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
    });
  }

  const json = subscription.toJSON();

  if (!json.keys?.p256dh || !json.keys?.auth) return null;

  return {
    endpoint: subscription.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  };
}

export async function registerForPushNotificationsAsync():
  Promise<string | null> {
  const subscription = await getSubscription();

  return subscription
    ? JSON.stringify(subscription)
    : null;
}

export async function saveTokenToServer(
  token: string,
  _phone?: string | null,
  getAuthToken?: GetAuthToken,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const subscription = JSON.parse(token) as WebPushData;
    const authToken = getAuthToken ? await getAuthToken() : null;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const response = await fetch(
      `${API_BASE}/api/web-push-subscriptions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(subscription),
      },
    );

    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status}`,
      };
    }

    return { ok: true };

  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : String(error),
    };
  }
}

export async function enableWebPushNotifications(
  phone?: string | null,
  getAuthToken?: GetAuthToken,
): Promise<{ ok: boolean; error?: string }> {
  if (!isWebPushSupported()) {
    return {
      ok: false,
      error: "الإشعارات غير مدعومة على هذا الجهاز",
    };
  }

  const permission = await Notification.requestPermission();

  if (permission !== "granted") {
    return {
      ok: false,
      error: "لم يتم السماح بالإشعارات",
    };
  }

  const token = await registerForPushNotificationsAsync();

  if (!token) {
    return {
      ok: false,
      error: "تعذر إنشاء اشتراك الإشعارات",
    };
  }

  return saveTokenToServer(
    token,
    phone,
    getAuthToken,
  );
}

export function usePushNotifications(
  phone?: string | null,
  getAuthToken?: GetAuthToken,
) {
  useEffect(() => {
    if (
      !isWebPushSupported() ||
      Notification.permission !== "granted"
    ) {
      return;
    }

    void registerForPushNotificationsAsync()
      .then((token) => {
        if (!token) return;
        return saveTokenToServer(
          token,
          phone,
          getAuthToken,
        );
      })
      .catch((error) => {
        console.error("[Web Push] Registration failed:", error);
      });
  }, [phone, getAuthToken]);
}
