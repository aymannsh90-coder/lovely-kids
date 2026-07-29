import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppSettings } from "@/context/AppSettingsContext";
import { useColors } from "@/hooks/useColors";

export default function AdminShippingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings, updateSettings } = useAppSettings();

  const [drafts, setDrafts] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  useEffect(() => {
    setDrafts((settings.shippingZones ?? []).map((z) => String(z.cost)));
  }, [settings.shippingZones]);

  const save = async () => {
    const zones = (settings.shippingZones ?? []).map((zone, index) => ({
      ...zone,
      cost: Math.max(0, parseInt(drafts[index] || "0", 10) || 0),
    }));

    setSaving(true);
    const ok = await updateSettings({ shippingZones: zones });
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
        <Text style={styles.headerTitle}>أسعار التوصيل</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.body}>
        {(settings.shippingZones ?? []).map((zone, index) => (
          <View
            key={`${zone.label}-${index}`}
            style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Text style={[styles.label, { color: colors.foreground }]}>{zone.label}</Text>

            <View style={[styles.inputBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <TextInput
                value={drafts[index] ?? ""}
                onChangeText={(value) => {
                  const clean = value.replace(/\D/g, "");
                  setDrafts((prev) => {
                    const next = [...prev];
                    next[index] = clean;
                    return next;
                  });
                }}
                keyboardType="number-pad"
                style={[styles.input, { color: colors.foreground }]}
              />
              <Text style={[styles.currency, { color: colors.foreground }]}>₪</Text>
            </View>
          </View>
        ))}

        <Pressable
          onPress={() => void save()}
          disabled={saving}
          style={[styles.saveBtn, { backgroundColor: saved ? "#22c55e" : colors.primary }]}
        >
          <Ionicons name={saved ? "checkmark-circle" : "save-outline"} size={20} color="#fff" />
          <Text style={styles.saveText}>
            {saving ? "جاري الحفظ..." : saved ? "تم الحفظ" : "حفظ أسعار التوصيل"}
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
  row: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  label: { flex: 1, fontWeight: "800", textAlign: "right" },
  inputBox: {
    width: 110,
    height: 44,
    borderWidth: 1,
    borderRadius: 10,
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    paddingHorizontal: 10,
  },
  input: { flex: 1, textAlign: "center", fontSize: 15, fontWeight: "800" },
  currency: { fontWeight: "800" },
  saveBtn: {
    marginTop: 6,
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  saveText: { color: "#fff", fontWeight: "800" },
});
