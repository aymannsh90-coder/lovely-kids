import { getResponsiveTopPadding } from "@/utils/webLayout";
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

import { useAppSettings } from "@/context/AppSettingsContext";
import { useColors } from "@/hooks/useColors";

const FEATURE_ICONS = [
  "shield-checkmark-outline",
  "rocket-outline",
  "pricetag-outline",
  "refresh-outline",
] as const;

export default function AboutScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings } = useAppSettings();

  const topPadding = getResponsiveTopPadding(insets.top);
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

      <View style={[styles.heroBanner, { backgroundColor: colors.muted, borderColor: colors.border }]}>
        <View style={styles.logoFrame}>
          <Image
            source={settings.logoUrl ? { uri: settings.logoUrl } : require("@/assets/images/logo.jpg")}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </View>
        <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>نابلس · فلسطين</Text>
        <Text style={[styles.heroHeadline, { color: colors.foreground }]}>كل ما يحتاجه طفلك، بكل حب</Text>
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
          {settings.aboutInfo.intro}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          لماذا تختارنا؟
        </Text>
        <View style={styles.features}>
          {settings.aboutInfo.features.map((f, index) => (
            <View
              key={`${f.title}-${index}`}
              style={[
                styles.featureCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={[styles.featureIcon, { backgroundColor: index % 2 === 0 ? colors.muted : colors.accent }]}>
                <Ionicons
                  name={FEATURE_ICONS[index % FEATURE_ICONS.length]}
                  size={24}
                  color={index % 2 === 0 ? colors.primary : "#C83479"}
                />
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
        <Text style={styles.ctaBtnText}>للتواصل معنا</Text>
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
    paddingHorizontal: 20,
    paddingBottom: 18,
  },
  title: { fontSize: 21, fontWeight: "800" },
  heroBanner: {
    marginHorizontal: 16,
    borderWidth: 1,
    borderRadius: 26,
    paddingHorizontal: 18,
    paddingVertical: 26,
    alignItems: "center",
    gap: 9,
    marginBottom: 28,
  },
  logoFrame: {
    backgroundColor: "#FFFFFF",
    borderColor: "#DFECF6",
    borderWidth: 1,
    borderRadius: 22,
    padding: 12,
    marginBottom: 6,
  },
  logoImage: { width: 138, height: 120, borderRadius: 12 },
  heroSub: { fontSize: 14, fontWeight: "600" },
  heroHeadline: { fontSize: 18, fontWeight: "800", textAlign: "center" },
  statsRow: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    width: "100%",
    gap: 8,
    marginTop: 16,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#DCEAF5",
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 13,
    paddingHorizontal: 2,
  },
  statNum: { fontSize: 21, fontWeight: "800", color: "#2379BF" },
  statLabel: { fontSize: 11, color: "#65748C", marginTop: 5 },
  section: { paddingHorizontal: 18, marginBottom: 27, gap: 14 },
  sectionTitle: { fontSize: 20, fontWeight: "800", textAlign: "right" },
  text: { fontSize: 15, textAlign: "right", lineHeight: 27 },
  features: { gap: 12 },
  featureCard: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    padding: 15,
    borderRadius: 18,
    borderWidth: 1,
    gap: 13,
  },
  featureIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: {
    flex: 1,
    alignItems: Platform.OS === "web" ? "flex-end" : "flex-start",
    gap: 5,
  },
  featureTitle: { fontSize: 15, fontWeight: "800", textAlign: "right" },
  featureDesc: { fontSize: 13, textAlign: "right", lineHeight: 20 },
  ctaBtn: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginHorizontal: 18,
    paddingVertical: 16,
    borderRadius: 18,
    marginBottom: 12,
  },
  ctaBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
