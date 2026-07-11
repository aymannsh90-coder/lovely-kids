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

const TEMPLATES = [
  { t: "بضاعة جديدة! 🎁", b: "تفقد أحدث المنتجات الوصلت للمتجر" },
  { t: "عرض خاص! 🔥", b: "خصومات حصرية لفترة محدودة، لا تفوتها" },
  { t: "تخفيضات! 💰", b: "أسعار مخفوضة على منتجات مختارة" },
  { t: "مناسبة خاصة! 🎉", b: "تسوقي أجمل الملابس لمناسبتك القادمة" },
];

export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getAuthToken } = useAuth();

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 16;

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [tokenCount, setTokenCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(true);

  const fetchCount = useCallback(async () => {
    setCountLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/push-tokens/count`);
      const data = await res.json() as { count?: number };
      setTokenCount(data.count ?? 0);
    } catch {
      setTokenCount(null);
    } finally {
      setCountLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCount();
  }, [fetchCount]);

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
        <Ionicons name="notifications" size={22} color="#fff" />
      </View>

      {/* Device count banner */}
      <Pressable onPress={fetchCount} style={[styles.countBanner, { backgroundColor: colors.secondary }]}>
        <Ionicons name="refresh-outline" size={16} color={colors.mutedForeground} />
        {countLoading ? (
          <ActivityIndicator size="small" color={colors.mutedForeground} />
        ) : (
          <Text style={[styles.countText, { color: colors.foreground }]}>
            {tokenCount === null
              ? "تعذّر جلب عدد الأجهزة"
              : `${tokenCount} جهاز مسجّل سيستقبل الإشعار`}
          </Text>
        )}
        <Ionicons name="phone-portrait-outline" size={18} color={colors.primary} />
      </Pressable>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomPadding }]}
        keyboardShouldPersistTaps="handled"
      >
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

        {/* Quick templates */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>قوالب سريعة:</Text>
        <View style={styles.templates}>
          {TEMPLATES.map((tpl, i) => (
            <Pressable
              key={i}
              onPress={() => { setTitle(tpl.t); setBody(tpl.b); setResult(null); }}
              style={[styles.chip, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Text style={[styles.chipText, { color: colors.foreground }]}>{tpl.t}</Text>
            </Pressable>
          ))}
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
            {sending ? "جارٍ الإرسال..." : "إرسال لكل المستخدمين"}
          </Text>
        </Pressable>

        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          سيصل الإشعار لجميع الأجهزة التي سبق لها فتح التطبيق وقبلت السماح بالإشعارات.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  headerTitle: { fontSize: 18, fontWeight: "800", color: "#fff", flex: 1, textAlign: "center" },
  countBanner: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  countText: { fontSize: 14, fontWeight: "600", flex: 1, textAlign: "center" },
  scroll: { padding: 16, gap: 4 },
  field: { gap: 6, marginBottom: 16 },
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
  sectionLabel: { fontSize: 13, fontWeight: "600", textAlign: "right", marginBottom: 8 },
  templates: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13, fontWeight: "600" },
  resultBox: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  resultText: { fontSize: 14, fontWeight: "600", textAlign: "right", lineHeight: 22 },
  sendBtn: {
    flexDirection: "row-reverse",
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
