import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useNotificationOptIn } from "@/context/NotificationOptInContext";
import { useColors } from "@/hooks/useColors";

type Props = {
  compact?: boolean;
  hideWhenEnabled?: boolean;
  orderId?: number | null;
  phone?: string | null;
};

export function NotificationSubscribeCard({
  compact = false,
  hideWhenEnabled = false,
  orderId,
  phone,
}: Props) {
  const colors = useColors();
  const {
    enabled,
    ready,
    enabling,
    enableNow,
  } = useNotificationOptIn();

  const [message, setMessage] = useState("");

  if (!ready) {
    return null;
  }

  if (enabled && hideWhenEnabled) {
    return null;
  }

  const enable = async () => {
    setMessage("");

    const result = await enableNow(
      orderId,
      phone,
    );

    if (result.ok) {
      setMessage(
        "تم تفعيل الإشعارات ✅ ستصلك العروض والجديد وتحديثات الطلبات.",
      );
      return;
    }

    setMessage(
      result.error ||
        "تعذر تفعيل الإشعارات. يمكنك المحاولة مرة أخرى.",
    );
  };

  return (
    <View
      style={[
        styles.card,
        compact && styles.compactCard,
        {
          backgroundColor: enabled
            ? "#F0FDF4"
            : colors.card,
          borderColor: enabled
            ? "#86EFAC"
            : colors.primary + "35",
        },
      ]}
    >
      <View style={styles.topRow}>
        <View
          style={[
            styles.iconWrap,
            {
              backgroundColor: enabled
                ? "#DCFCE7"
                : colors.primary + "14",
            },
          ]}
        >
          <Ionicons
            name={
              enabled
                ? "notifications-circle"
                : "notifications-outline"
            }
            size={compact ? 25 : 29}
            color={
              enabled
                ? "#16A34A"
                : colors.primary
            }
          />
        </View>

        <View style={styles.copy}>
          <Text
            style={[
              styles.title,
              {
                color: colors.foreground,
                fontSize: compact ? 15 : 16,
              },
            ]}
          >
            {enabled
              ? "الإشعارات مفعّلة ✅"
              : "خليك أول من يعرف 🔔"}
          </Text>

          <Text
            style={[
              styles.description,
              { color: colors.mutedForeground },
            ]}
          >
            {enabled
              ? "سنخبرك بالجديد والعروض وتوفر المقاسات وتحديثات طلباتك."
              : "فعّل الإشعارات ليصلك الجديد والعروض وتوفر المقاسات وتحديثات طلبك مباشرة."}
          </Text>
        </View>
      </View>

      {!enabled && !compact ? (
        <View style={styles.benefits}>
          <View style={styles.benefit}>
            <Ionicons
              name="sparkles-outline"
              size={16}
              color={colors.primary}
            />
            <Text
              style={[
                styles.benefitText,
                { color: colors.foreground },
              ]}
            >
              وصل جديد
            </Text>
          </View>

          <View style={styles.benefit}>
            <Ionicons
              name="pricetag-outline"
              size={16}
              color={colors.primary}
            />
            <Text
              style={[
                styles.benefitText,
                { color: colors.foreground },
              ]}
            >
              عروض
            </Text>
          </View>

          <View style={styles.benefit}>
            <Ionicons
              name="shirt-outline"
              size={16}
              color={colors.primary}
            />
            <Text
              style={[
                styles.benefitText,
                { color: colors.foreground },
              ]}
            >
              توفر المقاسات
            </Text>
          </View>

          <View style={styles.benefit}>
            <Ionicons
              name="cube-outline"
              size={16}
              color={colors.primary}
            />
            <Text
              style={[
                styles.benefitText,
                { color: colors.foreground },
              ]}
            >
              تحديث الطلب
            </Text>
          </View>
        </View>
      ) : null}

      {!enabled ? (
        <Pressable
          onPress={() => void enable()}
          disabled={enabling}
          style={[
            styles.button,
            compact && styles.compactButton,
            {
              backgroundColor: colors.primary,
              opacity: enabling ? 0.65 : 1,
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
              name="notifications"
              size={18}
              color="#fff"
            />
          )}

          <Text style={styles.buttonText}>
            {enabling
              ? "جاري التفعيل..."
              : "فعّل الإشعارات الآن"}
          </Text>
        </Pressable>
      ) : null}

      {!!message && (
        <Text
          style={[
            styles.message,
            {
              color: message.includes("✅")
                ? "#166534"
                : "#B91C1C",
            },
          ]}
        >
          {message}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 18,
    padding: 15,
    gap: 12,
  },
  compactCard: {
    paddingVertical: 13,
    paddingHorizontal: 14,
    gap: 10,
  },
  topRow: {
    flexDirection:
      Platform.OS === "web"
        ? "row-reverse"
        : "row",
    alignItems: "center",
    gap: 11,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: {
    flex: 1,
    alignItems: "flex-end",
  },
  title: {
    fontWeight: "800",
    textAlign: "right",
  },
  description: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 19,
    textAlign: "right",
  },
  benefits: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: 8,
  },
  benefit: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(236,72,153,0.08)",
  },
  benefitText: {
    fontSize: 11,
    fontWeight: "700",
  },
  button: {
    minHeight: 46,
    borderRadius: 13,
    flexDirection:
      Platform.OS === "web"
        ? "row-reverse"
        : "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
  },
  compactButton: {
    minHeight: 42,
  },
  buttonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
  },
  message: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: "right",
    fontWeight: "600",
  },
});
