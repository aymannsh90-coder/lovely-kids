import { getResponsiveTopPadding } from "@/utils/webLayout";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { API_BASE } from "@/constants/api";
import { useAuth } from "@/context/AuthContext";
import { useProducts } from "@/context/ProductsContext";
import { useColors } from "@/hooks/useColors";

type PreviewProduct = {
  id: number;
  name: string;
  image: string;
  photoCaption: string;
};

type PreviewResult = {
  configured: boolean;
  caption: string;
  products: PreviewProduct[];
};

const MAX_MODELS = 10;
const DEFAULT_INTRO = "🛍️ موديلات مختارة من Lovely Kids";

function isFailedResponse(value: unknown): value is { error: string } {
  return !!value && typeof value === "object" &&
    "error" in value && typeof value.error === "string";
}

export default function FacebookPostsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, getAuthToken } = useAuth();
  const { products } = useProducts();

  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [intro, setIntro] = useState(DEFAULT_INTRO);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [nextInstagramVerifying, setNextInstagramVerifying] = useState(false);
  const [nextInstagramVerification, setNextInstagramVerification] = useState<{
    connected: boolean;
    username?: string;
    error?: string;
  } | null>(null);
  const [nextVerifying, setNextVerifying] = useState(false);
  const [nextVerification, setNextVerification] = useState<{ connected: boolean; pageName?: string; error?: string } | null>(null);
  const [showConnectionChecks, setShowConnectionChecks] = useState(false);
  const [busy, setBusy] = useState<"preview" | "publish" | null>(null);
  const [error, setError] = useState("");
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [igPilotBusy, setIgPilotBusy] = useState<"preview" | "publish" | null>(null);
  const [igPilotPreview, setIgPilotPreview] = useState<{
    configured: boolean;
    product: { id: number; name: string; image: string };
    caption: string;
    note?: string;
  } | null>(null);
  const [igPilotError, setIgPilotError] = useState("");
  const [igPilotPermalink, setIgPilotPermalink] = useState<string | null>(null);
  const [igPilotSuccess, setIgPilotSuccess] = useState(false);
  const [igCarouselBusy, setIgCarouselBusy] = useState<"preview" | "publish" | null>(null);
  const [igCarouselPreview, setIgCarouselPreview] = useState<{
    configured: boolean;
    products: { id: number; name: string; image: string }[];
    caption: string;
    note: string;
  } | null>(null);
  const [igCarouselError, setIgCarouselError] = useState("");
  const [igCarouselResult, setIgCarouselResult] = useState<string | null>(null);
  const [igCarouselSuccess, setIgCarouselSuccess] = useState(false);

  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter((product) => !product.isHidden && !product.deletedAt)
      .filter((product) => !q ||
        product.nameAr.toLowerCase().includes(q) ||
        product.name.toLowerCase().includes(q) ||
        String(product.productCode ?? "").toLowerCase().includes(q) ||
        product.id === q)
      .slice(0, 100);
  }, [products, search]);

  useEffect(() => {
    if (user?.isOwner !== true) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await getAuthToken();
        if (!token) return;
        const result = await fetch(`${API_BASE}/api/owner/facebook/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!result.ok) return;
        const data = await result.json() as { configured?: boolean };
        if (!cancelled) setConfigured(data.configured === true);
      } catch {
        // Preview remains available; publishing will report server-side errors.
      }
    })();
    return () => { cancelled = true; };
  }, [getAuthToken, user?.isOwner]);

  const verifyNextFacebookConnection = async () => {
    if (nextVerifying) return;
    setNextVerifying(true);
    setNextVerification(null);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error("يجب تسجيل الدخول كمالك");
      const response = await fetch(`${API_BASE}/api/owner/facebook/verify-next`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json() as {
        connected?: boolean;
        pageName?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "تعذر فحص التطبيق الجديد");
      setNextVerification({
        connected: data.connected === true,
        pageName: data.pageName,
        error: data.error,
      });
    } catch (e) {
      setNextVerification({
        connected: false,
        error: e instanceof Error ? e.message : "تعذر فحص التطبيق الجديد",
      });
    } finally {
      setNextVerifying(false);
    }
  };

  const verifyNextInstagramConnection = async () => {
    if (nextInstagramVerifying) return;
    setNextInstagramVerifying(true);
    setNextInstagramVerification(null);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error("يجب تسجيل الدخول كمالك");
      const response = await fetch(`${API_BASE}/api/owner/instagram/verify-next`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json() as {
        connected?: boolean;
        username?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "تعذر فحص رمز إنستغرام الجديد");
      setNextInstagramVerification({
        connected: data.connected === true,
        username: data.username,
        error: data.error,
      });
    } catch (error) {
      setNextInstagramVerification({
        connected: false,
        error: error instanceof Error ? error.message : "تعذر فحص رمز إنستغرام الجديد",
      });
    } finally {
      setNextInstagramVerifying(false);
    }
  };

  const requestInstagramPilot = async (kind: "preview" | "publish") => {
    if (igPilotBusy || selectedIds.length !== 1) {
      setIgPilotError("اختر موديلًا واحدًا فقط لتجربة منشور إنستغرام");
      return;
    }
    setIgPilotBusy(kind);
    setIgPilotError("");
    try {
      const token = await getAuthToken();
      if (!token) throw new Error("يجب تسجيل الدخول كمالك");
      const response = await fetch(`${API_BASE}/api/owner/instagram/feed/${kind}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: Number(selectedIds[0]),
          ...(kind === "publish" ? { confirmed: true } : {}),
        }),
      });
      const data = await response.json() as {
        configured?: boolean;
        product?: { id: number; name: string; image: string };
        caption?: string;
        permalink?: string | null;
        ok?: boolean;
        error?: string;
        note?: string;
      };
      if (!response.ok || data.error) throw new Error(data.error || "تعذّر اتصال إنستغرام");
      if (kind === "preview") {
        if (!data.product || typeof data.caption !== "string") throw new Error("معاينة إنستغرام غير مكتملة");
        setIgPilotPreview({
          configured: data.configured === true,
          product: data.product,
          caption: data.caption,
          note: data.note,
        });
        setIgPilotSuccess(false);
        setIgPilotPermalink(null);
      } else {
        if (data.ok !== true) throw new Error("لم نتأكد من إتمام النشر على إنستغرام");
        setIgPilotSuccess(true);
        setIgPilotPermalink(data.permalink || null);
        setIgPilotPreview(null);
      }
    } catch (error) {
      setIgPilotError(error instanceof Error ? error.message : "تعذّر فحص منشور إنستغرام");
    } finally {
      setIgPilotBusy(null);
    }
  };

  const confirmInstagramPilot = () => {
    if (igPilotBusy || selectedIds.length !== 1 || !igPilotPreview?.configured ||
      igPilotPreview.product.id !== Number(selectedIds[0])) return;
    const message = "سيتم نشر صورة موديل واحد فعليًا على حساب lovely.kids.nablus. هل تؤكد النشر؟";
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(message)) {
        void requestInstagramPilot("publish");
      }
    } else {
      Alert.alert("تأكيد نشر إنستغرام", message, [
        { text: "إلغاء", style: "cancel" },
        { text: "نشر صورة واحدة", onPress: () => void requestInstagramPilot("publish") },
      ]);
    }
  };

  const requestInstagramCarousel = async (kind: "preview" | "publish") => {
    if (igCarouselBusy || selectedIds.length < 2 || selectedIds.length > 10) {
      setIgCarouselError("لازم تختار من صورتين إلى 10 صور مختلفة لمنشور إنستغرام.");
      return;
    }
    setIgCarouselBusy(kind);
    setIgCarouselError("");
    try {
      const token = await getAuthToken();
      if (!token) throw new Error("يجب تسجيل الدخول كمالك");
      const response = await fetch(`${API_BASE}/api/owner/instagram/carousel/${kind}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          productIds: selectedIds.map(Number),
          ...(kind === "publish" ? { confirmed: true } : {}),
        }),
      });
      const data = await response.json() as {
        configured?: boolean;
        products?: { id: number; name: string; image: string }[];
        caption?: string;
        note?: string;
        ok?: boolean;
        permalink?: string | null;
        error?: string;
      };
      if (!response.ok || data.error) throw new Error(data.error || "تعذر الاتصال بإنستغرام");
      if (kind === "preview") {
        if (!Array.isArray(data.products) || typeof data.caption !== "string") {
          throw new Error("معاينة إنستغرام غير مكتملة");
        }
        setIgCarouselPreview({
          configured: data.configured === true,
          products: data.products,
          caption: data.caption,
          note: data.note || "",
        });
        setIgCarouselResult(null);
        setIgCarouselSuccess(false);
      } else {
        if (data.ok !== true) throw new Error("لم نتأكد من إتمام النشر");
        setIgCarouselSuccess(true);
        setIgCarouselResult(data.permalink || null);
        setIgCarouselPreview(null);
      }
    } catch (error) {
      setIgCarouselError(error instanceof Error ? error.message : "تعذر نشر صور إنستغرام");
    } finally {
      setIgCarouselBusy(null);
    }
  };

  const confirmInstagramCarousel = () => {
    if (igCarouselBusy || !igCarouselPreview?.configured ||
        igCarouselPreview.products.length !== selectedIds.length ||
        igCarouselPreview.products.some((item, index) => item.id !== Number(selectedIds[index]))) return;
    const message = `سيتم نشر ${selectedIds.length} صور فعلية في منشور واحد على حساب lovely.kids.nablus. هل تؤكد؟`;
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(message)) {
        void requestInstagramCarousel("publish");
      }
    } else {
      Alert.alert("تأكيد منشور إنستغرام متعدد الصور", message, [
        { text: "إلغاء", style: "cancel" },
        { text: "نشر منشور واحد", onPress: () => void requestInstagramCarousel("publish") },
      ]);
    }
  };

  const toggleProduct = (id: string) => {
    setError("");
    setPublishedUrl(null);
    setPreview(null);
    setIgPilotPreview(null);
    setIgPilotPermalink(null);
    setIgPilotSuccess(false);
    setIgPilotError("");
    setIgCarouselPreview(null);
    setIgCarouselError("");
    setIgCarouselResult(null);
    setIgCarouselSuccess(false);
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= MAX_MODELS) {
        setError("يمكن اختيار 10 موديلات كحد أقصى لكل منشور");
        return current;
      }
      return [...current, id];
    });
  };

  const request = async (kind: "preview" | "publish") => {
    if (selectedIds.length === 0) {
      setError("اختَر موديلًا واحدًا على الأقل");
      return;
    }
    setBusy(kind);
    setError("");
    try {
      const token = await getAuthToken();
      if (!token) throw new Error("يجب تسجيل الدخول كمالك");
      const response = await fetch(`${API_BASE}/api/owner/facebook/${kind}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          productIds: selectedIds.map(Number),
          intro,
        }),
      });
      const data = await response.json() as unknown;
      if (!response.ok || isFailedResponse(data)) {
        throw new Error(isFailedResponse(data) ? data.error : "تعذر الاتصال بخدمة فيسبوك");
      }

      if (kind === "preview") {
        const result = data as PreviewResult;
        if (!Array.isArray(result.products) || typeof result.caption !== "string") {
          throw new Error("بيانات المعاينة غير مكتملة");
        }
        setPreview(result);
        setConfigured(result.configured);
      } else {
        const result = data as { postUrl?: string };
        setPublishedUrl(result.postUrl ?? null);
        setPreview(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "حدث خطأ غير متوقع");
    } finally {
      setBusy(null);
    }
  };

  const publish = () => {
    if (!preview || busy) return;
    const message = `هل تريد نشر ${preview.products.length} موديل على صفحة Lovely Kids؟ لا يمكن التراجع عن النشر من المتجر.`;
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(message)) {
        void request("publish");
      }
    } else {
      Alert.alert("تأكيد النشر", message, [
        { text: "إلغاء", style: "cancel" },
        { text: "نشر الآن", onPress: () => void request("publish") },
      ]);
    }
  };

  const surface = {
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  } as const;
  const muted = { color: colors.mutedForeground, fontSize: 12 } as const;
  const titleStyle = { color: colors.foreground, fontWeight: "800" as const, fontSize: 16 };
  const action = {
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center" as const,
    backgroundColor: colors.primary,
  };

  if (user?.isOwner !== true) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <Text style={titleStyle}>النشر على فيسبوك متاح للمالك فقط.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        paddingTop: getResponsiveTopPadding(insets.top),
        paddingBottom: Platform.OS === "web" ? 40 : insets.bottom + 24,
        paddingHorizontal: 16,
        maxWidth: 860,
        width: "100%",
        alignSelf: "center",
        gap: 14,
      }}
    >
      <Pressable onPress={() => router.back()} style={{ alignSelf: "flex-end", flexDirection: "row", gap: 5 }}>
        <Ionicons name="arrow-forward" size={20} color={colors.primary} />
        <Text style={{ color: colors.primary, fontWeight: "700" }}>رجوع</Text>
      </Pressable>
      <Text style={{ ...titleStyle, fontSize: 24, textAlign: "right" }}>نشر موديلات على فيسبوك وإنستغرام</Text>
      <Text style={{ ...muted, textAlign: "right" }}>
        اختَر موديلات لنشر صورها في منشور واحد. اسم كل صنف ورابطه موجودان في وصف صورته، ووصف المنشور الرئيسي لا يكرر التفاصيل.
      </Text>
      <Text style={{ ...muted, textAlign: "right" }}>
        {configured === true ? "✓ بيانات صفحة فيسبوك محفوظة في النظام" :
          configured === false ? "ربط صفحة فيسبوك للنشر لم يُفعّل بعد؛ المعاينة متاحة." : "جاري التحقق من إعدادات صفحة فيسبوك."}
      </Text>
      <View style={{ ...surface, gap: 8 }}>
        <Pressable
          onPress={() => setShowConnectionChecks((value) => !value)}
          accessibilityRole="button"
          style={{ flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 }}
        >
          <Text style={{ ...titleStyle, textAlign: "right", flex: 1 }}>
            فحوصات اتصال التطبيق المعتمد (اختياري)
          </Text>
          <Ionicons name={showConnectionChecks ? "chevron-up" : "chevron-down"} size={20} color={colors.primary} />
        </Pressable>
        <Text style={{ ...muted, textAlign: "right" }}>
          الفحوصات للقراءة فقط ولا تنشر أي صور. تم إخفاء أدوات فحص الربط القديم من هذه الصفحة.
        </Text>
        {showConnectionChecks && (
          <View style={{ gap: 12 }}>
            <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, gap: 8 }}>
              <Text style={{ ...titleStyle, textAlign: "right" }}>فيسبوك — فحص الرمز الجديد</Text>
              <Pressable
                onPress={() => void verifyNextFacebookConnection()}
                disabled={nextVerifying}
                style={{ ...action, opacity: nextVerifying ? 0.5 : 1 }}
              >
                {nextVerifying ? <ActivityIndicator color="#fff" /> :
                  <Text style={{ color: "#fff", fontWeight: "800" }}>فحص اتصال فيسبوك</Text>}
              </Pressable>
              {nextVerification && (
                <Text selectable style={{
                  color: nextVerification.connected ? "#16A34A" : "#DC2626",
                  textAlign: "right",
                  fontWeight: "700",
                }}>
                  {nextVerification.connected
                    ? `✓ رمز فيسبوك الجديد صالح لصفحة ${nextVerification.pageName || "Lovely Kids"}.`
                    : `✗ ${nextVerification.error || "تعذر فحص اتصال فيسبوك"}`}
                </Text>
              )}
            </View>
            <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, gap: 8 }}>
              <Text style={{ ...titleStyle, textAlign: "right" }}>إنستغرام — فحص الرمز الجديد</Text>
              <Pressable
                onPress={() => void verifyNextInstagramConnection()}
                disabled={nextInstagramVerifying}
                style={{ ...action, opacity: nextInstagramVerifying ? 0.5 : 1 }}
              >
                {nextInstagramVerifying ? <ActivityIndicator color="#fff" /> :
                  <Text style={{ color: "#fff", fontWeight: "800" }}>فحص اتصال إنستغرام</Text>}
              </Pressable>
              {nextInstagramVerification && (
                <Text selectable style={{
                  color: nextInstagramVerification.connected ? "#16A34A" : "#DC2626",
                  textAlign: "right",
                  fontWeight: "700",
                }}>
                  {nextInstagramVerification.connected
                    ? `✓ رمز إنستغرام الجديد صالح للحساب ${nextInstagramVerification.username || "Lovely Kids"}. نشر القصص لم يُحوّل بعد.`
                    : `✗ ${nextInstagramVerification.error || "تعذر فحص اتصال إنستغرام"}`}
                </Text>
              )}
            </View>
          </View>
        )}
      </View>

      <View style={{ ...surface, gap: 10 }}>
        <Text style={titleStyle}>الموديلات المختارة: {selectedIds.length}/{MAX_MODELS}</Text>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="ابحث باسم الصنف أو الكود أو رقم الموديل"
          placeholderTextColor={colors.mutedForeground}
          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, color: colors.foreground, textAlign: "right" }}
        />
        <ScrollView nestedScrollEnabled style={{ maxHeight: 380 }}>
          {visibleProducts.map((product) => {
            const chosen = selectedIds.includes(product.id);
            return (
              <Pressable
                key={product.id}
                onPress={() => toggleProduct(product.id)}
                style={{
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  gap: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                  paddingVertical: 9,
                }}
              >
                <Image source={{ uri: product.image }} style={{ height: 68, width: 68, borderRadius: 9, backgroundColor: colors.background }} />
                <View style={{ flex: 1, gap: 4, alignItems: "flex-end" }}>
                  <Text style={{ color: colors.foreground, fontWeight: "700", textAlign: "right" }}>{product.nameAr}</Text>
                  <Text style={muted}>#{product.id} · {product.price} ₪</Text>
                </View>
                <Ionicons
                  name={chosen ? "checkbox" : "square-outline"}
                  size={26}
                  color={chosen ? colors.primary : colors.mutedForeground}
                />
              </Pressable>
            );
          })}
          {visibleProducts.length === 0 && <Text style={{ ...muted, textAlign: "center" }}>ما في موديلات مطابقة</Text>}
        </ScrollView>
      </View>

      <View style={{ ...surface, gap: 10 }}>
        <Text style={{ ...titleStyle, textAlign: "right" }}>إنستغرام — تجربة منشور بصورة واحدة</Text>
        <Text style={{ ...muted, textAlign: "right" }}>
          هذا الخيار لمنشور إنستغرام بصورة واحدة. للصور المتعددة استخدم قسم Carousel أدناه.
          النشر الفعلي يتطلب تأكيد المالك، ولا يغيّر نشر فيسبوك أو القصص.
        </Text>
        <Pressable
          onPress={() => void requestInstagramPilot("preview")}
          disabled={igPilotBusy !== null || selectedIds.length !== 1}
          style={{ ...action, opacity: igPilotBusy || selectedIds.length !== 1 ? 0.5 : 1 }}
        >
          {igPilotBusy === "preview" ? <ActivityIndicator color="#fff" /> :
            <Text style={{ color: "#fff", fontWeight: "800" }}>معاينة صورة إنستغرام التجريبية</Text>}
        </Pressable>
        {igPilotPreview && (
          <View style={{ alignItems: "flex-end", gap: 8 }}>
            <Image source={{ uri: igPilotPreview.product.image }}
              style={{ height: 185, width: 185, borderRadius: 12, backgroundColor: colors.background }}
              resizeMode="contain" />
            <Text selectable style={{ color: colors.foreground, textAlign: "right" }}>{igPilotPreview.caption}</Text>
            <Text style={{ ...muted, textAlign: "right" }}>{igPilotPreview.note}</Text>
            {!igPilotPreview.configured && (
              <Text style={{ color: "#D97706", textAlign: "right" }}>
                النشر التجريبي معطّل من السيرفر لحين تفعيل مفتاح إنستغرام المستقل.
              </Text>
            )}
            <Pressable
              onPress={confirmInstagramPilot}
              disabled={!igPilotPreview.configured || igPilotBusy !== null}
              style={{ ...action, width: "100%", opacity: !igPilotPreview.configured || igPilotBusy ? 0.5 : 1 }}
            >
              {igPilotBusy === "publish" ? <ActivityIndicator color="#fff" /> :
                <Text style={{ color: "#fff", fontWeight: "800" }}>تأكيد ونشر صورة واحدة على إنستغرام</Text>}
            </Pressable>
          </View>
        )}
        {!!igPilotError && <Text selectable style={{ color: "#DC2626", textAlign: "right", fontWeight: "700" }}>{igPilotError}</Text>}
        {igPilotSuccess && (
          <View style={{ gap: 8 }}>
            <Text style={{ color: "#16A34A", textAlign: "right", fontWeight: "800" }}>
              ✓ أُرسل المنشور إلى إنستغرام؛ تأكد من ظهوره على الحساب قبل إعادة النشر.
            </Text>
            {igPilotPermalink && (
              <Pressable onPress={() => void Linking.openURL(igPilotPermalink)}
                style={{ ...action }}>
                <Text style={{ color: "#fff", fontWeight: "800" }}>فتح منشور إنستغرام</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>

      <View style={{ ...surface, gap: 10 }}>
        <Text style={{ ...titleStyle, textAlign: "right" }}>إنستغرام — منشور متعدد الصور (Carousel)</Text>
        <Text style={{ ...muted, textAlign: "right" }}>
          اختَر من موديلين إلى 10 موديلات. بتظهر الصور حسب ترتيب اختيارك،
          ولإنستغرام وصف واحد يجمع أسماء الموديلات وروابطها، مش وصف منفصل لكل صورة.
          النشر متعدد الصور يتطلب معاينة الصور والوصف ثم تأكيدًا صريحًا من المالك.
        </Text>
        <Pressable
          onPress={() => void requestInstagramCarousel("preview")}
          disabled={igCarouselBusy !== null || selectedIds.length < 2 || selectedIds.length > 10}
          style={{ ...action, opacity: igCarouselBusy || selectedIds.length < 2 || selectedIds.length > 10 ? 0.5 : 1 }}
        >
          {igCarouselBusy === "preview" ? <ActivityIndicator color="#fff" /> :
            <Text style={{ color: "#fff", fontWeight: "800" }}>معاينة منشور إنستغرام متعدد الصور</Text>}
        </Pressable>
        {igCarouselPreview && (
          <View style={{ gap: 10 }}>
            <Text style={{ ...titleStyle, textAlign: "right" }}>
              ترتيب الصور في المنشور ({igCarouselPreview.products.length})
            </Text>
            {igCarouselPreview.products.map((product, i) => (
              <View key={product.id} style={{ flexDirection: "row-reverse", alignItems: "center", gap: 10 }}>
                <Image source={{ uri: product.image }} resizeMode="contain"
                  style={{ height: 95, width: 95, borderRadius: 10, backgroundColor: colors.background }} />
                <Text style={{ color: colors.foreground, flex: 1, textAlign: "right" }}>
                  {i + 1}. {product.name} (#{product.id})
                </Text>
              </View>
            ))}
            <Text selectable style={{ color: colors.foreground, textAlign: "right", lineHeight: 23 }}>
              {igCarouselPreview.caption}
            </Text>
            <Text style={{ ...muted, textAlign: "right" }}>{igCarouselPreview.note}</Text>
            {!igCarouselPreview.configured && (
              <Text style={{ color: "#D97706", textAlign: "right" }}>
                النشر متعدد الصور معطّل من السيرفر. المعاينة فقط متاحة.
              </Text>
            )}
            <Pressable
              onPress={confirmInstagramCarousel}
              disabled={!igCarouselPreview.configured || igCarouselBusy !== null}
              style={{ ...action, opacity: !igCarouselPreview.configured || igCarouselBusy ? 0.5 : 1 }}
            >
              {igCarouselBusy === "publish" ? <ActivityIndicator color="#fff" /> :
                <Text style={{ color: "#fff", fontWeight: "800" }}>تأكيد ونشر Carousel على إنستغرام</Text>}
            </Pressable>
          </View>
        )}
        {!!igCarouselError && (
          <Text selectable style={{ color: "#DC2626", fontWeight: "700", textAlign: "right" }}>
            {igCarouselError}
          </Text>
        )}
        {igCarouselSuccess && (
          <View style={{ gap: 8 }}>
            <Text style={{ color: "#16A34A", fontWeight: "800", textAlign: "right" }}>
              ✓ أُرسل المنشور إلى إنستغرام. تحقق من ظهوره للعامة قبل إعادة المحاولة.
            </Text>
            {igCarouselResult && (
              <Pressable onPress={() => void Linking.openURL(igCarouselResult)} style={action}>
                <Text style={{ color: "#fff", fontWeight: "800" }}>فتح منشور إنستغرام</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>

      <View style={{ ...surface, gap: 10 }}>
        <Text style={titleStyle}>وصف المنشور الرئيسي (قابل للتعديل)</Text>
        <TextInput
          value={intro}
          onChangeText={(value) => { setIntro(value); setPreview(null); setPublishedUrl(null); }}
          multiline
          maxLength={500}
          style={{ minHeight: 66, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, color: colors.foreground, textAlign: "right", textAlignVertical: "top" }}
        />
        <Pressable
          onPress={() => void request("preview")}
          disabled={!!busy || selectedIds.length === 0}
          style={{ ...action, opacity: busy || selectedIds.length === 0 ? 0.5 : 1 }}
        >
          {busy === "preview" ? <ActivityIndicator color="#fff" /> :
            <Text style={{ color: "#fff", fontWeight: "800" }}>معاينة صور المنشور والوصف</Text>}
        </Pressable>
      </View>

      {preview && (
        <View style={{ ...surface, gap: 14 }}>
          <Text style={titleStyle}>معاينة المنشور ({preview.products.length} صور)</Text>
          {preview.products.map((product) => (
            <View key={product.id} style={{ alignItems: "flex-end", gap: 8, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Image
                source={{ uri: product.image }}
                style={{ height: 175, width: 175, borderRadius: 12, backgroundColor: colors.background }}
                resizeMode="contain"
              />
              <Text selectable style={{ color: colors.foreground, textAlign: "right", lineHeight: 23 }}>
                {product.photoCaption}
              </Text>
            </View>
          ))}
          <Text style={titleStyle}>الوصف الرئيسي الذي سيظهر مع المنشور</Text>
          <Text selectable style={{ color: colors.foreground, lineHeight: 24, textAlign: "right" }}>{preview.caption}</Text>
          <Text style={{ ...muted, textAlign: "right" }}>
            كل صورة مرتبطة باسم الموديل ورابطه في وصفها. قد لا يُظهر فيسبوك وصف الصورة مباشرة ضمن المنشور متعدد الصور؛ أحيانًا تحتاج الزبونة لفتح الصورة لقراءة التفاصيل.
          </Text>
          <Pressable
            onPress={publish}
            disabled={busy !== null || configured !== true}
            style={{ ...action, opacity: busy || configured !== true ? 0.5 : 1 }}
          >
            {busy === "publish" ? <ActivityIndicator color="#fff" /> :
              <Text style={{ color: "#fff", fontWeight: "800" }}>تأكيد ونشر على صفحة فيسبوك</Text>}
          </Pressable>
        </View>
      )}
      {!!error && <Text selectable style={{ color: "#DC2626", textAlign: "right", fontWeight: "700" }}>{error}</Text>}
      {publishedUrl && (
        <Pressable
          style={{ ...surface, borderColor: "#16A34A" }}
          onPress={() => void Linking.openURL(publishedUrl)}
        >
          <Text style={{ color: "#16A34A", textAlign: "center", fontWeight: "800" }}>✓ نُشر المنشور بنجاح — افتح المنشور على فيسبوك</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}
