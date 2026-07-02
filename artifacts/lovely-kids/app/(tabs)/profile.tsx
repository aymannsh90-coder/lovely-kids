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

import { useCart } from "@/context/CartContext";
import { useWishlist } from "@/context/WishlistContext";
import { useNewOrders } from "@/context/NewOrdersContext";
import { useColors } from "@/hooks/useColors";

const MENU_ITEMS = [
  { icon: "bag-outline" as const, label: "طلباتي", route: "/cart" as const },
  { icon: "heart-outline" as const, label: "المفضلة", route: "/wishlist" as const },
  { icon: "call-outline" as const, label: "تواصل معنا", route: "/contact" as const },
  { icon: "information-circle-outline" as const, label: "عن المحل", route: "/about" as const },
];

const ADMIN_ITEMS = [
  { icon: "shield-checkmark-outline" as const, label: "لوحة الإدارة", route: "/admin" as const },
];

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { totalItems } = useCart();
  const { count } = useWishlist();
  const { newCount, clearNew } = useNewOrders();

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.background }]}
      contentContainerStyle={{
        paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 16,
      }}
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingTop: topPadding + 12, backgroundColor: colors.primary },
        ]}
      >
        <View style={styles.avatarContainer}>
          <Image
            source={require("@/assets/images/logo.jpg")}
            style={styles.logoImage}
            resizeMode="contain"
          />
          <Text style={styles.storeTag}>نابلس · فلسطين</Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statNum}>{totalItems}</Text>
            <Text style={styles.statLabel}>في السلة</Text>
          </View>
          <View style={[styles.divider, { backgroundColor: "rgba(255,255,255,0.3)" }]} />
          <View style={styles.statItem}>
            <Text style={styles.statNum}>{count}</Text>
            <Text style={styles.statLabel}>المفضلة</Text>
          </View>
          <View style={[styles.divider, { backgroundColor: "rgba(255,255,255,0.3)" }]} />
          <View style={styles.statItem}>
            <Text style={styles.statNum}>+4800</Text>
            <Text style={styles.statLabel}>عميل</Text>
          </View>
        </View>
      </View>

      {/* Menu */}
      <View style={[styles.menuCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {MENU_ITEMS.map((item, idx) => (
          <React.Fragment key={item.label}>
            <Pressable
              onPress={() => router.push(item.route)}
              style={({ pressed }) => [
                styles.menuItem,
                pressed && { backgroundColor: colors.muted },
              ]}
            >
              <Ionicons name="chevron-back" size={18} color={colors.mutedForeground} />
              <Text style={[styles.menuLabel, { color: colors.foreground }]}>
                {item.label}
              </Text>
              <View style={[styles.menuIcon, { backgroundColor: colors.muted }]}>
                <Ionicons name={item.icon} size={20} color={colors.primary} />
              </View>
            </Pressable>
            {idx < MENU_ITEMS.length - 1 && (
              <View style={[styles.separator, { backgroundColor: colors.border }]} />
            )}
          </React.Fragment>
        ))}
      </View>

      {/* Admin Card */}
      <Pressable
        onPress={() => { clearNew(); router.push("/admin"); }}
        style={[styles.adminCard, { backgroundColor: colors.primary }]}
      >
        <View style={{ position: "relative" }}>
          <Ionicons name="shield-checkmark-outline" size={24} color="#fff" />
          {newCount > 0 && (
            <View style={styles.newOrdersBadge}>
              <Text style={styles.newOrdersBadgeText}>{newCount}</Text>
            </View>
          )}
        </View>
        <Text style={styles.adminCardText}>
          لوحة الإدارة{newCount > 0 ? ` • ${newCount} طلب جديد 🔔` : ""}
        </Text>
        <Ionicons name="arrow-back" size={18} color="#fff" />
      </Pressable>

      {/* About Card */}
      <View style={[styles.aboutCard, { backgroundColor: colors.secondary }]}>
        <Ionicons name="storefront-outline" size={32} color={colors.foreground} />
        <Text style={[styles.aboutTitle, { color: colors.foreground }]}>
          Lovely Kids - نابلس
        </Text>
        <Text style={[styles.aboutText, { color: colors.mutedForeground }]}>
          متجر متخصص في ملابس ومستلزمات الأطفال بجودة عالية وأسعار مناسبة. نوفر
          شحن مجاني لجميع الطلبات فوق 200 ₪
        </Text>
        <Pressable
          onPress={() => router.push("/contact")}
          style={[styles.contactBtn, { backgroundColor: colors.foreground }]}
        >
          <Text style={[styles.contactBtnText, { color: colors.background }]}>
            تواصل معنا
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  header: {
    paddingBottom: 24,
    paddingHorizontal: 16,
  },
  avatarContainer: { alignItems: "center", paddingTop: 16, gap: 8 },
  logoImage: { width: 140, height: 70, borderRadius: 12 },
  storeTag: { fontSize: 13, color: "rgba(255,255,255,0.85)" },
  statsRow: {
    flexDirection: "row-reverse",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 20,
    gap: 0,
  },
  statItem: { alignItems: "center", flex: 1 },
  statNum: { fontSize: 20, fontWeight: "800", color: "#fff" },
  statLabel: { fontSize: 11, color: "rgba(255,255,255,0.85)", marginTop: 2 },
  divider: { width: 1, height: 36 },
  menuCard: {
    margin: 16,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  menuItem: {
    flexDirection: "row-reverse",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  menuIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  menuLabel: { flex: 1, fontSize: 15, fontWeight: "600", textAlign: "right" },
  separator: { height: 1, marginHorizontal: 16 },
  adminCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 16,
  },
  adminCardText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
    textAlign: "right",
  },
  newOrdersBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    backgroundColor: "#ef4444",
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  newOrdersBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "800",
  },
  aboutCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    gap: 8,
  },
  aboutTitle: { fontSize: 16, fontWeight: "700" },
  aboutText: { fontSize: 13, textAlign: "center", lineHeight: 20 },
  contactBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 24,
    marginTop: 8,
  },
  contactBtnText: { fontSize: 14, fontWeight: "700" },
});
