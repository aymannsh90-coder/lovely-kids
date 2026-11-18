import { API_BASE } from "@/constants/api";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Image, Platform, Pressable, Text, View,
} from "react-native";

type Preview = {
  configured: boolean;
  account: string;
  product: { id: number; name: string; image: string };
  note: string;
};

/** New-app Instagram Story pilot only. No old Stories composer or Facebook publishing. */
export default function OwnerInstagramNextStoryPilot({ selectedIds }: { selectedIds: string[] }) {
  const colors = useColors();
  const { getAuthToken } = useAuth();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"preview" | "publish" | null>(null);
  const [error, setError] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [success, setSuccess] = useState(false);

  // Never reuse a preview after the owner's product selection changes.
  useEffect(() => {
    setPreview(null);
    setAttempted(false);
    setSuccess(false);
    setError("");
  }, [selectedIds]);

  const validSelection = selectedIds.length === 1 &&
    Number.isSafeInteger(Number(selectedIds[0])) && Number(selectedIds[0]) > 0;

  const request = async (kind: "preview" | "publish") => {
    if (busy || !validSelection) return;
    if (kind === "publish" && (attempted || !preview?.configured ||
      preview.product.id !== Number(selectedIds[0]))) return;
    setBusy(kind);
    setError("");
    if (kind === "publish") setAttempted(true);
    if (kind === "preview") {
      setPreview(null);
      setSuccess(false);
      setAttempted(false);
    }
    try {
      const token = await getAuthToken();
      if (!token) throw new Error("يجب تسجيل الدخول كمالك");
      const response = await fetch(API_BASE + "/api/owner/instagram/story-next/" + kind, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: Number(selectedIds[0]),
          ...(kind === "publish" ? { confirmed: true } : {}),
        }),
      });
      const data = await response.json() as {
        configured?: boolean;
        account?: string;
        product?: Preview["product"];
        note?: string;
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || data.error) throw new Error(data.error || "تعذر الاتصال بإنستغرام");
      if (kind === "preview") {
        if (!data.product || data.product.id !== Number(selectedIds[0])) {
          throw new Error("المعاينة غير مطابقة للموديل المختار");
        }
        setPreview({
          configured: data.configured === true,
          account: data.account || "lovely.kids.nablus",
          product: data.product,
          note: data.note || "",
        });
      } else {
        if (data.ok !== true) throw new Error("لم نتأكد من إرسال القصة");
        setSuccess(true);
        setPreview(null);
      }
    } catch (err) {
      setError((err instanceof Error ? err.message : "تعذر الاتصال بإنستغرام") +
        (kind === "publish" ? " — راجع القصص قبل إعادة أي محاولة حتى لا تتكرر القصة." : ""));
    } finally {
      setBusy(null);
    }
  };

  const confirmPublish = () => {
    if (busy || attempted || !preview?.configured ||
      preview.product.id !== Number(selectedIds[0])) return;
    const message = "سيتم نشر قصة إنستغرام فعلية بصورة واحدة للموديل #" +
      preview.product.id + " على lovely.kids.nablus. هل تؤكد؟";
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(message)) void request("publish");
    } else {
      Alert.alert("تأكيد نشر قصة إنستغرام", message, [
        { text: "إلغاء", style: "cancel" },
        { text: "نشر قصة واحدة", onPress: () => void request("publish") },
      ]);
    }
  };

  const base = {
    backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1,
    borderRadius: 14, padding: 12, gap: 11,
  } as const;
  const action = {
    backgroundColor: colors.primary, borderRadius: 12,
    paddingVertical: 13, paddingHorizontal: 16, alignItems: "center" as const,
  };
  const muted = { color: colors.mutedForeground, fontSize: 12, textAlign: "right" as const };

  return (
    <View style={base}>
      <Text style={{ color: colors.foreground, textAlign: "right", fontWeight: "800", fontSize: 16 }}>
        إنستغرام — قصة تجريبية بالتطبيق الجديد
      </Text>
      <Text style={muted}>
        هذه أداة جديدة مستقلة عن الربط السابق. اختَر موديلًا واحدًا فقط، وعاين صورته
        قبل أي تأكيد. لا ننشر قصص فيسبوك من هنا، ولا نعدّل صور R2.
      </Text>
      <Pressable onPress={() => void request("preview")}
        disabled={!validSelection || busy !== null}
        style={{ ...action, opacity: !validSelection || busy ? 0.5 : 1 }}>
        {busy === "preview" ? <ActivityIndicator color="#fff" /> :
          <Text style={{ color: "#fff", fontWeight: "800" }}>معاينة قصة إنستغرام الجديدة</Text>}
      </Pressable>
      {preview && (
        <View style={{ gap: 10 }}>
          <Text style={{ color: colors.foreground, fontWeight: "800", textAlign: "right" }}>
            {preview.product.name} (#{preview.product.id})
          </Text>
          <Image source={{ uri: preview.product.image }} resizeMode="contain"
            style={{ width: 170, height: 302, borderRadius: 10, backgroundColor: colors.background, alignSelf: "flex-end" }} />
          <Text style={muted}>{preview.note}</Text>
          {!preview.configured && (
            <Text style={{ color: "#D97706", textAlign: "right", fontWeight: "700" }}>
              النشر بالتطبيق الجديد معطّل من السيرفر حاليًا. المعاينة فقط متاحة.
            </Text>
          )}
          <Pressable onPress={confirmPublish}
            disabled={!preview.configured || attempted || busy !== null}
            style={{ ...action, opacity: !preview.configured || attempted || busy ? 0.5 : 1 }}>
            {busy === "publish" ? <ActivityIndicator color="#fff" /> :
              <Text style={{ color: "#fff", fontWeight: "800" }}>تأكيد ونشر قصة واحدة على إنستغرام</Text>}
          </Pressable>
        </View>
      )}
      {success && (
        <Text style={{ color: "#16A34A", fontWeight: "800", textAlign: "right" }}>
          ✓ تم قبول نشر القصة لدى Meta. افحص حساب إنستغرام قبل تجربة قصة أخرى.
        </Text>
      )}
      {!!error && (
        <Text selectable style={{ color: "#DC2626", fontWeight: "700", textAlign: "right" }}>
          {error}
        </Text>
      )}
    </View>
  );
}
