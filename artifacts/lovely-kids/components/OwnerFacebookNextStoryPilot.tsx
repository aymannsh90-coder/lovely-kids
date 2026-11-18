import { API_BASE } from "@/constants/api";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Image, Platform, Pressable, Text, View,
} from "react-native";

type StoryPreview = {
  configured: boolean;
  page: string;
  product: { id: number; name: string; image: string };
  note: string;
};

type StoryResult = { productId: number; storyId: string };

/**
 * Facebook NEXT Page Stories: 1–10 products, one original R2 URL per Story.
 * No copies, uploads, image manipulation or new R2 objects are created here.
 * The existing owner-only API publishes ONE product per request; calls are
 * sequential, stop on the first uncertainty and are never auto-retried.
 */
export default function OwnerFacebookNextStoryPilot({ selectedIds }: { selectedIds: string[] }) {
  const colors = useColors();
  const { getAuthToken } = useAuth();
  const [previews, setPreviews] = useState<StoryPreview[] | null>(null);
  const [busy, setBusy] = useState<"preview" | "publish" | null>(null);
  const [error, setError] = useState("");
  const [published, setPublished] = useState<StoryResult[]>([]);
  const [completed, setCompleted] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  // Synchronous locks protect double taps before React commits a state update.
  const operationRef = useRef(false);
  const confirmOpenRef = useRef(false);
  // Session-level guard. After an uncertain result, do not reuse the same
  // product in another publish attempt from this mounted component.
  const attemptedIdsRef = useRef<Set<number>>(new Set());

  const selectedKey = selectedIds.join(",");
  const ids = selectedIds.map(Number);
  const validSelection = ids.length >= 1 && ids.length <= 10 &&
    ids.every(id => Number.isSafeInteger(id) && id > 0) &&
    new Set(ids).size === ids.length;
  const matchesPreview = !!previews && validSelection &&
    previews.length === ids.length &&
    previews.every((p, i) => p.product.id === ids[i]);
  const hasAttemptedSelection = ids.some(id => attemptedIdsRef.current.has(id));
  const readyToPublish = matchesPreview && previews!.every(p => p.configured) &&
    !hasAttemptedSelection && !operationRef.current && busy === null;

  useEffect(() => {
    // Changing the selected models invalidates any previous preview.
    // Do NOT reset attemptedIdsRef: previously attempted posts must stay locked.
    setPreviews(null);
    setError("");
    setCompleted(false);
  }, [selectedKey]);

  const callApi = async (
    kind: "preview" | "publish", productId: number, token: string,
  ): Promise<{ configured?: boolean; page?: string; product?: StoryPreview["product"];
    note?: string; ok?: boolean; storyId?: string; error?: string }> => {
    const response = await fetch(API_BASE + "/api/owner/facebook/story-next/" + kind, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        productId,
        ...(kind === "publish" ? { confirmed: true } : {}),
      }),
    });
    const data = await response.json() as {
      configured?: boolean; page?: string; product?: StoryPreview["product"];
      note?: string; ok?: boolean; storyId?: string; error?: string;
    };
    if (!response.ok || data.error) throw new Error(data.error || "تعذر الاتصال بفيسبوك");
    return data;
  };

  const previewStories = async () => {
    if (operationRef.current || !validSelection) return;
    operationRef.current = true;
    setBusy("preview");
    setPreviews(null);
    setPublished([]);
    setCompleted(false);
    setProgress(null);
    setError("");
    const capturedIds = [...ids];
    try {
      const token = await getAuthToken();
      if (!token) throw new Error("يجب تسجيل الدخول كمالك");
      const items: StoryPreview[] = [];
      // Read-only previews are deliberately sequential to avoid burst requests.
      for (const id of capturedIds) {
        const data = await callApi("preview", id, token);
        if (!data.product || data.product.id !== id) {
          throw new Error("المعاينة غير مطابقة للموديلات المختارة");
        }
        items.push({
          configured: data.configured === true,
          page: data.page || "Lovely Kids",
          product: data.product,
          note: data.note || "",
        });
      }
      setPreviews(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر معاينة قصص فيسبوك");
    } finally {
      operationRef.current = false;
      setBusy(null);
    }
  };

  const publishStories = async () => {
    if (!readyToPublish || !previews || operationRef.current) return;
    operationRef.current = true;
    const planned = [...previews];
    setBusy("publish");
    setError("");
    setPublished([]);
    setCompleted(false);
    setProgress({ current: 0, total: planned.length });
    try {
      const token = await getAuthToken();
      if (!token) throw new Error("يجب تسجيل الدخول كمالك");
      for (let index = 0; index < planned.length; index++) {
        const productId = planned[index].product.id;
        if (attemptedIdsRef.current.has(productId)) {
          throw new Error("هذا الموديل سبق محاولة نشره خلال الجلسة. راجع قصص الحساب.");
        }
        // Record BEFORE the network write. Unknown responses must never retry.
        attemptedIdsRef.current.add(productId);
        const data = await callApi("publish", productId, token);
        if (data.ok !== true || !data.storyId) {
          throw new Error("نتيجة نشر القصة غير مؤكدة");
        }
        setPublished(current => [...current, { productId, storyId: data.storyId! }]);
        setProgress({ current: index + 1, total: planned.length });
      }
      setCompleted(true);
    } catch (err) {
      setError((err instanceof Error ? err.message : "تعذر تأكيد نشر القصة") +
        " — توقفنا عند أول مشكلة. راجع قصص فيسبوك قبل أي محاولة جديدة لتجنب التكرار.");
    } finally {
      operationRef.current = false;
      setBusy(null);
    }
  };

  const confirmPublish = () => {
    if (!readyToPublish || confirmOpenRef.current) return;
    const count = previews!.length;
    const message = "سيتم نشر " + count + " قصص فعلية متتابعة على صفحة Lovely Kids، " +
      "قصة مستقلة لكل موديل باستخدام الصورة الأصلية. إذا فشلت قصة سيتوقف الباقي، " +
      "ولا توجد إعادة محاولة تلقائية. هل تؤكد؟";
    confirmOpenRef.current = true;
    if (Platform.OS === "web") {
      const accepted = typeof window !== "undefined" && window.confirm(message);
      confirmOpenRef.current = false;
      if (accepted) void publishStories();
    } else {
      Alert.alert("تأكيد نشر قصص فيسبوك", message, [
        { text: "إلغاء", style: "cancel", onPress: () => { confirmOpenRef.current = false; } },
        { text: "نشر القصص", onPress: () => {
          confirmOpenRef.current = false;
          void publishStories();
        } },
      ], { cancelable: true, onDismiss: () => { confirmOpenRef.current = false; } });
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
        فيسبوك — نشر القصص
      </Text>
      <Text style={muted}>
        اختَر من موديل واحد إلى 10 موديلات، وكل موديل سيُنشر كقصة منفصلة على
        فيسبوك. نستخدم رابط صورة المنتج الأصلية من R2 دون نسخ أو تعديل أو تخزين
        صور جديدة. قصص فيسبوك والمنشورات العادية منفصلة تمامًا.
      </Text>
      <Pressable onPress={() => void previewStories()}
        disabled={!validSelection || busy !== null}
        style={{ ...action, opacity: !validSelection || busy ? 0.5 : 1 }}>
        {busy === "preview" ? <ActivityIndicator color="#fff" /> :
          <Text style={{ color: "#fff", fontWeight: "800" }}>
            معاينة {validSelection ? ids.length : ""} قصص فيسبوك
          </Text>}
      </Pressable>
      {previews && (
        <View style={{ gap: 10 }}>
          <Text style={{ color: colors.foreground, fontWeight: "800", textAlign: "right" }}>
            معاينة {previews.length} {previews.length === 1 ? "قصة" : "قصص"} على {previews[0].page}
          </Text>
          {previews.map(item => (
            <View key={item.product.id} style={{
              flexDirection: "row-reverse", gap: 10, alignItems: "center",
              borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 8,
            }}>
              <Image source={{ uri: item.product.image }} resizeMode="contain"
                style={{ width: 88, height: 155, borderRadius: 8, backgroundColor: colors.background }} />
              <Text style={{ color: colors.foreground, flex: 1, textAlign: "right" }}>
                {item.product.name} (#{item.product.id})
              </Text>
            </View>
          ))}
          <Text style={muted}>
            صور المعاينة هي الصور الأصلية، وقد يقص فيسبوك أطراف الصور المربعة عند
            عرضها عموديًا. لن تُنشأ صور 9:16 إضافية على R2. لا نضيف ملصقات أو روابط قابلة للضغط.
          </Text>
          {!previews.every(item => item.configured) && (
            <Text style={{ color: "#D97706", textAlign: "right", fontWeight: "700" }}>
              نشر قصص فيسبوك معطّل حاليًا من السيرفر، والمعاينة فقط متاحة.
            </Text>
          )}
          {hasAttemptedSelection && (
            <Text style={{ color: "#D97706", textAlign: "right", fontWeight: "700" }}>
              أحد هذه الموديلات سبق محاولة نشره خلال هذه الجلسة؛ لن نعيد نشره تلقائيًا.
              افحص القصص على فيسبوك أولًا.
            </Text>
          )}
          <Pressable onPress={confirmPublish}
            disabled={!readyToPublish}
            style={{ ...action, opacity: readyToPublish ? 1 : 0.5 }}>
            {busy === "publish" ? <ActivityIndicator color="#fff" /> :
              <Text style={{ color: "#fff", fontWeight: "800" }}>
                تأكيد ونشر {previews.length} {previews.length === 1 ? "قصة" : "قصص"} على فيسبوك
              </Text>}
          </Pressable>
        </View>
      )}
      {!!progress && (
        <Text style={{ color: colors.foreground, textAlign: "right", fontWeight: "700" }}>
          تم تأكيد {progress.current} من {progress.total} قصص لدى Meta.
          {busy === "publish" ? " جارٍ إرسال القصة التالية..." : ""}
        </Text>
      )}
      {published.length > 0 && (
        <Text style={muted}>
          الموديلات التي تم قبول نشرها: {published.map(p => "#" + p.productId).join("، ")}
        </Text>
      )}
      {completed && (
        <Text style={{ color: "#16A34A", fontWeight: "800", textAlign: "right" }}>
          ✓ تم قبول جميع القصص لدى Meta. افحص ظهورها على حساب فيسبوك.
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
