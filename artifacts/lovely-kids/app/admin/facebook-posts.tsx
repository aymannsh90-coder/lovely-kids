import { getResponsiveTopPadding } from "@/utils/webLayout";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { startWebBarcodeScanner } from "@/utils/webBarcodeScanner";
import {
  captureScannerKeyboardEvent,
  createScannerKeyboardBuffer,
  resetScannerKeyboardBuffer,
} from "@/utils/scannerKeyboard";
import {
  eligibleForSocialPublishing,
  exactSocialPublishingBarcodeMatches,
  matchesSocialPublishingProduct,
  socialPublishingDisplayImage,
} from "@/utils/socialPublishingProductSearch";

import { API_BASE } from "@/constants/api";
import { useAuth } from "@/context/AuthContext";
import { useProducts } from "@/context/ProductsContext";
// Instagram Stories reuse existing product image URLs. Never create R2 image copies.
import OwnerInstagramNextStoryPilot from "@/components/OwnerInstagramNextStoryPilot";
import OwnerFacebookNextStoryPilot from "@/components/OwnerFacebookNextStoryPilot";
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

const DEFAULT_INTRO = "🛍️ موديلات مختارة من Lovely Kids";

type PublishingPlatform = "facebook" | "instagram";
type PublishingContent = "post" | "story";
const FACEBOOK_COLOR = "#1877F2";
const INSTAGRAM_COLOR = "#C13584";

function isFailedResponse(value: unknown): value is { error: string } {
  return !!value && typeof value === "object" &&
    "error" in value && typeof value.error === "string";
}

export default function FacebookPostsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, getAuthToken } = useAuth();
  const { products } = useProducts();
  const scannerKeyboard = useRef(createScannerKeyboardBuffer());
  const scannerSearchFocused = useRef(false);
  const cameraScanAccepted = useRef(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const [platform, setPlatform] = useState<PublishingPlatform>("facebook");
  const brandColor = platform === "facebook" ? FACEBOOK_COLOR : INSTAGRAM_COLOR;
  const [contentType, setContentType] = useState<PublishingContent>("post");
  const [visibleCount, setVisibleCount] = useState(100);
  const [search, setSearch] = useState("");
  const [scanNotice, setScanNotice] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [intro, setIntro] = useState(DEFAULT_INTRO);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [showAllFacebookPreview, setShowAllFacebookPreview] = useState(false);
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

  const filteredProducts = useMemo(() => {
    return products.filter((product) =>
      eligibleForSocialPublishing(product) &&
      matchesSocialPublishingProduct(product, search)
    );
  }, [products, search]);
  const usablePhoto = (value: string) => {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return false;
      if (contentType === "story") {
        return platform === "instagram"
          ? /\.jpe?g$/i.test(url.pathname)
          : /\.(?:jpe?g|png)$/i.test(url.pathname);
      }
      return true;
    } catch {
      return false;
    }
  };
  const visibleProducts = useMemo(
    () => filteredProducts.slice(0, visibleCount),
    [filteredProducts, visibleCount],
  );

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


  const acceptBarcode = (rawValue: string) => {
    const barcode = rawValue.trim();
    if (!barcode) return;
    const exact = exactSocialPublishingBarcodeMatches(products, barcode);
    setSearch(barcode);
    setVisibleCount(100);
    setPreview(null);
    setShowAllFacebookPreview(false);
    setPublishedUrl(null);
    setIgCarouselPreview(null);
    setIgCarouselError("");
    setIgCarouselResult(null);
    setIgCarouselSuccess(false);
    if (exact.length === 1) {
      const product = exact[0];
      setSelectedIds((current) => (
        current.includes(product.id) ? current : [...current, product.id]
      ));
      setScanNotice("✓ تم اختيار الموديل #" + product.id + " — " + product.nameAr);
    } else if (exact.length > 1) {
      setScanNotice("الباركود مرتبط بأكثر من موديل. اختَر الموديل الصحيح من نتائج البحث.");
    } else {
      setScanNotice("لم نجد موديلًا متوفرًا بهذا الباركود. تأكد من الكود والمخزون.");
    }
  };

  // Exactly the same physical-keycode scanner decoder used by POS
  // and the Lovely Kids product management page: unaffected by Arabic keyboard layout.
  useEffect(() => {
    if (Platform.OS !== "web" || user?.isOwner !== true) return;
    const onScannerKeyDown = (event: KeyboardEvent) => {
      if (!scannerSearchFocused.current) return;
      const scan = captureScannerKeyboardEvent(scannerKeyboard.current, event);
      if (scan && event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        acceptBarcode(scan);
      }
    };
    window.addEventListener("keydown", onScannerKeyDown, true);
    return () => window.removeEventListener("keydown", onScannerKeyDown, true);
  }, [products, user?.isOwner]);

  // Do not keep already selected sold-out products in the owner publishing list.
  useEffect(() => {
    if (products.length === 0 || selectedIds.length === 0) return;
    const eligible = new Set(
      products.filter(eligibleForSocialPublishing).map((product) => product.id),
    );
    if (!selectedIds.some((id) => !eligible.has(id))) return;
    setSelectedIds((current) => current.filter((id) => eligible.has(id)));
    setPreview(null);
    setIgCarouselPreview(null);
    setScanNotice("تم إزالة الموديلات التي نفدت أو أصبحت مخفية من التحديد.");
  }, [products, selectedIds]);

  const stopCamera = () => setScannerOpen(false);

  const onCameraBarcode = (data: string) => {
    if (!data?.trim() || cameraScanAccepted.current) return;
    cameraScanAccepted.current = true;
    stopCamera();
    acceptBarcode(data);
  };

  const openCamera = async () => {
    cameraScanAccepted.current = false;
    setScanNotice("");
    if (Platform.OS !== "web") {
      try {
        const permission = cameraPermission?.granted
          ? cameraPermission
          : await requestCameraPermission();
        if (!permission.granted) {
          Alert.alert("الكاميرا", "يلزم السماح باستخدام الكاميرا لمسح الباركود.");
          return;
        }
      } catch {
        Alert.alert("الكاميرا", "تعذر الحصول على إذن الكاميرا.");
        return;
      }
    }
    setScannerOpen(true);
  };

  // Share the existing product-admin web camera scanner (native detector + ZXing).
  useEffect(() => {
    if (Platform.OS !== "web" || !scannerOpen) return;
    let disposed = false;
    let controls: { stop: () => void } | undefined;
    const timer = setTimeout(() => {
      void startWebBarcodeScanner("social-publishing-barcode-video", (raw) => {
        if (disposed) return;
        disposed = true;
        onCameraBarcode(raw);
      }).then((result) => {
        if (disposed) result.stop();
        else controls = result;
      }).catch(() => {
        if (!disposed) {
          setScannerOpen(false);
          setScanNotice("تعذر تشغيل الكاميرا. يمكنك استخدام البحث اليدوي أو قارئ الباركود.");
        }
      });
    }, 100);
    return () => {
      disposed = true;
      clearTimeout(timer);
      controls?.stop();
    };
  }, [scannerOpen, products]);

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
    setShowAllFacebookPreview(false);
    setIgCarouselPreview(null);
    setIgCarouselError("");
    setIgCarouselResult(null);
    setIgCarouselSuccess(false);
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      return [...current, id];
    });
  };

  const clearSelection = () => {
    if (busy === "publish" || igCarouselBusy === "publish") return;
    setSelectedIds([]);
    setPreview(null);
    setShowAllFacebookPreview(false);
    setPublishedUrl(null);
    setError("");
    setIgCarouselPreview(null);
    setIgCarouselError("");
    setIgCarouselResult(null);
    setIgCarouselSuccess(false);
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
        setShowAllFacebookPreview(false);
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
    backgroundColor: brandColor,
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
        اختَر المنصة ونوع النشر، وبعدها الموديلات المطلوبة. كل عملية نشر تحتاج معاينة وتأكيد منك. نستخدم الصور الأصلية دون إنشاء نسخ على R2.
      </Text>

      <View style={{ ...surface, gap: 10 }}>
        <Text style={{ ...titleStyle, textAlign: "right" }}>1. اختيار المنصة</Text>
        <View style={{ flexDirection: "row-reverse", gap: 10 }}>
          {(["facebook", "instagram"] as const).map((item) => (
            <Pressable
              key={item}
              onPress={() => setPlatform(item)}
              accessibilityRole="button"
              accessibilityState={{ selected: platform === item }}
              style={{
                flex: 1, paddingVertical: 13, borderRadius: 11, alignItems: "center",
                borderWidth: 1, borderColor: platform === item ? (item === "facebook" ? FACEBOOK_COLOR : INSTAGRAM_COLOR) : colors.border,
                backgroundColor: platform === item ? (item === "facebook" ? FACEBOOK_COLOR : INSTAGRAM_COLOR) : colors.background,
                flexDirection: "row-reverse", justifyContent: "center", gap: 8,
              }}
            >
              <Ionicons name={item === "facebook" ? "logo-facebook" : "logo-instagram"}
                size={21} color={platform === item ? "#FFFFFF" : item === "facebook" ? FACEBOOK_COLOR : INSTAGRAM_COLOR} />
              <Text style={{ color: platform === item ? "#FFFFFF" : colors.foreground, fontWeight: "800" }}>
                {item === "facebook" ? "فيسبوك" : "إنستغرام"}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={{ ...titleStyle, textAlign: "right" }}>2. نوع النشر</Text>
        <View style={{ flexDirection: "row-reverse", gap: 10 }}>
          {(["post", "story"] as const).map((item) => (
            <Pressable
              key={item}
              onPress={() => setContentType(item)}
              accessibilityRole="button"
              accessibilityState={{ selected: contentType === item }}
              style={{
                flex: 1, paddingVertical: 13, borderRadius: 11, alignItems: "center",
                borderWidth: 1, borderColor: contentType === item ? brandColor : colors.border,
                backgroundColor: contentType === item ? brandColor : colors.background,
              }}
            >
              <Text style={{ color: contentType === item ? "#FFFFFF" : colors.foreground, fontWeight: "800" }}>
                {item === "post" ? "منشور صور" : "قصص (Stories)"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={{ ...surface, gap: 10 }}>
        <View style={{ flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ ...titleStyle, textAlign: "right", flex: 1 }}>
            3. اختيار الموديلات ({selectedIds.length} مختار)
          </Text>
          <Pressable
            onPress={clearSelection}
            disabled={selectedIds.length === 0 || busy === "publish" || igCarouselBusy === "publish"}
            accessibilityRole="button"
            style={{ borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, opacity: selectedIds.length === 0 ? 0.5 : 1 }}
          >
            <Text style={{ color: colors.foreground, fontWeight: "700" }}>مسح الكل</Text>
          </Pressable>
        </View>
        {selectedIds.length > 0 && (
          <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: 6 }}>
            {selectedIds.slice(0, 8).map((id) => (
              <Pressable
                key={id}
                onPress={() => toggleProduct(id)}
                accessibilityRole="button"
                style={{ borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9, backgroundColor: colors.background }}
              >
                <Text style={{ color: colors.foreground, fontSize: 12 }}>#{id} ×</Text>
              </Pressable>
            ))}
            {selectedIds.length > 8 && (
              <Text style={{ ...muted, textAlign: "right", paddingVertical: 6 }}>
                و{selectedIds.length - 8} موديلات أخرى
              </Text>
            )}
          </View>
        )}
        <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 8 }}>
          <TextInput
            value={search}
            onChangeText={(value) => { setSearch(value); setScanNotice(""); setVisibleCount(100); }}
            onFocus={() => {
              scannerSearchFocused.current = true;
              resetScannerKeyboardBuffer(scannerKeyboard.current);
            }}
            onBlur={() => {
              scannerSearchFocused.current = false;
              resetScannerKeyboardBuffer(scannerKeyboard.current);
            }}
            placeholder="ابحث بالاسم أو الكود أو الباركود / LKQR"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, color: colors.foreground, textAlign: "right" }}
          />
          <Pressable
            onPress={() => void openCamera()}
            accessibilityRole="button"
            accessibilityLabel="مسح باركود أو رمز QR بالكاميرا"
            style={{ borderWidth: 1, borderColor: brandColor, padding: 10, borderRadius: 10, alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="camera-outline" size={24} color={brandColor} />
          </Pressable>
        </View>
        {!!scanNotice && (
          <Text style={{ color: scanNotice.startsWith("✓") ? "#15803D" : "#D97706", textAlign: "right", fontWeight: "700" }}>
            {scanNotice}
          </Text>
        )}
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
                <Image source={{ uri: socialPublishingDisplayImage(product, usablePhoto) }}
                  style={{ height: 68, width: 68, borderRadius: 9, backgroundColor: colors.background }} />
                <View style={{ flex: 1, gap: 4, alignItems: "flex-end" }}>
                  <Text style={{ color: colors.foreground, fontWeight: "700", textAlign: "right" }}>{product.nameAr}</Text>
                  <Text style={muted}>#{product.id} · {product.price} ₪</Text>
                </View>
                <Ionicons
                  name={chosen ? "checkbox" : "square-outline"}
                  size={26}
                  color={chosen ? brandColor : colors.mutedForeground}
                />
              </Pressable>
            );
          })}
          {visibleProducts.length === 0 && <Text style={{ ...muted, textAlign: "center" }}>ما في موديلات مطابقة</Text>}
        </ScrollView>
        {filteredProducts.length > visibleCount && (
          <Pressable
            onPress={() => setVisibleCount((count) => count + 100)}
            accessibilityRole="button"
            style={{ borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingVertical: 11, alignItems: "center" }}
          >
            <Text style={{ color: colors.primary, fontWeight: "700" }}>
              عرض المزيد ({filteredProducts.length - visibleCount} موديل متبقٍ)
            </Text>
          </Pressable>
        )}
        <Text style={{ ...muted, textAlign: "right" }}>
          {platform === "facebook" ? "فيسبوك: بدون حدّ 10 من نظامنا." : "إنستغرام: من 1 إلى 10 قصص، أو 2 إلى 10 صور للمنشور المتعدد."}
        </Text>
        {platform === "instagram" && selectedIds.length > 10 && (
          <Text style={{ color: "#D97706", textAlign: "right", fontWeight: "700" }}>
            اختر 10 موديلات أو أقل لاستخدام أدوات إنستغرام. يمكنك الاحتفاظ بالعدد الأكبر لفيسبوك.
          </Text>
        )}
      </View>


      {platform === "instagram" && contentType === "post" && (
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
      )}


      {/* Keep both Story components mounted across tab changes, preserving the
          in-session attempted-product protection against duplicate publication. */}
      <View style={{ display: platform === "instagram" && contentType === "story" ? "flex" : "none" }}>
        <OwnerInstagramNextStoryPilot selectedIds={selectedIds} />
      </View>
      <View style={{ display: platform === "facebook" && contentType === "story" ? "flex" : "none" }}>
        <OwnerFacebookNextStoryPilot selectedIds={selectedIds} />
      </View>


      {platform === "facebook" && contentType === "post" && (
        <>
      <View style={{ ...surface, gap: 10 }}>
        <Text style={titleStyle}>4. منشور فيسبوك — الوصف الرئيسي (قابل للتعديل)</Text>
        <TextInput
          value={intro}
          onChangeText={(value) => { setIntro(value); setPreview(null); setShowAllFacebookPreview(false); setPublishedUrl(null); }}
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
          <Text style={titleStyle}>4. معاينة منشور فيسبوك ({preview.products.length} صور)</Text>
          {preview.products.slice(0, showAllFacebookPreview ? undefined : 8).map((product) => (
            <View key={product.id} style={{ flexDirection: "row-reverse", alignItems: "center", gap: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Image
                source={{ uri: product.image }}
                style={{ height: 90, width: 90, borderRadius: 10, backgroundColor: colors.background }}
                resizeMode="contain"
              />
              <Text selectable style={{ color: colors.foreground, textAlign: "right", flex: 1, fontSize: 12 }}>
                {product.photoCaption}
              </Text>
            </View>
          ))}
          {preview.products.length > 8 && (
            <Pressable
              onPress={() => setShowAllFacebookPreview((shown) => !shown)}
              accessibilityRole="button"
              style={{ borderWidth: 1, borderColor: colors.border, paddingVertical: 11, alignItems: "center", borderRadius: 10 }}
            >
              <Text style={{ color: colors.primary, fontWeight: "700" }}>
                {showAllFacebookPreview ? "عرض مختصر" : "عرض جميع الصور (" + preview.products.length + ")"}
              </Text>
            </Pressable>
          )}
          <Text style={titleStyle}>الوصف الرئيسي الذي سيظهر مع المنشور</Text>
          <Text selectable style={{ color: colors.foreground, lineHeight: 24, textAlign: "right" }}>{preview.caption}</Text>
          <Text style={{ ...muted, textAlign: "right" }}>
            كل صورة مرتبطة باسم الموديل ورابطه في وصفها. قد لا يُظهر فيسبوك وصف الصورة مباشرة ضمن المنشور متعدد الصور؛ أحيانًا تحتاج الزبونة لفتح الصورة لقراءة التفاصيل. عند اختيار عدد كبير من الصور، قد يطول الإرسال أو ترفض Meta بعض الطلبات؛ راجع الصفحة قبل إعادة أي محاولة.
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

        </>
      )}

      <View style={{ ...surface, gap: 8 }}>
        <Pressable
          onPress={() => setShowConnectionChecks((value) => !value)}
          accessibilityRole="button"
          style={{ flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 }}
        >
          <Text style={{ ...titleStyle, textAlign: "right", flex: 1 }}>
            إعدادات متقدمة — فحص اتصال فيسبوك وإنستغرام
          </Text>
          <Ionicons name={showConnectionChecks ? "chevron-up" : "chevron-down"} size={20} color={colors.primary} />
        </Pressable>
        <Text style={{ ...muted, textAlign: "right" }}>
          الفحوصات للقراءة فقط ولا تنشر أي صور. تم إخفاء أدوات فحص الربط القديم من هذه الصفحة.
        </Text>
        {showConnectionChecks && (
          <View style={{ gap: 12 }}>
            <Text style={{ ...muted, textAlign: "right" }}>
              {configured === true ? "✓ منشورات فيسبوك متصلة بالنظام" :
                configured === false ? "ربط منشورات فيسبوك غير مفعّل؛ المعاينة متاحة." : "حالة منشورات فيسبوك لم تُتحقق بعد."}
            </Text>
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
                    ? `✓ رمز إنستغرام الجديد صالح للحساب ${nextInstagramVerification.username || "Lovely Kids"}. قصص إنستغرام متاحة ضمن قسم القصص على إنستغرام.`
                    : `✗ ${nextInstagramVerification.error || "تعذر فحص اتصال إنستغرام"}`}
                </Text>
              )}
            </View>
          </View>
        )}
      </View>

      <Modal visible={scannerOpen} animationType="fade" transparent
        onRequestClose={stopCamera}>
        <View style={{
          flex: 1, backgroundColor: "rgba(0,0,0,0.83)",
          justifyContent: "center", alignItems: "center", padding: 20,
        }}>
          <View style={{ width: "100%", maxWidth: 420, backgroundColor: "#111", borderRadius: 18, overflow: "hidden" }}>
            {Platform.OS === "web" ? (
              React.createElement("video", {
                id: "social-publishing-barcode-video",
                autoPlay: true,
                muted: true,
                playsInline: true,
                style: { width: "100%", height: 280, objectFit: "cover", backgroundColor: "#000" },
              } as any)
            ) : (
              <CameraView
                facing="back"
                style={{ width: "100%", height: 280 }}
                barcodeScannerSettings={{
                  barcodeTypes: [
                    "ean13", "ean8", "upc_a", "upc_e",
                    "code128", "code39", "code93",
                    "itf14", "codabar", "qr",
                  ],
                }}
                onBarcodeScanned={cameraScanAccepted.current
                  ? undefined
                  : ({ data }) => onCameraBarcode(data)}
              />
            )}
            <View style={{ gap: 12, padding: 16, alignItems: "center" }}>
              <Text style={{ color: "#fff", fontWeight: "800", textAlign: "center" }}>
                وجّه الكاميرا نحو الباركود أو QR — سيتم تحديد الموديل تلقائيًا
              </Text>
              <Pressable onPress={stopCamera} accessibilityRole="button"
                style={{ borderRadius: 20, backgroundColor: "#333", paddingVertical: 11, paddingHorizontal: 26 }}>
                <Text style={{ color: "#fff", fontWeight: "800" }}>إغلاق الكاميرا</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
