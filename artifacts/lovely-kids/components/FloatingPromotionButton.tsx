import { Ionicons } from "@expo/vector-icons";
import {
  router,
  useGlobalSearchParams,
  usePathname,
} from "expo-router";
import React, {
  useEffect,
  useMemo,
  useState,
} from "react";
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

const PROMOTION_ACCENT = "#FF8A3D";
const PROMOTION_DARK = "#0F1E4B";
const EXPANDED_MS = 4200;

function bidiSafePromotionLabel(label: string) {
  return label.replace(
    /\d+\s*\+\s*\d+/g,
    (value) => `\u2066${value}\u2069`,
  );
}

function promotionBadgeText(
  promotion: {
    kind: string;
    buyQuantity?: number | null;
    rewardQuantity?: number | null;
    percentOff?: number | null;
  },
) {
  if (
    promotion.kind === "buy_x_get_y" &&
    promotion.buyQuantity &&
    promotion.rewardQuantity
  ) {
    return `${promotion.buyQuantity}+${promotion.rewardQuantity}`;
  }

  if (
    promotion.kind === "percent_off" &&
    promotion.percentOff
  ) {
    return `${promotion.percentOff}%`;
  }

  return "عرض";
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
  const [expanded, setExpanded] =
    useState(true);

  const primaryPromotion =
    useMemo(() => {
      return [...promotions].sort(
        (left, right) =>
          right.priority -
            left.priority ||
          left.id - right.id,
      )[0] ?? null;
    }, [promotions]);

  useEffect(() => {
    if (!primaryPromotion) {
      return;
    }

    setExpanded(true);

    const timer = setTimeout(
      () => setExpanded(false),
      EXPANDED_MS,
    );

    return () => clearTimeout(timer);
  }, [primaryPromotion?.id]);

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
          insets.top + 220,
          Math.round(height * 0.50),
        )
      : Math.max(
          insets.top + 240,
          Math.round(height * 0.46),
        );

  const rawLabel =
    primaryPromotion.publicLabel?.trim() ||
    promotionShortLabel(
      primaryPromotion,
    );

  const shortLabel =
    bidiSafePromotionLabel(
      /^عرض\s/u.test(rawLabel)
        ? rawLabel
        : `عرض ${rawLabel}`,
    );

  const badge =
    bidiSafePromotionLabel(
      promotionBadgeText(
        primaryPromotion,
      ),
    );

  const openPromotion = () =>
    router.push({
      pathname:
        "/(tabs)/products",
      params: {
        promotionId:
          String(
            primaryPromotion.id,
          ),
      },
    } as never);

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrapper,
        { top },
      ]}
    >
      <Pressable
        onPress={openPromotion}
        accessibilityRole="button"
        accessibilityLabel={`عرض منتجات ${primaryPromotion.publicLabel}`}
        style={({ pressed }) => [
          styles.button,
          expanded
            ? styles.expandedButton
            : styles.compactButton,
          {
            opacity:
              pressed ? 0.86 : 1,
          },
        ]}
      >
        <View
          style={styles.giftCircle}
        >
          <Ionicons
            name="gift-outline"
            size={21}
            color="#FFFFFF"
          />
        </View>

        {expanded ? (
          <View
            style={
              styles.expandedCopy
            }
          >
            <Text
              style={
                styles.eyebrow
              }
            >
              عرض خاص
            </Text>
            <Text
              numberOfLines={1}
              style={
                styles.expandedLabel
              }
            >
              {shortLabel}
            </Text>
          </View>
        ) : null}

        <View
          style={
            styles.badge
          }
        >
          <Text
            style={
              styles.badgeText
            }
          >
            {badge}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles =
  StyleSheet.create({
    wrapper: {
      position: "absolute",
      left: 6,
      zIndex: 9998,
      elevation: 20,
    },
    button: {
      backgroundColor:
        PROMOTION_ACCENT,
      borderWidth: 2,
      borderColor:
        "rgba(255,255,255,0.96)",
      flexDirection: "row",
      alignItems: "center",
      shadowColor: "#000",
      shadowOpacity: 0.18,
      shadowRadius: 8,
      shadowOffset: {
        width: 0,
        height: 3,
      },
    },
    compactButton: {
      width: 54,
      height: 54,
      borderRadius: 27,
      justifyContent: "center",
    },
    expandedButton: {
      minHeight: 56,
      maxWidth: 190,
      borderRadius: 28,
      paddingLeft: 8,
      paddingRight: 15,
      paddingVertical: 6,
      gap: 8,
    },
    giftCircle: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor:
        "rgba(255,255,255,0.16)",
      alignItems: "center",
      justifyContent:
        "center",
      flexShrink: 0,
    },
    expandedCopy: {
      flexShrink: 1,
      gap: 1,
    },
    eyebrow: {
      color:
        "rgba(255,255,255,0.84)",
      fontSize: 9,
      fontWeight: "800",
      textAlign: "right",
    },
    expandedLabel: {
      color: "#FFFFFF",
      fontSize: 12,
      fontWeight: "900",
      textAlign: "right",
    },
    badge: {
      position: "absolute",
      top: -7,
      right: -7,
      minWidth: 36,
      height: 21,
      borderRadius: 11,
      paddingHorizontal: 6,
      backgroundColor:
        PROMOTION_DARK,
      borderWidth: 2,
      borderColor: "#FFFFFF",
      alignItems: "center",
      justifyContent:
        "center",
    },
    badgeText: {
      color: "#FFFFFF",
      fontSize: 9,
      fontWeight: "900",
      textAlign: "center",
    },
  });
