import { getResponsiveTopPadding } from "@/utils/webLayout";
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

  const topPadding = getResponsiveTopPadding(insets.top);
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 16;

  const AGE_GROUP_IDS = ["newborn", "infant", "toddler", "kids", "boys", "girls"];
  const CATEGORY_IDS = ["all", "clothes", "stroller", "feeding", "bath", "toys", "accessories"];

  const ageGroupLabels = settings.ageGroupLabels ?? DEFAULT_AGE_GROUP_LABELS;
  const categoryLabels = settings.categoryLabels ?? DEFAULT_CATEGORY_LABELS;
  const hiddenCategories = settings.hiddenCategories ?? [];
  const customCategories = settings.customCategories ?? [];

  const defaultProductCategoryIds = CATEGORY_IDS.filter((id) => id !== "all");
  const availableCategoryIds = [...defaultProductCategoryIds, ...customCategories]
    .filter((id, index, ids) => ids.indexOf(id) === index);
  const savedCategoryOrder = settings.categoryOrder ?? [];
  const initialCategoryOrder = [
    ...savedCategoryOrder.filter((id) => availableCategoryIds.includes(id)),
    ...availableCategoryIds.filter((id) => !savedCategoryOrder.includes(id)),
  ];

  const [localCategoryOrder, setLocalCategoryOrder] = useState(initialCategoryOrder);

  const [localAgeGroups, setLocalAgeGroups] = useState({ ...ageGroupLabels });
  const [localCategories, setLocalCategories] = useState({ ...categoryLabels });
  const [saved, setSaved] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");


  const moveCategory = (id: string, direction: -1 | 1) => {
    const currentIndex = localCategoryOrder.indexOf(id);
    const nextIndex = currentIndex + direction;

    if (
      currentIndex < 0 ||
      nextIndex < 0 ||
      nextIndex >= localCategoryOrder.length
    ) {
      return;
    }

    const updated = [...localCategoryOrder];
    [updated[currentIndex], updated[nextIndex]] = [
      updated[nextIndex],
      updated[currentIndex],
    ];

    Haptics.selectionAsync();
    setLocalCategoryOrder(updated);
  };

  const toggleCategoryVisibility = (id: string) => {
    const isHidden = hiddenCategories.includes(id);
    const updated = isHidden
      ? hiddenCategories.filter((c) => c !== id)
      : [...hiddenCategories, id];
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    updateSettings({ hiddenCategories: updated });
  };

  const handleAddCategory = () => {
    const label = newCategoryName.trim();
    if (!label) return;
    const id = `custom_${Date.now()}`;
    const updatedCustom = [...customCategories, id];
    const updatedLabels = { ...localCategories, [id]: label };
    const updatedOrder = [...localCategoryOrder, id];
    setLocalCategories(updatedLabels);
    setLocalCategoryOrder(updatedOrder);
    setNewCategoryName("");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    updateSettings({
      customCategories: updatedCustom,
      categoryLabels: updatedLabels,
      categoryOrder: updatedOrder,
    });
  };

  const handleDeleteCategory = (id: string) => {
    const updatedCustom = customCategories.filter((c) => c !== id);
    const updatedLabels = { ...localCategories };
    delete updatedLabels[id];
    const updatedHidden = hiddenCategories.filter((c) => c !== id);
    const updatedOrder = localCategoryOrder.filter((c) => c !== id);
    setLocalCategories(updatedLabels);
    setLocalCategoryOrder(updatedOrder);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    updateSettings({
      customCategories: updatedCustom,
      categoryLabels: updatedLabels,
      hiddenCategories: updatedHidden,
      categoryOrder: updatedOrder,
    });
  };

  const handleSave = () => {
    updateSettings({
      ageGroupLabels: localAgeGroups,
      categoryLabels: localCategories,
      categoryOrder: localCategoryOrder,
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleReset = () => {
    setLocalAgeGroups({ ...DEFAULT_AGE_GROUP_LABELS });
    setLocalCategories({ ...DEFAULT_CATEGORY_LABELS });
    setLocalCategoryOrder(CATEGORY_IDS.filter((id) => id !== "all"));
    updateSettings({
      ageGroupLabels: DEFAULT_AGE_GROUP_LABELS,
      categoryLabels: DEFAULT_CATEGORY_LABELS,
      customCategories: [],
      categoryOrder: CATEGORY_IDS.filter((id) => id !== "all"),
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
          {customCategories.length > 0 && (
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
          )}
          {customCategories.map((id, index) => {
            const isHidden = hiddenCategories.includes(id);
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
                  <Pressable
                    onPress={() => handleDeleteCategory(id)}
                    style={[styles.deleteBtn, { backgroundColor: "#FEE2E2" }]}
                  >
                    <Ionicons name="trash-outline" size={18} color="#EF4444" />
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>

        {/* Add New Category */}
        <View style={[styles.addCatRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TextInput
            value={newCategoryName}
            onChangeText={setNewCategoryName}
            style={[
              styles.input,
              styles.catInput,
              { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground },
            ]}
            textAlign="right"
            placeholder="اسم فئة جديدة، مثال: بناطيل"
            placeholderTextColor={colors.mutedForeground}
            onSubmitEditing={handleAddCategory}
            returnKeyType="done"
          />
          <Pressable
            onPress={handleAddCategory}
            style={[styles.addCatBtn, { backgroundColor: colors.primary }]}
          >
            <Ionicons name="add" size={20} color="#fff" />
          </Pressable>
        </View>
        <Text style={[styles.hint, { color: colors.mutedForeground, paddingHorizontal: 0, paddingTop: 6 }]}>
          الفئات الجديدة تظهر تلقائياً عند إضافة منتج جديد
        </Text>
      </View>

      {/* Category Order */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          ↕️ ترتيب الأصناف
        </Text>

        <Text
          style={[
            styles.hint,
            {
              color: colors.mutedForeground,
              paddingHorizontal: 0,
              paddingTop: 0,
            },
          ]}
        >
          استخدم الأسهم لتحديد ترتيب ظهور الأصناف في صفحة كل المنتجات
        </Text>

        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          {localCategoryOrder.map((id, index) => {
            const isHidden = hiddenCategories.includes(id);

            return (
              <View key={id}>
                {index > 0 && (
                  <View
                    style={[
                      styles.divider,
                      { backgroundColor: colors.border },
                    ]}
                  />
                )}

                <View
                  style={[
                    styles.catRow,
                    isHidden ? { opacity: 0.55 } : null,
                  ]}
                >
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 17,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: colors.secondary,
                    }}
                  >
                    <Text
                      style={{
                        color: colors.foreground,
                        fontWeight: "800",
                      }}
                    >
                      {index + 1}
                    </Text>
                  </View>

                  <Text
                    style={{
                      flex: 1,
                      color: colors.foreground,
                      fontSize: 15,
                      fontWeight: "700",
                      textAlign: "right",
                    }}
                  >
                    {localCategories[id] ??
                      categoryLabels[id] ??
                      DEFAULT_CATEGORY_LABELS[id] ??
                      id}
                  </Text>

                  <View
                    style={{
                      flexDirection: "row",
                      gap: 6,
                    }}
                  >
                    <Pressable
                      disabled={index === 0}
                      onPress={() => moveCategory(id, -1)}
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor:
                          index === 0
                            ? colors.background
                            : colors.secondary,
                        opacity: index === 0 ? 0.4 : 1,
                      }}
                    >
                      <Ionicons
                        name="arrow-up"
                        size={19}
                        color={colors.foreground}
                      />
                    </Pressable>

                    <Pressable
                      disabled={index === localCategoryOrder.length - 1}
                      onPress={() => moveCategory(id, 1)}
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor:
                          index === localCategoryOrder.length - 1
                            ? colors.background
                            : colors.secondary,
                        opacity:
                          index === localCategoryOrder.length - 1 ? 0.4 : 1,
                      }}
                    >
                      <Ionicons
                        name="arrow-down"
                        size={19}
                        color={colors.foreground}
                      />
                    </Pressable>
                  </View>
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
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
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
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
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
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
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
  deleteBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  addCatRow: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  addCatBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtn: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
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
