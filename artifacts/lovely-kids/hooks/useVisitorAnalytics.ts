import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect } from "react";

import { API_BASE } from "@/constants/api";

const VISITOR_ID_KEY =
  "lovely_kids_analytics_visitor_id";

const LAST_SENT_DAY_KEY =
  "lovely_kids_analytics_last_sent_day";

function createVisitorId() {
  const cryptoObject = globalThis.crypto as
    | { randomUUID?: () => string }
    | undefined;

  if (cryptoObject?.randomUUID) {
    return cryptoObject.randomUUID().replace(/-/g, "_");
  }

  return [
    "lk",
    Date.now().toString(36),
    Math.random().toString(36).slice(2),
    Math.random().toString(36).slice(2),
  ].join("_");
}

function currentDayKey() {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jerusalem",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function useVisitorAnalytics() {
  useEffect(() => {
    let cancelled = false;

    // التسجيل يبدأ بالخلفية بعد فتح الواجهة،
    // ولا يؤخر تحميل الصفحة أو المنتجات.
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const dayKey = currentDayKey();

          const lastSentDay =
            await AsyncStorage.getItem(LAST_SENT_DAY_KEY);

          if (cancelled || lastSentDay === dayKey) {
            return;
          }

          let visitorId =
            await AsyncStorage.getItem(VISITOR_ID_KEY);

          if (!visitorId) {
            visitorId = createVisitorId();

            await AsyncStorage.setItem(
              VISITOR_ID_KEY,
              visitorId,
            );
          }

          if (cancelled) return;

          const response = await fetch(
            `${API_BASE}/api/analytics/visit`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ visitorId }),
            },
          );

          if (response.ok && !cancelled) {
            await AsyncStorage.setItem(
              LAST_SENT_DAY_KEY,
              dayKey,
            );
          }
        } catch {
          // الإحصائيات لا يجب أن تؤثر على تجربة الزبون.
        }
      })();
    }, 1200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);
}
