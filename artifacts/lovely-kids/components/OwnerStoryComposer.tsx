import { API_BASE } from "@/constants/api";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";

type Target = "facebook" | "instagram";
type StoryPreview = {
  targets: Target[];
  ready: Record<Target, boolean>;
  products: Array<{ id: number; name: string; image: string; productUrl: string }>;
  note: string;
};
type StoryResult = {
  ok: boolean;
  published: Array<{ target: Target; productId: number; storyId: string }>;
  failed?: { target: Target; productId: number; reason: string };
  error?: string;
  note?: string;
};

const platformLabel = (platform: Target) => platform === "facebook" ? "فيسبوك" : "إنستغرام";

export default function OwnerStoryComposer({ selectedIds }: { selectedIds: string[] }) {
  const { getAuthToken } = useAuth();
  const colors = useColors();
  const [targets, setTargets] = useState<Target[]>(["facebook"]);
  const [preview, setPreview] = useState<StoryPreview | null>(null);
  const [result, setResult] = useState<StoryResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "publish" | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState("");

  // An old preview must never be used after products change.
  useEffect(() => {
    setPreview(null);
    setResult(null);
    setAttempted(false);
    setError("");
  }, [selectedIds]);

  const resetPreview = () => {
    setPreview(null);
    setResult(null);
    setAttempted(false);
    setError("");
  };

  const toggleTarget = (target: Target) => {
    if (busy) return;
    setTargets((current) =>
      current.includes(target) ? current.filter((item) => item !== target) : [...current, target],
    );
    resetPreview();
  };

  const request = async (kind: "preview" | "publish") => {
    if (busy || targets.length === 0 || selectedIds.length === 0) return;
    if (kind === "publish" && (!preview || attempted)) return;
    setBusy(kind);
    setError("");
    if (kind === "publish") setAttempted(true);
    if (kind === "preview") {
      setPreview(null);
      setResult(null);
    }
    try {
      const token = await getAuthToken();
      if (!token) throw new Error("يجب تسجيل الدخول كمالك");
      const response = await fetch(API_BASE + "/api/owner/stories/" + kind, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({
          productIds: kind === "publish" ? preview!.products.map((p) => p.id) : selectedIds.map(Number),
          targets: kind === "publish" ? preview!.targets : targets,
          ...(kind === "publish" ? { confirmed: true } : {}),
        }),
      });
      const data = await response.json() as {
        error?: string;
        products?: StoryPreview["products"];
        published?: StoryResult["published"];
      };
      if (kind === "preview") {
        if (!response.ok || !Array.isArray(data.products)) {
          throw new Error(data.error || "تعذرت معاينة القصص");
        }
        setPreview(data as StoryPreview);
        setAttempted(false);
      } else if (Array.isArray(data.published)) {
        setResult(data as StoryResult);
      } else {
        throw new Error(data.error || "تعذر إرسال القصص إلى Meta");
      }
    } catch (err) {
      setError((err instanceof Error ? err.message : "حدث خطأ غير متوقع") +
        (kind === "publish" ? " — افحص القصص قبل أي إعادة محاولة حتى لا تتكرر." : ""));
    } finally {
      setBusy(null);
    }
  };

  const confirmPublish = () => {
    if (busy || attempted || !preview) return;
    const count = preview.products.length * preview.targets.length;
    const message = "هل تؤكد نشر " + count + " قصة على " +
      preview.targets.map(platformLabel).join(" و") +
      "؟ كل موديل قصة مستقلة، وروابط الموديلات لا تظهر كملصقات قابلة للضغط.";
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(message)) void request("publish");
    } else {
      Alert.alert("تأكيد نشر القصص", message, [
        { text: "إلغاء", style: "cancel" },
        { text: "نشر القصص", onPress: () => void request("publish") },
      ]);
    }
  };

  const base = {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 11,
  } as const;
  const action = {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: "center" as const,
  };
  const muted = { color: colors.mutedForeground, fontSize: 12, textAlign: "right" as const };

  return (
    <View style={base}>
      <Text style={{ color: colors.foreground, textAlign: "right", fontWeight: "800", fontSize: 16 }}>
        نشر قصص الموديلات على فيسبوك وإنستغرام
      </Text>
      <Text style={muted}>
        اختَر من 1 إلى 10 موديلات من القائمة أعلاه، ثم حدّد المنصات.
        كل صورة ستكون قصة مستقلة، والمعاينة لا تنشر شيئًا.
      </Text>
      {(["facebook", "instagram"] as const).map((target) => (
        <Pressable
          key={target}
          onPress={() => toggleTarget(target)}
          disabled={!!busy}
          style={{ flexDirection: "row-reverse", alignItems: "center", gap: 10, paddingVertical: 6 }}
        >
          <Ionicons
            name={targets.includes(target) ? "checkbox" : "square-outline"}
            size={25}
            color={targets.includes(target) ? colors.primary : colors.mutedForeground}
          />
          <Text style={{ color: colors.foreground, fontWeight: "700" }}>
            {"قصص " + (target === "facebook" ? "صفحة Lovely Kids على فيسبوك" : "lovely.kids.nablus على إنستغرام")}
          </Text>
        </Pressable>
      ))}
      <Text style={muted}>
        روابط المنتجات في المعاينة مرجعية فقط، وليست ملصقات روابط داخل القصة.
        لإنستغرام يُفضّل JPEG عام بشكل عمودي 9:16؛ قد ترفض Meta الصور غير المتوافقة.
      </Text>
      <Pressable
        onPress={() => void request("preview")}
        disabled={!!busy || selectedIds.length === 0 || targets.length === 0}
        style={{ ...action, opacity: busy || selectedIds.length === 0 || targets.length === 0 ? 0.5 : 1 }}
      >
        {busy === "preview" ? <ActivityIndicator color="#fff" /> :
          <Text style={{ color: "#fff", fontWeight: "800" }}>معاينة قصص الموديلات</Text>}
      </Pressable>
      {preview && (
        <View style={{ gap: 10 }}>
          <Text style={{ color: colors.foreground, textAlign: "right", fontWeight: "800" }}>
            {"معاينة " + preview.products.length + " صور × " + preview.targets.length + " منصة"}
          </Text>
          <Text style={muted}>{preview.note}</Text>
          {preview.targets.map((target) => (
            <Text
              key={target}
              style={{ color: preview.ready[target] ? "#16A34A" : "#DC2626", textAlign: "right", fontWeight: "700" }}
            >
              {(preview.ready[target] ? "✓ " : "✗ ") + "بيانات " + platformLabel(target) +
                (preview.ready[target] ? " محفوظة (لا تؤكد صلاحية النشر)" : " غير مكتملة")}
            </Text>
          ))}
          {preview.products.map((product) => (
            <View key={product.id} style={{ flexDirection: "row-reverse", alignItems: "center", gap: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Image
                source={{ uri: product.image }}
                style={{ width: 90, height: 148, borderRadius: 10, backgroundColor: colors.background }}
                resizeMode="contain"
              />
              <View style={{ flex: 1, alignItems: "flex-end", gap: 4 }}>
                <Text style={{ color: colors.foreground, fontWeight: "700", textAlign: "right" }}>{product.name}</Text>
                <Text selectable style={muted}>{product.productUrl}</Text>
              </View>
            </View>
          ))}
          <Pressable
            onPress={confirmPublish}
            disabled={!!busy || attempted || preview.targets.some((target) => !preview.ready[target])}
            style={{
              ...action,
              opacity: busy || attempted || preview.targets.some((target) => !preview.ready[target]) ? 0.5 : 1,
            }}
          >
            {busy === "publish" ? <ActivityIndicator color="#fff" /> :
              <Text style={{ color: "#fff", fontWeight: "800" }}>تأكيد ونشر القصص المختارة</Text>}
          </Pressable>
        </View>
      )}
      {result && (
        <View style={{ gap: 7 }}>
          <Text style={{ color: result.ok ? "#16A34A" : "#DC2626", textAlign: "right", fontWeight: "800" }}>
            {(result.ok ? "✓ " : "⚠ ") + "تم قبول نشر " + result.published.length + " قصة لدى Meta"}
          </Text>
          {result.failed && (
            <Text selectable style={{ color: "#DC2626", textAlign: "right" }}>
              {"توقف عند موديل #" + result.failed.productId + " على " +
                platformLabel(result.failed.target) + " (" + result.failed.reason + ")"}
            </Text>
          )}
          <Text style={muted}>{result.error || result.note || "راجع الحسابات للتأكد من ظهور القصص."}</Text>
        </View>
      )}
      {!!error && <Text selectable style={{ color: "#DC2626", textAlign: "right", fontWeight: "700" }}>{error}</Text>}
    </View>
  );
}
