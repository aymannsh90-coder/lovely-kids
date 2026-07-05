import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppSettings } from "@/context/AppSettingsContext";
import { useColors } from "@/hooks/useColors";
import { DEFAULT_AGE_GROUP_LABELS, DEFAULT_CATEGORY_LABELS } from "@/data/products";

export default function CategoriesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings, updateSettings } = useAppSettings();

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 16;

  const ageGroupLabels = settings.ageGroupLabels ?? DEFAULT_AGE_GROUP_LABELS;
  const categoryLabels = settings.categoryLabels ?? DEFAULT_CATEGORY_LABELS;
  const hiddenCategories = settings.hiddenCategories ?? [];

  const [localAgeGroups, setLocalAgeGroups] = useState({ ...ageGroupLabels });
  const [localCategories, setLocalCategories] = useState({ ...categoryLabels });
  const [saved, setSaved] = useState(false);

  const AGE_GROUP_IDS = ["newborn", "infant", "toddler", "kids", "boys", "girls"];
  const CATEGORY_IDS = ["all", "clothes", "stroller", "feeding", "bath", "toys", "accessories"];

  const toggleCategoryVisibility = (id: string) => {
    const isHidden = hiddenCategories.includes(id);
    const updated = isHidden
      ? hiddenCategories.filter((c) => c !== id)
      : [...hiddenCategories, id];
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    updateSettings({ hiddenCategories: updated });
  };

  const handleSave = () => {
    updateSettings({
      ageGroupLabels: localAgeGroups,
      categoryLabels: localCategories,
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleReset = () => {
    setLocalAgeGroups({ ...DEFAULT_AGE_GROUP_LABELS });
    setLocalCategories({ ...DEFAULT_CATEGORY_LABELS });
    updateSettings({
      ageGroupLabels: DEFAULT_AGE_GROUP_LABELS,
      categoryLabels: DEFAULT_CATEGORY_LABELS,
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  };

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: bottomPadding }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingTop: topPadding + 12, backgroundColor: colors.primary },
        ]}
      >
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-forward" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>تعديل أسماء التصنيفات</Text>
        <Pressable onPress={handleReset}>
          <Ionicons name="refresh-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      <Text style={[styles.hint, { color: colors.mutedForeground }]}>
        يمكنك تغيير أسماء الفئات العمرية وفئات المنتجات كما تريد
      </Text>

      {/* Age Groups Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          👶 الفئات العمرية
        </Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {AGE_GROUP_IDS.map((id, index) => (
            <View key={id}>
              {index > 0 && (
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
              )}
              <View style={styles.fieldRow}>
                <View style={styles.fieldLabels}>
                  <Text style={[styles.fieldKey, { color: colors.mutedForeground }]}>
                    الاسم الرئيسي
                  </Text>
                  <TextInput
                    value={localAgeGroups[id]?.label ?? ""}
                    onChangeText={(v) =>
                      setLocalAgeGroups((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], label: v },
                      }))
                    }
                    style={[
                      styles.input,
                      { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground },
                    ]}
                    textAlign="right"
                    placeholder="اسم التصنيف"
                    placeholderTextColor={colors.mutedForeground}
                  />
                  <Text style={[styles.fieldKey, { color: colors.mutedForeground, marginTop: 6 }]}>
                    الوصف الفرعي
                  </Text>
                  <TextInput
                    value={localAgeGroups[id]?.sublabel ?? ""}
                    onChangeText={(v) =>
                      setLocalAgeGroups((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], sublabel: v },
                      }))
                    }
                    style={[
                      styles.input,
                      { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground },
                    ]}
                    textAlign="right"
                    placeholder="مثال: 0-3 أشهر"
                    placeholderTextColor={colors.mutedForeground}
                  />
                </View>

                <View style={[styles.previewBadge, { backgroundColor: colors.secondary }]}>
                  <Text style={[styles.previewLabel, { color: colors.foreground }]}>
                    {localAgeGroups[id]?.label || "—"}
                  </Text>
                  <Text style={[styles.previewSublabel, { color: colors.mutedForeground }]}>
                    {localAgeGroups[id]?.sublabel || "—"}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* Categories Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          🏷️ فئات المنتجات
        </Text>
        <Text style={[styles.hint, { color: colors.mutedForeground, paddingHorizontal: 0, paddingTop: 0 }]}>
          استخدمي المفتاح لإخفاء أو إظهار الفئة لجميع المستخدمين فوراً
        </Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {CATEGORY_IDS.map((id, index) => {
            const isHidden = id !== "all" && hiddenCategories.includes(id);
            return (
              <View key={id}>
                {index > 0 && (
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                )}
                <View style={styles.catRow}>
                  <View style={[styles.catPreview, { backgroundColor: colors.secondary }]}>
                    <Text style={[styles.catPreviewText, { color: colors.foreground }]}>
                      {localCategories[id] || "—"}
                    </Text>
                  </View>
                  <TextInput
                    value={localCategories[id] ?? ""}
                    onChangeText={(v) =>
                      setLocalCategories((prev) => ({ ...prev, [id]: v }))
                    }
                    style={[
                      styles.input,
                      styles.catInput,
                      { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground },
                    ]}
                    textAlign="right"
                    placeholder="اسم الفئة"
                    placeholderTextColor={colors.mutedForeground}
                  />
                  {id !== "all" && (
                    <View style={styles.visibilityToggle}>
                      <Ionicons
                        name={isHidden ? "eye-off-outline" : "eye-outline"}
                        size={18}
                        color={isHidden ? colors.mutedForeground : colors.primary}
                      />
                      <Switch
                        value={!isHidden}
                        onValueChange={() => toggleCategoryVisibility(id)}
                        trackColor={{ false: colors.border, true: colors.primary }}
                        thumbColor="#fff"
                      />
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      </View>

      {/* Save Button */}
      <Pressable
        onPress={handleSave}
        style={[
          styles.saveBtn,
          { backgroundColor: saved ? "#22c55e" : colors.primary },
        ]}
      >
        <Ionicons
          name={saved ? "checkmark-circle" : "save-outline"}
          size={22}
          color="#fff"
        />
        <Text style={styles.saveBtnText}>
          {saved ? "✅ تم الحفظ!" : "حفظ التغييرات"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  header: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  headerTitle: { fontSize: 18, fontWeight: "800", color: "#fff" },
  hint: {
    fontSize: 13,
    textAlign: "right",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  section: { paddingHorizontal: 16, marginTop: 8 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    textAlign: "right",
    marginBottom: 10,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 16,
  },
  divider: { height: 1, marginHorizontal: 14 },
  fieldRow: {
    flexDirection: "row-reverse",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
  },
  fieldLabels: { flex: 1 },
  fieldKey: { fontSize: 12, textAlign: "right", marginBottom: 4 },
  input: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 14,
  },
  previewBadge: {
    width: 76,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    alignItems: "center",
    gap: 4,
  },
  previewLabel: { fontSize: 13, fontWeight: "800", textAlign: "center" },
  previewSublabel: { fontSize: 10, textAlign: "center" },
  catRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  catInput: { flex: 1 },
  visibilityToggle: { alignItems: "center", gap: 2 },
  catPreview: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    minWidth: 60,
    alignItems: "center",
  },
  catPreviewText: { fontSize: 13, fontWeight: "700" },
  saveBtn: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginHorizontal: 16,
    marginTop: 8,
    paddingVertical: 16,
    borderRadius: 16,
  },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
