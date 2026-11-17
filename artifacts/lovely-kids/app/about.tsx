import { getResponsiveTopPadding } from "@/utils/webLayout";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { API_BASE } from "@/constants/api";
import { useAppSettings } from "@/context/AppSettingsContext";
import { useAuth } from "@/context/AuthContext";

const PALETTE = {
  navy: "#17245A",
  blue: "#2379BF",
  pink: "#CC4789",
  text: "#4F627E",
  border: "#DFEAF5",
  surface: "#FFFFFF",
  background: "#FAFCFF",
} as const;

const OPENING_DATE = { year: 2018, month: 4, day: 1 } as const;
const STATS_REFRESH_MS = 10 * 60 * 1000;
type StorefrontStats = {
  visitorCount: number;
  productCount: number;
};

function validCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

// A year is counted only after April 1 has actually passed in Palestine.
function yearsSinceOpening(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const completed = year - OPENING_DATE.year
    - (month < OPENING_DATE.month || (month === OPENING_DATE.month && day < OPENING_DATE.day) ? 1 : 0);
  return Math.max(0, completed);
}

function formatStat(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("en-US").format(value);
}

const FEATURE_ICONS = [
  "shield-checkmark-outline",
  "rocket-outline",
  "pricetag-outline",
  "refresh-outline",
] as const;

export default function AboutScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { settings } = useAppSettings();
  const { user, getAuthToken } = useAuth();
  const [storeStats, setStoreStats] = useState<StorefrontStats | null>(null);
  const [ownerVisitorCount, setOwnerVisitorCount] = useState<number | null>(null);
  const [years, setYears] = useState(() => yearsSinceOpening());
  const wideLayout = width >= 850;
  const isDesktopWeb = Platform.OS === "web" && width >= 1200;
  const topPadding = isDesktopWeb ? 24 : getResponsiveTopPadding(insets.top) + 8;
  const bottomPadding = Platform.OS === "web" ? 56 : insets.bottom + 28;
  useEffect(() => {
    const interval = setInterval(() => setYears(yearsSinceOpening()), 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let active = true;
    async function refreshCounters() {
      try {
        // Only two aggregated integers are exposed; the admin analytics route
        // stays owner-only, with no visitor IDs or country breakdowns published.
        const response = await fetch(`${API_BASE}/api/storefront/stats`, {
          headers: { Accept: "application/json" },
        });
        if (response.ok) {
          const body: unknown = await response.json();
          if (
            typeof body === "object" && body !== null &&
            "visitorCount" in body && "productCount" in body &&
            validCount(body.visitorCount) && validCount(body.productCount)
          ) {
            if (active) setStoreStats({
              visitorCount: body.visitorCount,
              productCount: body.productCount,
            });
            return;
          }
        }
      } catch {
        // Preview may run before the matching Worker branch is deployed.
      }

      // Preview-only graceful fallback for a logged-in owner; no protected data
      // is sent to other visitors and no credentials are persisted.
      if (user?.isOwner) {
        try {
          const token = await getAuthToken();
          if (!token) return;
          const response = await fetch(`${API_BASE}/api/analytics/summary`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!response.ok) return;
          const body: unknown = await response.json();
          if (typeof body === "object" && body !== null && "total" in body && validCount(body.total)) {
            if (active) setOwnerVisitorCount(body.total);
          }
        } catch {
          // Keep the counter unavailable rather than inventing a visitor count.
        }
      }
    }

    void refreshCounters();
    const interval = setInterval(() => { void refreshCounters(); }, STATS_REFRESH_MS);
    return () => { active = false; clearInterval(interval); };
  }, [getAuthToken, user?.isOwner]);

  // Never display dated preview counts as if they were live figures.
  // Until the public aggregate endpoint is deployed, unavailable counts show a dash.
  const stats = [
    {
      num: formatStat(storeStats?.visitorCount ?? ownerVisitorCount),
      label: "زائر للمتجر",
    },
    {
      num: formatStat(storeStats?.productCount ?? null),
      label: "منتج مضاف",
    },
    { num: `${years}+`, label: "سنوات خبرة" },
  ];

  return (
    <ScrollView
      style={styles.scroll}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingBottom: bottomPadding },
      ]}
    >
      <View style={[styles.shell, wideLayout && styles.shellWide]}>
        <View style={[styles.header, { paddingTop: topPadding }]}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="الرجوع"
            style={styles.backButton}
          >
            <Ionicons name="arrow-forward" size={22} color={PALETTE.navy} />
          </Pressable>
          <Text style={styles.pageTitle}>عن Lovely Kids</Text>
          <View style={styles.headerSpacer} />
        </View>

        <LinearGradient
          colors={["#EAF5FF", "#FFF4F9", "#FFFFFF"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.hero,
            wideLayout ? styles.heroWide : styles.heroPhone,
          ]}
        >
          <View style={[styles.heroCopy, wideLayout && styles.heroCopyWide]}>
            <View style={styles.eyebrow}>
              <Ionicons name="heart" color={PALETTE.pink} size={15} />
              <Text style={styles.eyebrowText}>من قلب نابلس، بكل حب</Text>
            </View>
            <Text style={[styles.heroTitle, wideLayout && styles.heroTitleWide]}>
              عالم متكامل من ملابس الأطفال وتجهيز المواليد
            </Text>
            <Text style={[styles.heroDescription, wideLayout && styles.heroDescriptionWide]}>
              في Lovely Kids، نهتم بأدق التفاصيل وبنوفر أفضل الخامات عشان تختاري لطفلك ملابس ومستلزمات جميلة ومريحة بكل ثقة.
            </Text>
            <View style={styles.locationPill}>
              <Ionicons name="location-outline" color={PALETTE.blue} size={17} />
              <Text style={styles.locationText}>عنواننا نابلس - المركز التجاري - شارع عمر المختار</Text>
            </View>
          </View>

          <View style={[styles.heroArt, wideLayout && styles.heroArtWide]}>
            <View style={styles.heroArtCircle} />
            <View style={styles.heroArtDot} />
            <View style={styles.logoCard}>
              <Image
                source={require("@/assets/images/about-logo.jpg")}
                style={styles.logoImage}
                resizeMode="contain"
              />
            </View>
            <View style={styles.heroHeart}>
              <Ionicons name="heart" color={PALETTE.pink} size={20} />
            </View>
          </View>
        </LinearGradient>

        <View style={styles.statsRow}>
          {stats.map((s) => (
            <View key={s.label} style={styles.statCard}>
              <Text style={[styles.statNumber, !wideLayout && styles.statNumberPhone]}>
                {s.num}
              </Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.storyCard, wideLayout && styles.storyCardWide]}>
          <View style={styles.sectionHeading}>
            <View style={styles.sectionAccent} />
            <Text style={styles.sectionTitle}>مين إحنا؟</Text>
          </View>
          <Text style={[styles.storyText, wideLayout && styles.storyTextWide]}>
            Lovely Kids احنا متجر متخصص في ملابس ومستلزمات الأطفال في مدينة نابلس. نقدم منتجات عالية الجودة بأسعار مناسبة لتلبية احتياجات كل مرحلة من مراحل نمو طفلك.
          </Text>
          <View style={styles.contactDetails}>
            <View style={styles.detailLine}>
              <Ionicons name="location-outline" size={19} color={PALETTE.pink} />
              <Text style={styles.detailText}>نابلس · المركز التجاري · شارع عمر المختار · طلعة بنك القدس</Text>
            </View>
            <View style={styles.detailLine}>
              <Ionicons name="call-outline" size={19} color={PALETTE.blue} />
              <View style={styles.phoneLinks}>
                <Pressable
                  onPress={() => { void Linking.openURL("tel:092376808"); }}
                  accessibilityRole="link"
                  accessibilityLabel="الاتصال على الهاتف الأرضي 092376808"
                  style={styles.phoneLink}
                >
                  <Text style={styles.phoneLinkText}>092376808</Text>
                </Pressable>
                <Text style={styles.phoneSeparator}>·</Text>
                <Pressable
                  onPress={() => { void Linking.openURL("tel:0595266731"); }}
                  accessibilityRole="link"
                  accessibilityLabel="الاتصال على الجوال 0595266731"
                  style={styles.phoneLink}
                >
                  <Text style={styles.phoneLinkText}>جوال 0595266731</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.whySection}>
          <View style={styles.sectionHeading}>
            <View style={styles.sectionAccent} />
            <Text style={styles.sectionTitle}>ليش تختاري Lovely Kids؟</Text>
          </View>
          <Text style={styles.sectionSubtitle}>
            نهتم بجودة المنتجات وراحتك بكل خطوة من تجربة التسوق.
          </Text>

          <View style={[styles.features, wideLayout && styles.featuresWide]}>
            {settings.aboutInfo.features.map((feature, index) => (
              <View
                key={`${feature.title}-${index}`}
                style={[styles.featureCard, wideLayout && styles.featureCardWide]}
              >
                <View
                  style={[
                    styles.featureIcon,
                    {
                      backgroundColor:
                        index % 2 === 0 ? "#E9F5FF" : "#FFF0F6",
                    },
                  ]}
                >
                  <Ionicons
                    name={FEATURE_ICONS[index % FEATURE_ICONS.length]}
                    size={24}
                    color={index % 2 === 0 ? PALETTE.blue : PALETTE.pink}
                  />
                </View>
                <View style={styles.featureText}>
                  <Text style={styles.featureTitle}>{feature.title}</Text>
                  <Text style={styles.featureDescription}>{feature.desc}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={[styles.contactStrip, wideLayout && styles.contactStripWide]}>
          <View style={styles.contactCopy}>
            <Text style={styles.contactTitle}>عندك سؤال؟ إحنا هون لمساعدتك</Text>
            <Text style={styles.contactSub}>تواصلي معنا، وبنساعدك تختاري الأنسب لطفلك.</Text>
          </View>
          <Pressable
            onPress={() => router.push("/contact")}
            accessibilityRole="button"
            style={styles.contactButton}
          >
            <Text style={styles.contactButtonText}>تواصلي معنا</Text>
            <Ionicons name="arrow-back" size={18} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: PALETTE.background },
  scrollContent: { alignItems: "center" },
  shell: {
    width: "100%",
    maxWidth: 1100,
    paddingHorizontal: 16,
  },
  shellWide: { paddingHorizontal: 24 },
  header: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 20,
  },
  pageTitle: {
    color: PALETTE.navy,
    fontSize: 23,
    fontWeight: "800",
    textAlign: "center",
  },
  backButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderColor: PALETTE.border,
    borderWidth: 1,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
  },
  headerSpacer: { width: 42 },
  hero: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "#DDEDF9",
    overflow: "hidden",
    minHeight: 280,
  },
  heroWide: {
    flexDirection: "row-reverse",
    alignItems: "center",
    paddingHorizontal: 48,
    paddingVertical: 32,
    gap: 22,
  },
  heroPhone: {
    alignItems: "center",
    paddingHorizontal: 21,
    paddingTop: 31,
    paddingBottom: 23,
    gap: 14,
  },
  heroCopy: { alignItems: "flex-end", gap: 15, width: "100%" },
  heroCopyWide: { flex: 1, width: undefined, gap: 18 },
  eyebrow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFFFFF",
    borderRadius: 30,
    paddingHorizontal: 15,
    paddingVertical: 9,
  },
  eyebrowText: {
    color: PALETTE.pink,
    fontSize: 14,
    fontWeight: "700",
  },
  heroTitle: {
    width: "100%",
    color: PALETTE.navy,
    fontSize: 29,
    lineHeight: 41,
    fontWeight: "800",
    textAlign: "right",
  },
  heroTitleWide: { fontSize: 36, lineHeight: 50 },
  heroDescription: {
    width: "100%",
    color: PALETTE.text,
    fontSize: 16,
    lineHeight: 28,
    textAlign: "right",
  },
  heroDescriptionWide: { fontSize: 18, lineHeight: 32 },
  locationPill: {
    flexDirection: "row-reverse",
    gap: 7,
    alignItems: "center",
    alignSelf: "stretch",
  },
  locationText: {
    color: PALETTE.navy,
    fontSize: 14,
    fontWeight: "600",
    flexShrink: 1,
    lineHeight: 22,
    textAlign: "right",
  },
  heroArt: {
    width: 190,
    height: 160,
    alignItems: "center",
    justifyContent: "center",
  },
  heroArtWide: { width: 290, height: 270, flexShrink: 0 },
  heroArtCircle: {
    position: "absolute",
    width: "90%",
    height: "98%",
    borderRadius: 140,
    backgroundColor: "#D2EAFD",
    opacity: 0.8,
  },
  heroArtDot: {
    position: "absolute",
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFD9EA",
    top: 5,
    left: 5,
  },
  logoCard: {
    width: "72%",
    aspectRatio: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 15,
    shadowColor: "#1D4C75",
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  logoImage: { width: "100%", height: "100%", borderRadius: 12 },
  heroHeart: {
    position: "absolute",
    right: 8,
    bottom: 9,
    width: 43,
    height: 43,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  statsRow: {
    flexDirection: "row-reverse",
    gap: 12,
    marginTop: 16,
    marginBottom: 34,
  },
  statCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: PALETTE.surface,
    borderWidth: 1,
    borderColor: PALETTE.border,
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  statNumber: {
    color: PALETTE.blue,
    fontSize: 28,
    lineHeight: 36,
    fontWeight: "800",
  },
  statNumberPhone: { fontSize: 22, lineHeight: 30 },
  statLabel: {
    color: PALETTE.text,
    fontSize: 12,
    lineHeight: 19,
    fontWeight: "600",
    textAlign: "center",
  },
  storyCard: {
    backgroundColor: "#FFFFFF",
    borderColor: PALETTE.border,
    borderWidth: 1,
    borderRadius: 24,
    padding: 22,
    marginBottom: 34,
    gap: 15,
  },
  storyCardWide: { paddingHorizontal: 32, paddingVertical: 28 },
  sectionHeading: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 11,
  },
  sectionAccent: {
    backgroundColor: PALETTE.pink,
    width: 5,
    height: 27,
    borderRadius: 4,
  },
  sectionTitle: {
    color: PALETTE.navy,
    textAlign: "right",
    fontSize: 22,
    fontWeight: "800",
  },
  storyText: {
    width: "100%",
    color: PALETTE.text,
    textAlign: "right",
    writingDirection: "rtl",
    fontSize: 16,
    lineHeight: 29,
  },
  storyTextWide: { fontSize: 18, lineHeight: 33 },
  contactDetails: { gap: 13, paddingTop: 10 },
  detailLine: {
    flexDirection: "row-reverse",
    gap: 10,
    alignItems: "center",
  },
  detailText: {
    color: PALETTE.text,
    fontSize: 15,
    lineHeight: 25,
    textAlign: "right",
    flexShrink: 1,
  },
  phoneLinks: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 8,
  },
  phoneLink: {
    paddingVertical: 5,
    paddingHorizontal: 7,
    borderRadius: 8,
    backgroundColor: "#EAF5FF",
  },
  phoneLinkText: {
    color: PALETTE.blue,
    fontSize: 15,
    lineHeight: 24,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
  phoneSeparator: { color: PALETTE.text, fontSize: 16 },
  whySection: { marginBottom: 32, gap: 12 },
  sectionSubtitle: {
    color: PALETTE.text,
    fontSize: 15,
    textAlign: "right",
    lineHeight: 25,
    marginBottom: 8,
  },
  features: { gap: 14 },
  featuresWide: { flexDirection: "row-reverse", flexWrap: "wrap" },
  featureCard: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 14,
    padding: 18,
    borderRadius: 18,
    borderColor: PALETTE.border,
    borderWidth: 1,
    backgroundColor: "#FFFFFF",
  },
  featureCardWide: { width: "48.5%", flexGrow: 1 },
  featureIcon: {
    width: 54,
    height: 54,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: { flex: 1, gap: 5, alignItems: "flex-end" },
  featureTitle: {
    color: PALETTE.navy,
    fontSize: 16,
    textAlign: "right",
    fontWeight: "800",
  },
  featureDescription: {
    color: PALETTE.text,
    fontSize: 14,
    lineHeight: 23,
    textAlign: "right",
  },
  contactStrip: {
    backgroundColor: "#E9F5FF",
    borderRadius: 22,
    padding: 22,
    gap: 18,
    alignItems: "stretch",
  },
  contactStripWide: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
  },
  contactCopy: { flex: 1, gap: 6, alignItems: "flex-end" },
  contactTitle: {
    color: PALETTE.navy,
    fontSize: 18,
    fontWeight: "800",
    textAlign: "right",
  },
  contactSub: {
    color: PALETTE.text,
    fontSize: 14,
    lineHeight: 23,
    textAlign: "right",
  },
  contactButton: {
    backgroundColor: PALETTE.blue,
    borderRadius: 14,
    paddingHorizontal: 22,
    paddingVertical: 14,
    flexDirection: "row-reverse",
    justifyContent: "center",
    alignItems: "center",
    gap: 9,
  },
  contactButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
});
