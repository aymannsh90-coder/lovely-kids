import { Ionicons } from "@expo/vector-icons";
import {
  router,
  useGlobalSearchParams,
  usePathname,
} from "expo-router";
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  PanResponder,
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
const EDGE_GAP = 8;
const DRAG_THRESHOLD = 6;

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
  const [bubbleSize, setBubbleSize] =
    useState({
      width: 190,
      height: 56,
    });

  const primaryPromotion =
    useMemo(() => {
      return [...promotions].sort(
        (left, right) =>
          right.priority -
            left.priority ||
          left.id - right.id,
      )[0] ?? null;
    }, [promotions]);

  const compact = width <= 768;

  const initialTop =
    compact
      ? Math.max(
          insets.top + 220,
          Math.round(height * 0.50),
        )
      : Math.max(
          insets.top + 240,
          Math.round(height * 0.46),
        );

  const position = useRef(
    new Animated.ValueXY({
      x: EDGE_GAP,
      y: initialTop,
    }),
  ).current;

  const currentPosition = useRef({
    x: EDGE_GAP,
    y: initialTop,
  });
  const dragStart = useRef({
    x: EDGE_GAP,
    y: initialTop,
  });
  const draggedDuringGesture =
    useRef(false);
  const suppressPress =
    useRef(false);
  const hasUserMoved =
    useRef(false);
  const snappedSide =
    useRef<"left" | "right">(
      "left",
    );

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

  const clampPosition = (
    x: number,
    y: number,
    nextSize = bubbleSize,
  ) => {
    const maxX = Math.max(
      EDGE_GAP,
      width -
        nextSize.width -
        EDGE_GAP,
    );
    const minY =
      insets.top + EDGE_GAP;
    const maxY = Math.max(
      minY,
      height -
        nextSize.height -
        insets.bottom -
        78,
    );

    return {
      x: Math.min(
        Math.max(x, EDGE_GAP),
        maxX,
      ),
      y: Math.min(
        Math.max(y, minY),
        maxY,
      ),
    };
  };

  useEffect(() => {
    const snappedX =
      snappedSide.current ===
      "right"
        ? Math.max(
            EDGE_GAP,
            width -
              bubbleSize.width -
              EDGE_GAP,
          )
        : EDGE_GAP;

    const target = hasUserMoved.current
      ? clampPosition(
          snappedX,
          currentPosition.current.y,
        )
      : clampPosition(
          EDGE_GAP,
          initialTop,
        );

    currentPosition.current =
      target;
    position.setValue(target);
  }, [
    width,
    height,
    insets.top,
    insets.bottom,
    initialTop,
    bubbleSize.width,
    bubbleSize.height,
    position,
  ]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder:
          () => false,
        onMoveShouldSetPanResponder:
          (_, gesture) =>
            Math.abs(gesture.dx) >
              DRAG_THRESHOLD ||
            Math.abs(gesture.dy) >
              DRAG_THRESHOLD,
        onPanResponderGrant: () => {
          dragStart.current = {
            ...currentPosition.current,
          };
          draggedDuringGesture.current =
            false;
        },
        onPanResponderMove: (
          _,
          gesture,
        ) => {
          draggedDuringGesture.current =
            true;
          hasUserMoved.current = true;

          const next = clampPosition(
            dragStart.current.x +
              gesture.dx,
            dragStart.current.y +
              gesture.dy,
          );

          currentPosition.current =
            next;
          position.setValue(next);
        },
        onPanResponderRelease: (
          _,
          gesture,
        ) => {
          if (
            !draggedDuringGesture.current
          ) {
            return;
          }

          const bubbleCenterX =
            currentPosition.current.x +
            bubbleSize.width / 2;

          snappedSide.current =
            bubbleCenterX <
            width / 2
              ? "left"
              : "right";

          const snappedX =
            snappedSide.current ===
            "left"
              ? EDGE_GAP
              : Math.max(
                  EDGE_GAP,
                  width -
                    bubbleSize.width -
                    EDGE_GAP,
                );

          const target =
            clampPosition(
              snappedX,
              currentPosition.current.y,
            );

          currentPosition.current =
            target;
          suppressPress.current =
            true;

          Animated.spring(
            position,
            {
              toValue: target,
              useNativeDriver:
                false,
              tension: 90,
              friction: 10,
            },
          ).start(() => {
            setTimeout(() => {
              suppressPress.current =
                false;
            }, 120);
          });
        },
        onPanResponderTerminate: () => {
          const target =
            clampPosition(
              currentPosition.current.x,
              currentPosition.current.y,
            );

          currentPosition.current =
            target;
          position.setValue(target);
          suppressPress.current =
            true;
          setTimeout(() => {
            suppressPress.current =
              false;
          }, 120);
        },
      }),
    [
      width,
      height,
      insets.top,
      insets.bottom,
      bubbleSize.width,
      bubbleSize.height,
      position,
    ],
  );

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

  const openPromotion = () => {
    if (suppressPress.current) {
      return;
    }

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
  };

  return (
    <Animated.View
      {...panResponder.panHandlers}
      onLayout={(event) => {
        const nextSize = {
          width:
            event.nativeEvent.layout
              .width,
          height:
            event.nativeEvent.layout
              .height,
        };

        setBubbleSize(
          (current) =>
            current.width ===
                nextSize.width &&
            current.height ===
                nextSize.height
              ? current
              : nextSize,
        );
      }}
      style={[
        styles.wrapper,
        {
          transform:
            position.getTranslateTransform(),
        },
      ]}
    >
      <Pressable
        onPress={openPromotion}
        accessibilityRole="button"
        accessibilityLabel={`عرض منتجات ${primaryPromotion.publicLabel}. يمكن سحب الزر إلى طرف الشاشة.`}
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
    </Animated.View>
  );
}

const styles =
  StyleSheet.create({
    wrapper: {
      position: "absolute",
      left: 0,
      top: 0,
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
