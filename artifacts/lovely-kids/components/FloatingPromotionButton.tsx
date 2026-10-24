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

import { useCart } from "@/context/CartContext";
import {
  promotionShortLabel,
  usePromotions,
} from "@/context/PromotionsContext";

const PROMOTION_RED = "#E53935";

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
  const { totalItems } = useCart();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

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

  const bottom =
    totalItems > 0
      ? compact
        ? 176 + insets.bottom
        : 196 + insets.bottom
      : compact
        ? 104 + insets.bottom
        : 126 + insets.bottom;

  const label =
    bidiSafePromotionLabel(
      primaryPromotion.publicLabel?.trim() ||
        promotionShortLabel(
          primaryPromotion,
        ),
    );

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrapper,
        { bottom },
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
              PROMOTION_RED
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
      left: 10,
      zIndex: 9998,
      elevation: 18,
    },
    button: {
      minHeight: 44,
      maxWidth: 156,
      borderRadius: 22,
      borderWidth: 2,
      borderColor:
        "rgba(255,255,255,0.96)",
      backgroundColor:
        PROMOTION_RED,
      paddingLeft: 11,
      paddingRight: 8,
      paddingVertical: 5,
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
      fontSize: 12,
      fontWeight: "900",
      textAlign: "right",
      flexShrink: 1,
    },
  });
