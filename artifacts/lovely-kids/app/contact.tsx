import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

const PHONE = "0092376808";
const WHATSAPP_NUM = "97292376808";
const FACEBOOK = "https://www.facebook.com/lovely.kids.nablus1";
const INSTAGRAM = "https://www.instagram.com/lovely.kids.nablus";
const TIKTOK = "https://www.tiktok.com/@lovely_kids_nablus";
const MAPS = "https://google.com/maps?cid=10801481858754571229";

export default function ContactScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 16;

  const openWhatsapp = () => {
    Linking.openURL(`https://wa.me/${WHATSAPP_NUM}?text=مرحباً، أريد الاستفسار عن منتج`);
  };

  const openPhone = () => {
    Linking.openURL(`tel:${PHONE}`);
  };

  const openFacebook = () => {
    Linking.openURL(FACEBOOK);
  };

  const openInstagram = () => {
    Linking.openURL(INSTAGRAM);
  };

  const openTiktok = () => {
    Linking.openURL(TIKTOK);
  };

  const openMaps = () => {
    Linking.openURL(MAPS);
  };

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: bottomPadding }}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12 }]}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-forward" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>تواصل معنا</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Hero */}
      <View style={[styles.hero, { backgroundColor: colors.primary }]}>
        <Ionicons name="storefront-outline" size={48} color="#fff" />
        <Text style={styles.heroTitle}>Lovely Kids</Text>
        <Text style={styles.heroSub}>نابلس · فلسطين</Text>
        <Text style={styles.heroTagline}>كل ما يحتاجه طفلك في مكان واحد</Text>
      </View>

      {/* Direct Contact */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          تواصل مباشر
        </Text>

        <Pressable onPress={openWhatsapp} style={[styles.contactCard, { backgroundColor: "#25D366" }]}>
          <Ionicons name="logo-whatsapp" size={28} color="#fff" />
          <View style={styles.contactInfo}>
            <Text style={styles.contactLabel}>واتساب</Text>
            <Text style={styles.contactValue}>09-237-6808</Text>
          </View>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </Pressable>

        <Pressable onPress={openPhone} style={[styles.contactCard, { backgroundColor: colors.secondary }]}>
          <Ionicons name="call-outline" size={28} color={colors.foreground} />
          <View style={styles.contactInfo}>
            <Text style={[styles.contactLabel, { color: colors.foreground }]}>اتصال مباشر</Text>
            <Text style={[styles.contactValue, { color: colors.foreground }]}>09-237-6808</Text>
          </View>
          <Ionicons name="arrow-back" size={20} color={colors.foreground} />
        </Pressable>
      </View>

      {/* Social Media */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          تابعنا على السوشيال ميديا
        </Text>
        <View style={styles.socialRow}>
          <Pressable
            onPress={openFacebook}
            style={[styles.socialBtn, { backgroundColor: "#1877F2" }]}
          >
            <Ionicons name="logo-facebook" size={26} color="#fff" />
            <Text style={styles.socialLabel}>فيس بوك</Text>
          </Pressable>
          <Pressable
            onPress={openInstagram}
            style={[styles.socialBtn, { backgroundColor: "#E1306C" }]}
          >
            <Ionicons name="logo-instagram" size={26} color="#fff" />
            <Text style={styles.socialLabel}>انستجرام</Text>
          </Pressable>
          <Pressable
            onPress={openTiktok}
            style={[styles.socialBtn, { backgroundColor: "#010101" }]}
          >
            <Ionicons name="logo-tiktok" size={26} color="#fff" />
            <Text style={styles.socialLabel}>تيك توك</Text>
          </Pressable>
        </View>
      </View>

      {/* Info Cards */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          معلومات المتجر
        </Text>

        <Pressable
          onPress={openMaps}
          style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View style={[styles.infoIcon, { backgroundColor: colors.muted }]}>
            <Ionicons name="location-outline" size={22} color={colors.primary} />
          </View>
          <View style={styles.infoContent}>
            <Text style={[styles.infoTitle, { color: colors.foreground }]}>الموقع</Text>
            <Text style={[styles.infoValue, { color: colors.mutedForeground }]}>
              نابلس · المركز التجاري{"\n"}شارع عمر المختار · طلعة بنك القدس
            </Text>
            <Text style={[styles.mapsLink, { color: colors.primary }]}>اضغط لفتح الخريطة</Text>
          </View>
          <Ionicons name="chevron-back" size={16} color={colors.mutedForeground} />
        </Pressable>

        {[
          {
            icon: "time-outline" as const,
            title: "ساعات العمل",
            value: "السبت - الخميس\n9:00 صباحاً - 9:00 مساءً",
          },
          {
            icon: "rocket-outline" as const,
            title: "الشحن",
            value: "توصيل سريع لجميع المناطق\nشحن مجاني فوق 200 ₪",
          },
          {
            icon: "refresh-outline" as const,
            title: "سياسة الإرجاع",
            value: "إمكانية الاستبدال خلال 7 أيام\nبالبضاعة سليمة",
          },
        ].map((item) => (
          <View
            key={item.title}
            style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={[styles.infoIcon, { backgroundColor: colors.muted }]}>
              <Ionicons name={item.icon} size={22} color={colors.primary} />
            </View>
            <View style={styles.infoContent}>
              <Text style={[styles.infoTitle, { color: colors.foreground }]}>{item.title}</Text>
              <Text style={[styles.infoValue, { color: colors.mutedForeground }]}>{item.value}</Text>
            </View>
          </View>
        ))}
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
    paddingBottom: 12,
  },
  title: { fontSize: 20, fontWeight: "800" },
  hero: {
    marginHorizontal: 16,
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    gap: 8,
    marginBottom: 20,
  },
  heroTitle: { fontSize: 26, fontWeight: "800", color: "#fff" },
  heroSub: { fontSize: 14, color: "rgba(255,255,255,0.85)" },
  heroTagline: { fontSize: 13, color: "rgba(255,255,255,0.8)", textAlign: "center" },
  section: { paddingHorizontal: 16, marginBottom: 20, gap: 12 },
  sectionTitle: { fontSize: 17, fontWeight: "700", textAlign: "right" },
  contactCard: {
    flexDirection: "row-reverse",
    alignItems: "center",
    padding: 16,
    borderRadius: 16,
    gap: 12,
  },
  contactInfo: { flex: 1, alignItems: "flex-end" },
  contactLabel: { fontSize: 14, fontWeight: "700", color: "#fff" },
  contactValue: { fontSize: 16, fontWeight: "800", color: "#fff", marginTop: 2 },
  socialRow: { flexDirection: "row-reverse", gap: 10 },
  socialBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 14,
    gap: 6,
  },
  socialLabel: { color: "#fff", fontSize: 12, fontWeight: "700" },
  infoCard: {
    flexDirection: "row-reverse",
    alignItems: "flex-start",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  infoIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  infoContent: { flex: 1, alignItems: "flex-end", gap: 4 },
  infoTitle: { fontSize: 14, fontWeight: "700" },
  infoValue: { fontSize: 13, textAlign: "right", lineHeight: 20 },
  mapsLink: { fontSize: 12, fontWeight: "600" },
});
