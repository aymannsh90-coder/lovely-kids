import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SocialSignInButtons } from "@/components/SocialSignInButtons";
import { useAppSettings } from "@/context/AppSettingsContext";
import { useAuth } from "@/context/AuthContext";
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

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { totalItems } = useCart();
  const { count } = useWishlist();
  const { newCount, clearNew } = useNewOrders();
  const { user, loading, register, login, logout, promoteToAdmin } = useAuth();
  const { settings } = useAppSettings();

  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [adminModalVisible, setAdminModalVisible] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminError, setAdminError] = useState("");
  const [promoting, setPromoting] = useState(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  const handleAuthSubmit = async () => {
    setAuthError("");
    if (!phone.trim() || !password.trim() || (authMode === "register" && !name.trim())) {
      setAuthError("يرجى تعبئة جميع الحقول");
      return;
    }
    setSubmitting(true);
    try {
      if (authMode === "register") {
        await register(name.trim(), phone.trim(), password);
      } else {
        await login(phone.trim(), password);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setName("");
      setPhone("");
      setPassword("");
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setAuthError(e instanceof Error ? e.message : "حدث خطأ");
    } finally {
      setSubmitting(false);
    }
  };

  const openAdminUnlock = () => {
    if (!user) {
      setAuthError("يجب تسجيل الدخول أولاً للوصول لهذه الخاصية");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAdminError("");
    setAdminPassword("");
    setAdminModalVisible(true);
  };

  const handlePromote = async () => {
    if (!adminPassword.trim()) return;
    setPromoting(true);
    setAdminError("");
    try {
      await promoteToAdmin(adminPassword.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAdminModalVisible(false);
      setAdminPassword("");
      router.push("/admin/products");
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setAdminError(e instanceof Error ? e.message : "حدث خطأ");
    } finally {
      setPromoting(false);
    }
  };

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
        <Pressable
          onLongPress={openAdminUnlock}
          delayLongPress={600}
          style={styles.avatarContainer}
        >
          <Image
            source={settings.logoUrl ? { uri: settings.logoUrl } : require("@/assets/images/logo.jpg")}
            style={styles.logoImage}
            resizeMode="contain"
          />
          <Text style={styles.storeTag}>نابلس · فلسطين</Text>
        </Pressable>

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

      {/* Account Section */}
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : user ? (
        <View style={[styles.accountCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {user.avatarUrl ? (
            <Image source={{ uri: user.avatarUrl }} style={styles.accountAvatarImage} />
          ) : (
            <View style={[styles.accountAvatar, { backgroundColor: colors.primary }]}>
              <Ionicons name="person" size={24} color="#fff" />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={[styles.accountName, { color: colors.foreground }]}>{user.name}</Text>
            {user.phone ? (
              <Text style={[styles.accountPhone, { color: colors.mutedForeground }]}>{user.phone}</Text>
            ) : null}
          </View>
          <Pressable onPress={() => logout()} style={styles.logoutBtn}>
            <Ionicons name="log-out-outline" size={22} color={colors.destructive} />
          </Pressable>
        </View>
      ) : (
        <View style={[styles.authCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.authSectionLabel, { color: colors.mutedForeground }]}>
            سجّل دخولك أو أنشئ حسابك بخطوة واحدة
          </Text>

          <SocialSignInButtons />

          <View style={styles.orRow}>
            <View style={[styles.orLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.orText, { color: colors.mutedForeground }]}>
              أو سجّل برقم الهاتف
            </Text>
            <View style={[styles.orLine, { backgroundColor: colors.border }]} />
          </View>

          <View style={styles.authTabs}>
            <Pressable
              onPress={() => { setAuthMode("login"); setAuthError(""); }}
              style={[
                styles.authTab,
                authMode === "login" && { backgroundColor: colors.primary },
              ]}
            >
              <Text
                style={[
                  styles.authTabText,
                  { color: authMode === "login" ? "#fff" : colors.mutedForeground },
                ]}
              >
                تسجيل الدخول
              </Text>
            </Pressable>
            <Pressable
              onPress={() => { setAuthMode("register"); setAuthError(""); }}
              style={[
                styles.authTab,
                authMode === "register" && { backgroundColor: colors.primary },
              ]}
            >
              <Text
                style={[
                  styles.authTabText,
                  { color: authMode === "register" ? "#fff" : colors.mutedForeground },
                ]}
              >
                حساب جديد
              </Text>
            </Pressable>
          </View>

          {authMode === "register" && (
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="الاسم الكامل"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
              textAlign="right"
            />
          )}
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="رقم الهاتف"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="phone-pad"
            style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
            textAlign="right"
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="كلمة المرور"
            placeholderTextColor={colors.mutedForeground}
            secureTextEntry
            style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
            textAlign="right"
          />

          {authError ? (
            <Text style={[styles.errorText, { color: colors.destructive }]}>{authError}</Text>
          ) : null}

          <Pressable
            onPress={handleAuthSubmit}
            disabled={submitting}
            style={[styles.authSubmitBtn, { backgroundColor: colors.primary, opacity: submitting ? 0.7 : 1 }]}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.authSubmitText}>
                {authMode === "login" ? "دخول" : "إنشاء حساب"}
              </Text>
            )}
          </Pressable>
        </View>
      )}

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

      {/* Admin Card - only visible to promoted admins */}
      {user?.isAdmin && (
        <Pressable
          onPress={() => { clearNew(); router.push("/admin/products"); }}
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
            الإدارة{newCount > 0 ? ` • ${newCount} طلب جديد 🔔` : ""}
          </Text>
          <Ionicons name="arrow-back" size={18} color="#fff" />
        </Pressable>
      )}

      {/* About Card */}
      <View style={[styles.aboutCard, { backgroundColor: colors.secondary }]}>
        <Ionicons name="storefront-outline" size={32} color={colors.foreground} />
        <Text style={[styles.aboutTitle, { color: colors.foreground }]}>
          Lovely Kids - نابلس
        </Text>
        <Text style={[styles.aboutText, { color: colors.mutedForeground }]}>
          متجر متخصص في ملابس ومستلزمات الأطفال بجودة عالية وأسعار مناسبة. نوفر
          شحن مجاني لجميع الطلبات فوق 500 ₪
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

      <Modal
        visible={adminModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAdminModalVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setAdminModalVisible(false)}
        >
          <Pressable
            style={[styles.modalCard, { backgroundColor: colors.card }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Ionicons name="shield-checkmark" size={32} color={colors.primary} />
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              الوصول للإدارة
            </Text>
            <TextInput
              value={adminPassword}
              onChangeText={setAdminPassword}
              placeholder="كلمة مرور الإدارة"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry
              autoFocus
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, width: "100%" }]}
              textAlign="right"
              onSubmitEditing={handlePromote}
            />
            {adminError ? (
              <Text style={[styles.errorText, { color: colors.destructive }]}>{adminError}</Text>
            ) : null}
            <Pressable
              onPress={handlePromote}
              disabled={promoting}
              style={[styles.authSubmitBtn, { backgroundColor: colors.primary, width: "100%" }]}
            >
              {promoting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.authSubmitText}>تأكيد</Text>
              )}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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
  loadingBox: { paddingVertical: 24, alignItems: "center" },
  accountCard: {
    margin: 16,
    marginBottom: 0,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 12,
  },
  accountAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  accountAvatarImage: {
    width: 46,
    height: 46,
    borderRadius: 23,
  },
  accountName: { fontSize: 15, fontWeight: "700", textAlign: "right" },
  accountPhone: { fontSize: 13, marginTop: 2, textAlign: "right" },
  logoutBtn: { padding: 8 },
  authCard: {
    margin: 16,
    marginBottom: 0,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  authSectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 2,
  },
  authTabs: {
    flexDirection: "row-reverse",
    gap: 8,
    marginBottom: 6,
  },
  authTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  authTabText: { fontSize: 14, fontWeight: "700" },
  input: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  errorText: { fontSize: 13, fontWeight: "600", textAlign: "right" },
  orRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
    marginTop: 2,
  },
  orLine: { flex: 1, height: 1 },
  orText: { fontSize: 12, fontWeight: "600" },
  authSubmitBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  authSubmitText: { color: "#fff", fontSize: 15, fontWeight: "700" },
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
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    gap: 12,
  },
  modalTitle: { fontSize: 17, fontWeight: "800" },
});
