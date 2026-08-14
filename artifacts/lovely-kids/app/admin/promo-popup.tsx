import { getResponsiveTopPadding } from "@/utils/webLayout";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PromoPopupSettings } from "@/components/PromoPopupSettings";
import { useColors } from "@/hooks/useColors";

export default function AdminPromoPopupScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{
        paddingBottom: Platform.OS === "web" ? 40 : insets.bottom + 20,
      }}
    >
      <View
        style={[
          styles.header,
          {
            paddingTop: getResponsiveTopPadding(insets.top) + 12,
            backgroundColor: colors.primary,
          },
        ]}
      >
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-forward" size={24} color="#fff" />
        </Pressable>

        <Text style={styles.headerTitle}>الإعلان المنبثق</Text>

        <Ionicons name="megaphone-outline" size={23} color="#fff" />
      </View>

      <PromoPopupSettings />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    minHeight: 64,
    paddingHorizontal: 18,
    paddingBottom: 14,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 19,
    fontWeight: "800",
  },
});
