import { getResponsiveTopPadding } from "@/utils/webLayout";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { API_BASE } from "@/constants/api";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { enablePushNotifications } from "@/hooks/usePushNotifications";

type NotificationTemplate = {
  title: string;
  body: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  accent: string;
};

const TEMPLATES: NotificationTemplate[] = [
  {
    label: "بضاعة جديدة",
    title: "🎁 بضاعة جديدة وصلت",
    body: "وصلتنا تشكيلة جديدة ومميزة، تفقدي أحدث المنتجات الآن قبل نفاد الكمية.",
    icon: "gift-outline",
    accent: "#EC4899",
  },
  {
    label: "ورد ومناسبة",
    title: "🌹 شيء مميز بانتظارك",
    body: "اختيارات جميلة ومميزة وصلت للمتجر، شاهدي التفاصيل واختاري ما يناسبك.",
    icon: "flower-outline",
    accent: "#E11D48",
  },
  {
    label: "عرض خاص",
    title: "🔥 عرض خاص لفترة محدودة",
    body: "استفيدي الآن من عرض مميز على مجموعة مختارة من المنتجات لفترة محدودة.",
    icon: "flame-outline",
    accent: "#F97316",
  },
  {
    label: "تخفيضات",
    title: "💸 تخفيضات جديدة",
    body: "اغتنمي الفرصة الآن وتصفحي أحدث التخفيضات والأسعار المميزة داخل المتجر.",
    icon: "pricetag-outline",
    accent: "#16A34A",
  },
  {
    label: "هدية",
    title: "💝 هدية مميزة بانتظارك",
    body: "اطلبي الآن واستفيدي من الهدية أو العرض المتاح مع طلبك.",
    icon: "heart-outline",
    accent: "#DB2777",
  },
  {
    label: "رجع للمخزون",
    title: "📦 رجع للمخزون",
    body: "بعض المنتجات المطلوبة توفرت من جديد، سارعي بالطلب قبل نفاد الكمية.",
    icon: "refresh-circle-outline",
    accent: "#0284C7",
  },
  {
    label: "توصيل",
    title: "🚚 اطلب الآن بسهولة",
    body: "اطلبي من المتجر واستفيدي من خيارات التوصيل أو الاستلام من المحل.",
    icon: "car-outline",
    accent: "#7C3AED",
  },
  {
    label: "الأكثر طلبًا",
    title: "⭐ الأكثر طلبًا الآن",
    body: "شاهدي المنتجات الأكثر طلبًا واختاري المفضل لديك قبل نفاد الكمية.",
    icon: "star-outline",
    accent: "#CA8A04",
  },
  {
    label: "نهاية الأسبوع",
    title: "🛍️ اختيارات نهاية الأسبوع",
    body: "جهزنا لك مجموعة مميزة من المنتجات والعروض لتسوق أجمل هذا الأسبوع.",
    icon: "bag-handle-outline",
    accent: "#0891B2",
  },
  {
    label: "مناسبة خاصة",
    title: "🎉 مناسبة خاصة",
    body: "بمناسبة خاصة جهزنا لكم اختيارات وعروضًا مميزة، تفقديها الآن.",
    icon: "sparkles-outline",
    accent: "#9333EA",
  },
];

export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getAuthToken } = useAuth();

  const topPadding = getResponsiveTopPadding(insets.top);
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 16;

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [tokenCount, setTokenCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(true);
  const [enablingDevice, setEnablingDevice] = useState(false);

  const fetchCount = useCallback(async () => {
    setCountLoading(true);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error("No admin token");
      const res = await fetch(`${API_BASE}/api/push-tokens/count`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json() as { count?: number };
      setTokenCount(data.count ?? 0);
    } catch {
      setTokenCount(null);
    } finally {
      setCountLoading(false);
    }
  }, [getAuthToken]);

  useEffect(() => {
    void fetchCount();
  }, [fetchCount]);

  const enableThisDevice = async () => {
    setEnablingDevice(true);
    setResult(null);

    try {
      const enabled =
        await enablePushNotifications(
          undefined,
          getAuthToken,
        );

      if (!enabled.ok) {
        setResult({
          ok: false,
          message:
            enabled.error ||
            "تعذر تفعيل الإشعارات على هذا الجهاز",
        });
        return;
      }

      setResult({
        ok: true,
        message:
          "✅ تم تفعيل إشعارات الإدارة على هذا الجهاز. ستصلك الطلبات الجديدة حتى عند عدم فتح صفحة الطلبات.",
      });

      void fetchCount();
    } finally {
      setEnablingDevice(false);
    }
  };

  const handleSend = async () => {
    if (!title.trim() || !body.trim()) {
      setResult({ ok: false, message: "يرجى كتابة العنوان والنص قبل الإرسال" });
      return;
    }
    setSending(true);
    setResult(null);
    try {
      const token = await getAuthToken();
      const res = await fetch(`${API_BASE}/api/notifications/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ title: title.trim(), body: body.trim() }),
      });
      const data = await res.json() as { sent?: number; total?: number; message?: string; error?: string };
      if (!res.ok) {
        setResult({ ok: false, message: data.error ?? "حدث خطأ أثناء الإرسال" });
        return;
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (data.message) {
        setResult({ ok: true, message: data.message });
      } else {
        setResult({ ok: true, message: `✅ تم الإرسال بنجاح إلى ${data.sent} جهاز من أصل ${data.total}` });
        setTitle("");
        setBody("");
      }
      void fetchCount();
    } catch {
      setResult({ ok: false, message: "تعذّر الاتصال بالسيرفر" });
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12, backgroundColor: "#FF6B35" }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-forward" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>إرسال إشعار</Text>
        <Pressable onPress={() => router.push("/admin/push-debug")} hitSlop={12}>
          <Ionicons name="bug-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      {/* Device count banner */}
      <Pressable onPress={fetchCount} style={[styles.countBanner, { backgroundColor: colors.secondary }]}>
        <Ionicons name="refresh-outline" size={16} color={colors.mutedForeground} />
        {countLoading ? (
          <ActivityIndicator size="small" color={colors.mutedForeground} />
        ) : (
          <Text style={[styles.countText, { color: colors.foreground }]}>
            {tokenCount === null
              ? "تعذّر جلب عدد المشتركين"
              : `${tokenCount} جهاز/متصفح مشترك بالإشعارات`}
          </Text>
        )}
        <Ionicons name="phone-portrait-outline" size={18} color={colors.primary} />
      </Pressable>

      <Pressable
        onPress={() => void enableThisDevice()}
        disabled={enablingDevice}
        style={[
          styles.adminPushButton,
          {
            backgroundColor:
              colors.primary + "14",
            borderColor:
              colors.primary,
            opacity:
              enablingDevice
                ? 0.65
                : 1,
          },
        ]}
      >
        {enablingDevice ? (
          <ActivityIndicator
            size="small"
            color={colors.primary}
          />
        ) : (
          <Ionicons
            name="notifications-outline"
            size={18}
            color={colors.primary}
          />
        )}
        <Text
          style={[
            styles.adminPushButtonText,
            { color: colors.primary },
          ]}
        >
          {enablingDevice
            ? "جاري التفعيل..."
            : Platform.OS === "web"
              ? "تفعيل إشعارات الطلبات على هذا المتصفح"
              : "تفعيل إشعارات الطلبات على هذا الجهاز"}
        </Text>
      </Pressable>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomPadding }]}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            styles.sectionCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.sectionHeaderRow}>
            <View
              style={[
                styles.sectionIcon,
                { backgroundColor: colors.primary + "14" },
              ]}
            >
              <Ionicons
                name="create-outline"
                size={20}
                color={colors.primary}
              />
            </View>
            <View style={styles.sectionHeaderText}>
              <Text
                style={[
                  styles.sectionTitle,
                  { color: colors.foreground },
                ]}
              >
                كتابة حرة
              </Text>
              <Text
                style={[
                  styles.sectionSubtitle,
                  { color: colors.mutedForeground },
                ]}
              >
                اكتب الإشعار بنفسك، أو اختر قالبًا بالأسفل ثم عدّل النص كما تريد.
              </Text>
            </View>
          </View>

        {/* Title */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>عنوان الإشعار *</Text>
          <TextInput
            value={title}
            onChangeText={(t) => { setTitle(t); setResult(null); }}
            placeholder="مثال: بضاعة جديدة وصلت! 🎉"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            textAlign="right"
            maxLength={100}
          />
          <Text style={[styles.charCount, { color: colors.mutedForeground }]}>{title.length}/100</Text>
        </View>

        {/* Body */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>نص الإشعار *</Text>
          <TextInput
            value={body}
            onChangeText={(t) => { setBody(t); setResult(null); }}
            placeholder="مثال: تفقد أحدث المنتجات والعروض المميزة الآن"
            placeholderTextColor={colors.mutedForeground}
            multiline
            numberOfLines={3}
            style={[styles.input, styles.textArea, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            textAlign="right"
            textAlignVertical="top"
            maxLength={200}
          />
          <Text style={[styles.charCount, { color: colors.mutedForeground }]}>{body.length}/200</Text>
        </View>

        </View>

        {/* Quick templates */}
        <View
          style={[
            styles.sectionCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.sectionHeaderRow}>
            <View
              style={[
                styles.sectionIcon,
                { backgroundColor: "#FFF1F2" },
              ]}
            >
              <Ionicons
                name="apps-outline"
                size={20}
                color="#E11D48"
              />
            </View>
            <View style={styles.sectionHeaderText}>
              <Text
                style={[
                  styles.sectionTitle,
                  { color: colors.foreground },
                ]}
              >
                قوالب جاهزة
              </Text>
              <Text
                style={[
                  styles.sectionSubtitle,
                  { color: colors.mutedForeground },
                ]}
              >
                اضغط على أي قالب لتعبئة العنوان والنص، وبعدها عدّلهم بحرية.
              </Text>
            </View>
          </View>

          <View style={styles.templates}>
            {TEMPLATES.map((tpl) => (
              <Pressable
                key={tpl.label}
                onPress={() => {
                  setTitle(tpl.title);
                  setBody(tpl.body);
                  setResult(null);
                }}
                style={[
                  styles.templateCard,
                  {
                    borderColor: tpl.accent + "35",
                    backgroundColor: tpl.accent + "0D",
                  },
                ]}
              >
                <View
                  style={[
                    styles.templateIcon,
                    { backgroundColor: tpl.accent + "18" },
                  ]}
                >
                  <Ionicons
                    name={tpl.icon}
                    size={24}
                    color={tpl.accent}
                  />
                </View>
                <Text
                  style={[
                    styles.templateLabel,
                    { color: colors.foreground },
                  ]}
                  numberOfLines={1}
                >
                  {tpl.label}
                </Text>
                <Ionicons
                  name="chevron-back"
                  size={15}
                  color={tpl.accent}
                />
              </Pressable>
            ))}
          </View>
        </View>

        {/* Result */}
        {result && (
          <View style={[
            styles.resultBox,
            { backgroundColor: result.ok ? "#dcfce7" : "#fee2e2", borderColor: result.ok ? "#86efac" : "#fca5a5" },
          ]}>
            <Text style={[styles.resultText, { color: result.ok ? "#166534" : "#991b1b" }]}>
              {result.message}
            </Text>
          </View>
        )}

        {/* Send button */}
        <Pressable
          onPress={handleSend}
          disabled={sending}
          style={[styles.sendBtn, { backgroundColor: sending ? colors.mutedForeground : "#FF6B35" }]}
        >
          {sending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Ionicons name="send-outline" size={20} color="#fff" />
          )}
          <Text style={styles.sendBtnText}>
            {sending ? "جارٍ الإرسال..." : "إرسال لكل المشتركين"}
          </Text>
        </Pressable>

        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          سيصل الإشعار للمشتركين الذين فعّلوا الإشعارات على التطبيق أو المتصفح.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  headerTitle: { fontSize: 18, fontWeight: "800", color: "#fff", flex: 1, textAlign: "center" },
  countBanner: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  countText: { fontSize: 14, fontWeight: "600", flex: 1, textAlign: "center" },
  adminPushButton: {
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection:
      Platform.OS === "web"
        ? "row-reverse"
        : "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  adminPushButtonText: {
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },
  scroll: { padding: 16, gap: 14 },
  sectionCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
  },
  sectionHeaderRow: {
    flexDirection:
      Platform.OS === "web"
        ? "row-reverse"
        : "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  sectionHeaderText: {
    flex: 1,
    alignItems: "flex-end",
  },
  sectionIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "800",
    textAlign: "right",
  },
  sectionSubtitle: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: "right",
    marginTop: 2,
  },
  field: { gap: 6, marginBottom: 14 },
  label: { fontSize: 14, fontWeight: "700", textAlign: "right" },
  input: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 14,
  },
  textArea: { height: 90, paddingTop: 12 },
  charCount: { fontSize: 11, textAlign: "left" },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    textAlign: "right",
    marginBottom: 8,
  },
  templates: {
    flexDirection:
      Platform.OS === "web"
        ? "row-reverse"
        : "row",
    flexWrap: "wrap",
    gap: 10,
  },
  templateCard: {
    width: "48%",
    minHeight: 82,
    paddingHorizontal: 10,
    paddingVertical: 11,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection:
      Platform.OS === "web"
        ? "row-reverse"
        : "row",
    alignItems: "center",
    gap: 7,
  },
  templateIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  templateLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "right",
  },
  resultBox: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  resultText: { fontSize: 14, fontWeight: "600", textAlign: "right", lineHeight: 22 },
  sendBtn: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 16,
    marginBottom: 16,
  },
  sendBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  hint: { fontSize: 12, textAlign: "right", lineHeight: 18 },
});
