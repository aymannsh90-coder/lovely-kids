import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect } from "react";
import { Platform } from "react-native";

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
    let started = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const sendVisit = async () => {
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
    };

    if (Platform.OS !== "web") {
      timer = setTimeout(() => {
        void sendVisit();
      }, 1200);

      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
      };
    }

    if (typeof window === "undefined") {
      return;
    }

    // لا نحسب صفحات الإدارة ضمن زوار المتجر.
    if (window.location.pathname.startsWith("/admin")) {
      return;
    }

    // المتصفحات الآلية المعروفة لا تُحتسب.
    if (navigator.webdriver) {
      return;
    }

    const events = [
      "pointerdown",
      "touchstart",
      "keydown",
      "scroll",
    ] as const;

    const removeListeners = () => {
      for (const eventName of events) {
        window.removeEventListener(
          eventName,
          handleHumanInteraction,
        );
      }
    };

    function handleHumanInteraction() {
      if (cancelled || started) return;

      started = true;
      removeListeners();

      timer = setTimeout(() => {
        void sendVisit();
      }, 200);
    }

    // على الويب لا نسجل الزيارة إلا بعد تفاعل بشري فعلي.
    for (const eventName of events) {
      window.addEventListener(
        eventName,
        handleHumanInteraction,
        { passive: true },
      );
    }

    return () => {
      cancelled = true;
      removeListeners();

      if (timer) {
        clearTimeout(timer);
      }
    };
  }, []);
}
