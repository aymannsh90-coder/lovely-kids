import { getResponsiveTopPadding } from "@/utils/webLayout";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ColorPickerButton } from "@/components/ColorPickerButton";
import { useAppSettings } from "@/context/AppSettingsContext";
import { useColors } from "@/hooks/useColors";

export default function AdminColorsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings, updateSettings } = useAppSettings();

  const [primary, setPrimary] = useState(settings.primaryColor);
  const [background, setBackground] = useState(settings.backgroundColor);
  const [secondary, setSecondary] = useState(settings.secondaryColor);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const topPadding = getResponsiveTopPadding(insets.top);

  useEffect(() => {
    setPrimary(settings.primaryColor);
    setBackground(settings.backgroundColor);
    setSecondary(settings.secondaryColor);
  }, [settings.primaryColor, settings.backgroundColor, settings.secondaryColor]);

  const save = async () => {
    setSaving(true);
    const ok = await updateSettings({
      primaryColor: primary,
      backgroundColor: background,
      secondaryColor: secondary,
      accentColor: secondary,
    });
    setSaving(false);

    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 12, backgroundColor: colors.primary }]}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-forward" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>ألوان التطبيق</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.body}>
        {[
          ["اللون الرئيسي", primary, setPrimary],
          ["لون الخلفية", background, setBackground],
          ["اللون الثانوي", secondary, setSecondary],
        ].map(([label, value, setter]) => (
          <View
            key={label as string}
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Text style={[styles.label, { color: colors.foreground }]}>{label as string}</Text>
            <ColorPickerButton
              value={value as string}
              title={label as string}
              onChange={setter as (value: string) => void}
            />
          </View>
        ))}

        <Pressable
          onPress={() => void save()}
          disabled={saving}
          style={[styles.saveBtn, { backgroundColor: saved ? "#22c55e" : colors.primary }]}
        >
          <Ionicons name={saved ? "checkmark-circle" : "save-outline"} size={20} color="#fff" />
          <Text style={styles.saveText}>
            {saving ? "جاري الحفظ..." : saved ? "تم الحفظ" : "حفظ الألوان"}
          </Text>
        </Pressable>
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
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
  label: { fontWeight: "800", textAlign: "right" },
  saveBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  saveText: { color: "#fff", fontWeight: "800" },
});
