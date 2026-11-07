import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView,
  Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { API_BASE } from "@/constants/api";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { getResponsiveTopPadding } from "@/utils/webLayout";
import { startWebBarcodeScanner } from "@/utils/webBarcodeScanner";
import {
  captureScannerKeyboardEvent, createScannerKeyboardBuffer,
} from "@/utils/scannerKeyboard";

type PickingLine = {
  key: string;
  productId: number;
  name: string;
  image: string | null;
  color: string | null;
  size: string | null;
  required: number;
  scanned: number;
};

type PickingScan = {
  id: string;
  barcode: string;
  scannedAt: string;
  scannedByUserId: number;
};

type PickingState = {
  orderId: number;
  status: string;
  lines: PickingLine[];
  scans: PickingScan[];
  scannedCount: number;
  requiredCount: number;
  stale: boolean;
  verified: boolean;
  verifiedAt: string | null;
  verifiedByUserId: number | null;
  canScan: boolean;
};

const makeScanRequestId = () =>
  `scan-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const styles = {
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 16,
    marginBottom: 12,
  } as const,
  button: {
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 12,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
  },
  buttonText: { color: "#fff", fontWeight: "800" as const, fontSize: 15 },
};

export default function OrderPickingScreen() {
  const params = useLocalSearchParams<{ orderId?: string | string[] }>();
  const orderId = Number(Array.isArray(params.orderId) ? params.orderId[0] : params.orderId);
  const { getAuthToken } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [data, setData] = useState<PickingState | null>(null);
  const [barcode, setBarcode] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<{ text: string; good: boolean } | null>(null);
  const busyRef = useRef(false);
  const cameraResultRef = useRef(false);
  const scannerKeyboardRef = useRef(createScannerKeyboardBuffer());
  const scannerInputFocusedRef = useRef(false);
  const inputRef = useRef<TextInput>(null);

  const request = useCallback(async (path: string, method = "GET", payload?: unknown) => {
    const token = await getAuthToken();
    if (!token) throw new Error("انتهت جلسة الدخول. سجّل الدخول من جديد.");
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const result = await res.json().catch(() => null);
    if (!res.ok) throw new Error(result?.error ?? "تعذّر الاتصال بالخادم");
    return result as PickingState;
  }, [getAuthToken]);

  const refresh = useCallback(async () => {
    if (!Number.isSafeInteger(orderId) || orderId <= 0) {
      setError("رقم الطلب غير صالح");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const state = await request(`/api/orders/${orderId}/picking`);
      setData(state);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر قراءة بيانات التحضير");
    } finally {
      setLoading(false);
    }
  }, [orderId, request]);

  useEffect(() => { void refresh(); }, [refresh]);

  const scanBarcode = useCallback(async (raw: string) => {
    const value = raw.trim();
    if (!value || busyRef.current || !Number.isSafeInteger(orderId)) return;
    busyRef.current = true;
    setBusy(true);
    setCameraOpen(false);
    setBarcode("");
    try {
      const state = await request(
        `/api/orders/${orderId}/picking/scan`,
        "POST",
        { barcode: value, requestId: makeScanRequestId() },
      );
      setData(state);
      setFeedback({
        text: state.verified
          ? "✓ كل القطع مطابقة 100%، تم حفظ نتيجة الفحص. حالة الطلب لم تتغيّر."
          : "✓ الباركود مطابق، تم احتساب قطعة واحدة.",
        good: true,
      });
      setError("");
    } catch (e) {
      setFeedback({ text: e instanceof Error ? e.message : "هذه القطعة غير مطابقة", good: false });
      // Refresh on mismatch too: e.g. the order was edited in another session.
      try {
        setData(await request(`/api/orders/${orderId}/picking`));
      } catch { /* Show the original scanning error. */ }
    } finally {
      busyRef.current = false;
      setBusy(false);
      if (Platform.OS === "web") inputRef.current?.focus();
    }
  }, [orderId, request]);

  // Recover US-layout characters from fast hardware scanners even when
  // the system keyboard is set to Arabic, using the project's existing parser.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!scannerInputFocusedRef.current) return;
      const value = captureScannerKeyboardEvent(scannerKeyboardRef.current, event);
      if (value) {
        event.preventDefault();
        void scanBarcode(value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [scanBarcode]);

  useEffect(() => {
    if (Platform.OS !== "web" || !cameraOpen) return;
    let disposed = false;
    let controls: { stop: () => void } | undefined;
    cameraResultRef.current = false;
    const timer = setTimeout(() => {
      void startWebBarcodeScanner("picking-item-camera", (value) => {
        if (disposed || cameraResultRef.current) return;
        cameraResultRef.current = true;
        setCameraOpen(false);
        void scanBarcode(value);
      }).then(result => {
        if (disposed) result.stop();
        else controls = result;
      }).catch(() => {
        if (!disposed) {
          setCameraOpen(false);
          setFeedback({ text: "تعذّر تشغيل الكاميرا. استخدم قارئ الباركود اليدوي.", good: false });
        }
      });
    }, 100);
    return () => { disposed = true; clearTimeout(timer); controls?.stop(); };
  }, [cameraOpen, scanBarcode]);

  async function openCamera() {
    if (!data?.canScan || busy) return;
    if (Platform.OS !== "web" && !permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setFeedback({ text: "يجب السماح باستخدام الكاميرا لمسح الباركود", good: false });
        return;
      }
    }
    setFeedback(null);
    cameraResultRef.current = false;
    setCameraOpen(true);
  }

  async function mutation(path: string, method: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      setData(await request(path, method));
      setError("");
    } catch (e) {
      setFeedback({ text: e instanceof Error ? e.message : "تعذّر حفظ التغيير", good: false });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function confirmReset() {
    const action = () => void mutation(`/api/orders/${orderId}/picking/reset`, "DELETE");
    const message = "سيتم حذف المسحات المسجلة لهذا الطلب وإعادة فحص كل القطع. لن تتغيّر حالة الطلب ولا المخزون.";
    if (Platform.OS === "web") {
      if (window.confirm(message)) action();
    } else {
      Alert.alert("بدء الفحص من جديد؟", message, [
        { text: "تراجع", style: "cancel" },
        { text: "إعادة الفحص", style: "destructive", onPress: action },
      ]);
    }
  }

  const progress = data?.requiredCount
    ? Math.round((data.scannedCount / data.requiredCount) * 100)
    : 0;
  const canMutate = !!data?.canScan && !busy;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background, flex: 1 }}
      contentContainerStyle={{
        paddingHorizontal: 14,
        paddingTop: getResponsiveTopPadding(insets.top),
        paddingBottom: insets.bottom + 35,
        width: "100%", maxWidth: 850, alignSelf: "center",
      }}
      keyboardShouldPersistTaps="handled"
    >
      <Pressable onPress={() => router.back()} style={{ flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 15 }}>
        <Ionicons name="arrow-forward" color={colors.primary} size={23} />
        <Text style={{ color: colors.primary, fontWeight: "700" }}>الرجوع لإدارة الطلبات</Text>
      </Pressable>

      <View style={styles.card}>
        <Text style={{ fontSize: 23, fontWeight: "900", color: "#172033", textAlign: "right" }}>
          تحضير الطلب #{Number.isSafeInteger(orderId) ? orderId : "—"}
        </Text>
        <Text style={{ marginTop: 6, color: "#64748B", textAlign: "right", lineHeight: 23 }}>
          خطوة اختيارية للتحقق من الموديل واللون والمقاس والعدد. لا يتم تغيير حالة الطلب تلقائيًا، ولا تحدث أي حركة مخزون أو مالية.
        </Text>
        {loading ? <ActivityIndicator style={{ marginTop: 18 }} color={colors.primary} /> : null}
        {error ? <Text accessibilityRole="alert" style={{ color: "#B91C1C", marginTop: 10 }}>{error}</Text> : null}
        {data ? (
          <>
            <View style={{ flexDirection: "row-reverse", justifyContent: "space-between", marginTop: 17 }}>
              <Text style={{ color: "#334155", fontWeight: "800" }}>
                {data.verified ? "✓ تمت مطابقة جميع القطع" : `${data.scannedCount} من ${data.requiredCount} قطعة`}
              </Text>
              <Text style={{ color: data.verified ? "#15803D" : "#475569", fontWeight: "800" }}>{progress}%</Text>
            </View>
            <View style={{ marginTop: 10, backgroundColor: "#E2E8F0", height: 9, borderRadius: 5, overflow: "hidden" }}>
              <View style={{ backgroundColor: data.verified ? "#16A34A" : "#2563EB", height: 9, width: `${progress}%` }} />
            </View>
            {data.verified && (
              <Text style={{ color: "#15803D", fontWeight: "800", textAlign: "right", marginTop: 10 }}>
                ✓ تم التحقق بالباركود {data.verifiedAt ? `— ${new Date(data.verifiedAt).toLocaleString("ar-PS")}` : ""}
              </Text>
            )}
            {data.stale ? (
              <Text style={{ color: "#B91C1C", fontWeight: "800", marginTop: 12, textAlign: "right" }}>
                تغيرت الأصناف أو الكميات بعد الفحص السابق. يجب إعادة الفحص؛ المطابقة القديمة غير معتمدة.
              </Text>
            ) : null}
            {!data.canScan ? (
              <Text style={{ color: "#A16207", marginTop: 12, textAlign: "right" }}>
                هذا الطلب للعرض فقط حاليًا (بسبب الحالة أو الصلاحيات). تغيير الحالة يبقى يدويًا من قائمة الطلبات.
              </Text>
            ) : null}
          </>
        ) : null}
      </View>

      {data && (
        <View style={styles.card}>
          <Text style={{ fontSize: 18, fontWeight: "800", color: "#0F172A", textAlign: "right", marginBottom: 10 }}>
            امسح QR / باركود القطعة
          </Text>
          <TextInput
            ref={inputRef}
            value={barcode}
            onChangeText={setBarcode}
            placeholder="امسح هنا أو أدخل الباركود ثم Enter"
            autoCapitalize="none"
            autoCorrect={false}
            selectTextOnFocus
            onFocus={() => { scannerInputFocusedRef.current = true; scannerKeyboardRef.current = createScannerKeyboardBuffer(); }}
            onBlur={() => { scannerInputFocusedRef.current = false; }}
            onSubmitEditing={() => void scanBarcode(barcode)}
            editable={canMutate && !data.stale && !data.verified}
            style={{
              textAlign: "left", writingDirection: "ltr", backgroundColor: "#F8FAFC",
              borderColor: "#CBD5E1", borderWidth: 1, borderRadius: 11,
              padding: 13, fontSize: 17, marginBottom: 10, color: "#0F172A",
            }}
          />
          <View style={{ gap: 9, flexDirection: "row-reverse", flexWrap: "wrap" }}>
            <Pressable
              disabled={!canMutate || data.stale || data.verified || !barcode.trim()}
              onPress={() => void scanBarcode(barcode)}
              style={[styles.button, { backgroundColor: "#2563EB", opacity: !canMutate || data.stale || data.verified || !barcode.trim() ? 0.5 : 1, flex: 1 }]}
            >
              <Ionicons name="checkmark-circle-outline" size={19} color="#fff" />
              <Text style={styles.buttonText}>تحقق من القطعة</Text>
            </Pressable>
            <Pressable
              disabled={!canMutate || data.stale || data.verified}
              onPress={() => void openCamera()}
              style={[styles.button, { backgroundColor: "#334155", opacity: !canMutate || data.stale || data.verified ? 0.5 : 1, flex: 1 }]}
            >
              <Ionicons name="camera-outline" size={19} color="#fff" />
              <Text style={styles.buttonText}>كاميرا الجوال</Text>
            </Pressable>
          </View>
          {cameraOpen && (
            <View style={{ marginTop: 14, overflow: "hidden", borderRadius: 12 }}>
              {Platform.OS === "web"
                ? React.createElement("video", {
                    id: "picking-item-camera",
                    autoPlay: true, muted: true, playsInline: true,
                    style: { width: "100%", height: 265, objectFit: "cover", backgroundColor: "#000" },
                  } as any)
                : (
                  <CameraView
                    style={{ height: 265, width: "100%" }}
                    facing="back"
                    barcodeScannerSettings={{ barcodeTypes: ["qr", "code128", "ean13", "ean8"] }}
                    onBarcodeScanned={({ data: scanned }) => {
                      if (cameraResultRef.current) return;
                      cameraResultRef.current = true;
                      setCameraOpen(false);
                      void scanBarcode(scanned);
                    }}
                  />
                )}
              <Pressable onPress={() => setCameraOpen(false)} style={[styles.button, { backgroundColor: "#475569" }]}>
                <Text style={styles.buttonText}>إغلاق الكاميرا</Text>
              </Pressable>
            </View>
          )}
          {feedback && (
            <Text accessibilityRole="alert" style={{
              color: feedback.good ? "#166534" : "#B91C1C",
              backgroundColor: feedback.good ? "#DCFCE7" : "#FEE2E2",
              padding: 13, borderRadius: 10, textAlign: "right", marginTop: 12, fontWeight: "800",
            }}>
              {feedback.text}
            </Text>
          )}
          {data.canScan && (data.scannedCount > 0 || data.stale || data.verified) && (
            <Pressable disabled={busy} onPress={confirmReset} style={{ paddingVertical: 12, alignSelf: "flex-end" }}>
              <Text style={{ color: "#B45309", fontWeight: "800" }}>بدء الفحص من جديد</Text>
            </Pressable>
          )}
        </View>
      )}

      {data && (
        <View style={styles.card}>
          <Text style={{ color: "#0F172A", fontSize: 19, fontWeight: "800", textAlign: "right", marginBottom: 8 }}>
            تفاصيل المطابقة
          </Text>
          {data.lines.map(line => {
            const done = line.scanned === line.required;
            return (
              <View key={line.key} style={{
                borderBottomColor: "#E2E8F0", borderBottomWidth: 1,
                paddingVertical: 11, flexDirection: "row-reverse", alignItems: "center", gap: 11,
              }}>
                {line.image ? (
                  <Image source={{ uri: line.image }} style={{ width: 59, height: 65, borderRadius: 8 }} />
                ) : <Ionicons name="shirt-outline" size={28} color="#64748B" />}
                <View style={{ flex: 1, alignItems: "flex-end", gap: 4 }}>
                  <Text style={{ fontWeight: "800", color: "#1E293B", textAlign: "right" }}>{line.name}</Text>
                  <Text style={{ color: "#64748B" }}>
                    اللون: {line.color || "بدون"} · المقاس: {line.size || "بدون"}
                  </Text>
                  <Text style={{ color: done ? "#15803D" : "#475569", fontWeight: "800" }}>
                    {line.scanned} / {line.required} {done ? "✓ مطابق" : "بانتظار المسح"}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {!!data?.scans.length && !data.stale && (
        <View style={styles.card}>
          <Text style={{ color: "#0F172A", fontWeight: "800", fontSize: 17, textAlign: "right", marginBottom: 9 }}>
            آخر المسحات
          </Text>
          {[...data.scans].reverse().map(scan => (
            <View key={scan.id} style={{
              flexDirection: "row-reverse", justifyContent: "space-between",
              alignItems: "center", gap: 10, marginBottom: 8,
            }}>
              <View style={{ flex: 1, alignItems: "flex-end" }}>
                <Text style={{ fontSize: 13, color: "#334155", textAlign: "right" }}>{scan.barcode}</Text>
                <Text style={{ color: "#94A3B8", fontSize: 11 }}>
                  {new Date(scan.scannedAt).toLocaleString("ar-PS")}
                </Text>
              </View>
              {data.canScan && (
                <Pressable
                  disabled={busy}
                  onPress={() => void mutation(`/api/orders/${orderId}/picking/scans/${scan.id}`, "DELETE")}
                  style={{ padding: 9 }}
                >
                  <Text style={{ color: "#B91C1C", fontWeight: "700" }}>تراجع</Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}
      <Pressable
        onPress={() => void refresh()}
        disabled={loading || busy}
        style={[styles.button, { borderColor: "#CBD5E1", borderWidth: 1, marginTop: 4 }]}
      >
        <Ionicons name="refresh-outline" color="#475569" size={18} />
        <Text style={{ color: "#475569", fontWeight: "800" }}>تحديث نتيجة الفحص</Text>
      </Pressable>
    </ScrollView>
  );
}
