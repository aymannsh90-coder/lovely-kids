import { getResponsiveTopPadding } from "@/utils/webLayout";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

export default function ProductOrderingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const topPadding = getResponsiveTopPadding(insets.top);
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 20;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: bottomPadding }}
      showsVerticalScrollIndicator={false}
    >
      <View
        style={[
          styles.header,
          {
            paddingTop: topPadding + 12,
            backgroundColor: colors.primary,
          },
        ]}
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-forward" size={24} color="#fff" />
        </Pressable>

        <Text style={styles.headerTitle}>ترتيب المنتجات</Text>

        <View style={{ width: 24 }} />
      </View>

      <View style={styles.body}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <Ionicons
            name="swap-vertical-outline"
            size={34}
            color={colors.primary}
          />

          <Text style={[styles.title, { color: colors.foreground }]}>
            ترتيب المنتجات
          </Text>

          <Text style={[styles.description, { color: colors.mutedForeground }]}>
            اختر الصنف ثم حدد ترتيب ظهور منتجاته في المتجر.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  headerTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "900",
  },
  body: {
    width: "100%",
    maxWidth: 900,
    alignSelf: "center",
    padding: 16,
  },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    gap: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: "900",
  },
  description: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
});
