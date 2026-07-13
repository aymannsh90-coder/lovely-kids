import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Image,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppSettings } from "@/context/AppSettingsContext";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { useWishlist } from "@/context/WishlistContext";
import { useNewOrders } from "@/context/NewOrdersContext";
import { useColors } from "@/hooks/useColors";

const MENU_ITEMS = [
  { icon: "bag-outline" as const, label: "متابعة طلباتي", route: "/my-orders" as const },
  { icon: "heart-outline" as const, label: "المفضلة", route: "/wishlist" as const },
  { icon: "call-outline" as const, label: "تواصل معنا", route: "/contact" as const },
  { icon: "information-circle-outline" as const, label: "عن المحل", route: "/about" as const },
];

type AuthMode = "login" | "register";
type ForgotStep = null | "phone" | "sent";

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { totalItems } = useCart();
  const { count } = useWishlist();
  const { newCount, clearNew } = useNewOrders();
  const {
    user,
    loading,
    register,
    login,
    logout,
    promoteToAdmin,
    updateProfile,
    pendingVerification,
    verifyEmail,
  } = useAuth();
  const { settings } = useAppSettings();
  // ─── Auth form state ─────────────────────────────────────────────
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [authError, setAuthError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // ─── Forgot password state ────────────────────────────────────────
  const [forgotStep, setForgotStep] = useState<ForgotStep>(null);
  const [forgotPhone, setForgotPhone] = useState("");
  const [forgotError, setForgotError] = useState("");

  // ─── Admin unlock state ───────────────────────────────────────────
  const [adminModalVisible, setAdminModalVisible] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminError, setAdminError] = useState("");
  const [promoting, setPromoting] = useState(false);

  // ─── Edit profile state ───────────────────────────────────────────
  const [editProfileVisible, setEditProfileVisible] = useState(false);
  const [editName, setEditName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  // ─── Auth submit ──────────────────────────────────────────────────
  const handleAuthSubmit = async () => {
    setAuthError("");

    if (pendingVerification) {
      if (!verifyCode.trim()) { setAuthError("يرجى إدخال رمز التحقق"); return; }
      setSubmitting(true);
      try {
        await verifyEmail(verifyCode.trim());
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setVerifyCode("");
      } catch (e) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setAuthError(e instanceof Error ? e.message : "رمز التحقق غير صحيح");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (authMode === "register") {
      if (!name.trim() || !phone.trim() || !email.trim() || !password) {
        setAuthError("يرجى تعبئة جميع الحقول");
        return;
      }
      setSubmitting(true);
      try {
        await register(name.trim(), phone.trim(), email.trim(), password);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setName(""); setPhone(""); setEmail(""); setPassword("");
      } catch (e) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setAuthError(e instanceof Error ? e.message : "حدث خطأ");
      } finally {
        setSubmitting(false);
      }
    } else {
      if (!phone.trim() || !password) {
        setAuthError("يرجى تعبئة جميع الحقول");
        return;
      }
      setSubmitting(true);
      try {
        await login(phone.trim(), password);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setPhone(""); setPassword("");
      } catch (e) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setAuthError(e instanceof Error ? e.message : "حدث خطأ");
      } finally {
        setSubmitting(false);
      }
    }
  };

  // ─── Forgot password (placeholder — shows info message only) ─────
  const handleForgotSubmit = () => {
    if (!forgotPhone.trim()) { setForgotError("يرجى إدخال رقم الجوال"); return; }
    setForgotError("");
    setForgotStep("sent");
  };

  const closeForgot = () => {
    setForgotStep(null);
    setForgotPhone("");
    setForgotError("");
  };

  // ─── Admin unlock ─────────────────────────────────────────────────
  const openAdminUnlock = () => {
    if (!user) { setAuthError("يجب تسجيل الدخول أولاً"); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAdminError(""); setAdminPassword(""); setAdminModalVisible(true);
  };

  const handlePromote = async () => {
    if (!adminPassword.trim()) return;
    setPromoting(true); setAdminError("");
    try {
      await promoteToAdmin(adminPassword.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAdminModalVisible(false); setAdminPassword("");
      router.push("/admin/products");
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setAdminError(e instanceof Error ? e.message : "حدث خطأ");
    } finally {
      setPromoting(false);
    }
  };

  // ─── Edit profile ─────────────────────────────────────────────────
  const openEditProfile = () => {
    setEditName(user?.name ?? "");
    setEditAddress(user?.deliveryAddress ?? "");
    setEditError(""); setEditProfileVisible(true);
  };

  const handleSaveProfile = async () => {
    setEditError("");
    if (!editName.trim()) { setEditError("الاسم مطلوب"); return; }
    setEditSaving(true);
    try {
      await updateProfile({ name: editName.trim(), deliveryAddress: editAddress.trim() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditProfileVisible(false);
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setEditError(e instanceof Error ? e.message : "حدث خطأ");
    } finally {
      setEditSaving(false);
    }
  };

  // ─── Auth form section ────────────────────────────────────────────
  const renderAuthForm = () => {
    // Step 2 of registration: email verification
    if (pendingVerification) {
      return (
        <View style={[styles.authCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="mail-open-outline" size={36} color={colors.primary} style={{ alignSelf: "center" }} />
          <Text style={[styles.authSectionLabel, { color: colors.foreground, fontWeight: "700" }]}>
            تحقق من بريدك الإلكتروني
          </Text>
          <Text style={[styles.authSectionLabel, { color: colors.mutedForeground }]}>
            تم إرسال رمز تحقق إلى بريدك. أدخله أدناه:
          </Text>

          <TextInput
            value={verifyCode}
            onChangeText={setVerifyCode}
            placeholder="رمز التحقق"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="number-pad"
            style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
            textAlign="center"
            autoFocus
          />

          {authError ? (
            <Text style={[styles.errorText, { color: colors.destructive }]}>{authError}</Text>
          ) : null}

          <Pressable
            onPress={handleAuthSubmit}
            disabled={submitting}
            style={[styles.authSubmitBtn, { backgroundColor: colors.primary, opacity: submitting ? 0.7 : 1 }]}
          >
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.authSubmitText}>تأكيد</Text>}
          </Pressable>
        </View>
      );
    }

    return (
      <View style={[styles.authCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.authSectionLabel, { color: colors.mutedForeground }]}>
          سجّل دخولك أو أنشئ حسابك
        </Text>

        <View style={styles.authTabs}>
          <Pressable
            onPress={() => { setAuthMode("login"); setAuthError(""); setPhone(""); setPassword(""); }}
            style={[styles.authTab, authMode === "login" && { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.authTabText, { color: authMode === "login" ? "#fff" : colors.mutedForeground }]}>
              تسجيل الدخول
            </Text>
          </Pressable>
          <Pressable
            onPress={() => { setAuthMode("register"); setAuthError(""); setPhone(""); setPassword(""); }}
            style={[styles.authTab, authMode === "register" && { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.authTabText, { color: authMode === "register" ? "#fff" : colors.mutedForeground }]}>
              حساب جديد
            </Text>
          </Pressable>
        </View>

        {authMode === "register" ? (
          <>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="الاسم الكامل"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
              textAlign="right"
            />
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="رقم الجوال (مثال: 0591234567)"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="phone-pad"
              style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
              textAlign="right"
            />
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="البريد الإلكتروني"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="email-address"
              autoCapitalize="none"
              style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
              textAlign="right"
            />
          </>
        ) : (
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="رقم الجوال (مثال: 0591234567)"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="phone-pad"
            style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
            textAlign="right"
          />
        )}

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

        {authMode === "login" && (
          <Pressable onPress={() => { setForgotStep("phone"); setForgotPhone(""); setForgotError(""); }}>
            <Text style={[styles.forgotLink, { color: colors.primary }]}>نسيت كلمة المرور؟</Text>
          </Pressable>
        )}
      </View>
    );
  };

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.background }]}
      contentContainerStyle={{
        paddingBottom: Platform.OS === "web" ? 100 : insets.bottom + 80,
      }}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12, backgroundColor: colors.primary }]}>
        <Pressable onLongPress={openAdminUnlock} delayLongPress={600} style={styles.avatarContainer}>
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

      {/* Account section */}
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : user ? (
        <>
          {/* User Info Card */}
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
              ) : user.email ? (
                <Text style={[styles.accountPhone, { color: colors.mutedForeground }]}>{user.email}</Text>
              ) : null}
            </View>
            <Pressable onPress={() => logout()} style={styles.logoutBtn}>
              <Ionicons name="log-out-outline" size={22} color={colors.destructive} />
            </Pressable>
          </View>

          {/* Personal Details Card */}
          <View style={[styles.detailsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.detailsHeader}>
              <Pressable onPress={openEditProfile} style={[styles.editBtn, { backgroundColor: colors.primary + "18" }]}>
                <Ionicons name="create-outline" size={16} color={colors.primary} />
                <Text style={[styles.editBtnText, { color: colors.primary }]}>تعديل</Text>
              </Pressable>
              <Text style={[styles.detailsTitle, { color: colors.foreground }]}>بياناتي الشخصية</Text>
            </View>

            <View style={[styles.detailRow, { borderTopColor: colors.border }]}>
              <Text style={[styles.detailValue, { color: colors.foreground }]}>{user.name}</Text>
              <View style={styles.detailLabelRow}>
                <Ionicons name="person-outline" size={15} color={colors.mutedForeground} />
                <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>الاسم</Text>
              </View>
            </View>

            {user.phone ? (
              <View style={[styles.detailRow, { borderTopColor: colors.border }]}>
                <Text style={[styles.detailValue, { color: colors.foreground }]}>{user.phone}</Text>
                <View style={styles.detailLabelRow}>
                  <Ionicons name="call-outline" size={15} color={colors.mutedForeground} />
                  <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>رقم الهاتف</Text>
                </View>
              </View>
            ) : null}

            {user.email ? (
              <View style={[styles.detailRow, { borderTopColor: colors.border }]}>
                <Text style={[styles.detailValue, { color: colors.foreground }]}>{user.email}</Text>
                <View style={styles.detailLabelRow}>
                  <Ionicons name="mail-outline" size={15} color={colors.mutedForeground} />
                  <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>البريد الإلكتروني</Text>
                </View>
              </View>
            ) : null}

            <View style={[styles.detailRow, { borderTopColor: colors.border }]}>
              {user.deliveryAddress ? (
                <Text style={[styles.detailValue, { color: colors.foreground }]}>{user.deliveryAddress}</Text>
              ) : (
                <Pressable onPress={openEditProfile}>
                  <Text style={[styles.detailValueEmpty, { color: colors.primary }]}>+ أضف عنوان التوصيل</Text>
                </Pressable>
              )}
              <View style={styles.detailLabelRow}>
                <Ionicons name="location-outline" size={15} color={colors.mutedForeground} />
                <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>عنوان التوصيل</Text>
              </View>
            </View>
          </View>

        </>
      ) : (
        renderAuthForm()
      )}

      {/* Menu */}
      <View style={[styles.menuCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {MENU_ITEMS.map((item, idx) => (
          <React.Fragment key={item.label}>
            <Pressable
              onPress={() => router.push(item.route)}
              style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: colors.muted }]}
            >
              <Ionicons name="chevron-back" size={18} color={colors.mutedForeground} />
              <Text style={[styles.menuLabel, { color: colors.foreground }]}>{item.label}</Text>
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
          {settings.contactInfo?.storeName ?? "Lovely Kids"}
        </Text>
        {(settings.aboutInfo?.intro ?? "").length > 0 && (
          <Text style={[styles.aboutText, { color: colors.mutedForeground }]}>
            {settings.aboutInfo.intro}
          </Text>
        )}
        <Pressable
          onPress={() => router.push("/contact")}
          style={[styles.contactBtn, { backgroundColor: colors.foreground }]}
        >
          <Text style={[styles.contactBtnText, { color: colors.background }]}>تواصل معنا</Text>
        </Pressable>
      </View>

      {/* ── Admin unlock modal ── */}
      <Modal visible={adminModalVisible} transparent animationType="fade" onRequestClose={() => setAdminModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setAdminModalVisible(false)}>
          <Pressable style={[styles.modalCard, { backgroundColor: colors.card }]} onPress={(e) => e.stopPropagation()}>
            <Ionicons name="shield-checkmark" size={32} color={colors.primary} />
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>الوصول للإدارة</Text>
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
            {adminError ? <Text style={[styles.errorText, { color: colors.destructive }]}>{adminError}</Text> : null}
            <Pressable
              onPress={handlePromote}
              disabled={promoting}
              style={[styles.authSubmitBtn, { backgroundColor: colors.primary, width: "100%" }]}
            >
              {promoting ? <ActivityIndicator color="#fff" /> : <Text style={styles.authSubmitText}>تأكيد</Text>}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Edit profile modal ── */}
      <Modal visible={editProfileVisible} transparent animationType="slide" onRequestClose={() => setEditProfileVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setEditProfileVisible(false)}>
          <Pressable style={[styles.modalCard, { backgroundColor: colors.card }]} onPress={(e) => e.stopPropagation()}>
            <Ionicons name="person-circle-outline" size={36} color={colors.primary} />
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>تعديل البيانات الشخصية</Text>

            <View style={{ width: "100%", gap: 12 }}>
              <View style={styles.modalFieldGroup}>
                <Text style={[styles.modalFieldLabel, { color: colors.mutedForeground }]}>الاسم الكامل</Text>
                <TextInput
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="اسمك الكامل"
                  placeholderTextColor={colors.mutedForeground}
                  style={[styles.input, { color: colors.foreground, borderColor: colors.border, width: "100%" }]}
                  textAlign="right"
                />
              </View>
              <View style={styles.modalFieldGroup}>
                <Text style={[styles.modalFieldLabel, { color: colors.mutedForeground }]}>عنوان التوصيل المفضّل</Text>
                <TextInput
                  value={editAddress}
                  onChangeText={setEditAddress}
                  placeholder="المدينة، الشارع، رقم المنزل..."
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  numberOfLines={3}
                  style={[
                    styles.input,
                    { color: colors.foreground, borderColor: colors.border, width: "100%", minHeight: 80, textAlignVertical: "top", paddingTop: 12 },
                  ]}
                  textAlign="right"
                />
              </View>
            </View>

            {editError ? <Text style={[styles.errorText, { color: colors.destructive }]}>{editError}</Text> : null}

            <View style={{ width: "100%", flexDirection: "row-reverse", gap: 10 }}>
              <Pressable
                onPress={handleSaveProfile}
                disabled={editSaving}
                style={[styles.authSubmitBtn, { backgroundColor: colors.primary, flex: 1 }]}
              >
                {editSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.authSubmitText}>حفظ</Text>}
              </Pressable>
              <Pressable
                onPress={() => setEditProfileVisible(false)}
                style={[styles.authSubmitBtn, { backgroundColor: colors.muted, flex: 1 }]}
              >
                <Text style={[styles.authSubmitText, { color: colors.foreground }]}>إلغاء</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Forgot password modal ── */}
      <Modal
        visible={forgotStep !== null}
        transparent
        animationType="slide"
        onRequestClose={closeForgot}
      >
        <Pressable style={styles.modalOverlay} onPress={closeForgot}>
          <Pressable style={[styles.modalCard, { backgroundColor: colors.card }]} onPress={(e) => e.stopPropagation()}>
            <Ionicons name="lock-open-outline" size={36} color={colors.primary} />
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>نسيت كلمة المرور؟</Text>

            {forgotStep === "phone" ? (
              <>
                <Text style={[styles.authSectionLabel, { color: colors.mutedForeground, textAlign: "center" }]}>
                  أدخل رقم جوالك وسيتم إرسال رابط الاستعادة إلى البريد الإلكتروني المرتبط بحسابك
                </Text>
                <TextInput
                  value={forgotPhone}
                  onChangeText={setForgotPhone}
                  placeholder="رقم الجوال (مثال: 0591234567)"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="phone-pad"
                  autoFocus
                  style={[styles.input, { color: colors.foreground, borderColor: colors.border, width: "100%" }]}
                  textAlign="right"
                />
                {forgotError ? <Text style={[styles.errorText, { color: colors.destructive }]}>{forgotError}</Text> : null}
                <Pressable
                  onPress={handleForgotSubmit}
                  style={[styles.authSubmitBtn, { backgroundColor: colors.primary, width: "100%" }]}
                >
                  <Text style={styles.authSubmitText}>إرسال رابط الاستعادة</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Ionicons name="mail-outline" size={48} color={colors.primary} style={{ marginVertical: 4 }} />
                <Text style={[styles.authSectionLabel, { color: colors.foreground, textAlign: "center", fontWeight: "700", fontSize: 15 }]}>
                  سيتم إرسال رابط استعادة كلمة المرور إلى البريد الإلكتروني المرتبط برقم جوالك
                </Text>
                <Text style={[styles.authSectionLabel, { color: colors.mutedForeground, textAlign: "center" }]}>
                  يرجى مراجعة بريدك الإلكتروني واتباع التعليمات
                </Text>
                <Pressable
                  onPress={closeForgot}
                  style={[styles.authSubmitBtn, { backgroundColor: colors.primary, width: "100%" }]}
                >
                  <Text style={styles.authSubmitText}>حسناً</Text>
                </Pressable>
              </>
            )}

            <Pressable onPress={closeForgot}>
              <Text style={{ color: colors.mutedForeground, fontSize: 13, marginTop: 4 }}>إلغاء</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  header: { paddingBottom: 24, paddingHorizontal: 16 },
  avatarContainer: { alignItems: "center", paddingTop: 16, gap: 8 },
  logoImage: { width: 140, height: 70, borderRadius: 12 },
  storeTag: { fontSize: 13, color: "rgba(255,255,255,0.85)" },
  statsRow: { flexDirection: "row-reverse", justifyContent: "center", alignItems: "center", marginTop: 20 },
  statItem: { alignItems: "center", flex: 1 },
  statNum: { fontSize: 20, fontWeight: "800", color: "#fff" },
  statLabel: { fontSize: 11, color: "rgba(255,255,255,0.85)", marginTop: 2 },
  divider: { width: 1, height: 36 },
  loadingBox: { paddingVertical: 24, alignItems: "center" },
  accountCard: {
    margin: 16, marginBottom: 0, borderRadius: 16, borderWidth: 1,
    padding: 14, flexDirection: "row-reverse", alignItems: "center", gap: 12,
  },
  accountAvatar: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  accountAvatarImage: { width: 46, height: 46, borderRadius: 23 },
  accountName: { fontSize: 15, fontWeight: "700", textAlign: "right" },
  accountPhone: { fontSize: 13, marginTop: 2, textAlign: "right" },
  logoutBtn: { padding: 8 },
  detailsCard: { margin: 16, marginBottom: 0, borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  detailsHeader: { flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center", padding: 14 },
  detailsTitle: { fontSize: 15, fontWeight: "700" },
  editBtn: { flexDirection: "row-reverse", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  editBtnText: { fontSize: 13, fontWeight: "600" },
  detailRow: { flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: 1 },
  detailLabelRow: { flexDirection: "row-reverse", alignItems: "center", gap: 4 },
  detailLabel: { fontSize: 12 },
  detailValue: { fontSize: 14, fontWeight: "600", textAlign: "right", flex: 1, paddingLeft: 8 },
  detailValueEmpty: { fontSize: 14, fontWeight: "600" },
  authCard: { margin: 16, borderRadius: 20, borderWidth: 1, padding: 20, gap: 12 },
  authSectionLabel: { fontSize: 14, textAlign: "right" },
  authTabs: { flexDirection: "row-reverse", backgroundColor: "transparent", borderRadius: 12, overflow: "hidden", gap: 8 },
  authTab: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  authTabText: { fontSize: 14, fontWeight: "700" },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  errorText: { fontSize: 13, fontWeight: "600", textAlign: "right" },
  authSubmitBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  authSubmitText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  forgotLink: { fontSize: 13, fontWeight: "600", textAlign: "center", paddingVertical: 4 },
  menuCard: { margin: 16, marginTop: 16, borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  menuItem: { flexDirection: "row-reverse", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  menuLabel: { flex: 1, fontSize: 15, fontWeight: "600", textAlign: "right" },
  menuIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  separator: { height: 1, marginHorizontal: 16 },
  adminCard: { marginHorizontal: 16, marginTop: 8, borderRadius: 16, flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", padding: 16, gap: 12 },
  adminCardText: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "800", textAlign: "right" },
  newOrdersBadge: { position: "absolute", top: -4, right: -4, backgroundColor: "#ef4444", borderRadius: 8, minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  newOrdersBadgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },
  aboutCard: { margin: 16, marginTop: 8, borderRadius: 20, padding: 24, alignItems: "center", gap: 10 },
  aboutTitle: { fontSize: 16, fontWeight: "800" },
  aboutText: { fontSize: 13, textAlign: "center", lineHeight: 20 },
  contactBtn: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 12, marginTop: 4 },
  contactBtnText: { fontSize: 14, fontWeight: "700" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center", padding: 24 },
  modalCard: { width: "100%", borderRadius: 24, padding: 24, alignItems: "center", gap: 12 },
  modalTitle: { fontSize: 17, fontWeight: "800" },
  modalFieldGroup: { gap: 6 },
  modalFieldLabel: { fontSize: 12, fontWeight: "600", textAlign: "right" },
});
