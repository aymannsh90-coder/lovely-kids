import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
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
  createdAt: string;
}

const STATUS_OPTIONS = [
  { key: "new", label: "جديد", color: "#E91E8C", icon: "star-outline" as const },
  { key: "confirmed", label: "مؤكد", color: "#2196F3", icon: "checkmark-circle-outline" as const },
  { key: "delivering", label: "قيد التوصيل", color: "#FF9800", icon: "bicycle-outline" as const },
  { key: "done", label: "تم التسليم", color: "#22c55e", icon: "bag-check-outline" as const },
  { key: "cancelled", label: "ملغي", color: "#ef4444", icon: "close-circle-outline" as const },
];

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
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [proofModal, setProofModal] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [pendingOrderIds, setPendingOrderIds] = useState<Set<number>>(new Set());
  const bannerAnim = useRef(new Animated.Value(-80)).current;
  const bannerCount = useRef(0);

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
    if (pendingOrderIds.has(id)) return;
    const previousStatus = orders.find((o) => o.id === id)?.status;
    if (!previousStatus || previousStatus === status) return;
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    setPendingOrderIds((prev) => new Set(prev).add(id));
    try {
      const token = await getAuthToken();
      if (!token) throw new Error("انتهت جلسة تسجيل الدخول");
      const res = await fetch(`${API_BASE}/api/orders/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("تعذر تحديث حالة الطلب");
    } catch {
      setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status: previousStatus } : o)));
    }
    finally { setPendingOrderIds((prev) => { const next = new Set(prev); next.delete(id); return next; }); }
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
    if (pendingOrderIds.has(id)) return;
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
    finally { setPendingOrderIds((prev) => { const next = new Set(prev); next.delete(id); return next; }); }
  };

  const confirmDeleteOrder = (id: number) => {
    setDeleteConfirmId(id);
  };

  const callCustomer = (phone: string) => Linking.openURL(`tel:${phone}`);
  const whatsappCustomer = (phone: string, orderId: number) => {
    const msg = encodeURIComponent(`مرحباً! بخصوص طلبك رقم #${orderId} من Lovely Kids 🛍️`);
    Linking.openURL(`https://wa.me/970${phone.replace(/^0/, "")}?text=${msg}`);
  };

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
        <Pressable onPress={() => { setRefreshing(true); fetchOrders(); }}>
          <Ionicons name="refresh-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>جاري التحميل...</Text>
        </View>
      ) : (
        <FlatList
          data={orders}
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
                          onPress={() => updateStatus(item.id, s.key)}
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
  headerTitle: { fontSize: 18, fontWeight: "800", color: "#fff" },
  newBadge: { backgroundColor: "#FFD700", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  newBadgeText: { fontSize: 11, fontWeight: "800", color: "#000" },
  notifBanner: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 100, flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", backgroundColor: "#E91E8C", paddingHorizontal: 16, paddingVertical: 14 },
  notifText: { color: "#fff", fontWeight: "700", fontSize: 14, flex: 1, textAlign: "center" },
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
});
