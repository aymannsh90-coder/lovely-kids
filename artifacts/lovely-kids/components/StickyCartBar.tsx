import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import React from "react";
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
import { useColors } from "@/hooks/useColors";

export function StickyCartBar() {
  const { totalItems, totalPrice } = useCart();
  const colors = useColors();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const isProductPage = pathname.startsWith("/product/");
  const isCartPage = pathname === "/cart";
  const isAdminPage = pathname.startsWith("/admin");

  if (totalItems <= 0 || isCartPage || isAdminPage) {
    return null;
  }

  const bottom =
    isProductPage
      ? 114 + insets.bottom
      : width <= 768
        ? 88 + insets.bottom
        : 116 + insets.bottom;

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
      <View
        style={[
          styles.bar,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        <View style={styles.summary}>
          <Ionicons name="cart" size={25} color={colors.primary} />

          <View>
            <Text style={[styles.itemsText, { color: colors.foreground }]}>
              {totalItems} {totalItems === 1 ? "منتج" : "منتجات"} في سلتك
            </Text>

            <Text style={[styles.priceText, { color: colors.primary }]}>
              {totalPrice} ₪
            </Text>
          </View>
        </View>

        <Pressable
          onPress={() => router.push("/cart")}
          style={({ pressed }) => [
            styles.checkoutButton,
            {
              backgroundColor: colors.primary,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Text style={styles.checkoutText}>إتمام الطلب</Text>
          <Ionicons name="arrow-back" size={17} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 8,
    right: 8,
    zIndex: 999,
    elevation: 20,
    alignItems: "center",
  },
  bar: {
    width: "100%",
    maxWidth: 620,
    minHeight: 58,
    borderRadius: 15,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#000",
    shadowOpacity: Platform.OS === "web" ? 0.12 : 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  summary: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },
  itemsText: {
    fontSize: 14,
    fontWeight: "700",
    textAlign: "right",
  },
  priceText: {
    marginTop: 1,
    fontSize: 16,
    fontWeight: "800",
    textAlign: "right",
  },
  checkoutButton: {
    minHeight: 39,
    paddingHorizontal: 14,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    justifyContent: "center",
  },
  checkoutText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
  },
});
