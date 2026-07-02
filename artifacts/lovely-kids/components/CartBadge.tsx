import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useCart } from "@/context/CartContext";
import { useColors } from "@/hooks/useColors";

export function CartBadge() {
  const colors = useColors();
  const { totalItems } = useCart();

  return (
    <Pressable onPress={() => router.push("/cart")} style={styles.container}>
      <Ionicons name="bag-outline" size={24} color={colors.foreground} />
      {totalItems > 0 && (
        <View style={[styles.badge, { backgroundColor: colors.primary }]}>
          <Text style={styles.badgeText}>{totalItems}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
  },
});
