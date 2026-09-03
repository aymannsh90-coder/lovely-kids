import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { API_BASE } from "@/constants/api";
import { useColors } from "@/hooks/useColors";

type OrderItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  size?: string;
  color?: string;
};

type Order = {
  id: number;
  customerName: string;
  customerAddress: string;
  items: OrderItem[];
  totalPrice: number;
  status: string;
  shippingZone?: string | null;
  shippingCost?: number | null;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  createdAt: string;
};

const STATUS_MAP: Record<
  string,
  { label: string; color: string; icon: string }
> = {
  new: {
    label: "تم استلام الطلب",
    color: "#E91E8C",
    icon: "time-outline",
  },
  confirmed: {
    label: "تم تأكيد الطلب",
    color: "#2196F3",
    icon: "checkmark-circle-outline",
  },
  delivering: {
    label: "الطلب قيد التوصيل",
    color: "#FF9800",
    icon: "bicycle-outline",
  },
  done: {
    label: "تم تسليم الطلب",
    color: "#22c55e",
    icon: "bag-check-outline",
  },
  cancelled: {
    label: "الطلب ملغي",
    color: "#ef4444",
    icon: "close-circle-outline",
  },
};

const STORE_PICKUP_LABEL = "استلام من المحل";

export default function TrackOrderScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const params = useLocalSearchParams<{
    id?: string | string[];
    token?: string | string[];
  }>();

  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const rawToken = Array.isArray(params.token)
    ? params.token[0]
    : params.token;

  const orderId = Number(rawId);
  const token = rawToken?.trim() ?? "";

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrder = useCallback(async () => {
    if (!Number.isInteger(orderId) || orderId <= 0 || !token) {
      setError("رابط متابعة الطلب غير صالح");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `${API_BASE}/api/orders/${orderId}/track?token=${encodeURIComponent(token)}`,
        { cache: "no-store" },
      );

      if (!res.ok) {
        setOrder(null);
        setError(
          res.status === 404
            ? "الطلب غير موجود"
            : "تعذر فتح رابط متابعة الطلب",
        );
        return;
      }

      setOrder((await res.json()) as Order);
    } catch {
      setOrder(null);
      setError("تعذر الاتصال بالسيرفر، حاول مرة أخرى");
    } finally {
      setLoading(false);
    }
  }, [orderId, token]);

  useEffect(() => {
    void fetchOrder();
  }, [fetchOrder]);

  const status = order
    ? STATUS_MAP[order.status] ?? {
        label: order.status,
        color: "#888",
        icon: "ellipse-outline",
      }
    : null;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 12,
            backgroundColor: colors.primary,
          },
        ]}
      >
        <Pressable onPress={() => router.replace("/")} style={styles.headerBtn}>
          <Ionicons name="home-outline" size={23} color="#fff" />
        </Pressable>

        <Text style={styles.headerTitle}>متابعة الطلب</Text>

        <Pressable onPress={() => void fetchOrder()} style={styles.headerBtn}>
          <Ionicons name="refresh-outline" size={23} color="#fff" />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={{ color: colors.mutedForeground }}>
            جاري تحميل حالة الطلب...
          </Text>
        </View>
      ) : error || !order || !status ? (
        <View style={styles.center}>
          <Ionicons
            name="alert-circle-outline"
            size={52}
            color={colors.mutedForeground}
          />
          <Text style={[styles.errorTitle, { color: colors.foreground }]}>
            تعذر عرض الطلب
          </Text>
          <Text
            style={[
              styles.errorText,
              { color: colors.mutedForeground },
            ]}
          >
            {error ?? "رابط متابعة الطلب غير صالح"}
          </Text>

          <Pressable
            onPress={() => router.replace("/")}
            style={[styles.homeBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.homeBtnText}>العودة إلى المتجر</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + 28 },
          ]}
        >
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.orderNumber, { color: colors.foreground }]}>
              طلب #{order.id}
            </Text>

            <View
              style={[
                styles.statusBox,
                {
                  backgroundColor: status.color + "15",
                  borderColor: status.color + "55",
                },
              ]}
            >
              <Ionicons
                name={status.icon as "time-outline"}
                size={28}
                color={status.color}
              />
              <Text style={[styles.statusText, { color: status.color }]}>
                {status.label}
              </Text>
            </View>

            <Text
              style={[
                styles.dateText,
                { color: colors.mutedForeground },
              ]}
            >
              {new Date(order.createdAt).toLocaleString("ar-PS")}
            </Text>
          </View>

          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              المنتجات
            </Text>

            {order.items.map((item, index) => (
              <View
                key={`${item.id}-${index}`}
                style={[
                  styles.itemRow,
                  index > 0 && { borderTopColor: colors.border, borderTopWidth: 1 },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemName, { color: colors.foreground }]}>
                    {item.name}
                  </Text>

                  {(item.color || item.size) && (
                    <Text
                      style={[
                        styles.itemMeta,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      {[item.color ? `اللون: ${item.color}` : null,
                        item.size ? `المقاس: ${item.size}` : null]
                        .filter(Boolean)
                        .join(" • ")}
                    </Text>
                  )}
                </View>

                <Text style={[styles.itemQty, { color: colors.foreground }]}>
                  × {item.quantity}
                </Text>
              </View>
            ))}
          </View>

          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              تفاصيل الاستلام
            </Text>

            <Text style={[styles.detailText, { color: colors.foreground }]}>
              {order.shippingZone === STORE_PICKUP_LABEL
                ? "🏪 استلام من المحل"
                : `🚚 ${order.shippingZone || "توصيل"}`}
            </Text>

            {order.shippingZone !== STORE_PICKUP_LABEL &&
            order.customerAddress ? (
              <Text
                style={[
                  styles.detailSub,
                  { color: colors.mutedForeground },
                ]}
              >
                📍 {order.customerAddress}
              </Text>
            ) : null}

            <View
              style={[
                styles.totalRow,
                { borderTopColor: colors.border },
              ]}
            >
              <Text style={[styles.totalLabel, { color: colors.foreground }]}>
                الإجمالي
              </Text>
              <Text style={[styles.totalValue, { color: colors.primary }]}>
                {order.totalPrice} شيكل
              </Text>
            </View>
          </View>

          <Pressable
            onPress={() => void fetchOrder()}
            style={[
              styles.refreshBtn,
              {
                borderColor: colors.primary,
                backgroundColor: colors.primary + "10",
              },
            ]}
          >
            <Ionicons name="refresh-outline" size={19} color={colors.primary} />
            <Text style={[styles.refreshText, { color: colors.primary }]}>
              تحديث حالة الطلب
            </Text>
          </Pressable>

          <Text
            style={[
              styles.hint,
              { color: colors.mutedForeground },
            ]}
          >
            احتفظ بهذا الرابط لمتابعة حالة طلبك في أي وقت
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerBtn: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "900",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    gap: 12,
  },
  content: {
    padding: 14,
    gap: 12,
  },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 15,
    gap: 10,
  },
  orderNumber: {
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
  },
  statusBox: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: "center",
    gap: 7,
  },
  statusText: {
    fontSize: 18,
    fontWeight: "900",
  },
  dateText: {
    fontSize: 12,
    textAlign: "center",
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "900",
    textAlign: "right",
  },
  itemRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
  },
  itemName: {
    fontSize: 14,
    fontWeight: "700",
    textAlign: "right",
  },
  itemMeta: {
    fontSize: 12,
    marginTop: 3,
    textAlign: "right",
  },
  itemQty: {
    fontSize: 14,
    fontWeight: "800",
  },
  detailText: {
    fontSize: 14,
    fontWeight: "800",
    textAlign: "right",
  },
  detailSub: {
    fontSize: 13,
    textAlign: "right",
  },
  totalRow: {
    borderTopWidth: 1,
    paddingTop: 12,
    marginTop: 4,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
  },
  totalLabel: {
    fontSize: 15,
    fontWeight: "800",
  },
  totalValue: {
    fontSize: 19,
    fontWeight: "900",
  },
  refreshBtn: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  refreshText: {
    fontSize: 14,
    fontWeight: "800",
  },
  hint: {
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: "900",
  },
  errorText: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 20,
  },
  homeBtn: {
    marginTop: 6,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  homeBtnText: {
    color: "#fff",
    fontWeight: "800",
  },
});
