import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import { enableWebPushNotifications } from "@/hooks/usePushNotifications";

type Props = {
  phone: string;
  orderId: number;
};

export default function GuestOrderNotificationPrompt({
  phone,
  orderId,
}: Props) {
  const colors = useColors();
  const [enabling, setEnabling] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");

  const enable = async () => {
    setEnabling(true);
    setError("");

    try {
      const result = await enableWebPushNotifications(
        phone.trim(),
        undefined,
        orderId,
      );

      if (!result.ok) {
        setError(
          result.error ||
            "تعذر تفعيل الإشعارات، حاول مرة أخرى",
        );
        return;
      }

      setEnabled(true);
    } finally {
      setEnabling(false);
    }
  };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: enabled
            ? "#22c55e"
            : colors.primary,
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
          size={28}
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
              ? "تم تفعيل إشعارات طلبك ✅"
              : "فعّل إشعارات الطلب"}
          </Text>

          <Text
            style={[
              styles.description,
              { color: colors.mutedForeground },
            ]}
          >
            {enabled
              ? "سيصلك إشعار عند تحديث حالة الطلب"
              : "ليصلك إشعار عند تأكيد الطلب أو خروجه للتوصيل أو تسليمه"}
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
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons
              name="notifications-outline"
              size={19}
              color="#fff"
            />
          )}

          <Text style={styles.buttonText}>
            {enabling
              ? "جاري التفعيل..."
              : "تفعيل الإشعارات"}
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
    fontSize: 15,
    fontWeight: "800",
    textAlign: "right",
  },
  description: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: "right",
  },
  button: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    paddingVertical: 12,
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
