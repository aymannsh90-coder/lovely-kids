import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import { useNotificationOptIn } from "@/context/NotificationOptInContext";
import { isPushNotificationsEnabled } from "@/hooks/usePushNotifications";

type Props = {
  phone: string;
  orderId: number;
  getAuthToken?: (() => Promise<string | null>) | null;
};

export default function GuestOrderNotificationPrompt({
  phone,
  orderId,
  getAuthToken,
}: Props) {
  const colors = useColors();
  const { enableNow } = useNotificationOptIn();
  const [enabling, setEnabling] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");

  const enable = async () => {
    if (enabling || enabled) return;

    setEnabling(true);
    setError("");

    try {
      const result = await enableNow(
        orderId,
        phone.trim(),
      );

      if (!result.ok) {
        setError(
          result.error ||
            "تعذر ربط الإشعارات بهذا الطلب، حاول مرة أخرى",
        );
        return;
      }

      setEnabled(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "تعذر تفعيل الإشعارات، حاول مرة أخرى",
      );
    } finally {
      setEnabling(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    const linkExistingPermission = async () => {
      try {
        const granted =
          await isPushNotificationsEnabled();

        if (!mounted || !granted) {
          return;
        }

        await enable();
      } catch {
        // لا نظهر خطأ إذا كان هذا مجرد ربط تلقائي لاشتراك موجود.
      }
    };

    void linkExistingPermission();

    return () => {
      mounted = false;
    };
    // يتم الربط مرة واحدة عند ظهور شاشة نجاح الطلب.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: enabled ? "#22c55e" : colors.primary,
        },
      ]}
    >
      <View style={styles.heading}>
        <Ionicons
          name={
            enabled
              ? "notifications-circle"
              : "notifications-outline"
          }
          size={30}
          color={enabled ? "#22c55e" : colors.primary}
        />

        <View style={styles.texts}>
          <Text
            style={[
              styles.title,
              { color: colors.foreground },
            ]}
          >
            {enabled
              ? "متابعة الطلب مفعّلة ✅"
              : "تابع طلبك أول بأول"}
          </Text>

          <Text
            style={[
              styles.description,
              { color: colors.mutedForeground },
            ]}
          >
            {enabled
              ? "سنخبرك فور حدوث أي تحديث على حالة طلبك"
              : "فعّل الإشعارات لنخبرك عند تأكيد الطلب، خروجه للتوصيل وتسليمه"}
          </Text>
        </View>
      </View>

      {!enabled && (
        <Pressable
          onPress={() => void enable()}
          disabled={enabling}
          style={[
            styles.button,
            {
              backgroundColor: colors.primary,
              opacity: enabling ? 0.6 : 1,
            },
          ]}
        >
          {enabling ? (
            <ActivityIndicator
              size="small"
              color="#fff"
            />
          ) : (
            <Ionicons
              name="notifications-outline"
              size={20}
              color="#fff"
            />
          )}

          <Text style={styles.buttonText}>
            {enabling
              ? "جاري التفعيل..."
              : "فعّل متابعة الطلب"}
          </Text>
        </Pressable>
      )}

      {!!error && (
        <Text style={styles.error}>{error}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },

  heading: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
  },

  texts: {
    flex: 1,
    alignItems: "flex-end",
    gap: 4,
  },

  title: {
    fontSize: 16,
    fontWeight: "800",
    textAlign: "right",
  },

  description: {
    fontSize: 13,
    lineHeight: 21,
    textAlign: "right",
  },

  button: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    paddingVertical: 13,
  },

  buttonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
  },

  error: {
    color: "#ef4444",
    fontSize: 12,
    textAlign: "right",
  },
});
