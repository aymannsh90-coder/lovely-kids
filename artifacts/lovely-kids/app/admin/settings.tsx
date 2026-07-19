import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
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

import { ColorPickerButton } from "@/components/ColorPickerButton";
import { LogoPickerButton } from "@/components/LogoPickerButton";
import { useAppSettings } from "@/context/AppSettingsContext";
import { useColors } from "@/hooks/useColors";

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
  const { settings, settingsReady, updateSettings, resetSettings } = useAppSettings();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 16;

  const [draftPrimary, setDraftPrimary] = useState(settings.primaryColor);
  const [draftBg, setDraftBg] = useState(settings.backgroundColor);
  const [draftSecondary, setDraftSecondary] = useState(settings.secondaryColor);
  const [draftBanner, setDraftBanner] = useState(settings.bannerColor);
  const [draftBannerTitle, setDraftBannerTitle] = useState(settings.bannerTitle);
  const [draftBannerSubtitle, setDraftBannerSubtitle] = useState(settings.bannerSubtitle);
  const [draftBannerBadge, setDraftBannerBadge] = useState(settings.bannerBadge);

  const initializedRef = useRef(false);
  useEffect(() => {
    if (settingsReady && !initializedRef.current) {
      initializedRef.current = true;
      setDraftPrimary(settings.primaryColor);
      setDraftBg(settings.backgroundColor);
      setDraftSecondary(settings.secondaryColor);
      setDraftBanner(settings.bannerColor);
      setDraftBannerTitle(settings.bannerTitle);
      setDraftBannerSubtitle(settings.bannerSubtitle);
      setDraftBannerBadge(settings.bannerBadge);
    }
  }, [settingsReady, settings.primaryColor, settings.backgroundColor, settings.secondaryColor, settings.bannerColor]);

  const handleSave = async () => {
    setSaving(true);
    const ok = await updateSettings({
      primaryColor: draftPrimary,
      backgroundColor: draftBg,
      secondaryColor: draftSecondary,
      accentColor: draftSecondary,
      bannerColor: draftBanner,
      bannerTitle: draftBannerTitle,
      bannerSubtitle: draftBannerSubtitle,
      bannerBadge: draftBannerBadge,
    });
    setSaving(false);
    if (ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } else {
      Alert.alert(
        "فشل حفظ الألوان",
        "تعذّر حفظ الألوان في السيرفر.\nتأكد من اتصالك بالإنترنت وأن حسابك يملك صلاحية أدمن.",
        [{ text: "حسناً" }]
      );
    }
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

      {/* ── الشعار ── */}
      <Section title="🖼️ شعار المتجر">
        <View style={styles.field}>
          <LogoPickerButton
            value={settings.logoUrl}
            fallbackSource={require("@/assets/images/logo.jpg")}
            onChange={(url) => updateSettings({ logoUrl: url })}
          />
        </View>
      </Section>

      {/* ── الألوان ── */}
      <Section title="🎨 الألوان الرئيسية">
        <Field label="لون الزر والعناصر الرئيسية">
          <ColorPickerButton
            value={draftPrimary}
            title="لون الزر والعناصر الرئيسية"
            onChange={(v) => { setDraftPrimary(v); setDraftBanner(v); }}
          />
        </Field>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Field label="لون خلفية التطبيق">
          <ColorPickerButton
            value={draftBg}
            title="لون خلفية التطبيق"
            onChange={(v) => setDraftBg(v)}
          />
        </Field>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Field label="اللون الثانوي">
          <ColorPickerButton
            value={draftSecondary}
            title="اللون الثانوي"
            onChange={(v) => setDraftSecondary(v)}
          />
        </Field>

        {/* Save Colors Button */}
        <View style={styles.field}>
          <Pressable
            onPress={handleSave}
            disabled={saving}
            style={[
              styles.saveColorsBtn,
              { backgroundColor: saved ? "#22c55e" : saving ? colors.muted : colors.primary },
            ]}
          >
            <Ionicons
              name={saved ? "checkmark-circle" : saving ? "hourglass-outline" : "color-palette-outline"}
              size={18}
              color="#fff"
            />
            <Text style={styles.saveColorsBtnText}>
              {saved ? "تم حفظ الألوان ✓" : saving ? "جاري الحفظ..." : "حفظ الألوان"}
            </Text>
          </Pressable>
        </View>
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
          value={draftBannerTitle}
          onChangeText={setDraftBannerTitle}
          placeholder="كل ما يحتاجه\nطفلك..."
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Field
          label="وصف البانر"
          value={draftBannerSubtitle}
          onChangeText={setDraftBannerSubtitle}
          placeholder="ملابس · عربات · مستلزمات"
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Field
          label="نص الشارة (مثلاً: خصم 30%)"
          value={draftBannerBadge}
          onChangeText={setDraftBannerBadge}
          placeholder="خصم 20%"
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Field label="لون البانر">
          <ColorPickerButton
            value={draftBanner}
            title="لون البانر"
            onChange={(v) => setDraftBanner(v)}
          />
        </Field>
      </Section>

      {/* ── واتساب ── */}
      <Section title="💬 رقم واتساب المتجر">
        <Field label="رقم الواتساب (بدون + مع رمز الدولة، مثال: 97250000000)">
          <TextInput
            value={settings.whatsappNumber ?? ""}
            onChangeText={(v) => updateSettings({ whatsappNumber: v.replace(/\D/g, "") })}
            placeholder="97292376808"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="phone-pad"
            style={[styles.fieldInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            textAlign="right"
          />
        </Field>
      </Section>

      {/* ── روابط المشاركة ── */}
      <Section title="🔗 روابط مشاركة المنتجات">
        <Field
          label="الدومين الأساسي للروابط (بدون / في النهاية)"
          value={settings.productShareBaseUrl ?? ""}
          onChangeText={(v) => updateSettings({ productShareBaseUrl: v.trim() })}
          placeholder="https://lovely-kids.replit.app"
        />
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
              style={[styles.fieldInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              textAlign="right"
            />
          </Field>
        ))}
      </Section>

      {/* ── معلومات صفحة التواصل ── */}
      <Section title="📇 صفحة تواصل معنا">
        <Field
          label="اسم المتجر"
          value={settings.contactInfo?.storeName}
          onChangeText={(v) => updateSettings({ contactInfo: { ...settings.contactInfo, storeName: v } })}
          placeholder="Lovely Kids"
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Field
          label="الشعار الفرعي"
          value={settings.contactInfo?.storeTagline}
          onChangeText={(v) => updateSettings({ contactInfo: { ...settings.contactInfo, storeTagline: v } })}
          placeholder="كل ما يحتاجه طفلك في مكان واحد"
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Field label="رقم الاتصال المباشر">
          <TextInput
            value={settings.contactInfo?.phoneNumber ?? ""}
            onChangeText={(v) =>
              updateSettings({ contactInfo: { ...settings.contactInfo, phoneNumber: v.replace(/[^\d+]/g, "") } })
            }
            placeholder="092376808"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="phone-pad"
            style={[styles.fieldInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            textAlign="right"
          />
        </Field>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Field
          label="رابط فيسبوك"
          value={settings.contactInfo?.facebookUrl}
          onChangeText={(v) => updateSettings({ contactInfo: { ...settings.contactInfo, facebookUrl: v } })}
          placeholder="https://www.facebook.com/..."
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Field
          label="رابط انستجرام"
          value={settings.contactInfo?.instagramUrl}
          onChangeText={(v) => updateSettings({ contactInfo: { ...settings.contactInfo, instagramUrl: v } })}
          placeholder="https://www.instagram.com/..."
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Field
          label="رابط تيك توك"
          value={settings.contactInfo?.tiktokUrl}
          onChangeText={(v) => updateSettings({ contactInfo: { ...settings.contactInfo, tiktokUrl: v } })}
          placeholder="https://www.tiktok.com/@..."
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Field
          label="سطر العنوان الأول"
          value={settings.contactInfo?.addressLine1}
          onChangeText={(v) => updateSettings({ contactInfo: { ...settings.contactInfo, addressLine1: v } })}
          placeholder="نابلس · المركز التجاري"
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Field
          label="سطر العنوان الثاني"
          value={settings.contactInfo?.addressLine2}
          onChangeText={(v) => updateSettings({ contactInfo: { ...settings.contactInfo, addressLine2: v } })}
          placeholder="شارع عمر المختار · طلعة بنك القدس"
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Field
          label="رابط خرائط جوجل"
          value={settings.contactInfo?.mapsUrl}
          onChangeText={(v) => updateSettings({ contactInfo: { ...settings.contactInfo, mapsUrl: v } })}
          placeholder="https://google.com/maps?..."
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Field label="ساعات العمل (سطرين بـ Enter)">
          <TextInput
            value={settings.contactInfo?.workingHours ?? ""}
            onChangeText={(v) => updateSettings({ contactInfo: { ...settings.contactInfo, workingHours: v } })}
            placeholder={"السبت - الخميس\n9:00 صباحاً - 9:00 مساءً"}
            placeholderTextColor={colors.mutedForeground}
            multiline
            style={[styles.fieldInput, styles.fieldInputMultiline, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            textAlign="right"
          />
        </Field>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Field label="معلومات الشحن (سطرين بـ Enter)">
          <TextInput
            value={settings.contactInfo?.shippingInfo ?? ""}
            onChangeText={(v) => updateSettings({ contactInfo: { ...settings.contactInfo, shippingInfo: v } })}
            placeholder={"توصيل سريع لجميع المناطق\nشحن مجاني فوق 500 ₪"}
            placeholderTextColor={colors.mutedForeground}
            multiline
            style={[styles.fieldInput, styles.fieldInputMultiline, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            textAlign="right"
          />
        </Field>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Field label="سياسة الإرجاع (سطرين بـ Enter)">
          <TextInput
            value={settings.contactInfo?.returnPolicy ?? ""}
            onChangeText={(v) => updateSettings({ contactInfo: { ...settings.contactInfo, returnPolicy: v } })}
            placeholder={"إمكانية الاستبدال خلال 7 أيام\nبالبضاعة سليمة"}
            placeholderTextColor={colors.mutedForeground}
            multiline
            style={[styles.fieldInput, styles.fieldInputMultiline, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            textAlign="right"
          />
        </Field>
      </Section>

      {/* ── صفحة عن المحل ── */}
      <Section title="ℹ️ صفحة عن المحل">
        <Field label="من نحن (نص التعريف بالمحل)">
          <TextInput
            value={settings.aboutInfo?.intro ?? ""}
            onChangeText={(v) =>
              updateSettings({ aboutInfo: { ...settings.aboutInfo, intro: v } })
            }
            placeholder="اكتب نبذة عن المحل..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            style={[styles.fieldInput, styles.fieldInputMultiline, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            textAlign="right"
          />
        </Field>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Text style={[styles.fieldLabel, { color: colors.mutedForeground, paddingHorizontal: 14, paddingTop: 4 }]}>
          لماذا تختارنا (4 مميزات)
        </Text>
        {(settings.aboutInfo?.features ?? []).map((feature, index) => (
          <View key={index}>
            <View style={styles.field}>
              <Field
                label={`عنوان الميزة ${index + 1}`}
                value={feature.title}
                onChangeText={(v) => {
                  const features = [...(settings.aboutInfo?.features ?? [])];
                  features[index] = { ...features[index], title: v };
                  updateSettings({ aboutInfo: { ...settings.aboutInfo, features } });
                }}
                placeholder="عنوان الميزة"
              />
              <Field
                label={`وصف الميزة ${index + 1}`}
                value={feature.desc}
                onChangeText={(v) => {
                  const features = [...(settings.aboutInfo?.features ?? [])];
                  features[index] = { ...features[index], desc: v };
                  updateSettings({ aboutInfo: { ...settings.aboutInfo, features } });
                }}
                placeholder="وصف الميزة"
              />
            </View>
            {index < (settings.aboutInfo?.features?.length ?? 0) - 1 && (
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
            )}
          </View>
        ))}
      </Section>

      {/* ── تكلفة التوصيل ── */}
      <Section title="🚚 تكلفة التوصيل">
        {(settings.shippingZones ?? []).map((zone, index) => (
          <View key={index}>
            {index > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
            <View style={[styles.field, { flexDirection: "row-reverse", alignItems: "center", gap: 10 }]}>
              <Text style={[styles.fieldLabel, { flex: 1, color: colors.mutedForeground }]}>{zone.label}</Text>
              <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 6 }}>
                <TextInput
                  value={String(zone.cost)}
                  onChangeText={(v) => {
                    const cost = parseInt(v.replace(/\D/g, ""), 10);
                    const zones = [...(settings.shippingZones ?? [])];
                    zones[index] = { ...zones[index], cost: isNaN(cost) ? 0 : cost };
                    updateSettings({ shippingZones: zones });
                  }}
                  keyboardType="number-pad"
                  style={[styles.fieldInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, width: 80, textAlign: "center" }]}
                />
                <Text style={[styles.fieldLabel, { color: colors.foreground }]}>₪</Text>
              </View>
            </View>
          </View>
        ))}
        <View style={[styles.field, { paddingTop: 0 }]}>
          <Text style={[styles.fieldLabel, { color: colors.mutedForeground, fontSize: 12 }]}>
            تكلفة التوصيل تُضاف تلقائياً على إجمالي الطلب عند اختيار المنطقة
          </Text>
        </View>
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
          <View style={[styles.previewBanner, { backgroundColor: draftBanner }]}>
            <Text style={styles.previewBannerText}>{settings.bannerTitle.replace("\\n", "\n")}</Text>
          </View>
          <View style={styles.previewRow}>
            <View style={[styles.previewBtn, { backgroundColor: draftPrimary }]}>
              <Text style={styles.previewBtnText}>زر رئيسي</Text>
            </View>
            <View style={[styles.previewCard, { backgroundColor: draftBg, borderColor: draftSecondary }]}>
              <Text style={{ color: draftPrimary, fontWeight: "700" }}>بطاقة</Text>
            </View>
          </View>
        </View>
      </Section>

      {/* Main Save Button */}
      <Pressable
        onPress={handleSave}
        disabled={saving}
        style={[styles.saveBtn, { backgroundColor: saved ? "#22c55e" : saving ? colors.muted : colors.primary }]}
      >
        <Ionicons name={saved ? "checkmark-circle" : saving ? "hourglass-outline" : "save-outline"} size={22} color="#fff" />
        <Text style={styles.saveBtnText}>
          {saved ? "تم الحفظ!" : saving ? "جاري الحفظ..." : "حفظ الإعدادات"}
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
  fieldInputMultiline: {
    minHeight: 60,
    textAlignVertical: "top",
  },
  divider: { height: 1, marginHorizontal: 14 },
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
  saveColorsBtn: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
  },
  saveColorsBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
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
