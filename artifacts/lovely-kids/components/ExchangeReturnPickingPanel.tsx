import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView, Text, TextInput, View,
} from "react-native";
import { API_BASE } from "@/constants/api";
import { useAuth } from "@/context/AuthContext";
import { startWebBarcodeScanner } from "@/utils/webBarcodeScanner";
import { captureScannerKeyboardEvent, createScannerKeyboardBuffer } from "@/utils/scannerKeyboard";

type Line = {
  key: string; productId: number; name: string; color: string | null;
  size: string | null; required: number; scanned: number; image: string | null;
};
type Scan = { id: string; barcode: string; scannedAt: string; scannedByUserId: number };
type State = {
  publicId: string; verified: boolean; verifiedAt: string | null;
  stale: boolean; canScan: boolean; receivedAt: string | null;
  scannedCount: number; requiredCount: number;
  lines: Line[]; scans: Scan[];
};

type Props = {
  publicId: string;
  onVerifiedChange: (value: boolean) => void;
  disabled?: boolean;
};

const base = "/api/pos/exchanges/online/return-picking";
const requestId = () => `return-scan-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function ExchangeReturnPickingPanel({
  publicId, onVerifiedChange, disabled = false,
}: Props) {
  const { getAuthToken } = useAuth();
  const [data, setData] = useState<State | null>(null);
  const [barcode, setBarcode] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [previewLine, setPreviewLine] = useState<Line | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const busyRef = useRef(false);
  const cameraResultRef = useRef(false);
  const inputFocusedRef = useRef(false);
  const scannerRef = useRef(createScannerKeyboardBuffer());
  const inputRef = useRef<TextInput>(null);

  const request = useCallback(async (suffix: string, payload?: unknown) => {
    const token = await getAuthToken();
    if (!token) throw new Error("انتهت جلسة الدخول. يرجى تسجيل الدخول مجددًا.");
    const url = `${API_BASE}${base}${suffix}${payload === undefined ? `?publicId=${encodeURIComponent(publicId)}` : ""}`;
    const res = await fetch(url, {
      method: payload === undefined ? "GET" : "POST",
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}`,
        ...(payload === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(payload === undefined ? {} : { body: JSON.stringify({ publicId, ...(payload as object) }) }),
    });
    const result = await res.json().catch(() => null);
    if (!res.ok) throw new Error(result?.error || "تعذر الاتصال بفحص طرد التبديل");
    return result as State;
  }, [getAuthToken, publicId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await request(""));
      setError("");
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "تعذر تحميل بيانات المرتجع");
    } finally { setLoading(false); }
  }, [request]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { onVerifiedChange(Boolean(data?.verified)); }, [onVerifiedChange, data?.verified]);

  const scan = useCallback(async (raw: string) => {
    const code = raw.trim();
    if (!code || busyRef.current || disabled || !data?.canScan || data.verified || data.stale) return;
    busyRef.current = true;
    setBusy(true); setBarcode(""); setCameraOpen(false);
    try {
      const next = await request("/scan", { barcode: code, requestId: requestId() });
      setData(next);
      setFeedback(next.verified
        ? "✓ اكتمل الفحص بنسبة 100%. يمكنك الآن تأكيد الاستلام وإرجاع المخزون."
        : "✓ القطعة مطابقة للمرتجع، تم احتساب قطعة واحدة.");
      setError("");
    } catch (e) {
      setFeedback("");
      setError(e instanceof Error ? e.message : "باركود غير مطابق");
      try { setData(await request("")); } catch { /* Keep the original scan error. */ }
    } finally {
      busyRef.current = false; setBusy(false);
      if (Platform.OS === "web") inputRef.current?.focus();
    }
  }, [data?.canScan, data?.stale, data?.verified, disabled, request]);

  // The POS scanner may type a US QR while the Windows keyboard uses Arabic.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    function onKey(event: KeyboardEvent) {
      if (!inputFocusedRef.current) return;
      const value = captureScannerKeyboardEvent(scannerRef.current, event);
      if (!value) return;
      event.preventDefault(); event.stopPropagation();
      void scan(value);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [scan]);

  useEffect(() => {
    if (Platform.OS !== "web" || !cameraOpen) return;
    let disposed = false;
    let controls: { stop: () => void } | undefined;
    cameraResultRef.current = false;
    const timer = setTimeout(() => {
      void startWebBarcodeScanner("exchange-return-camera", value => {
        if (disposed || cameraResultRef.current) return;
        cameraResultRef.current = true;
        setCameraOpen(false);
        void scan(value);
      }).then(result => {
        if (disposed) result.stop();
        else controls = result;
      }).catch(() => {
        if (!disposed) {
          setCameraOpen(false);
          setError("تعذر تشغيل الكاميرا. استخدم قارئ الباركود اليدوي.");
        }
      });
    }, 100);
    return () => { disposed = true; clearTimeout(timer); controls?.stop(); };
  }, [cameraOpen, scan]);

  async function openCamera() {
    if (disabled || busy || !data?.canScan || data.verified) return;
    if (Platform.OS !== "web" && !permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setError("يجب السماح للكاميرا بالعمل"); return;
      }
    }
    cameraResultRef.current = false; setCameraOpen(true);
  }

  const mutate = async (endpoint: string, payload: object, reset: boolean) => {
    if (busyRef.current || disabled) return;
    const proceed = () => {
      void (async () => {
        busyRef.current = true;
        setBusy(true);
        try {
          setData(await request(endpoint, payload));
          setError(""); setFeedback("");
        } catch (e) {
          setError(e instanceof Error ? e.message : "تعذر تحديث المسحات");
        } finally { busyRef.current = false; setBusy(false); }
      })();
    };
    if (!reset) { proceed(); return; }
    const message = "سيتم حذف مسحات الطرد والبدء من جديد، بدون أي تغيير على المخزون أو القيود.";
    if (Platform.OS === "web") {
      if (window.confirm(message)) proceed();
    } else {
      Alert.alert("بدء الفحص من جديد؟", message, [
        { text: "رجوع", style: "cancel" },
        { text: "إعادة الفحص", style: "destructive", onPress: proceed },
      ]);
    }
  };

  const ready = !!data?.canScan && !disabled && !busy;
  const percent = data?.requiredCount
    ? Math.round(100 * data.scannedCount / data.requiredCount) : 0;

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ textAlign: "right", fontWeight: "900", fontSize: 16, color: "#1E293B" }}>
        فحص القطع المرتجعة بالباركود
      </Text>
      <Text style={{ textAlign: "right", color: "#64748B", fontSize: 12 }}>
        المسح للتأكد من الصنف واللون والمقاس والكمية، ولا يرجع المخزون قبل تأكيد الاستلام.
      </Text>
      {loading ? <ActivityIndicator color="#2563EB" /> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: "#B91C1C", backgroundColor: "#FEE2E2", padding: 8, borderRadius: 8, textAlign: "right" }}>{error}</Text> : null}
      {data ? (
        <>
          <View style={{ flexDirection: "row-reverse", justifyContent: "space-between" }}>
            <Text style={{ color: data.verified ? "#15803D" : "#334155", fontWeight: "800" }}>
              {data.verified ? "✓ جميع القطع مطابقة" : `${data.scannedCount} من ${data.requiredCount} قطعة`}
            </Text>
            <Text style={{ fontWeight: "900", color: data.verified ? "#15803D" : "#334155" }}>{percent}%</Text>
          </View>
          <View style={{ backgroundColor: "#E2E8F0", borderRadius: 7, height: 9, overflow: "hidden" }}>
            <View style={{ width: `${percent}%`, height: 9, backgroundColor: data.verified ? "#16A34A" : "#2563EB" }} />
          </View>
          {data.stale ? (
            <Text style={{ color: "#B91C1C", textAlign: "right" }}>
              تغيّرت أصناف أو كميات المرتجع بعد الفحص. يجب إعادة الفحص.
            </Text>
          ) : null}
          <TextInput
            ref={inputRef}
            value={barcode}
            onChangeText={setBarcode}
            placeholder="امسح باركود المرتجع هنا ثم Enter"
            autoCapitalize="none"
            autoCorrect={false}
            selectTextOnFocus
            editable={ready && !data.verified && !data.stale}
            onFocus={() => { inputFocusedRef.current = true; scannerRef.current = createScannerKeyboardBuffer(); }}
            onBlur={() => { inputFocusedRef.current = false; }}
            onSubmitEditing={() => void scan(barcode)}
            style={{ borderColor: "#CBD5E1", borderWidth: 1, borderRadius: 9,
              padding: 11, backgroundColor: "#fff", color: "#0F172A", textAlign: "left", writingDirection: "ltr" }}
          />
          <View style={{ flexDirection: "row-reverse", gap: 8 }}>
            <Pressable disabled={!ready || data.verified || data.stale || !barcode.trim()}
              onPress={() => void scan(barcode)}
              style={{ flex: 1, padding: 12, borderRadius: 9, backgroundColor: "#2563EB",
                opacity: !ready || data.verified || data.stale || !barcode.trim() ? 0.5 : 1 }}>
              <Text style={{ color: "white", fontWeight: "800", textAlign: "center" }}>تحقق من القطعة</Text>
            </Pressable>
            <Pressable disabled={!ready || data.verified || data.stale}
              onPress={() => void openCamera()}
              style={{ flex: 1, padding: 12, borderRadius: 9, backgroundColor: "#334155",
                opacity: !ready || data.verified || data.stale ? 0.5 : 1 }}>
              <Text style={{ color: "white", fontWeight: "800", textAlign: "center" }}>
                <Ionicons name="camera-outline" size={16} color="white" /> الكاميرا
              </Text>
            </Pressable>
          </View>
          {cameraOpen ? (
            <View style={{ gap: 6, overflow: "hidden", borderRadius: 9 }}>
              {Platform.OS === "web" ? React.createElement("video", {
                id: "exchange-return-camera", autoPlay: true, muted: true, playsInline: true,
                style: { width: "100%", height: 230, objectFit: "cover", backgroundColor: "#000" },
              } as any) : (
                <CameraView style={{ height: 230, width: "100%" }}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ["qr", "code128", "ean13", "ean8"] }}
                  onBarcodeScanned={({ data: scanned }) => {
                    if (cameraResultRef.current) return;
                    cameraResultRef.current = true;
                    setCameraOpen(false); void scan(scanned);
                  }}
                />
              )}
              <Pressable onPress={() => setCameraOpen(false)}>
                <Text style={{ textAlign: "center", color: "#B91C1C" }}>إغلاق الكاميرا</Text>
              </Pressable>
            </View>
          ) : null}
          {feedback ? <Text style={{ backgroundColor: "#DCFCE7", color: "#166534", padding: 9,
            textAlign: "right", borderRadius: 8, fontWeight: "800" }}>{feedback}</Text> : null}
          {previewLine?.image ? (
            <View style={{ padding: 10, backgroundColor: "#F8FAFC", borderWidth: 1,
              borderColor: "#CBD5E1", borderRadius: 12, gap: 8 }}>
              <Pressable onPress={() => setPreviewLine(null)}
                accessibilityRole="button"
                accessibilityLabel="إغلاق الصورة المكبرة"
                style={{ flexDirection: "row-reverse", alignItems: "center", gap: 5 }}>
                <Ionicons name="close-circle-outline" color="#475569" size={20} />
                <Text style={{ color: "#475569", fontWeight: "800", fontSize: 12 }}>
                  إغلاق الصورة
                </Text>
              </Pressable>
              <Image source={{ uri: previewLine.image }}
                resizeMode="contain"
                style={{ width: "100%", height: 215, borderRadius: 9, backgroundColor: "#fff" }} />
              <Text style={{ textAlign: "right", color: "#334155", fontWeight: "700", fontSize: 12 }}>
                {previewLine.name} · {previewLine.color || "بدون لون"} · {previewLine.size || "بدون مقاس"}
              </Text>
            </View>
          ) : null}
          <ScrollView style={{ maxHeight: 235 }}
            nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {data.lines.map(line => (
              <View key={line.key} style={{
                flexDirection: "row-reverse", alignItems: "center",
                borderBottomWidth: 1, borderBottomColor: "#E2E8F0", paddingVertical: 8, gap: 9,
              }}>
                {line.image ? (
                  <Pressable onPress={() => setPreviewLine(line)}
                    accessibilityRole="button"
                    accessibilityLabel={`تكبير صورة ${line.name}، اللون ${line.color || "بدون لون"}، المقاس ${line.size || "بدون مقاس"}`}
                    style={{ borderWidth: 1, borderColor: "#E2E8F0",
                      borderRadius: 9, overflow: "hidden", backgroundColor: "#F8FAFC" }}>
                    <Image source={{ uri: line.image }} resizeMode="cover"
                      style={{ width: 58, height: 63 }} />
                  </Pressable>
                ) : (
                  <View style={{ width: 60, height: 65, borderRadius: 9,
                    backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="image-outline" size={23} color="#94A3B8" />
                  </View>
                )}
                <View style={{ flex: 1, alignItems: "flex-end", gap: 3 }}>
                  <Text style={{ fontWeight: "800", color: "#1E293B",
                    textAlign: "right", fontSize: 12 }} numberOfLines={2}>
                    {line.name}
                  </Text>
                  <Text style={{ color: "#64748B", textAlign: "right", fontSize: 12 }}>
                    {line.color || "بدون لون"} · {line.size || "بدون مقاس"}
                  </Text>
                </View>
                <Text style={{ color: line.scanned === line.required ? "#15803D" : "#475569",
                  backgroundColor: line.scanned === line.required ? "#DCFCE7" : "#F1F5F9",
                  paddingHorizontal: 7, paddingVertical: 5, borderRadius: 7,
                  fontWeight: "900", fontSize: 12 }}>
                  {line.scanned}/{line.required}
                </Text>
              </View>
            ))}
          </ScrollView>
          {!!data.scans.length && !data.stale ? (
            <View style={{ gap: 4 }}>
              <Text style={{ fontWeight: "800", color: "#334155", textAlign: "right" }}>آخر المسحات</Text>
              {data.scans.slice(-3).reverse().map(scan => (
                <View key={scan.id} style={{ flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontSize: 11, color: "#64748B" }}>{scan.barcode}</Text>
                  <Pressable disabled={!ready} onPress={() => void mutate("/undo", { scanId: scan.id }, false)}>
                    <Text style={{ color: ready ? "#B91C1C" : "#94A3B8", fontWeight: "800" }}>تراجع</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
          {(data.scannedCount > 0 || data.stale) && data.canScan ? (
            <Pressable disabled={!ready} onPress={() => void mutate("/reset", {}, true)}>
              <Text style={{ color: "#B45309", textAlign: "right", fontWeight: "800" }}>بدء الفحص من جديد</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
