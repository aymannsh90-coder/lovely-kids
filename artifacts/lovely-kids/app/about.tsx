import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

export default function AboutScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 16;

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: bottomPadding }}
    >
      <View style={[styles.header, { paddingTop: topPadding + 12 }]}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-forward" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>عن المحل</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={[styles.heroBanner, { backgroundColor: colors.primary }]}>
        <Image
          source={require("@/assets/images/logo.jpg")}
          style={styles.logoImage}
          resizeMode="contain"
        />
        <Text style={styles.heroSub}>نابلس · فلسطين</Text>
        <View style={styles.statsRow}>
          {[
            { num: "+4800", label: "عميل" },
            { num: "+500", label: "منتج" },
            { num: "7+", label: "سنوات خبرة" },
          ].map((s) => (
            <View key={s.label} style={styles.statItem}>
              <Text style={styles.statNum}>{s.num}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          من نحن
        </Text>
        <Text style={[styles.text, { color: colors.mutedForeground }]}>
          Lovely Kids متجر متخصص في ملابس ومستلزمات الأطفال في مدينة نابلس.
          نقدم منتجات عالية الجودة بأسعار مناسبة لتلبية احتياجات كل مرحلة من
          مراحل نمو طفلك.{"\n\n"}
          📍 نابلس · المركز التجاري · شارع عمر المختار · طلعة بنك القدس{"\n"}
          📞 09-237-6808
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          لماذا تختارنا؟
        </Text>
        <View style={styles.features}>
          {[
            { icon: "shield-checkmark-outline" as const, title: "جودة مضمونة", desc: "منتجات مختارة بعناية من أفضل العلامات التجارية" },
            { icon: "rocket-outline" as const, title: "توصيل سريع", desc: "نوصل لجميع مناطق فلسطين بأسرع وقت" },
            { icon: "pricetag-outline" as const, title: "أسعار مناسبة", desc: "أفضل الأسعار مع ضمان الجودة العالية" },
            { icon: "refresh-outline" as const, title: "ضمان الاستبدال", desc: "إمكانية الاستبدال خلال 7 أيام من الاستلام" },
          ].map((f) => (
            <View
              key={f.title}
              style={[
                styles.featureCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={[styles.featureIcon, { backgroundColor: colors.muted }]}>
                <Ionicons name={f.icon} size={24} color={colors.primary} />
              </View>
              <View style={styles.featureText}>
                <Text style={[styles.featureTitle, { color: colors.foreground }]}>
                  {f.title}
                </Text>
                <Text style={[styles.featureDesc, { color: colors.mutedForeground }]}>
                  {f.desc}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      <Pressable
        onPress={() => router.push("/contact")}
        style={[styles.ctaBtn, { backgroundColor: colors.primary }]}
      >
        <Ionicons name="chatbubble-outline" size={20} color="#fff" />
        <Text style={styles.ctaBtnText}>تواصل معنا الآن</Text>
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
  title: { fontSize: 20, fontWeight: "800" },
  heroBanner: {
    marginHorizontal: 16,
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    gap: 8,
    marginBottom: 20,
  },
  logoImage: { width: 160, height: 80, borderRadius: 12 },
  heroSub: { fontSize: 14, color: "rgba(255,255,255,0.85)" },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    width: "100%",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.3)",
  },
  statItem: { alignItems: "center" },
  statNum: { fontSize: 22, fontWeight: "800", color: "#fff" },
  statLabel: { fontSize: 12, color: "rgba(255,255,255,0.85)", marginTop: 2 },
  section: { paddingHorizontal: 16, marginBottom: 20, gap: 12 },
  sectionTitle: { fontSize: 18, fontWeight: "700", textAlign: "right" },
  text: { fontSize: 14, textAlign: "right", lineHeight: 22 },
  features: { gap: 10 },
  featureCard: {
    flexDirection: "row-reverse",
    alignItems: "flex-start",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  featureIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: { flex: 1, alignItems: "flex-end", gap: 4 },
  featureTitle: { fontSize: 15, fontWeight: "700" },
  featureDesc: { fontSize: 13, textAlign: "right", lineHeight: 18 },
  ctaBtn: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 16,
    marginBottom: 8,
  },
  ctaBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
