import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
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
import { useAppSettings } from "@/context/AppSettingsContext";
import { useProducts } from "@/context/ProductsContext";
import { useColors } from "@/hooks/useColors";

const ADMIN_CARDS = [
  {
    label: "إدارة المنتجات",
    subtitle: "المنتجات والمخزون",
    icon: "cube-outline" as const,
    route: "/admin/products" as const,
  },
  {
    label: "الطلبات",
    subtitle: "متابعة طلبات الزبائن",
    icon: "bag-handle-outline" as const,
    route: "/admin/orders" as const,
  },
  {
    label: "المستخدمون",
    subtitle: "الحسابات والمستخدمون",
    icon: "people-outline" as const,
    route: "/admin/users" as const,
  },
  {
    label: "الإشعارات",
    subtitle: "إرسال الإشعارات",
    icon: "notifications-outline" as const,
    route: "/admin/notifications" as const,
  },
  {
    label: "العروض",
    subtitle: "إدارة منتجات العروض",
    icon: "pricetag-outline" as const,
    route: "/admin/product-offers" as const,
  },
  {
    label: "إعدادات التطبيق",
    subtitle: "جميع الإعدادات",
    icon: "settings-outline" as const,
    route: "/admin/settings" as const,
  },
];

export default function AdminDashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { products } = useProducts();
  const { settings, updateSettings } = useAppSettings();

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 20;

  const [draftPrimary, setDraftPrimary] = useState(settings.primaryColor);
  const [draftBackground, setDraftBackground] = useState(settings.backgroundColor);
  const [draftSecondary, setDraftSecondary] = useState(settings.secondaryColor);
  const [shippingDrafts, setShippingDrafts] = useState<string[]>(
    (settings.shippingZones ?? []).map((zone) => String(zone.cost)),
  );
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    setDraftPrimary(settings.primaryColor);
    setDraftBackground(settings.backgroundColor);
    setDraftSecondary(settings.secondaryColor);
  }, [
    settings.primaryColor,
    settings.backgroundColor,
    settings.secondaryColor,
  ]);

  useEffect(() => {
    setShippingDrafts(
      (settings.shippingZones ?? []).map((zone) => String(zone.cost)),
    );
  }, [settings.shippingZones]);

  const activeCategories = useMemo(() => {
    const hidden = settings.hiddenCategories ?? [];
    return Object.entries(settings.categoryLabels ?? {})
      .filter(([id]) => id !== "all" && !hidden.includes(id))
      .map(([id, label]) => ({ id, label }));
  }, [settings.categoryLabels, settings.hiddenCategories]);

  const offersCount = useMemo(
    () => products.filter((product) => product.showInOffers === true).length,
    [products],
  );

  const markSaved = (key: string) => {
    setSaved(key);
    setTimeout(() => {
      setSaved((current) => (current === key ? null : current));
    }, 1800);
  };

  const saveColors = async () => {
    setSaving("colors");
    const ok = await updateSettings({
      primaryColor: draftPrimary,
      backgroundColor: draftBackground,
      secondaryColor: draftSecondary,
      accentColor: draftSecondary,
    });
    setSaving(null);
    if (ok) markSaved("colors");
  };

  const saveShipping = async () => {
    const zones = (settings.shippingZones ?? []).map((zone, index) => {
      const parsed = Number.parseInt(shippingDrafts[index] ?? "", 10);
      return {
        ...zone,
        cost: Number.isFinite(parsed) ? Math.max(0, parsed) : 0,
      };
    });

    setSaving("shipping");
    const ok = await updateSettings({ shippingZones: zones });
    setSaving(null);
    if (ok) markSaved("shipping");
  };

  const setSeason = async (season: "summer" | "winter") => {
    if (settings.activeSeason === season) return;
    setSaving("season");
    const ok = await updateSettings({ activeSeason: season });
    setSaving(null);
    if (ok) markSaved("season");
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
          {
            paddingTop: topPadding + 12,
            backgroundColor: colors.primary,
          },
        ]}
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-forward" size={24} color="#fff" />
        </Pressable>

        <View style={{ alignItems: "center" }}>
          <Text style={styles.headerTitle}>لوحة الإدارة</Text>
          <Text style={styles.headerSubtitle}>Lovely Kids</Text>
        </View>

        <View style={{ width: 24 }} />
      </View>

      <View style={styles.body}>
        {/* Summary */}
        <View
          style={[
            styles.summaryCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryNumber, { color: colors.primary }]}>
              {products.length}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>
              منتج
            </Text>
          </View>

          <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />

          <View style={styles.summaryItem}>
            <Text style={[styles.summaryNumber, { color: colors.primary }]}>
              {offersCount}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>
              في العروض
            </Text>
          </View>

          <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />

          <View style={styles.summaryItem}>
            <Text style={[styles.summaryNumber, { color: colors.primary }]}>
              {activeCategories.length}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>
              تصنيف نشط
            </Text>
          </View>
        </View>

        {/* Main admin cards */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          الإدارة الرئيسية
        </Text>

        <View style={styles.cardsGrid}>
          {ADMIN_CARDS.map((item) => (
            <Pressable
              key={item.route}
              onPress={() => router.push(item.route)}
              style={[
                styles.adminCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              <View
                style={[
                  styles.iconCircle,
                  { backgroundColor: colors.secondary },
                ]}
              >
                <Ionicons name={item.icon} size={25} color={colors.primary} />
              </View>

              <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                {item.label}
              </Text>

              <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>
                {item.subtitle}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          إعدادات سريعة
        </Text>

        {/* Active season */}
        <View
          style={[
            styles.quickCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.quickHeader}>
            <Ionicons name="partly-sunny-outline" size={22} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.quickTitle, { color: colors.foreground }]}>
                الموسم النشط
              </Text>
              <Text style={[styles.quickHint, { color: colors.mutedForeground }]}>
                المنتجات المعروضة حسب الموسم
              </Text>
            </View>
          </View>

          <View style={styles.seasonRow}>
            <Pressable
              onPress={() => void setSeason("summer")}
              style={[
                styles.seasonBtn,
                {
                  backgroundColor:
                    settings.activeSeason === "summer"
                      ? colors.primary
                      : colors.background,
                  borderColor:
                    settings.activeSeason === "summer"
                      ? colors.primary
                      : colors.border,
                },
              ]}
            >
              <Text
                style={{
                  color:
                    settings.activeSeason === "summer"
                      ? "#fff"
                      : colors.foreground,
                  fontWeight: "800",
                }}
              >
                ☀️ صيفي
              </Text>
            </Pressable>

            <Pressable
              onPress={() => void setSeason("winter")}
              style={[
                styles.seasonBtn,
                {
                  backgroundColor:
                    settings.activeSeason === "winter"
                      ? colors.primary
                      : colors.background,
                  borderColor:
                    settings.activeSeason === "winter"
                      ? colors.primary
                      : colors.border,
                },
              ]}
            >
              <Text
                style={{
                  color:
                    settings.activeSeason === "winter"
                      ? "#fff"
                      : colors.foreground,
                  fontWeight: "800",
                }}
              >
                ❄️ شتوي
              </Text>
            </Pressable>
          </View>

          {saved === "season" ? (
            <Text style={styles.savedText}>✓ تم تحديث الموسم</Text>
          ) : null}
        </View>

        {/* Shipping */}
        <View
          style={[
            styles.quickCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.quickHeader}>
            <Ionicons name="car-outline" size={22} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.quickTitle, { color: colors.foreground }]}>
                أسعار التوصيل
              </Text>
              <Text style={[styles.quickHint, { color: colors.mutedForeground }]}>
                نفس الأسعار المستخدمة عند إنشاء الطلب
              </Text>
            </View>
          </View>

          {(settings.shippingZones ?? []).map((zone, index) => (
            <View key={`${zone.label}-${index}`} style={styles.shippingRow}>
              <Text style={[styles.shippingLabel, { color: colors.foreground }]}>
                {zone.label}
              </Text>

              <View
                style={[
                  styles.shippingInputWrap,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
              >
                <TextInput
                  value={shippingDrafts[index] ?? ""}
                  onChangeText={(value) => {
                    const clean = value.replace(/\D/g, "");
                    setShippingDrafts((current) => {
                      const next = [...current];
                      next[index] = clean;
                      return next;
                    });
                  }}
                  keyboardType="number-pad"
                  style={[styles.shippingInput, { color: colors.foreground }]}
                  textAlign="center"
                />
                <Text style={{ color: colors.foreground, fontWeight: "700" }}>
                  ₪
                </Text>
              </View>
            </View>
          ))}

          <Pressable
            onPress={() => void saveShipping()}
            disabled={saving === "shipping"}
            style={[
              styles.saveQuickBtn,
              {
                backgroundColor:
                  saved === "shipping" ? "#22c55e" : colors.primary,
              },
            ]}
          >
            <Ionicons
              name={saved === "shipping" ? "checkmark-circle" : "save-outline"}
              size={18}
              color="#fff"
            />
            <Text style={styles.saveQuickText}>
              {saving === "shipping"
                ? "جاري الحفظ..."
                : saved === "shipping"
                  ? "تم الحفظ"
                  : "حفظ أسعار التوصيل"}
            </Text>
          </Pressable>
        </View>

        {/* Colors */}
        <View
          style={[
            styles.quickCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.quickHeader}>
            <Ionicons name="color-palette-outline" size={22} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.quickTitle, { color: colors.foreground }]}>
                ألوان التطبيق
              </Text>
              <Text style={[styles.quickHint, { color: colors.mutedForeground }]}>
                الألوان الرئيسية المستخدمة في المتجر
              </Text>
            </View>
          </View>

          <View style={styles.colorField}>
            <Text style={[styles.colorLabel, { color: colors.foreground }]}>
              اللون الرئيسي
            </Text>
            <ColorPickerButton
              value={draftPrimary}
              title="اللون الرئيسي"
              onChange={setDraftPrimary}
            />
          </View>

          <View style={styles.colorField}>
            <Text style={[styles.colorLabel, { color: colors.foreground }]}>
              الخلفية
            </Text>
            <ColorPickerButton
              value={draftBackground}
              title="لون الخلفية"
              onChange={setDraftBackground}
            />
          </View>

          <View style={styles.colorField}>
            <Text style={[styles.colorLabel, { color: colors.foreground }]}>
              اللون الثانوي
            </Text>
            <ColorPickerButton
              value={draftSecondary}
              title="اللون الثانوي"
              onChange={setDraftSecondary}
            />
          </View>

          <Pressable
            onPress={() => void saveColors()}
            disabled={saving === "colors"}
            style={[
              styles.saveQuickBtn,
              {
                backgroundColor:
                  saved === "colors" ? "#22c55e" : colors.primary,
              },
            ]}
          >
            <Ionicons
              name={saved === "colors" ? "checkmark-circle" : "save-outline"}
              size={18}
              color="#fff"
            />
            <Text style={styles.saveQuickText}>
              {saving === "colors"
                ? "جاري الحفظ..."
                : saved === "colors"
                  ? "تم الحفظ"
                  : "حفظ الألوان"}
            </Text>
          </Pressable>
        </View>

        {/* Categories */}
        <View
          style={[
            styles.quickCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.quickHeader}>
            <Ionicons name="grid-outline" size={22} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.quickTitle, { color: colors.foreground }]}>
                أسماء التصنيفات
              </Text>
              <Text style={[styles.quickHint, { color: colors.mutedForeground }]}>
                {activeCategories.length} تصنيف ظاهر حاليًا
              </Text>
            </View>
          </View>

          <View style={styles.categoryChips}>
            {activeCategories.map((category) => (
              <View
                key={category.id}
                style={[
                  styles.categoryChip,
                  { backgroundColor: colors.secondary },
                ]}
              >
                <Text
                  style={[
                    styles.categoryChipText,
                    { color: colors.foreground },
                  ]}
                >
                  {category.label}
                </Text>
              </View>
            ))}
          </View>

          <Pressable
            onPress={() => router.push("/admin/categories")}
            style={[
              styles.manageBtn,
              {
                borderColor: colors.primary,
                backgroundColor: colors.background,
              },
            ]}
          >
            <Ionicons name="create-outline" size={18} color={colors.primary} />
            <Text style={[styles.manageBtnText, { color: colors.primary }]}>
              إدارة التصنيفات
            </Text>
          </Pressable>
        </View>
      </View>
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
  headerTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "900",
  },
  headerSubtitle: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 11,
    marginTop: 2,
  },

  body: {
    padding: 14,
    gap: 14,
    width: "100%",
    maxWidth: 900,
    alignSelf: "center",
  },

  summaryCard: {
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 14,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-around",
  },
  summaryItem: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  summaryNumber: {
    fontSize: 22,
    fontWeight: "900",
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  summaryDivider: {
    width: 1,
    height: 38,
  },

  sectionTitle: {
    fontSize: 17,
    fontWeight: "900",
    textAlign: "right",
    marginTop: 2,
  },

  cardsGrid: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: 10,
  },
  adminCard: {
    flexGrow: 1,
    flexBasis: "46%",
    minWidth: 150,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    alignItems: "flex-end",
    gap: 7,
    minHeight: 132,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "900",
    textAlign: "right",
  },
  cardSubtitle: {
    fontSize: 11,
    lineHeight: 17,
    textAlign: "right",
  },

  quickCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  quickHeader: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
  },
  quickTitle: {
    fontSize: 15,
    fontWeight: "900",
    textAlign: "right",
  },
  quickHint: {
    fontSize: 11,
    marginTop: 2,
    textAlign: "right",
  },

  seasonRow: {
    flexDirection: "row-reverse",
    gap: 10,
  },
  seasonBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  savedText: {
    color: "#16a34a",
    fontWeight: "700",
    fontSize: 12,
    textAlign: "center",
  },

  shippingRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
  },
  shippingLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "right",
  },
  shippingInputWrap: {
    width: 105,
    height: 42,
    borderWidth: 1,
    borderRadius: 10,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 8,
  },
  shippingInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: "800",
    paddingVertical: 0,
  },

  colorField: {
    gap: 6,
  },
  colorLabel: {
    fontSize: 13,
    fontWeight: "700",
    textAlign: "right",
  },

  saveQuickBtn: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 12,
    borderRadius: 12,
  },
  saveQuickText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 13,
  },

  categoryChips: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: 7,
  },
  categoryChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: "700",
  },

  manageBtn: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
  },
  manageBtnText: {
    fontSize: 13,
    fontWeight: "800",
  },
});
