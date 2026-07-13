// Web / non-native stub — push notifications are not supported on web.
// Exports mirror the native implementation so TypeScript resolves types correctly.

export function maskToken(_t: string): string {
  return "***";
}

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  return null;
}

export async function saveTokenToServer(
  _token: string,
  _phone?: string | null,
  _getAuthToken?: (() => Promise<string | null>) | null
): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: "Push notifications not supported on web" };
}

export function usePushNotifications(
  _phone?: string | null,
  _getAuthToken?: (() => Promise<string | null>) | null
) {}
