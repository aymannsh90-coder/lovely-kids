import { Ionicons } from "@expo/vector-icons";
import {
  router,
  useGlobalSearchParams,
  usePathname,
} from "expo-router";
import React, { useMemo } from "react";
import {
  Platform,
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
import { useColors } from "@/hooks/useColors";

function bidiSafePromotionLabel(label: string) {
  return label.replace(
    /\d+\s*\+\s*\d+/g,
    (value) => `\u2066${value}\u2069`,
  );
}

export function FloatingPromotionButton() {
  const colors = useColors();
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
  const isCurrentPromotionPage =
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
    isCurrentPromotionPage
  ) {
    return null;
  }

  const isProductPage =
    pathname.startsWith(
      "/product/",
    );
  const compact =
    width <= 768;

  const bottom =
    totalItems > 0
      ? isProductPage
        ? 184 + insets.bottom
        : compact
          ? 154 + insets.bottom
          : 182 + insets.bottom
      : compact
        ? 74 + insets.bottom
        : 98 + insets.bottom;

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
        {
          bottom,
        },
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
        style={({
          pressed,
        }) => [
          styles.button,
          {
            backgroundColor:
              colors.primary,
            borderColor:
              "rgba(255,255,255,0.90)",
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
            size={19}
            color={
              colors.primary
            }
          />
        </View>

        <View
          style={{
            flexShrink: 1,
          }}
        >
          <Text
            numberOfLines={1}
            style={
              styles.label
            }
          >
            {label}
          </Text>

          <Text
            numberOfLines={1}
            style={
              styles.subLabel
            }
          >
            اضغط لعرض المنتجات
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles =
  StyleSheet.create({
    wrapper: {
      position:
        "absolute",
      right: 10,
      zIndex: 9998,
      elevation: 18,
      alignItems:
        "flex-end",
    },
    button: {
      minHeight: 50,
      maxWidth: 210,
      borderRadius: 25,
      borderWidth: 2,
      paddingHorizontal: 10,
      paddingVertical: 6,
      flexDirection:
        "row-reverse",
      alignItems:
        "center",
      gap: 8,
      shadowColor: "#000",
      shadowOpacity:
        Platform.OS === "web"
          ? 0.16
          : 0.22,
      shadowRadius: 8,
      shadowOffset: {
        width: 0,
        height: 3,
      },
    },
    iconBubble: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor:
        "#FFFFFF",
      alignItems: "center",
      justifyContent:
        "center",
      flexShrink: 0,
    },
    label: {
      color: "#FFFFFF",
      fontSize: 13,
      fontWeight: "900",
      textAlign: "right",
    },
    subLabel: {
      color:
        "rgba(255,255,255,0.90)",
      fontSize: 10,
      fontWeight: "700",
      textAlign: "right",
      marginTop: 1,
    },
  });
