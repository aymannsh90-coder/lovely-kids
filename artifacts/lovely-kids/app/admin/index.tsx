import { getResponsiveTopPadding } from "@/utils/webLayout";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
    label: "قسم العروض 🔥",
    subtitle: "إدارة منتجات العروض",
    icon: "pricetag-outline" as const,
    route: "/admin/product-offers" as const,
  },
  {
    label: "عرض التوصيل",
    subtitle: "الحد الأدنى والفترة وأسعار العرض",
    icon: "car-outline" as const,
    route: "/admin/shipping-promotion" as const,
  },
  {
    label: "أقسام الصفحة الرئيسية",
    subtitle: "إظهار وإخفاء أقسام الرئيسية",
    icon: "eye-outline" as const,
    route: "/admin/home-sections" as const,
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

  const topPadding = getResponsiveTopPadding(insets.top);
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 20;

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

        <View style={styles.quickGrid}>
          <Pressable
            onPress={() => router.push("/admin/season")}
            style={[styles.quickButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Ionicons name="partly-sunny-outline" size={28} color={colors.primary} />
            <Text style={[styles.quickButtonTitle, { color: colors.foreground }]}>الموسم النشط</Text>
            <Text style={[styles.quickButtonValue, { color: colors.mutedForeground }]}>
              {settings.activeSeason === "summer"
                ? "☀️ صيفي"
                : settings.activeSeason === "winter"
                  ? "❄️ شتوي"
                  : "غير محدد"}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/admin/shipping")}
            style={[styles.quickButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Ionicons name="car-outline" size={28} color={colors.primary} />
            <Text style={[styles.quickButtonTitle, { color: colors.foreground }]}>أسعار التوصيل</Text>
            <Text style={[styles.quickButtonValue, { color: colors.mutedForeground }]}>
              {(settings.shippingZones ?? []).map((zone) => `${zone.cost} ₪`).join(" · ")}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/admin/colors")}
            style={[styles.quickButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Ionicons name="color-palette-outline" size={28} color={colors.primary} />
            <Text style={[styles.quickButtonTitle, { color: colors.foreground }]}>ألوان التطبيق</Text>
            <View style={styles.colorDots}>
              {[settings.primaryColor, settings.backgroundColor, settings.secondaryColor].map((color, index) => (
                <View
                  key={`${color}-${index}`}
                  style={[styles.colorDot, { backgroundColor: color, borderColor: colors.border }]}
                />
              ))}
            </View>
          </Pressable>

          <Pressable
            onPress={() => router.push("/admin/hero" as never)}
            style={[styles.quickButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Ionicons name="images-outline" size={28} color={colors.primary} />
            <Text style={[styles.quickButtonTitle, { color: colors.foreground }]}>
              Hero Slider
            </Text>
            <Text style={[styles.quickButtonValue, { color: colors.mutedForeground }]}>
              {(settings.heroSlides ?? []).filter((slide) => slide.active).length} من 5 شرائح
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/admin/categories")}
            style={[styles.quickButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Ionicons name="grid-outline" size={28} color={colors.primary} />
            <Text style={[styles.quickButtonTitle, { color: colors.foreground }]}>أسماء التصنيفات</Text>
            <Text style={[styles.quickButtonValue, { color: colors.mutedForeground }]}>
              {activeCategories.length} تصنيف نشط
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
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
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
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
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
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
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
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
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
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
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
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
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
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
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
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
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
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
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
  quickGrid: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    flexWrap: "wrap",
    gap: 10,
  },
  quickButton: {
    flexGrow: 1,
    flexBasis: "46%",
    minWidth: 150,
    minHeight: 125,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  quickButtonTitle: {
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
  },
  quickButtonValue: {
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  colorDots: {
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
  },
  colorDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
  },

});
