import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Print from "expo-print";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useNewOrders } from "@/context/NewOrdersContext";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

import { API_BASE } from "@/constants/api";
import { createOrderPrintHtml } from "@/utils/orderPrint";
import { startWebBarcodeScanner } from "@/utils/webBarcodeScanner";

interface OrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  size?: string;
  color?: string;
}

interface Order {
  id: number;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  items: OrderItem[];
  totalPrice: number;
  shippingZone?: string;
  shippingCost?: number;
  status: string;
  notes?: string;
  paymentMethod: string;
  paymentStatus: string;
  paymentProof?: string;
  printedAt?: string | null;
  printCount?: number;
  createdAt: string;
}

const STATUS_OPTIONS = [
  { key: "new", label: "جديد", color: "#E91E8C", icon: "star-outline" as const },
  { key: "confirmed", label: "مؤكد", color: "#2196F3", icon: "checkmark-circle-outline" as const },
  { key: "delivering", label: "قيد التوصيل", color: "#FF9800", icon: "bicycle-outline" as const },
  { key: "done", label: "تم التسليم", color: "#22c55e", icon: "bag-check-outline" as const },
  { key: "cancelled", label: "ملغي", color: "#ef4444", icon: "close-circle-outline" as const },
];

const ORDER_TRANSITIONS: Record<string, readonly string[]> = {
  new: ["confirmed", "cancelled"],
  confirmed: ["new", "delivering", "cancelled"],
  delivering: ["new", "confirmed", "done", "cancelled"],
  done: [],
  cancelled: [],
};

function statusInfo(s: string) {
  return STATUS_OPTIONS.find((o) => o.key === s) ?? STATUS_OPTIONS[0];
}

function paymentMethodLabel(m: string) {
  return m === "bank_transfer" ? "تحويل بنكي" : "عند الاستلام";
}

function paymentStatusInfo(s: string) {
  switch (s) {
    case "proof_submitted": return { label: "وصل مُرفق", color: "#FF9800", icon: "image-outline" as const };
    case "confirmed": return { label: "مدفوع ✓", color: "#22c55e", icon: "checkmark-circle-outline" as const };
    case "awaiting_transfer": return { label: "بانتظار التحويل", color: "#9B59B6", icon: "time-outline" as const };
    default: return { label: "الدفع عند الاستلام", color: "#607D8B", icon: "cash-outline" as const };
  }
}

function timeAgo(dateStr: string) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return "الآن";
  if (diff < 3600) return `منذ ${Math.floor(diff / 60)} دقيقة`;
  if (diff < 86400) return `منذ ${Math.floor(diff / 3600)} ساعة`;
  return `منذ ${Math.floor(diff / 86400)} يوم`;
}

export default function AdminOrdersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { newCount, clearNew } = useNewOrders();
  const { getAuthToken } = useAuth();
  const params = useLocalSearchParams<{ orderId?: string | string[] }>();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [proofModal, setProofModal] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [pendingOrderIds, setPendingOrderIds] = useState<Set<number>>(new Set());
  const [printingId, setPrintingId] = useState<number | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [qrScanned, setQrScanned] = useState(false);
  const pendingOrderIdsRef = useRef<Set<number>>(new Set());
  const ordersFetchVersionRef = useRef(0);
  const listRef = useRef<FlatList<Order>>(null);
  const openedOrderParamRef = useRef<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bannerAnim = useRef(new Animated.Value(-80)).current;
  const bannerCount = useRef(0);

  const showError = (msg: string) => {
    setErrorMsg(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setErrorMsg(null), 4000);
  };

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 16;

  const showNotificationBanner = useCallback((count: number) => {
    bannerCount.current = count;
    setShowBanner(true);
    Animated.sequence([
      Animated.spring(bannerAnim, { toValue: 0, useNativeDriver: true, tension: 80, friction: 8 }),
      Animated.delay(3000),
      Animated.timing(bannerAnim, { toValue: -80, useNativeDriver: true, duration: 300 }),
    ]).start(() => setShowBanner(false));
  }, [bannerAnim]);

  const fetchOrders = useCallback(async () => {
    if (pendingOrderIdsRef.current.size > 0) { setRefreshing(false); return; }
    const fetchVersion = ordersFetchVersionRef.current;
    const token = await getAuthToken();
    if (!token) {
      setOrders([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/orders`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (fetchVersion !== ordersFetchVersionRef.current) return;
      setOrders(Array.isArray(data) ? data : []);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getAuthToken]);

  useEffect(() => {
    if (newCount > 0) {
      showNotificationBanner(newCount);
      fetchOrders();
    }
  }, [newCount, showNotificationBanner, fetchOrders]);

  useEffect(() => {
    clearNew();
    return () => {};
  }, [clearNew]);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 30000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  const updateStatus = async (id: number, status: string) => {
    if (pendingOrderIdsRef.current.has(id)) return;
    const order = orders.find((o) => o.id === id);
    const previousStatus = order?.status;
    if (!previousStatus || previousStatus === status) return;
    const allowed = ORDER_TRANSITIONS[previousStatus] ?? [];
    if (!allowed.includes(status)) return;
    pendingOrderIdsRef.current.add(id);
    ordersFetchVersionRef.current += 1;
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    setPendingOrderIds((prev) => new Set(prev).add(id));
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const token = await getAuthToken();
      if (!token) throw new Error("انتهت جلسة تسجيل الدخول");
      const res = await fetch(`${API_BASE}/api/orders/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        let msg = "تعذر تحديث الحالة";
        try { const body = await res.json() as { error?: string }; if (body.error) msg = body.error; } catch { /* ignore */ }
        throw new Error(msg);
      }
      const updatedOrder = (await res.json()) as Order;
      setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, ...updatedOrder } : o)));
    } catch (error) {
      setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status: previousStatus } : o)));
      const msg = error instanceof Error ? error.message : "حدث خطأ غير متوقع";
      showError(msg);
      if (Platform.OS !== "web") Alert.alert("تعذر تحديث الحالة", msg);
    } finally {
      pendingOrderIdsRef.current.delete(id);
      setPendingOrderIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  };

  const confirmPayment = async (id: number) => {
    try {
      const token = await getAuthToken();
      if (!token) return;
      const res = await fetch(`${API_BASE}/api/orders/${id}/confirm-payment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setOrders((prev) =>
          prev.map((o) =>
            o.id === id ? { ...o, paymentStatus: "confirmed", status: "confirmed" } : o
          )
        );
      }
    } catch {
      // ignore
    }
  };

  const deleteOrder = async (id: number) => {
    if (pendingOrderIdsRef.current.has(id)) return;
    setDeleteConfirmId(null);
    const deletedOrder = orders.find((o) => o.id === id);
    if (!deletedOrder) return;
    const deletedIndex = orders.findIndex((o) => o.id === id);
    setOrders((prev) => prev.filter((o) => o.id !== id));
    setPendingOrderIds((prev) => new Set(prev).add(id));
    try {
      const token = await getAuthToken();
      if (!token) throw new Error("انتهت جلسة تسجيل الدخول");
      const res = await fetch(`${API_BASE}/api/orders/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("تعذر حذف الطلب");
      if (expanded === id) setExpanded(null);
    } catch {
      setOrders((prev) => [...prev.slice(0, deletedIndex), deletedOrder, ...prev.slice(deletedIndex)]);
    }
    finally { pendingOrderIdsRef.current.delete(id); setPendingOrderIds((prev) => { const next = new Set(prev); next.delete(id); return next; }); }
  };

  const confirmDeleteOrder = (id: number) => {
    setDeleteConfirmId(id);
  };

  const callCustomer = (phone: string) => Linking.openURL(`tel:${phone}`);
  const whatsappCustomer = (phone: string, orderId: number) => {
    const msg = encodeURIComponent(`مرحباً! بخصوص طلبك رقم #${orderId} من Lovely Kids 🛍️`);
    Linking.openURL(`https://wa.me/970${phone.replace(/^0/, "")}?text=${msg}`);
  };

  const openOrderById = useCallback((id: number) => {
    const index = orders.findIndex((order) => order.id === id);

    if (index < 0) {
      showError(`الطلب #${id} غير موجود`);
      return false;
    }

    setExpanded(id);

    setTimeout(() => {
      try {
        listRef.current?.scrollToIndex({
          index,
          animated: true,
          viewPosition: 0.15,
        });
      } catch {
        // FlatList may still be measuring.
      }
    }, 120);

    return true;
  }, [orders]);

  const parseOrderQr = useCallback((value: string): number | null => {
    const raw = value.trim();
    if (!raw) return null;

    try {
      const url = new URL(raw, "https://lovelykids.net");

      if (url.pathname.replace(/\/+$/, "") !== "/admin/orders") {
        return null;
      }

      const id = Number(url.searchParams.get("orderId"));

      if (!Number.isInteger(id) || id <= 0) {
        return null;
      }

      return id;
    } catch {
      return null;
    }
  }, []);

  const handleScannedOrderQr = useCallback((value: string) => {
    const id = parseOrderQr(value);

    if (id === null) {
      showError("هذا QR ليس تابعاً لطلب Lovely Kids");
      setScannerOpen(false);
      return;
    }

    setScannerOpen(false);
    openOrderById(id);
  }, [openOrderById, parseOrderQr]);

  const handleOpenQrScanner = async () => {
    if (Platform.OS === "web") {
      setQrScanned(false);
      setScannerOpen(true);
      return;
    }

    if (CameraView.isModernBarcodeScannerAvailable) {
      try {
        await CameraView.launchScanner({
          barcodeTypes: ["qr"],
        });
      } catch {
        showError("تعذر تشغيل ماسح QR");
      }
      return;
    }

    const permission = cameraPermission?.granted
      ? cameraPermission
      : await requestCameraPermission();

    if (!permission.granted) {
      Alert.alert(
        "صلاحية الكاميرا",
        "يجب السماح باستخدام الكاميرا لمسح QR الطلب",
      );
      return;
    }

    setQrScanned(false);
    setScannerOpen(true);
  };

  const confirmPrintSuccess = (): Promise<boolean> => {
    if (Platform.OS === "web") {
      return Promise.resolve(
        window.confirm("هل تمت طباعة الطلب بنجاح؟"),
      );
    }

    return new Promise((resolve) => {
      Alert.alert(
        "تأكيد الطباعة",
        "هل تمت طباعة الطلب بنجاح؟",
        [
          {
            text: "لا",
            style: "cancel",
            onPress: () => resolve(false),
          },
          {
            text: "نعم، تمت",
            onPress: () => resolve(true),
          },
        ],
        {
          cancelable: false,
        },
      );
    });
  };

  const handlePrintOrder = async (order: Order) => {
    if (printingId !== null) return;

    let printWindow: Window | null = null;

    if (Platform.OS === "web") {
      printWindow = window.open(
        "",
        "_blank",
        "width=900,height=750",
      );

      if (!printWindow) {
        showError("اسمح بالنوافذ المنبثقة حتى نفتح صفحة الطباعة");
        return;
      }

      printWindow.document.write(
        '<div dir="rtl" style="font-family:Arial;padding:30px;text-align:center">جاري تجهيز الطلب للطباعة...</div>',
      );
    }

    setPrintingId(order.id);

    try {
      const html = await createOrderPrintHtml(order);

      if (Platform.OS === "web") {
        if (!printWindow) {
          throw new Error("تعذر فتح نافذة الطباعة");
        }

        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();

        await new Promise((resolve) => setTimeout(resolve, 300));

        printWindow.focus();
        printWindow.print();
      } else {
        await Print.printAsync({ html });
      }

      const confirmed = await confirmPrintSuccess();

      if (!confirmed) {
        return;
      }

      const token = await getAuthToken();

      if (!token) {
        throw new Error("انتهت جلسة تسجيل الدخول");
      }

      const res = await fetch(
        `${API_BASE}/api/orders/${order.id}/print`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (!res.ok) {
        let message = "تمت الطباعة لكن تعذر تسجيلها";

        try {
          const body = await res.json() as { error?: string };
          if (body.error) message = body.error;
        } catch {
          // ignore invalid error body
        }

        throw new Error(message);
      }

      const updated = await res.json() as Order;

      setOrders((prev) =>
        prev.map((item) =>
          item.id === order.id
            ? { ...item, ...updated }
            : item,
        ),
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "تعذر طباعة الطلب";

      showError(message);

      if (Platform.OS !== "web") {
        Alert.alert("خطأ", message);
      }
    } finally {
      setPrintingId(null);
    }
  };

  useEffect(() => {
    const rawParam = Array.isArray(params.orderId)
      ? params.orderId[0]
      : params.orderId;

    if (!rawParam || openedOrderParamRef.current === rawParam) {
      return;
    }

    const id = Number(rawParam);

    if (!Number.isInteger(id) || id <= 0 || orders.length === 0) {
      return;
    }

    if (openOrderById(id)) {
      openedOrderParamRef.current = rawParam;
    }
  }, [params.orderId, orders.length, openOrderById]);

  useEffect(() => {
    if (
      Platform.OS === "web" ||
      !CameraView.isModernBarcodeScannerAvailable
    ) {
      return;
    }

    const subscription =
      CameraView.onModernBarcodeScanned(({ data }) => {
        if (!data?.trim()) return;
        handleScannedOrderQr(data);
      });

    return () => subscription.remove();
  }, [handleScannedOrderQr]);

  useEffect(() => {
    if (Platform.OS !== "web" || !scannerOpen) {
      return;
    }

    let disposed = false;
    let controls: { stop: () => void } | undefined;

    const timer = setTimeout(() => {
      void startWebBarcodeScanner(
        "orders-qr-video",
        (value) => {
          if (disposed) return;

          disposed = true;
          setQrScanned(true);
          handleScannedOrderQr(value);
        },
      )
        .then((result) => {
          if (disposed) {
            result.stop();
          } else {
            controls = result;
          }
        })
        .catch(() => {
          if (!disposed) {
            setScannerOpen(false);
            showError("تعذر تشغيل الكاميرا");
          }
        });
    }, 100);

    return () => {
      disposed = true;
      clearTimeout(timer);
      controls?.stop();
    };
  }, [scannerOpen, handleScannedOrderQr]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Notification Banner */}
      {showBanner && (
        <Animated.View style={[styles.notifBanner, { transform: [{ translateY: bannerAnim }] }]}>
          <Ionicons name="notifications" size={20} color="#fff" />
          <Text style={styles.notifText}>🔔 وصل {bannerCount.current} طلب جديد!</Text>
          <Pressable onPress={() => { bannerAnim.setValue(-80); setShowBanner(false); }}>
            <Ionicons name="close" size={18} color="rgba(255,255,255,0.8)" />
          </Pressable>
        </Animated.View>
      )}

      {/* Error Banner */}
      {errorMsg !== null && (
        <Pressable style={styles.errorBanner} onPress={() => setErrorMsg(null)}>
          <Ionicons name="alert-circle-outline" size={18} color="#fff" />
          <Text style={styles.errorBannerText}>{errorMsg}</Text>
          <Ionicons name="close" size={16} color="rgba(255,255,255,0.8)" />
        </Pressable>
      )}

      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12, backgroundColor: colors.primary }]}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-forward" size={24} color="#fff" />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>الطلبات</Text>
          {newCount > 0 && (
            <View style={styles.newBadge}>
              <Text style={styles.newBadgeText}>{newCount} جديد</Text>
            </View>
          )}
        </View>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => void handleOpenQrScanner()}
            hitSlop={8}
          >
            <Ionicons name="scan-outline" size={23} color="#fff" />
          </Pressable>

          <Pressable
            onPress={() => {
              setRefreshing(true);
              fetchOrders();
            }}
            hitSlop={8}
          >
            <Ionicons name="refresh-outline" size={22} color="#fff" />
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>جاري التحميل...</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={orders}
          onScrollToIndexFailed={({ index }) => {
            setTimeout(() => {
              listRef.current?.scrollToIndex({
                index,
                animated: true,
                viewPosition: 0.15,
              });
            }, 300);
          }}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={[styles.list, { paddingBottom: bottomPadding }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchOrders(); }} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="bag-outline" size={56} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>لا توجد طلبات بعد</Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>ستظهر الطلبات هنا فور استلامها</Text>
            </View>
          }
          renderItem={({ item }) => {
            const st = statusInfo(item.status);
            const pst = paymentStatusInfo(item.paymentStatus);
            const isOpen = expanded === item.id;
            const hasBankTransfer = item.paymentMethod === "bank_transfer";
            const hasProof = !!item.paymentProof;
            const paymentConfirmed = item.paymentStatus === "confirmed";

            return (
              <Pressable
                onPress={() => setExpanded(isOpen ? null : item.id)}
                style={[
                  styles.orderCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: item.paymentStatus === "proof_submitted"
                      ? "#FF9800"
                      : item.status === "new"
                      ? colors.primary
                      : colors.border,
                    borderWidth: (item.status === "new" || item.paymentStatus === "proof_submitted") ? 2 : 1,
                  },
                ]}
              >
                {/* Card Header */}
                <View style={styles.cardTop}>
                  <View style={styles.cardTopLeft}>
                    <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.mutedForeground} />
                  </View>
                  <View style={styles.cardTopRight}>
                    <View style={styles.orderIdRow}>
                      <Text style={[styles.orderId, { color: colors.primary }]}>#{item.id}</Text>
                      {item.status === "new" && (
                        <View style={[styles.newDot, { backgroundColor: colors.primary }]}>
                          <Text style={styles.newDotText}>جديد</Text>
                        </View>
                      )}
                      {item.paymentStatus === "proof_submitted" && (
                        <View style={[styles.newDot, { backgroundColor: "#FF9800" }]}>
                          <Text style={styles.newDotText}>وصل مُرفق</Text>
                        </View>
                      )}

                      {(item.printCount ?? 0) > 0 && (
                        <View style={[styles.newDot, { backgroundColor: "#22c55e" }]}>
                          <Text style={styles.newDotText}>
                            مطبوعة ×{item.printCount}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.customerName, { color: colors.foreground }]}>{item.customerName}</Text>
                    <Text style={[styles.timeAgo, { color: colors.mutedForeground }]}>{timeAgo(item.createdAt)}</Text>
                  </View>
                  <View style={styles.statusBadges}>
                    <View style={[styles.statusChip, { backgroundColor: st.color + "20" }]}>
                      <Ionicons name={st.icon} size={13} color={st.color} />
                      <Text style={[styles.statusText, { color: st.color }]}>{st.label}</Text>
                    </View>
                    {hasBankTransfer && (
                      <View style={[styles.statusChip, { backgroundColor: pst.color + "20" }]}>
                        <Ionicons name={pst.icon} size={13} color={pst.color} />
                        <Text style={[styles.statusText, { color: pst.color }]}>{pst.label}</Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Price row */}
                <View style={[styles.priceRow, { borderTopColor: colors.border }]}>
                  <View style={styles.priceLeft}>
                    <Text style={[styles.payMethodBadge, { color: hasBankTransfer ? "#9B59B6" : "#607D8B" }]}>
                      {hasBankTransfer ? "💳" : "💵"} {paymentMethodLabel(item.paymentMethod)}
                    </Text>
                  </View>
                  <Text style={[styles.totalAmount, { color: colors.primary }]}>{item.totalPrice}₪</Text>
                </View>

                {/* Expanded Details */}
                {isOpen && (
                  <View style={styles.expandedContent}>
                    {/* Contact */}
                    <View style={[styles.infoSection, { backgroundColor: colors.background }]}>
                      <View style={styles.infoRow}>
                        <Ionicons name="location-outline" size={16} color={colors.mutedForeground} />
                        <Text style={[styles.infoText, { color: colors.foreground }]}>{item.customerAddress}</Text>
                      </View>
                      {item.shippingZone ? (
                        <View style={styles.infoRow}>
                          <Ionicons name="bicycle-outline" size={16} color={colors.mutedForeground} />
                          <Text style={[styles.infoText, { color: colors.foreground }]}>
                            منطقة التوصيل: {item.shippingZone}
                            {item.shippingCost != null ? ` — ${item.shippingCost}₪` : ""}
                          </Text>
                        </View>
                      ) : null}
                      <View style={styles.infoRow}>
                        <Ionicons name="call-outline" size={16} color={colors.mutedForeground} />
                        <Text style={[styles.infoText, { color: colors.foreground }]}>{item.customerPhone}</Text>
                      </View>
                      {item.notes ? (
                        <View style={styles.infoRow}>
                          <Ionicons name="document-text-outline" size={16} color={colors.mutedForeground} />
                          <Text style={[styles.infoText, { color: colors.foreground }]}>{item.notes}</Text>
                        </View>
                      ) : null}
                    </View>

                    {/* Items */}
                    <View style={[styles.itemsSection, { backgroundColor: colors.background }]}>
                      <Text style={[styles.sectionLabel, { color: colors.foreground }]}>المنتجات:</Text>
                      {item.items.map((oi, idx) => (
                        <View key={idx} style={styles.orderItemCard}>
                          {oi.image ? (
                            <Pressable onPress={() => setProofModal(oi.image!)}>
                              <Image source={{ uri: oi.image }} style={styles.orderItemImage} resizeMode="cover" />
                            </Pressable>
                          ) : (
                            <View style={[styles.orderItemImage, styles.orderItemImagePlaceholder, { backgroundColor: colors.secondary }]}>
                              <Ionicons name="image-outline" size={20} color={colors.mutedForeground} />
                            </View>
                          )}
                          <View style={styles.orderItemInfo}>
                            <Text style={[styles.orderItemName, { color: colors.foreground }]} numberOfLines={2}>
                              {oi.name} x{oi.quantity}
                            </Text>
                            <View style={styles.orderItemVariantRow}>
                              {oi.color ? (
                                <View style={[styles.variantChip, { backgroundColor: colors.secondary }]}>
                                  <Text style={[styles.variantChipText, { color: colors.foreground }]}>اللون: {oi.color}</Text>
                                </View>
                              ) : null}
                              {oi.size ? (
                                <View style={[styles.variantChip, { backgroundColor: colors.secondary }]}>
                                  <Text style={[styles.variantChipText, { color: colors.foreground }]}>المقاس: {oi.size}</Text>
                                </View>
                              ) : null}
                            </View>
                          </View>
                          <Text style={[styles.orderItemPrice, { color: colors.primary }]}>{oi.price * oi.quantity}₪</Text>
                        </View>
                      ))}
                    </View>

                    {/* Payment Proof Section */}
                    {hasBankTransfer && (
                      <View style={[styles.proofSection, { backgroundColor: colors.background, borderColor: hasProof ? "#FF9800" : colors.border }]}>
                        <Text style={[styles.sectionLabel, { color: colors.foreground }]}>التحويل البنكي:</Text>

                        {hasProof ? (
                          <>
                            <Pressable onPress={() => setProofModal(item.paymentProof!)} style={styles.proofThumbContainer}>
                              <Image source={{ uri: item.paymentProof! }} style={styles.proofThumb} resizeMode="cover" />
                              <View style={styles.proofOverlay}>
                                <Ionicons name="expand-outline" size={22} color="#fff" />
                                <Text style={styles.proofViewText}>اضغط للتكبير</Text>
                              </View>
                            </Pressable>

                            {!paymentConfirmed && (
                              <Pressable
                                onPress={() => confirmPayment(item.id)}
                                style={[styles.confirmPayBtn, { backgroundColor: "#22c55e" }]}
                              >
                                <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                                <Text style={styles.confirmPayBtnText}>تأكيد استلام الدفع ✓</Text>
                              </Pressable>
                            )}

                            {paymentConfirmed && (
                              <View style={[styles.confirmedBadge, { backgroundColor: "#22c55e20" }]}>
                                <Ionicons name="checkmark-circle" size={18} color="#22c55e" />
                                <Text style={[styles.confirmedText, { color: "#22c55e" }]}>تم تأكيد الدفع</Text>
                              </View>
                            )}
                          </>
                        ) : (
                          <View style={[styles.noProofBox, { borderColor: colors.border }]}>
                            <Ionicons name="time-outline" size={20} color={colors.mutedForeground} />
                            <Text style={[styles.noProofText, { color: colors.mutedForeground }]}>
                              {item.paymentStatus === "awaiting_transfer"
                                ? "بانتظار رفع وصل التحويل من الزبون"
                                : "لم يُرفع وصل التحويل بعد"}
                            </Text>
                          </View>
                        )}
                      </View>
                    )}

                    {/* Print */}
                    <View
                      style={[
                        styles.printSection,
                        {
                          backgroundColor: colors.background,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <View style={styles.printStatusRow}>
                        <Ionicons
                          name={(item.printCount ?? 0) > 0 ? "checkmark-circle" : "print-outline"}
                          size={18}
                          color={(item.printCount ?? 0) > 0 ? "#22c55e" : colors.mutedForeground}
                        />

                        <View style={styles.printStatusTextWrap}>
                          <Text
                            style={[
                              styles.printStatusTitle,
                              { color: colors.foreground },
                            ]}
                          >
                            {(item.printCount ?? 0) > 0
                              ? `تمت الطباعة ${item.printCount} مرة`
                              : "لم تتم طباعة الطلب"}
                          </Text>

                          {item.printedAt ? (
                            <Text
                              style={[
                                styles.printStatusSub,
                                { color: colors.mutedForeground },
                              ]}
                            >
                              آخر طباعة: {new Date(item.printedAt).toLocaleString("ar-EG")}
                            </Text>
                          ) : null}
                        </View>
                      </View>

                      <Pressable
                        disabled={printingId !== null}
                        onPress={(event) => {
                          event.stopPropagation();
                          void handlePrintOrder(item);
                        }}
                        style={[
                          styles.printBtn,
                          {
                            backgroundColor:
                              printingId === item.id
                                ? colors.mutedForeground
                                : colors.primary,
                            opacity:
                              printingId !== null && printingId !== item.id
                                ? 0.55
                                : 1,
                          },
                        ]}
                      >
                        {printingId === item.id ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Ionicons
                            name="print-outline"
                            size={19}
                            color="#fff"
                          />
                        )}

                        <Text style={styles.printBtnText}>
                          {printingId === item.id
                            ? "جاري تجهيز الطباعة..."
                            : (item.printCount ?? 0) > 0
                            ? "إعادة طباعة"
                            : "طباعة الطلب"}
                        </Text>
                      </Pressable>
                    </View>

                    {/* Contact Buttons */}
                    <View style={styles.contactBtns}>
                      <Pressable
                        onPress={() => whatsappCustomer(item.customerPhone, item.id)}
                        style={[styles.contactBtn, { backgroundColor: "#25D366" }]}
                      >
                        <Ionicons name="logo-whatsapp" size={18} color="#fff" />
                        <Text style={styles.contactBtnText}>واتساب</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => callCustomer(item.customerPhone)}
                        style={[styles.contactBtn, { backgroundColor: colors.secondary }]}
                      >
                        <Ionicons name="call-outline" size={18} color={colors.foreground} />
                        <Text style={[styles.contactBtnText, { color: colors.foreground }]}>اتصال</Text>
                      </Pressable>
                    </View>

                    {/* Status Change */}
                    <Text style={[styles.sectionLabel, { color: colors.foreground }]}>تغيير الحالة:</Text>
                    <View style={styles.statusBtns}>
                      {STATUS_OPTIONS.map((s) => (
                        <Pressable
                          key={s.key}
                            disabled={pendingOrderIds.has(item.id) || item.status === s.key || !(ORDER_TRANSITIONS[item.status] ?? []).includes(s.key)}
                          onPress={(event) => { event.stopPropagation(); updateStatus(item.id, s.key); }}
                          style={[
                            styles.statusBtn,
                            { backgroundColor: item.status === s.key ? s.color : s.color + "20" },
                          ]}
                        >
                          <Ionicons name={s.icon} size={14} color={item.status === s.key ? "#fff" : s.color} />
                          <Text style={[styles.statusBtnText, { color: item.status === s.key ? "#fff" : s.color }]}>
                            {s.label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>

                    {/* Delete Order */}
                    {(item.status === "cancelled" || item.status === "done") && (
                    <Pressable
                      onPress={() => confirmDeleteOrder(item.id)}
                      style={[styles.deleteBtn, { backgroundColor: "#ef444420" }]}
                    >
                      <Ionicons name="trash-outline" size={16} color="#ef4444" />
                      <Text style={styles.deleteBtnText}>حذف الطلب</Text>
                    </Pressable>
                    )}
                  </View>
                )}
              </Pressable>
            );
          }}
        />
      )}

      {/* QR Scanner Modal */}
      <Modal
        visible={scannerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setScannerOpen(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setScannerOpen(false)}
        >
          <Pressable
            style={[
              styles.scannerCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
            onPress={(event) => event.stopPropagation()}
          >
            <Text
              style={[
                styles.scannerTitle,
                { color: colors.foreground },
              ]}
            >
              مسح QR الطلب
            </Text>

            <Text
              style={[
                styles.scannerHint,
                { color: colors.mutedForeground },
              ]}
            >
              وجّه الكاميرا نحو QR الموجود على الطلب المطبوع
            </Text>

            <View style={styles.scannerCamera}>
              {Platform.OS === "web" ? (
                React.createElement(
                  "video",
                  {
                    id: "orders-qr-video",
                    autoPlay: true,
                    muted: true,
                    playsInline: true,
                    style: {
                      width: "100%",
                      height: 270,
                      objectFit: "cover",
                      backgroundColor: "#000",
                    },
                  } as any,
                )
              ) : (
                <CameraView
                  style={{ width: "100%", height: 270 }}
                  facing="back"
                  barcodeScannerSettings={{
                    barcodeTypes: ["qr"],
                  }}
                  onBarcodeScanned={
                    qrScanned
                      ? undefined
                      : ({ data }) => {
                          setQrScanned(true);
                          handleScannedOrderQr(data);
                        }
                  }
                />
              )}
            </View>

            <Pressable
              style={[
                styles.scannerCloseBtn,
                { borderColor: colors.border },
              ]}
              onPress={() => setScannerOpen(false)}
            >
              <Text
                style={[
                  styles.scannerCloseText,
                  { color: colors.foreground },
                ]}
              >
                إغلاق
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        visible={deleteConfirmId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteConfirmId(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setDeleteConfirmId(null)}>
          <Pressable style={[styles.deleteConfirmCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.deleteConfirmIcon}>
              <Ionicons name="trash-outline" size={36} color="#ef4444" />
            </View>
            <Text style={[styles.deleteConfirmTitle, { color: colors.foreground }]}>حذف الطلب</Text>
            <Text style={[styles.deleteConfirmSub, { color: colors.mutedForeground }]}>
              {`هل أنت متأكد من حذف الطلب #${deleteConfirmId}؟ لا يمكن التراجع عن هذا الإجراء.`}
            </Text>
            <Pressable
              style={styles.deleteConfirmBtn}
              onPress={() => deleteConfirmId !== null && deleteOrder(deleteConfirmId)}
            >
              <Text style={styles.deleteConfirmBtnText}>حذف</Text>
            </Pressable>
            <Pressable
              style={[styles.deleteCancelBtn, { borderColor: colors.border }]}
              onPress={() => setDeleteConfirmId(null)}
            >
              <Text style={[styles.deleteCancelBtnText, { color: colors.foreground }]}>إلغاء</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Proof Image Modal */}
      <Modal visible={!!proofModal} transparent animationType="fade" onRequestClose={() => setProofModal(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setProofModal(null)}>
          <ScrollView
            maximumZoomScale={3}
            minimumZoomScale={1}
            contentContainerStyle={styles.modalContent}
          >
            {proofModal && (
              <Image source={{ uri: proofModal }} style={styles.proofFull} resizeMode="contain" />
            )}
          </ScrollView>
          <Pressable style={styles.modalClose} onPress={() => setProofModal(null)}>
            <Ionicons name="close-circle" size={36} color="#fff" />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 16 },
  headerCenter: { flexDirection: "row-reverse", alignItems: "center", gap: 8 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 14 },
  headerTitle: { fontSize: 18, fontWeight: "800", color: "#fff" },
  newBadge: { backgroundColor: "#FFD700", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  newBadgeText: { fontSize: 11, fontWeight: "800", color: "#000" },
  notifBanner: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 100, flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", backgroundColor: "#E91E8C", paddingHorizontal: 16, paddingVertical: 14 },
  notifText: { color: "#fff", fontWeight: "700", fontSize: 14, flex: 1, textAlign: "center" },
  errorBanner: { flexDirection: "row-reverse", alignItems: "center", gap: 8, backgroundColor: "#c0392b", paddingHorizontal: 16, paddingVertical: 12, zIndex: 99 },
  errorBannerText: { color: "#fff", fontWeight: "700", fontSize: 13, flex: 1, textAlign: "right" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  loadingText: { fontSize: 14 },
  emptyText: { fontSize: 18, fontWeight: "700" },
  emptySub: { fontSize: 13, textAlign: "center" },
  list: { padding: 12, gap: 10 },
  orderCard: { borderRadius: 16, overflow: "hidden" },
  cardTop: { flexDirection: "row-reverse", alignItems: "flex-start", padding: 14, gap: 10 },
  cardTopLeft: { marginRight: 2, paddingTop: 2 },
  cardTopRight: { flex: 1, gap: 2, alignItems: "flex-end" },
  orderIdRow: { flexDirection: "row-reverse", alignItems: "center", gap: 6, flexWrap: "wrap" },
  orderId: { fontSize: 14, fontWeight: "800" },
  newDot: { borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  newDotText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  customerName: { fontSize: 15, fontWeight: "700", textAlign: "right" },
  timeAgo: { fontSize: 11 },
  statusBadges: { gap: 4, alignItems: "flex-end" },
  statusChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  statusText: { fontSize: 11, fontWeight: "700" },
  priceRow: { flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1 },
  priceLeft: { gap: 2 },
  payMethodBadge: { fontSize: 12, fontWeight: "600" },
  totalAmount: { fontSize: 17, fontWeight: "800" },
  expandedContent: { padding: 12, gap: 10 },
  infoSection: { borderRadius: 12, padding: 12, gap: 8 },
  infoRow: { flexDirection: "row-reverse", alignItems: "flex-start", gap: 8 },
  infoText: { fontSize: 13, flex: 1, textAlign: "right" },
  itemsSection: { borderRadius: 12, padding: 12, gap: 6 },
  sectionLabel: { fontSize: 13, fontWeight: "700", textAlign: "right", marginBottom: 2 },
  orderItemRow: { flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center" },
  orderItemCard: { flexDirection: "row-reverse", alignItems: "center", gap: 10, paddingVertical: 6 },
  orderItemImage: { width: 52, height: 52, borderRadius: 10 },
  orderItemImagePlaceholder: { alignItems: "center", justifyContent: "center" },
  orderItemInfo: { flex: 1, gap: 4, alignItems: "flex-end" },
  orderItemVariantRow: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 6 },
  variantChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  variantChipText: { fontSize: 11, fontWeight: "600" },
  orderItemName: { fontSize: 13, textAlign: "right", flex: 1 },
  orderItemPrice: { fontSize: 13, fontWeight: "700" },
  proofSection: { borderRadius: 12, borderWidth: 1.5, padding: 12, gap: 10 },
  proofThumbContainer: { borderRadius: 10, overflow: "hidden", position: "relative" },
  proofThumb: { width: "100%", height: 180, borderRadius: 10 },
  proofOverlay: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.45)", flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 6, padding: 8 },
  proofViewText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  confirmPayBtn: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 12 },
  confirmPayBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  confirmedBadge: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 6, padding: 10, borderRadius: 10 },
  confirmedText: { fontSize: 14, fontWeight: "700" },
  noProofBox: { flexDirection: "row-reverse", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderStyle: "dashed" },
  noProofText: { fontSize: 13, flex: 1, textAlign: "right" },
  printSection: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 10 },
  printStatusRow: { flexDirection: "row-reverse", alignItems: "center", gap: 9 },
  printStatusTextWrap: { flex: 1, alignItems: "flex-end" },
  printStatusTitle: { fontSize: 13, fontWeight: "700", textAlign: "right" },
  printStatusSub: { fontSize: 11, marginTop: 2, textAlign: "right" },
  printBtn: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 11, borderRadius: 10 },
  printBtnText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  contactBtns: { flexDirection: "row-reverse", gap: 8 },
  contactBtn: { flex: 1, flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10 },
  contactBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  statusBtns: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 6 },
  statusBtn: { flexDirection: "row-reverse", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20 },
  statusBtnText: { fontSize: 12, fontWeight: "700" },
  deleteBtn: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10, marginTop: 4 },
  deleteBtnText: { color: "#ef4444", fontSize: 13, fontWeight: "700" },
  deleteConfirmCard: { width: 300, borderRadius: 20, borderWidth: 1, padding: 24, alignItems: "center", gap: 8, margin: 24 },
  deleteConfirmIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#ef444418", alignItems: "center", justifyContent: "center", marginBottom: 4 },
  deleteConfirmTitle: { fontSize: 17, fontWeight: "800", textAlign: "center" },
  deleteConfirmSub: { fontSize: 13, textAlign: "center", lineHeight: 20, marginBottom: 4 },
  deleteConfirmBtn: { width: "100%", backgroundColor: "#ef4444", paddingVertical: 12, borderRadius: 12, alignItems: "center", marginTop: 4 },
  deleteConfirmBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  deleteCancelBtn: { width: "100%", borderWidth: 1, paddingVertical: 11, borderRadius: 12, alignItems: "center", marginTop: 4 },
  deleteCancelBtnText: { fontSize: 14, fontWeight: "600" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center" },
  modalContent: { flex: 1, justifyContent: "center", alignItems: "center", padding: 16 },
  proofFull: { width: 340, height: 500 },
  modalClose: { position: "absolute", top: 50, right: 16 },
  scannerCard: { width: "92%", maxWidth: 480, borderRadius: 18, borderWidth: 1, padding: 16, gap: 10 },
  scannerTitle: { fontSize: 18, fontWeight: "800", textAlign: "center" },
  scannerHint: { fontSize: 13, textAlign: "center", lineHeight: 19 },
  scannerCamera: { width: "100%", height: 270, overflow: "hidden", borderRadius: 12, backgroundColor: "#000" },
  scannerCloseBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  scannerCloseText: { fontSize: 14, fontWeight: "700" },
});
