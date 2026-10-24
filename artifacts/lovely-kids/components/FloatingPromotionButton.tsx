import { Ionicons } from "@expo/vector-icons";
import {
  router,
  useGlobalSearchParams,
  usePathname,
} from "expo-router";
import React, { useMemo } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  promotionShortLabel,
  usePromotions,
} from "@/context/PromotionsContext";

const PROMOTION_ACCENT = "#7C3AED";

function bidiSafePromotionLabel(label: string) {
  return label.replace(
    /\d+\s*\+\s*\d+/g,
    (value) => `\u2066${value}\u2069`,
  );
}

export function FloatingPromotionButton() {
  const pathname = usePathname();
  const params =
    useGlobalSearchParams<{
      promotionId?: string;
    }>();
  const { promotions, loading } =
    usePromotions();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const primaryPromotion =
    useMemo(() => {
      return [...promotions].sort(
        (left, right) =>
          right.priority -
            left.priority ||
          left.id - right.id,
      )[0] ?? null;
    }, [promotions]);

  const currentPromotionId =
    Number(params.promotionId);

  const isAdminPage =
    pathname.startsWith("/admin");
  const isCartPage =
    pathname === "/cart";
  const isSamePromotionPage =
    primaryPromotion !== null &&
    Number.isSafeInteger(
      currentPromotionId,
    ) &&
    currentPromotionId ===
      primaryPromotion.id;

  if (
    loading ||
    !primaryPromotion ||
    isAdminPage ||
    isCartPage ||
    isSamePromotionPage
  ) {
    return null;
  }

  const compact = width <= 768;

  const top =
    compact
      ? Math.max(
          insets.top + 180,
          Math.round(height * 0.44),
        )
      : Math.max(
          insets.top + 200,
          Math.round(height * 0.40),
        );

  const rawLabel =
    primaryPromotion.publicLabel?.trim() ||
    promotionShortLabel(
      primaryPromotion,
    );

  const label =
    bidiSafePromotionLabel(
      /^عرض\s/u.test(rawLabel)
        ? rawLabel
        : `عرض ${rawLabel}`,
    );

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrapper,
        { top },
      ]}
    >
      <Pressable
        onPress={() =>
          router.push({
            pathname:
              "/(tabs)/products",
            params: {
              promotionId:
                String(
                  primaryPromotion.id,
                ),
            },
          } as never)
        }
        accessibilityRole="button"
        accessibilityLabel={`عرض منتجات ${primaryPromotion.publicLabel}`}
        style={({ pressed }) => [
          styles.button,
          {
            opacity:
              pressed ? 0.86 : 1,
          },
        ]}
      >
        <View
          style={
            styles.iconBubble
          }
        >
          <Ionicons
            name="gift-outline"
            size={18}
            color={
              PROMOTION_ACCENT
            }
          />
        </View>

        <Text
          numberOfLines={1}
          style={styles.label}
        >
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

const styles =
  StyleSheet.create({
    wrapper: {
      position: "absolute",
      left: 8,
      zIndex: 9998,
      elevation: 18,
    },
    button: {
      minHeight: 48,
      maxWidth: 178,
      borderRadius: 24,
      borderWidth: 2,
      borderColor:
        "rgba(255,255,255,0.96)",
      backgroundColor:
        PROMOTION_ACCENT,
      paddingLeft: 12,
      paddingRight: 9,
      paddingVertical: 6,
      flexDirection:
        "row",
      alignItems: "center",
      justifyContent:
        "center",
      gap: 7,
      shadowColor: "#000",
      shadowOpacity: 0.18,
      shadowRadius: 8,
      shadowOffset: {
        width: 0,
        height: 3,
      },
    },
    iconBubble: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor:
        "#FFFFFF",
      alignItems: "center",
      justifyContent:
        "center",
      flexShrink: 0,
    },
    label: {
      color: "#FFFFFF",
      fontSize: 12.5,
      fontWeight: "900",
      textAlign: "right",
      flexShrink: 1,
    },
  });
