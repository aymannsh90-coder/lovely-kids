import { getResponsiveTopPadding } from "@/utils/webLayout";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppSettings } from "@/context/AppSettingsContext";
import { useColors } from "@/hooks/useColors";

export default function AdminSeasonScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings, updateSettings } = useAppSettings();
  const [saving, setSaving] = useState(false);

  const topPadding = getResponsiveTopPadding(insets.top);

  const choose = async (season: "summer" | "winter") => {
    setSaving(true);
    await updateSettings({ activeSeason: season });
    setSaving(false);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 12, backgroundColor: colors.primary }]}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-forward" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>الموسم النشط</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.body}>
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          اختر الموسم الذي تريد عرضه حاليًا
        </Text>

        {(["summer", "winter"] as const).map((season) => {
          const active = settings.activeSeason === season;
          return (
            <Pressable
              key={season}
              disabled={saving}
              onPress={() => void choose(season)}
              style={[
                styles.option,
                {
                  backgroundColor: active ? colors.primary : colors.card,
                  borderColor: active ? colors.primary : colors.border,
                },
              ]}
            >
              <Text style={styles.emoji}>{season === "summer" ? "☀️" : "❄️"}</Text>
              <Text style={[styles.optionText, { color: active ? "#fff" : colors.foreground }]}>
                {season === "summer" ? "الموسم الصيفي" : "الموسم الشتوي"}
              </Text>
              <Ionicons
                name={active ? "checkmark-circle" : "ellipse-outline"}
                size={24}
                color={active ? "#fff" : colors.mutedForeground}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  body: { padding: 16, gap: 12, width: "100%", maxWidth: 650, alignSelf: "center" },
  hint: { fontSize: 13, textAlign: "right", marginBottom: 4 },
  option: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
  },
  emoji: { fontSize: 28 },
  optionText: { flex: 1, fontSize: 16, fontWeight: "800", textAlign: "right" },
});
