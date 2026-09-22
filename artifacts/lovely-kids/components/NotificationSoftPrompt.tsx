import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";

export type NotificationPromptReason = "visit" | "cart";

type Props = {
  visible: boolean;
  reason: NotificationPromptReason;
  enabling: boolean;
  error?: string;
  onEnable: () => void;
  onDismiss: () => void;
};

export function NotificationSoftPrompt({
  visible,
  reason,
  enabling,
  error,
  onEnable,
  onDismiss,
}: Props) {
  const colors = useColors();

  const isCart = reason === "cart";

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.primary + "45",
            },
          ]}
        >
          <View
            style={[
              styles.iconWrap,
              { backgroundColor: colors.primary + "16" },
            ]}
          >
            <Ionicons
              name="notifications-outline"
              size={34}
              color={colors.primary}
            />
          </View>

          <Text
            style={[
              styles.title,
              { color: colors.foreground },
            ]}
          >
            {isCart
              ? "خليك قريب من كل جديد 🔔"
              : "خليك أول من يعرف 🔔"}
          </Text>

          <Text
            style={[
              styles.description,
              { color: colors.mutedForeground },
            ]}
          >
            {isCart
              ? "فعّل الإشعارات لتوصلك الموديلات الجديدة والعروض وتوفر المقاسات والألوان."
              : "وصلك الجديد والعروض وتوفر المقاسات والألوان أول بأول، بدون ما تحتاج تراجع المتجر كل مرة."}
          </Text>

          <View style={styles.benefits}>
            <View style={styles.benefit}>
              <Ionicons
                name="sparkles-outline"
                size={17}
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
                size={17}
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
                size={17}
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
          </View>

          <Pressable
            disabled={enabling}
            onPress={onEnable}
            style={[
              styles.primaryButton,
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
                size={19}
                color="#fff"
              />
            )}

            <Text style={styles.primaryButtonText}>
              {enabling
                ? "جاري التفعيل..."
                : "نعم، فعّل الإشعارات"}
            </Text>
          </Pressable>

          <Pressable
            disabled={enabling}
            onPress={onDismiss}
            style={styles.laterButton}
          >
            <Text
              style={[
                styles.laterText,
                { color: colors.mutedForeground },
              ]}
            >
              لاحقًا
            </Text>
          </Pressable>

          {!!error && (
            <Text style={styles.error}>
              {error}
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.42)",
    alignItems: "center",
    justifyContent: "center",
    padding: 22,
  },

  card: {
    width: "100%",
    maxWidth: 430,
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 24,
    alignItems: "center",
    gap: 13,
  },

  iconWrap: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },

  title: {
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
  },

  description: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
  },

  benefits: {
    width: "100%",
    flexDirection: "row-reverse",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 10,
    marginVertical: 5,
  },

  benefit: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 5,
  },

  benefitText: {
    fontSize: 12,
    fontWeight: "600",
  },

  primaryButton: {
    width: "100%",
    minHeight: 48,
    borderRadius: 14,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },

  primaryButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800",
  },

  laterButton: {
    paddingHorizontal: 18,
    paddingVertical: 6,
  },

  laterText: {
    fontSize: 13,
    fontWeight: "600",
  },

  error: {
    color: "#ef4444",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
});
