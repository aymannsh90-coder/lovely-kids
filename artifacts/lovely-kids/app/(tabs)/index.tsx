import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Dimensions,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CartBadge } from "@/components/CartBadge";
import { ProductCard } from "@/components/ProductCard";
import { AGE_GROUP_IDS, DEFAULT_AGE_GROUP_LABELS, AGE_GROUP_ICONS } from "@/data/products";
import { useVisibleProducts } from "@/hooks/useVisibleProducts";
import { useAppSettings } from "@/context/AppSettingsContext";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

type GenderTab = "boys" | "girls" | null;

const { width } = Dimensions.get("window");

const AGE_COLORS = [
  "#FFB5C8",
  "#96DFEC",
  "#B5D5FF",
  "#FFD9A0",
  "#B5ECC8",
  "#E8B5FF",
];

const TRUST_BADGES = [
  { icon: "shirt-outline" as const, color: "#E91E8C", title: "خامات ناعمة", subtitle: "ومريحة" },
  { icon: "sparkles-outline" as const, color: "#96DFEC", title: "تصاميم عصرية", subtitle: "وعملية" },
  { icon: "ribbon-outline" as const, color: "#FFB84D", title: "جودة تدوم", subtitle: "طويلاً" },
];

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { products } = useVisibleProducts();
  const { settings } = useAppSettings();
  const { user } = useAuth();
  const ageGroupLabels = settings.ageGroupLabels ?? DEFAULT_AGE_GROUP_LABELS;
  const ageGroups = AGE_GROUP_IDS.map((id) => ({
    id,
    label: ageGroupLabels[id]?.label ?? DEFAULT_AGE_GROUP_LABELS[id].label,
    sublabel: ageGroupLabels[id]?.sublabel ?? DEFAULT_AGE_GROUP_LABELS[id].sublabel,
  }));
  const activeOffers = settings.offers.filter((o) => o.active);
  const [selectedAge, setSelectedAge] = useState<string | null>(null);
  const [genderTab, setGenderTab] = useState<GenderTab>(null);

  const genderFiltered = genderTab
    ? products.filter((p) => p.gender === genderTab)
    : products;

  const newArrivals = genderFiltered.filter((p) => p.isNew);

  const filteredProducts = selectedAge
    ? genderFiltered.filter((p) => p.ageGroup === selectedAge)
    : genderFiltered.slice(0, 6);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.background }]}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 100 : insets.bottom + 80 }}
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingTop: topPadding + 12, backgroundColor: colors.background },
        ]}
      >
        <View style={styles.headerLeft}>
          <Image
            source={settings.logoUrl ? { uri: settings.logoUrl } : require("@/assets/images/logo.jpg")}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </View>
        <View style={styles.headerRight}>
          <Pressable
            onPress={() => router.push("/wishlist")}
            style={styles.iconBtn}
          >
            <Ionicons name="heart-outline" size={24} color={colors.foreground} />
          </Pressable>
          <CartBadge />
        </View>
      </View>

      {user && (
        <View style={styles.greetingRow}>
          <Text style={[styles.greetingText, { color: colors.foreground }]}>
            أهلاً وسهلاً : {user.name}
          </Text>
        </View>
      )}

      {/* Gender Tabs */}
      <View style={[styles.genderTabsRow, { borderColor: colors.border }]}>
        <Pressable
          onPress={() => { setGenderTab(null); setSelectedAge(null); }}
          style={[
            styles.genderTab,
            genderTab === null && { backgroundColor: colors.primary },
          ]}
        >
          <Text style={[styles.genderTabText, { color: genderTab === null ? "#fff" : colors.foreground }]}>
            الكل
          </Text>
        </Pressable>
        <Pressable
          onPress={() => { setGenderTab("boys"); setSelectedAge(null); }}
          style={[
            styles.genderTab,
            genderTab === "boys" && { backgroundColor: "#3B82F6" },
          ]}
        >
          <Text style={{ fontSize: 18 }}>👦</Text>
          <Text style={[styles.genderTabText, { color: genderTab === "boys" ? "#fff" : colors.foreground }]}>
            ولادي
          </Text>
        </Pressable>
        <Pressable
          onPress={() => { setGenderTab("girls"); setSelectedAge(null); }}
          style={[
            styles.genderTab,
            genderTab === "girls" && { backgroundColor: "#EC4899" },
          ]}
        >
          <Text style={{ fontSize: 18 }}>👧</Text>
          <Text style={[styles.genderTabText, { color: genderTab === "girls" ? "#fff" : colors.foreground }]}>
            بناتي
          </Text>
        </Pressable>
      </View>

      {/* Search Bar */}
      <Pressable
        onPress={() => router.push("/search")}
        style={[
          styles.searchBar,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Ionicons name="search-outline" size={20} color={colors.mutedForeground} />
        <Text style={[styles.searchPlaceholder, { color: colors.mutedForeground }]}>
          ابحث عن منتج...
        </Text>
      </Pressable>

      {/* Hero Banner */}
      <Pressable
        onPress={() => router.push("/products")}
        style={[styles.heroBanner, { backgroundColor: settings.bannerColor }]}
      >
        <View style={styles.heroContent}>
          {settings.bannerBadge ? (
            <View style={[styles.heroBadge, { backgroundColor: "#FFD700" }]}>
              <Text style={styles.heroBadgeText}>{settings.bannerBadge}</Text>
            </View>
          ) : null}
          <Text style={styles.heroTitle}>
            {settings.bannerTitle.replace("\\n", "\n")}
          </Text>
          <Text style={styles.heroSubtitle}>{settings.bannerSubtitle}</Text>
          <View style={[styles.heroBtn, { backgroundColor: "#fff" }]}>
            <Text style={[styles.heroBtnText, { color: settings.bannerColor }]}>
              تسوقي الآن
            </Text>
            <Ionicons name="arrow-back" size={16} color={settings.bannerColor} />
          </View>
          <View style={styles.heroStats}>
            <Ionicons name="star" size={14} color="#FFD700" />
            <Ionicons name="star" size={14} color="#FFD700" />
            <Ionicons name="star" size={14} color="#FFD700" />
            <Ionicons name="star" size={14} color="#FFD700" />
            <Ionicons name="star" size={14} color="#FFD700" />
            <Text style={styles.heroStatText}>+٤٨٠٠ عميل</Text>
          </View>
        </View>
      </Pressable>

      {/* Trust Badges */}
      <View style={styles.trustRow}>
        {TRUST_BADGES.map((t) => (
          <View key={t.title} style={styles.trustItem}>
            <View style={[styles.trustIconCircle, { backgroundColor: t.color + "20" }]}>
              <Ionicons name={t.icon} size={24} color={t.color} />
            </View>
            <Text style={[styles.trustTitle, { color: colors.foreground }]}>
              {t.title}
            </Text>
            <Text style={[styles.trustSubtitle, { color: colors.mutedForeground }]}>
              {t.subtitle}
            </Text>
          </View>
        ))}
      </View>

      {/* Active Offers */}
      {activeOffers.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            🏷️ عروض خاصة
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.offersScroll}
          >
            {activeOffers.map((offer) => (
              <View
                key={offer.id}
                style={[styles.offerCard, { backgroundColor: offer.color }]}
              >
                <View style={styles.offerBadge}>
                  <Text style={styles.offerBadgeText}>{offer.badgeText}</Text>
                </View>
                <Text style={styles.offerTitle} numberOfLines={2}>
                  {offer.title}
                </Text>
                <Text style={styles.offerSub} numberOfLines={1}>
                  {offer.subtitle}
                </Text>
              </View>
            ))}
          </ScrollView>
        </>
      )}

      {/* Age Groups */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
        تسوقي حسب عمر الطفل
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.ageScroll}
      >
        {ageGroups.map((ag, idx) => (
          <Pressable
            key={ag.id}
            onPress={() => setSelectedAge(selectedAge === ag.id ? null : ag.id)}
            style={[
              styles.ageItem,
              {
                backgroundColor:
                  selectedAge === ag.id ? colors.primary : colors.card,
                borderColor:
                  selectedAge === ag.id ? colors.primary : colors.border,
              },
            ]}
          >
            <View
              style={[
                styles.ageIcon,
                { backgroundColor: AGE_COLORS[idx] + "40" },
              ]}
            >
              <Ionicons
                name={(AGE_GROUP_ICONS[ag.id] ?? "person-outline") as keyof typeof Ionicons.glyphMap}
                size={22}
                color={AGE_COLORS[idx]}
              />
            </View>
            <Text
              style={[
                styles.ageLabel,
                {
                  color:
                    selectedAge === ag.id ? "#fff" : colors.foreground,
                },
              ]}
            >
              {ag.label}
            </Text>
            <Text
              style={[
                styles.ageSublabel,
                {
                  color:
                    selectedAge === ag.id
                      ? "rgba(255,255,255,0.8)"
                      : colors.mutedForeground,
                },
              ]}
            >
              {ag.sublabel}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Features */}
      <View style={styles.features}>
        {[
          { icon: "rocket-outline" as const, text: "توصيل سريع" },
          { icon: "shield-checkmark-outline" as const, text: "دفع آمن" },
          { icon: "refresh-outline" as const, text: "استبدال خلال 7 أيام" },
          { icon: "headset-outline" as const, text: "دعم 24/7" },
        ].map((f) => (
          <View
            key={f.text}
            style={[
              styles.featureItem,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Ionicons name={f.icon} size={22} color={colors.primary} />
            <Text style={[styles.featureText, { color: colors.foreground }]}>
              {f.text}
            </Text>
          </View>
        ))}
      </View>

      {/* Products Grid */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          {selectedAge
            ? ageGroups.find((a) => a.id === selectedAge)?.label
            : "منتجاتنا المميزة"}
        </Text>
        <Pressable onPress={() => router.push("/products")}>
          <Text style={[styles.seeAll, { color: colors.primary }]}>عرض الكل</Text>
        </Pressable>
      </View>

      <View style={styles.productsGrid}>
        {filteredProducts.map((product, idx) => (
          <ProductCard
            key={product.id}
            product={product}
            style={{ width: (width - 48) / 2 }}
          />
        ))}
      </View>

      {/* New Arrivals */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          وصل حديثاً
        </Text>
        <Pressable onPress={() => router.push("/products")}>
          <Text style={[styles.seeAll, { color: colors.primary }]}>عرض الكل</Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScroll}
      >
        {newArrivals.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            style={{ width: 170 }}
          />
        ))}
      </ScrollView>

      {/* Contact Banner */}
      <Pressable
        onPress={() => router.push("/contact")}
        style={[styles.contactBanner, { backgroundColor: colors.secondary }]}
      >
        <Ionicons name="chatbubble-ellipses-outline" size={28} color={colors.foreground} />
        <View style={styles.contactText}>
          <Text style={[styles.contactTitle, { color: colors.foreground }]}>
            تواصلي معنا
          </Text>
          <Text style={[styles.contactSub, { color: colors.mutedForeground }]}>
            09-237-6808 · واتساب · نابلس
          </Text>
        </View>
        <Ionicons name="arrow-back" size={20} color={colors.foreground} />
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
    paddingBottom: 12,
  },
  headerLeft: { alignItems: "flex-end" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 4 },
  logoImage: { width: 110, height: 52 },
  greetingRow: { paddingHorizontal: 16, paddingBottom: 10 },
  greetingText: { fontSize: 15, fontWeight: "700", textAlign: "right" },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  searchBar: {
    marginHorizontal: 16,
    marginBottom: 16,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  searchPlaceholder: { fontSize: 14, flex: 1, textAlign: "right" },
  heroBanner: {
    marginHorizontal: 16,
    borderRadius: 20,
    overflow: "hidden",
    marginBottom: 20,
    padding: 20,
    minHeight: 180,
  },
  heroContent: { alignItems: "flex-end", gap: 8 },
  heroBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    alignSelf: "flex-end",
  },
  heroBadgeText: { fontSize: 12, fontWeight: "700", color: "#333" },
  heroTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#fff",
    textAlign: "right",
    lineHeight: 32,
  },
  heroSubtitle: { fontSize: 13, color: "rgba(255,255,255,0.85)", textAlign: "right" },
  heroBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 30,
    alignSelf: "flex-end",
    marginTop: 4,
  },
  heroBtnText: { fontSize: 14, fontWeight: "700" },
  heroStats: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 4,
  },
  heroStatText: { color: "rgba(255,255,255,0.9)", fontSize: 12, marginRight: 4 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    textAlign: "right",
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  seeAll: { fontSize: 13, fontWeight: "600" },
  offersScroll: { paddingHorizontal: 16, gap: 12, paddingBottom: 4 },
  offerCard: {
    width: 180,
    borderRadius: 16,
    padding: 14,
    gap: 6,
    marginBottom: 16,
  },
  offerBadge: {
    backgroundColor: "rgba(255,255,255,0.3)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignSelf: "flex-end",
  },
  offerBadgeText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  offerTitle: { color: "#fff", fontWeight: "700", fontSize: 14, textAlign: "right" },
  offerSub: { color: "rgba(255,255,255,0.85)", fontSize: 12, textAlign: "right" },
  ageScroll: { paddingHorizontal: 16, gap: 10, paddingBottom: 4 },
  ageItem: {
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
    minWidth: 80,
    marginBottom: 16,
  },
  ageIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  ageLabel: { fontSize: 13, fontWeight: "700" },
  ageSublabel: { fontSize: 10 },
  features: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 20,
  },
  featureItem: {
    width: (width - 40) / 2,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  featureText: { fontSize: 12, fontWeight: "600", textAlign: "right" },
  trustRow: {
    flexDirection: "row-reverse",
    justifyContent: "space-around",
    paddingHorizontal: 16,
    marginTop: 18,
    marginBottom: 8,
  },
  trustItem: { alignItems: "center", flex: 1, gap: 2 },
  trustIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 6,
  },
  trustTitle: { fontSize: 12, fontWeight: "700", textAlign: "center" },
  trustSubtitle: { fontSize: 10, textAlign: "center" },
  productsGrid: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 20,
  },
  horizontalScroll: {
    paddingHorizontal: 16,
    gap: 12,
    paddingBottom: 4,
    marginBottom: 20,
  },
  contactBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 16,
  },
  contactText: { flex: 1, alignItems: "flex-end" },
  contactTitle: { fontSize: 16, fontWeight: "700" },
  contactSub: { fontSize: 12, marginTop: 2 },
  genderTabsRow: {
    flexDirection: "row-reverse",
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  genderTab: {
    flex: 1,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
  },
  genderTabText: { fontSize: 14, fontWeight: "700" },
});
