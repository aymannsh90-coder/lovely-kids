import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { API_BASE } from "@/constants/api";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

type OrderItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  size?: string;
  color?: string;
};

type Order = {
  id: number;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  items: OrderItem[];
  totalPrice: number;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  notes: string | null;
  createdAt: string;
};

const STATUS_MAP: Record<string, { label: string; color: string; icon: string }> = {
  new:        { label: "جديد",          color: "#E91E8C", icon: "star-outline" },
  confirmed:  { label: "مؤكد",          color: "#2196F3", icon: "checkmark-circle-outline" },
  delivering: { label: "قيد التوصيل",  color: "#FF9800", icon: "bicycle-outline" },
  done:       { label: "تم التسليم",   color: "#22c55e", icon: "bag-check-outline" },
  cancelled:  { label: "ملغي",         color: "#ef4444", icon: "close-circle-outline" },
};

function statusInfo(s: string) {
  return STATUS_MAP[s] ?? { label: s, color: "#888", icon: "ellipse-outline" };
}

function canCancel(status: string) {
  return status === "new";
}

function timeAgo(dateStr: string) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return "الآن";
  if (diff < 3600) return `${Math.floor(diff / 60)} دقيقة`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ساعة`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)} يوم`;
  return new Date(dateStr).toLocaleDateString("ar-SA");
}

function payMethodLabel(m: string) {
  return m === "bank_transfer" ? "تحويل بنكي" : "الدفع عند الاستلام";
}

export default function MyOrdersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, getAuthToken } = useAuth();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState<number | null>(null);
  const [proofUploading, setProofUploading] = useState<number | null>(null);

  // In-app confirmation modal (replaces Alert.alert which is blocked in iframes)
  const [confirmOrder, setConfirmOrder] = useState<Order | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  const fetchOrders = useCallback(async (silent = false) => {
    if (!user) return;
    if (!silent) setLoading(true);
    try {
        const token = await getAuthToken();
        if (!token) {
          setOrders([]);
          return;
        }

        const res = await fetch(`${API_BASE}/api/orders/my`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
      if (res.ok) {
        const data = await res.json();
        setOrders(data);
      }
    } catch {
      // silent
    } finally {
      if (!silent) setLoading(false);
    }
  }, [user, getAuthToken]);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === "web") return;

      void fetchOrders();

      const intervalId = setInterval(() => {
        void fetchOrders(true);
      }, 10000);

      return () => clearInterval(intervalId);
    }, [fetchOrders])
  );

  useEffect(() => {
    if (Platform.OS !== "web") return;

    void fetchOrders();

    const intervalId = setInterval(() => {
      void fetchOrders(true);
    }, 10000);

    return () => clearInterval(intervalId);
  }, [fetchOrders]);

  // Called when user confirms cancellation in the modal
  const doCancel = async (order: Order) => {
    setConfirmOrder(null);
    setCancelling(order.id);
    try {
      const token = await getAuthToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE}/api/orders/${order.id}/cancel`, {
        method: "PATCH",
        headers,
      });

      if (res.ok) {
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        setOrders((prev) =>
          prev.map((o) => (o.id === order.id ? { ...o, status: "cancelled" } : o))
        );
      } else {
        const err = await res.json().catch(() => ({}));
        setErrorMsg((err as { error?: string }).error ?? "تعذّر إلغاء الطلب، حاول مجدداً");
      }
    } catch {
      setErrorMsg("تعذّر الاتصال بالسيرفر، حاول مجدداً");
    } finally {
      setCancelling(null);
    }
  };

  const handleUploadProof = async (order: Order) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setErrorMsg("يجب السماح بالوصول إلى الصور لرفع وصل التحويل");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.5,
      base64: true,
    });

    if (result.canceled || !result.assets[0]?.base64) return;

    setProofUploading(order.id);

    try {
      const token = await getAuthToken();
      if (!token) throw new Error("يجب تسجيل الدخول لرفع وصل الدفع");


      const res = await fetch(`${API_BASE}/api/orders/${order.id}/payment-proof`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          paymentProof: `data:image/jpeg;base64,${result.assets[0].base64}`,
        }),
      });

      if (!res.ok) {
        throw new Error("فشل رفع الوصل");
      }

      setOrders((prev) =>
        prev.map((o) =>
          o.id === order.id
            ? { ...o, paymentStatus: "proof_submitted" }
            : o
        )
      );

    } catch (e) {
      setErrorMsg(
        e instanceof Error ? e.message : "فشل رفع الوصل، حاول مجدداً"
      );
    } finally {
      setProofUploading(null);
    }
  };


  const renderOrder = ({ item }: { item: Order }) => {
    const st = statusInfo(item.status);
    const cancellable = canCancel(item.status);
    const isCancelling = cancelling === item.id;
    const isProofUploading = proofUploading === item.id;
    const canUploadProof = item.paymentMethod === "bank_transfer" && item.paymentStatus !== "confirmed" && item.status !== "cancelled" && item.status !== "done";

    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {/* Header row */}
        <View style={styles.cardHeader}>
          <View style={[styles.badge, { backgroundColor: st.color + "20", borderColor: st.color + "50" }]}>
            <Ionicons name={st.icon as "time-outline"} size={13} color={st.color} />
            <Text style={[styles.badgeText, { color: st.color }]}>{st.label}</Text>
          </View>
          <View style={styles.orderMeta}>
            <Text style={[styles.orderId, { color: colors.foreground }]}>طلب #{item.id}</Text>
            <Text style={[styles.orderTime, { color: colors.mutedForeground }]}>{timeAgo(item.createdAt)}</Text>
          </View>
        </View>

        {canUploadProof && (
          <Pressable
            onPress={() => handleUploadProof(item)}
            disabled={isProofUploading}
            style={[
              styles.cancelBtn,
              { borderColor: colors.primary, opacity: isProofUploading ? 0.5 : 1 },
            ]}
          >
            {isProofUploading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name="cloud-upload-outline" size={16} color={colors.primary} />
            )}
            <Text style={[styles.cancelBtnText, { color: colors.primary }]}>
              {item.paymentStatus === "proof_submitted"
                ? "تغيير وصل التحويل"
                : "رفع وصل التحويل"}
            </Text>
          </Pressable>
        )}


        {/* Items list */}
        <View style={styles.itemsBox}>
          {(item.items as OrderItem[]).map((oi, idx) => (
            <View key={idx} style={styles.itemRow}>
              {oi.image ? (
                <Image source={{ uri: oi.image }} style={styles.itemImage} />
              ) : (
                <View style={[styles.itemImagePlaceholder, { backgroundColor: colors.muted }]}>
                  <Ionicons name="shirt-outline" size={18} color={colors.mutedForeground} />
                </View>
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.itemName, { color: colors.foreground }]} numberOfLines={1}>
                  {oi.name}
                </Text>
                <View style={styles.itemMeta}>
                  {oi.size ? (
                    <Text style={[styles.itemTag, { color: colors.mutedForeground }]}>مقاس: {oi.size}</Text>
                  ) : null}
                  {oi.color ? (
                    <Text style={[styles.itemTag, { color: colors.mutedForeground }]}>لون: {oi.color}</Text>
                  ) : null}
                  <Text style={[styles.itemTag, { color: colors.mutedForeground }]}>× {oi.quantity}</Text>
                </View>
              </View>
              <Text style={[styles.itemPrice, { color: colors.foreground }]}>
                {oi.price * oi.quantity}₪
              </Text>
            </View>
          ))}
        </View>

        {/* Footer */}
        <View style={[styles.cardFooter, { borderTopColor: colors.border }]}>
          <Text style={[styles.payMethod, { color: colors.mutedForeground }]}>
            {payMethodLabel(item.paymentMethod)}
          </Text>
          <Text style={[styles.total, { color: colors.primary }]}>{item.totalPrice}₪</Text>
        </View>

        {/* Cancel button — only shown when status = "new" */}
        {cancellable && (
          <Pressable
            onPress={() => setConfirmOrder(item)}
            disabled={isCancelling}
            style={[styles.cancelBtn, { borderColor: "#ef4444", opacity: isCancelling ? 0.5 : 1 }]}
          >
            {isCancelling ? (
              <ActivityIndicator size="small" color="#ef4444" />
            ) : (
              <Ionicons name="close-circle-outline" size={16} color="#ef4444" />
            )}
            <Text style={styles.cancelBtnText}>
              {isCancelling ? "جاري الإلغاء..." : "إلغاء الطلب"}
            </Text>
          </Pressable>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12, backgroundColor: colors.primary }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-forward" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>طلباتي</Text>
        <Pressable onPress={() => void fetchOrders()} style={styles.refreshBtn}>
          <Ionicons name="refresh-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      {!user ? (
        <View style={styles.emptyBox}>
          <Ionicons name="person-outline" size={60} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>سجّل دخولك أولاً</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            تحتاج إلى تسجيل الدخول لعرض طلباتك
          </Text>
          <Pressable
            onPress={() => router.push("/(tabs)/profile")}
            style={[styles.emptyBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.emptyBtnText}>تسجيل الدخول</Text>
          </Pressable>
        </View>
      ) : loading && orders.length === 0 ? (
        <View style={styles.emptyBox}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.emptySub, { color: colors.mutedForeground, marginTop: 12 }]}>
            جاري تحميل طلباتك...
          </Text>
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name="bag-outline" size={64} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>لا توجد طلبات بعد</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            طلباتك ستظهر هنا بعد إتمام أول طلب
          </Text>
          <Pressable
            onPress={() => router.push("/(tabs)/products")}
            style={[styles.emptyBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.emptyBtnText}>تسوّق الآن</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => String(o.id)}
          renderItem={renderOrder}
          contentContainerStyle={{
            padding: 14,
            gap: 12,
            paddingBottom: Platform.OS === "web" ? 100 : insets.bottom + 80,
          }}
          onRefresh={fetchOrders}
          refreshing={loading}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* ── Confirmation Modal ─────────────────────────────────────────── */}
      <Modal
        visible={confirmOrder !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmOrder(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setConfirmOrder(null)}>
          <Pressable style={[styles.modalBox, { backgroundColor: colors.card }]} onPress={() => {}}>
            <View style={styles.modalIconWrap}>
              <Ionicons name="alert-circle-outline" size={44} color="#ef4444" />
            </View>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>إلغاء الطلب</Text>
            <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
              هل تريد إلغاء الطلب رقم #{confirmOrder?.id}؟{"\n"}لا يمكن التراجع عن هذا الإجراء.
            </Text>
            <View style={styles.modalBtns}>
              <Pressable
                style={[styles.modalBtnSecondary, { borderColor: colors.border }]}
                onPress={() => setConfirmOrder(null)}
              >
                <Text style={[styles.modalBtnSecondaryText, { color: colors.foreground }]}>لا، تراجع</Text>
              </Pressable>
              <Pressable
                style={styles.modalBtnDanger}
                onPress={() => confirmOrder && doCancel(confirmOrder)}
              >
                <Text style={styles.modalBtnDangerText}>نعم، إلغاء الطلب</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Error Modal ────────────────────────────────────────────────── */}
      <Modal
        visible={errorMsg !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setErrorMsg(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setErrorMsg(null)}>
          <Pressable style={[styles.modalBox, { backgroundColor: colors.card }]} onPress={() => {}}>
            <Ionicons name="warning-outline" size={44} color="#F59E0B" />
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>تنبيه</Text>
            <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>{errorMsg}</Text>
            <Pressable
              style={[styles.modalBtnDanger, { backgroundColor: colors.primary, width: "100%" }]}
              onPress={() => setErrorMsg(null)}
            >
              <Text style={styles.modalBtnDangerText}>حسناً</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  headerTitle: { fontSize: 18, fontWeight: "800", color: "#fff" },
  backBtn: { padding: 4 },
  refreshBtn: { padding: 4 },
  emptyBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
  },
  emptyTitle: { fontSize: 18, fontWeight: "700", textAlign: "center" },
  emptySub: { fontSize: 14, textAlign: "center", lineHeight: 22 },
  emptyBtn: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 14,
    marginTop: 8,
  },
  emptyBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    paddingBottom: 10,
  },
  badge: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  badgeText: { fontSize: 12, fontWeight: "700" },
  orderMeta: { alignItems: "flex-end", gap: 2 },
  orderId: { fontSize: 14, fontWeight: "800" },
  orderTime: { fontSize: 11 },
  itemsBox: { paddingHorizontal: 12, gap: 10, paddingBottom: 10 },
  itemRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
  },
  itemImage: {
    width: 52,
    height: 52,
    borderRadius: 10,
    resizeMode: "cover",
  },
  itemImagePlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  itemName: { fontSize: 13, fontWeight: "600", textAlign: "right" },
  itemMeta: { flexDirection: "row-reverse", gap: 8, flexWrap: "wrap" },
  itemTag: { fontSize: 11 },
  itemPrice: { fontSize: 13, fontWeight: "700", minWidth: 40, textAlign: "left" },
  cardFooter: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  payMethod: { fontSize: 12 },
  total: { fontSize: 16, fontWeight: "800" },
  cancelBtn: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    margin: 10,
    marginTop: 0,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  cancelBtnText: { color: "#ef4444", fontSize: 13, fontWeight: "700" },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  modalBox: {
    width: "100%",
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  modalIconWrap: { marginBottom: 4 },
  modalTitle: { fontSize: 18, fontWeight: "800", textAlign: "center" },
  modalBody: { fontSize: 14, textAlign: "center", lineHeight: 22 },
  modalBtns: { flexDirection: "row-reverse", gap: 10, width: "100%", marginTop: 4 },
  modalBtnSecondary: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  modalBtnSecondaryText: { fontSize: 14, fontWeight: "700" },
  modalBtnDanger: {
    flex: 1,
    backgroundColor: "#ef4444",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  modalBtnDangerText: { color: "#fff", fontSize: 14, fontWeight: "700" },
});
