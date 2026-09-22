import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";

import {
  NotificationSoftPrompt,
  type NotificationPromptReason,
} from "@/components/NotificationSoftPrompt";
import {
  enablePushNotifications,
  isPushNotificationsEnabled,
} from "@/hooks/usePushNotifications";

const VISIT_COUNT_KEY =
  "@lovely_kids_notification_visit_count";

const LAST_GENERAL_PROMPT_AT_KEY =
  "@lovely_kids_notification_last_general_prompt_at";

const GENERAL_PROMPT_COOLDOWN_MS =
  7 * 24 * 60 * 60 * 1000;

type EnableResult = {
  ok: boolean;
  error?: string;
};

type ContextValue = {
  enabled: boolean;
  ready: boolean;
  enabling: boolean;
  canPromptOnVisit: boolean;
  refreshPermissionState: () => Promise<boolean>;
  enableNow: (
    orderId?: number | null,
    phoneOverride?: string | null,
  ) => Promise<EnableResult>;
  requestGeneralPrompt: (
    reason: NotificationPromptReason,
  ) => Promise<boolean>;
  setGeneralPromptBlocked: (
    blocked: boolean,
  ) => void;
};

const NotificationOptInContext =
  createContext<ContextValue | null>(null);

type Props = {
  children: React.ReactNode;
  phone?: string | null;
  getAuthToken?: (() => Promise<string | null>) | null;
};

export function NotificationOptInProvider({
  children,
  phone,
  getAuthToken,
}: Props) {
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [canPromptOnVisit, setCanPromptOnVisit] =
    useState(false);

  const [promptVisible, setPromptVisible] =
    useState(false);

  const [promptReason, setPromptReason] =
    useState<NotificationPromptReason>("visit");

  const [promptError, setPromptError] =
    useState("");

  const promptShownThisSession = useRef(false);
  const generalPromptBlocked = useRef(false);

  const refreshPermissionState =
    useCallback(async () => {
      try {
        const granted =
          await isPushNotificationsEnabled();

        setEnabled(granted);
        setReady(true);

        return granted;
      } catch {
        setEnabled(false);
        setReady(true);
        return false;
      }
    }, []);

  const setGeneralPromptBlocked =
    useCallback((blocked: boolean) => {
      generalPromptBlocked.current = blocked;
    }, []);

  const requestGeneralPrompt =
    useCallback(
      async (
        reason: NotificationPromptReason,
      ): Promise<boolean> => {
        if (
          generalPromptBlocked.current ||
          promptShownThisSession.current
        ) {
          return false;
        }

        const granted =
          await isPushNotificationsEnabled()
            .catch(() => false);

        if (granted) {
          setEnabled(true);
          setReady(true);
          return false;
        }

        const lastRaw =
          await AsyncStorage.getItem(
            LAST_GENERAL_PROMPT_AT_KEY,
          ).catch(() => null);

        const lastShown = Number(lastRaw || 0);

        if (
          Number.isFinite(lastShown) &&
          lastShown > 0 &&
          Date.now() - lastShown <
            GENERAL_PROMPT_COOLDOWN_MS
        ) {
          return false;
        }

        promptShownThisSession.current = true;

        await AsyncStorage.setItem(
          LAST_GENERAL_PROMPT_AT_KEY,
          String(Date.now()),
        ).catch(() => {});

        setPromptError("");
        setPromptReason(reason);
        setPromptVisible(true);

        return true;
      },
      [],
    );

  const enableNow = useCallback(
    async (
      orderId?: number | null,
      phoneOverride?: string | null,
    ): Promise<EnableResult> => {
      if (enabling) {
        return {
          ok: false,
          error: "جاري تفعيل الإشعارات",
        };
      }

      setEnabling(true);
      setPromptError("");

      try {
        const result =
          await enablePushNotifications(
            phoneOverride?.trim() ||
              phone?.trim() ||
              undefined,
            getAuthToken,
            orderId,
          );

        if (result.ok) {
          setEnabled(true);
          setReady(true);
          setPromptVisible(false);
          return result;
        }

        setPromptError(
          result.error ||
            "تعذر تفعيل الإشعارات",
        );

        return result;
      } finally {
        setEnabling(false);
      }
    },
    [
      enabling,
      getAuthToken,
      phone,
    ],
  );

  const dismissPrompt = useCallback(() => {
    setPromptVisible(false);
    setPromptError("");
  }, []);

  useEffect(() => {
    let stopped = false;

    const initialize = async () => {
      const granted =
        await refreshPermissionState();

      const countRaw =
        await AsyncStorage.getItem(
          VISIT_COUNT_KEY,
        ).catch(() => null);

      const previousCount = Math.max(
        0,
        Number(countRaw || 0) || 0,
      );

      const nextCount = previousCount + 1;

      await AsyncStorage.setItem(
        VISIT_COUNT_KEY,
        String(nextCount),
      ).catch(() => {});

      if (stopped) {
        return;
      }

      setCanPromptOnVisit(
        !granted && nextCount >= 2,
      );
    };

    void initialize();

    return () => {
      stopped = true;
    };
  }, [refreshPermissionState]);

  useEffect(() => {
    const subscription =
      AppState.addEventListener(
        "change",
        (state) => {
          if (state === "active") {
            void refreshPermissionState();
          }
        },
      );

    return () => subscription.remove();
  }, [refreshPermissionState]);

  return (
    <NotificationOptInContext.Provider
      value={{
        enabled,
        ready,
        enabling,
        canPromptOnVisit,
        refreshPermissionState,
        enableNow,
        requestGeneralPrompt,
        setGeneralPromptBlocked,
      }}
    >
      {children}

      <NotificationSoftPrompt
        visible={promptVisible}
        reason={promptReason}
        enabling={enabling}
        error={promptError}
        onEnable={() => {
          void enableNow();
        }}
        onDismiss={dismissPrompt}
      />
    </NotificationOptInContext.Provider>
  );
}

export function useNotificationOptIn() {
  const context =
    useContext(NotificationOptInContext);

  if (!context) {
    throw new Error(
      "useNotificationOptIn must be used inside NotificationOptInProvider",
    );
  }

  return context;
}
