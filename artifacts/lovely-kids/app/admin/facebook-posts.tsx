import { getResponsiveTopPadding } from "@/utils/webLayout";
import OwnerStoryComposer from "@/components/OwnerStoryComposer";
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
  const [instagramVerifying, setInstagramVerifying] = useState(false);
  const [instagramVerification, setInstagramVerification] = useState<{
    connected: boolean;
    username?: string;
    accountType?: string | null;
    error?: string;
  } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState<{ connected: boolean; pageName?: string; error?: string } | null>(null);
  const [busy, setBusy] = useState<"preview" | "publish" | null>(null);
  const [error, setError] = useState("");
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);

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

  const verifyConnection = async () => {
    if (verifying) return;
    setVerifying(true);
    setVerification(null);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error("يجب تسجيل الدخول كمالك");
      const response = await fetch(`${API_BASE}/api/owner/facebook/verify`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json() as {
        connected?: boolean;
        pageName?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "تعذر فحص الاتصال بصفحة فيسبوك");
      setVerification({
        connected: data.connected === true,
        pageName: data.pageName,
        error: data.error,
      });
    } catch (e) {
      setVerification({
        connected: false,
        error: e instanceof Error ? e.message : "تعذر فحص الاتصال بصفحة فيسبوك",
      });
    } finally {
      setVerifying(false);
    }
  };

  const verifyInstagramConnection = async () => {
    if (instagramVerifying) return;
    setInstagramVerifying(true);
    setInstagramVerification(null);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error("يجب تسجيل الدخول كمالك");
      const response = await fetch(`${API_BASE}/api/owner/instagram/verify`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json() as {
        connected?: boolean;
        username?: string;
        accountType?: string | null;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "تعذر فحص حساب إنستغرام");
      setInstagramVerification({
        connected: data.connected === true,
        username: data.username,
        accountType: data.accountType,
        error: data.error,
      });
    } catch (error) {
      setInstagramVerification({
        connected: false,
        error: error instanceof Error ? error.message : "تعذر فحص حساب إنستغرام",
      });
    } finally {
      setInstagramVerifying(false);
    }
  };

  const toggleProduct = (id: string) => {
    setError("");
    setPublishedUrl(null);
    setPreview(null);
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
      <Text style={{ ...titleStyle, fontSize: 24, textAlign: "right" }}>نشر موديلات على فيسبوك</Text>
      <Text style={{ ...muted, textAlign: "right" }}>
        اختَر موديلات لنشر صورها في منشور واحد. اسم كل صنف ورابطه موجودان في وصف صورته، ووصف المنشور الرئيسي لا يكرر التفاصيل.
      </Text>
      <Text style={{ ...muted, textAlign: "right" }}>
        {configured === true ? "✓ بيانات صفحة فيسبوك محفوظة في النظام" :
          configured === false ? "ربط صفحة فيسبوك للنشر لم يُفعّل بعد؛ المعاينة متاحة." : "جاري التحقق من إعدادات صفحة فيسبوك."}
      </Text>
      <View style={{ ...surface, gap: 8 }}>
        <Text style={{ ...titleStyle, textAlign: "right" }}>فحص اتصال فيسبوك بدون نشر</Text>
        <Text style={{ ...muted, textAlign: "right" }}>
          يفحص رمز الوصول واسم الصفحة مباشرة من Meta. لا يرفع أي صور ولا ينشئ أي منشور.
        </Text>
        <Pressable
          onPress={() => void verifyConnection()}
          disabled={verifying || configured !== true}
          style={{ ...action, opacity: verifying || configured !== true ? 0.5 : 1 }}
        >
          {verifying ? <ActivityIndicator color="#fff" /> :
            <Text style={{ color: "#fff", fontWeight: "800" }}>افحص اتصال صفحة Lovely Kids</Text>}
        </Pressable>
        {verification && (
          <Text selectable style={{
            color: verification.connected ? "#16A34A" : "#DC2626",
            textAlign: "right",
            fontWeight: "700",
          }}>
            {verification.connected
              ? `✓ رمز الوصول صالح لصفحة ${verification.pageName || "Lovely Kids"}؛ هذا لا يضمن صلاحية نشر المنشورات حتى نجربها.`
              : `✗ ${verification.error || "تعذر التحقق من الاتصال"}`}
          </Text>
        )}
      </View>

      <View style={{ ...surface, gap: 8 }}>
        <Text style={{ ...titleStyle, textAlign: "right" }}>فحص اتصال إنستغرام — بدون نشر</Text>
        <Text style={{ ...muted, textAlign: "right" }}>
          يفحص حساب lovely.kids.nablus من خلال Meta دون رفع صور أو إنشاء منشورات أو قصص.
        </Text>
        <Pressable
          onPress={() => void verifyInstagramConnection()}
          disabled={instagramVerifying}
          style={{ ...action, opacity: instagramVerifying ? 0.5 : 1 }}
        >
          {instagramVerifying ? <ActivityIndicator color="#fff" /> :
            <Text style={{ color: "#fff", fontWeight: "800" }}>افحص اتصال إنستغرام Lovely Kids</Text>}
        </Pressable>
        {instagramVerification && (
          <Text selectable style={{
            color: instagramVerification.connected ? "#16A34A" : "#DC2626",
            textAlign: "right",
            fontWeight: "700",
          }}>
            {instagramVerification.connected
              ? `✓ حساب ${instagramVerification.username || "Lovely Kids"} متصل بإنستغرام. الفحص لا يؤكد صلاحية نشر المنشورات والقصص بعد.`
              : `✗ ${instagramVerification.error || "تعذر فحص الاتصال"}`}
          </Text>
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
      <OwnerStoryComposer selectedIds={selectedIds} />
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
