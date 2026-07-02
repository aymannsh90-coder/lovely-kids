import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppSettings } from "@/context/AppSettingsContext";
import { useColors } from "@/hooks/useColors";

const PRIMARY_COLORS = [
  { label: "وردي", value: "#E91E8C" },
  { label: "أزرق", value: "#2196F3" },
  { label: "بنفسجي", value: "#9C27B0" },
  { label: "برتقالي", value: "#FF5722" },
  { label: "أخضر", value: "#4CAF50" },
  { label: "أحمر", value: "#F44336" },
  { label: "سماوي", value: "#00BCD4" },
  { label: "ذهبي", value: "#FFC107" },
];

const BG_COLORS = [
  { label: "أزرق فاتح", value: "#F0FAFE" },
  { label: "أبيض", value: "#FFFFFF" },
  { label: "وردي فاتح", value: "#FFF0F5" },
  { label: "أخضر فاتح", value: "#F0FFF4" },
  { label: "أصفر فاتح", value: "#FFFDE7" },
  { label: "رمادي فاتح", value: "#F5F5F5" },
  { label: "بنفسجي فاتح", value: "#F3E5F5" },
  { label: "برتقالي فاتح", value: "#FFF3E0" },
];

const SECONDARY_COLORS = [
  { label: "سماوي", value: "#96DFEC" },
  { label: "وردي فاتح", value: "#FFB5C8" },
  { label: "أصفر", value: "#FFF176" },
  { label: "أخضر", value: "#A5D6A7" },
  { label: "بنفسجي", value: "#CE93D8" },
  { label: "برتقالي", value: "#FFCC80" },
];

function ColorSwatch({
  colors: swatches,
  selected,
  onSelect,
}: {
  colors: { label: string; value: string }[];
  selected: string;
  onSelect: (v: string) => void;
}) {
  return (
    <View style={styles.swatchRow}>
      {swatches.map((c) => (
        <Pressable
          key={c.value}
          onPress={() => onSelect(c.value)}
          style={[
            styles.swatch,
            { backgroundColor: c.value },
            selected === c.value && styles.swatchSelected,
          ]}
        >
          {selected === c.value && (
            <Ionicons name="checkmark" size={16} color="#fff" />
          )}
        </Pressable>
      ))}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
      <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {children}
      </View>
    </View>
  );
}

function Field({ label, value, onChangeText, placeholder, children }: {
  label: string;
  value?: string;
  onChangeText?: (t: string) => void;
  placeholder?: string;
  children?: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      {children ?? (
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          style={[styles.fieldInput, { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground }]}
          textAlign="right"
        />
      )}
    </View>
  );
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings, updateSettings, resetSettings } = useAppSettings();
  const [saved, setSaved] = useState(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 16;

  const handleSave = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    if (Platform.OS === "web") {
      if (window.confirm("إعادة تعيين جميع الإعدادات للوضع الافتراضي؟")) {
        resetSettings();
      }
    } else {
      Alert.alert("إعادة التعيين", "إعادة جميع الإعدادات للوضع الافتراضي؟", [
        { text: "إلغاء", style: "cancel" },
        { text: "تأكيد", style: "destructive", onPress: resetSettings },
      ]);
    }
  };

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: bottomPadding }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12, backgroundColor: colors.primary }]}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-forward" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>إعدادات التطبيق</Text>
        <Pressable onPress={handleReset}>
          <Ionicons name="refresh-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      {/* ── الألوان ── */}
      <Section title="🎨 الألوان الرئيسية">
        <Field label="لون الزر والعناصر الرئيسية">
          <ColorSwatch
            colors={PRIMARY_COLORS}
            selected={settings.primaryColor}
            onSelect={(v) => updateSettings({ primaryColor: v, bannerColor: v })}
          />
        </Field>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Field label="لون خلفية التطبيق">
          <ColorSwatch
            colors={BG_COLORS}
            selected={settings.backgroundColor}
            onSelect={(v) => updateSettings({ backgroundColor: v })}
          />
        </Field>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Field label="اللون الثانوي">
          <ColorSwatch
            colors={SECONDARY_COLORS}
            selected={settings.secondaryColor}
            onSelect={(v) => updateSettings({ secondaryColor: v, accentColor: v })}
          />
        </Field>
      </Section>

      {/* ── أسماء التبويبات ── */}
      <Section title="📋 أسماء التبويبات السفلية">
        <Field
          label="تبويب الرئيسية"
          value={settings.tabLabelHome}
          onChangeText={(v) => updateSettings({ tabLabelHome: v })}
          placeholder="الرئيسية"
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Field
          label="تبويب المنتجات"
          value={settings.tabLabelProducts}
          onChangeText={(v) => updateSettings({ tabLabelProducts: v })}
          placeholder="المنتجات"
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Field
          label="تبويب الحساب"
          value={settings.tabLabelProfile}
          onChangeText={(v) => updateSettings({ tabLabelProfile: v })}
          placeholder="حسابي"
        />
      </Section>

      {/* ── البانر الرئيسي ── */}
      <Section title="🖼️ البانر الرئيسي">
        <Field
          label="عنوان البانر (السطر الأول والثاني بـ \\n)"
          value={settings.bannerTitle}
          onChangeText={(v) => updateSettings({ bannerTitle: v })}
          placeholder="كل ما يحتاجه\nطفلك..."
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Field
          label="وصف البانر"
          value={settings.bannerSubtitle}
          onChangeText={(v) => updateSettings({ bannerSubtitle: v })}
          placeholder="ملابس · عربات · مستلزمات"
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Field
          label="نص الشارة (مثلاً: خصم 30%)"
          value={settings.bannerBadge}
          onChangeText={(v) => updateSettings({ bannerBadge: v })}
          placeholder="خصم 20%"
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Field label="لون البانر">
          <ColorSwatch
            colors={PRIMARY_COLORS}
            selected={settings.bannerColor}
            onSelect={(v) => updateSettings({ bannerColor: v })}
          />
        </Field>
      </Section>

      {/* ── التحويل البنكي ── */}
      <Section title="🏦 بيانات التحويل البنكي">
        {[
          { label: "اسم البنك", key: "bankName" as const, placeholder: "مثال: بنك القدس" },
          { label: "اسم صاحب الحساب", key: "accountHolder" as const, placeholder: "الاسم الكامل" },
          { label: "رقم الحساب", key: "accountNumber" as const, placeholder: "XXXX-XXXX-XXXX" },
          { label: "IBAN (اختياري)", key: "iban" as const, placeholder: "PS00XXXX..." },
        ].map((f) => (
          <Field key={f.key} label={f.label}>
            <TextInput
              value={settings.bankInfo?.[f.key] ?? ""}
              onChangeText={(v) =>
                updateSettings({ bankInfo: { ...settings.bankInfo, [f.key]: v } })
              }
              placeholder={f.placeholder}
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              textAlign="right"
            />
          </Field>
        ))}
      </Section>

      {/* ── التصنيفات ── */}
      <Section title="🏷️ أسماء التصنيفات">
        <Pressable
          onPress={() => router.push("/admin/categories")}
          style={[styles.navRow, { backgroundColor: colors.secondary }]}
        >
          <Ionicons name="arrow-back" size={18} color={colors.foreground} />
          <Text style={[styles.navText, { color: colors.foreground }]}>
            تعديل أسماء الفئات العمرية والمنتجات
          </Text>
          <Ionicons name="list-outline" size={22} color={colors.primary} />
        </Pressable>
      </Section>

      {/* ── العروض ── */}
      <Section title="🛒 العروض الخاصة">
        <Pressable
          onPress={() => router.push("/admin/offers")}
          style={[styles.navRow, { backgroundColor: colors.secondary }]}
        >
          <Ionicons name="arrow-back" size={18} color={colors.foreground} />
          <Text style={[styles.navText, { color: colors.foreground }]}>
            إدارة العروض ({settings.offers.length})
          </Text>
          <Ionicons name="pricetag-outline" size={22} color={colors.primary} />
        </Pressable>
      </Section>

      {/* Preview */}
      <Section title="👁️ معاينة الألوان">
        <View style={styles.preview}>
          <View style={[styles.previewBanner, { backgroundColor: settings.bannerColor }]}>
            <Text style={styles.previewBannerText}>{settings.bannerTitle.replace("\\n", "\n")}</Text>
          </View>
          <View style={styles.previewRow}>
            <View style={[styles.previewBtn, { backgroundColor: settings.primaryColor }]}>
              <Text style={styles.previewBtnText}>زر رئيسي</Text>
            </View>
            <View style={[styles.previewCard, { backgroundColor: settings.backgroundColor, borderColor: settings.secondaryColor }]}>
              <Text style={{ color: settings.primaryColor, fontWeight: "700" }}>بطاقة</Text>
            </View>
          </View>
        </View>
      </Section>

      {/* Save Button */}
      <Pressable
        onPress={handleSave}
        style={[styles.saveBtn, { backgroundColor: saved ? "#22c55e" : colors.primary }]}
      >
        <Ionicons name={saved ? "checkmark-circle" : "save-outline"} size={22} color="#fff" />
        <Text style={styles.saveBtnText}>{saved ? "تم الحفظ!" : "حفظ الإعدادات"}</Text>
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
  section: { paddingHorizontal: 16, marginTop: 20 },
  sectionTitle: { fontSize: 15, fontWeight: "700", textAlign: "right", marginBottom: 8 },
  sectionCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  field: { padding: 14, gap: 10 },
  fieldLabel: { fontSize: 13, textAlign: "right" },
  fieldInput: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 14,
  },
  divider: { height: 1, marginHorizontal: 14 },
  swatchRow: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 10 },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  swatchSelected: {
    borderWidth: 3,
    borderColor: "#fff",
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  navRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    margin: 10,
  },
  navText: { flex: 1, fontSize: 14, fontWeight: "700", textAlign: "right" },
  preview: { padding: 14, gap: 12 },
  previewBanner: {
    padding: 16,
    borderRadius: 12,
    alignItems: "flex-end",
  },
  previewBannerText: { color: "#fff", fontWeight: "700", fontSize: 15, textAlign: "right" },
  previewRow: { flexDirection: "row-reverse", gap: 10, alignItems: "center" },
  previewBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  previewBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  previewCard: {
    padding: 14,
    borderRadius: 10,
    borderWidth: 2,
    flex: 1,
    alignItems: "center",
  },
  saveBtn: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginHorizontal: 16,
    marginTop: 20,
    paddingVertical: 16,
    borderRadius: 16,
  },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
