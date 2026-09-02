import { getResponsiveTopPadding } from "@/utils/webLayout";
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
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  useAppSettings,
  type AppSettings,
  type ShippingZone,
} from "@/context/AppSettingsContext";
import { useNewOrders } from "@/context/NewOrdersContext";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

import { API_BASE } from "@/constants/api";
import { createOrderPrintHtml } from "@/utils/orderPrint";
import { printOrderThermalReceipt } from "@/utils/orderThermalReceipt";
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

interface AdminOrderEditSize {
  size: string;
  stock?: number | null;
  outOfStock?: boolean;
}

interface AdminOrderEditVariant {
  color: string;
  image?: string;
  sizes?: AdminOrderEditSize[];
}

interface AdminOrderEditProduct {
  id: string;
  name?: string;
  nameAr: string;
  price: number;
  image?: string;
  productCode?: string | null;
  barcode?: string | null;
  stock?: number | null;
  sizes?: string[];
  colorVariants?: AdminOrderEditVariant[];
  deletedAt?: string | null;
}

interface EditableOrderItem extends OrderItem {}

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

const ADMIN_STORE_PICKUP_LABEL = "استلام من المحل";

const ADMIN_DEFAULT_SHIPPING_ZONES: ShippingZone[] = [
  { label: "الضفة الغربية", cost: 20, promoCost: 20 },
  { label: "القدس", cost: 30, promoCost: 30 },
  { label: "أراضي الـ48", cost: 70, promoCost: 70 },
];

function getAdminStoreDate() {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Jerusalem",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());

    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );

    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function getAdminEditShippingCost(
  settings: AppSettings,
  shipping: ShippingZone,
  productsTotal: number,
) {
  if (shipping.label === ADMIN_STORE_PICKUP_LABEL) {
    return 0;
  }

  if (settings.shippingPromotionEnabled !== true) {
    return shipping.cost;
  }

  const threshold = settings.shippingPromotionThreshold;

  if (
    !Number.isInteger(threshold) ||
    threshold < 0 ||
    productsTotal < threshold
  ) {
    return shipping.cost;
  }

  const today = getAdminStoreDate();
  const startDate =
    settings.shippingPromotionStartDate?.trim() ?? "";
  const endDate =
    settings.shippingPromotionEndDate?.trim() ?? "";

  if (startDate && today < startDate) {
    return shipping.cost;
  }

  if (endDate && today > endDate) {
    return shipping.cost;
  }

  const promoCost = shipping.promoCost;

  return typeof promoCost === "number" &&
    Number.isInteger(promoCost) &&
    promoCost >= 0
    ? promoCost
    : shipping.cost;
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
  cancelled: ["confirmed", "delivering", "done"],
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

const STORE_PICKUP_HOLD_MS = 48 * 60 * 60 * 1000;

function pickupRemaining(createdAt: string, now: number) {
  const remaining =
    new Date(createdAt).getTime() + STORE_PICKUP_HOLD_MS - now;

  if (remaining <= 0) return "انتهت مهلة الحجز";

  const mins = Math.ceil(remaining / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const minutes = mins % 60;

  if (days > 0) return `متبقي ${days} يوم و ${hours} ساعة`;
  if (hours > 0) return `متبقي ${hours} ساعة و ${minutes} دقيقة`;
  return `متبقي ${minutes} دقيقة`;
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
  const { settings } = useAppSettings();
  const insets = useSafeAreaInsets();
  const { newCount, clearNew } = useNewOrders();
  const { getAuthToken } = useAuth();
  const params = useLocalSearchParams<{ orderId?: string | string[] }>();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [orders, setOrders] = useState<Order[]>([]);
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [proofModal, setProofModal] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [pickupConfirmOrder, setPickupConfirmOrder] = useState<Order | null>(null);
  const [pickupConvertingId, setPickupConvertingId] = useState<number | null>(null);
  const [pendingOrderIds, setPendingOrderIds] = useState<Set<number>>(new Set());
  const [printingId, setPrintingId] = useState<number | null>(null);
  const [thermalPrintingId, setThermalPrintingId] =
    useState<number | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [qrScanned, setQrScanned] = useState(false);
  const [orderSearch, setOrderSearch] = useState("");
  const [printConfirmVisible, setPrintConfirmVisible] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [editItems, setEditItems] = useState<EditableOrderItem[]>([]);
  const [editProducts, setEditProducts] = useState<AdminOrderEditProduct[]>([]);
  const [editProductsLoading, setEditProductsLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editSearch, setEditSearch] = useState("");
  const [editPickedProduct, setEditPickedProduct] =
    useState<AdminOrderEditProduct | null>(null);
  const [editPickedColor, setEditPickedColor] = useState<string | null>(null);
  const [editPickedSize, setEditPickedSize] = useState<string | null>(null);
  const [editOrderError, setEditOrderError] = useState<string | null>(null);
  const [editCustomerName, setEditCustomerName] = useState("");
  const [editCustomerPhone, setEditCustomerPhone] = useState("");
  const [editCustomerAddress, setEditCustomerAddress] = useState("");
  const [editShippingZone, setEditShippingZone] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const printConfirmResolverRef =
    useRef<((confirmed: boolean) => void) | null>(null);

  const orderSearchTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const topPadding = getResponsiveTopPadding(insets.top);
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

  // عداد الاستلام يتحرك محلياً فقط بدون أي طلبات للسيرفر
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);

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

  const convertToStorePickup = async (order: Order) => {
    if (pickupConvertingId !== null) return;

    setPickupConfirmOrder(null);
    setPickupConvertingId(order.id);

    try {
      const token = await getAuthToken();

      if (!token) {
        throw new Error("انتهت جلسة تسجيل الدخول");
      }

      const res = await fetch(
        `${API_BASE}/api/orders/${order.id}/store-pickup`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const body = await res.json().catch(() => null) as
        | Order
        | { error?: string }
        | null;

      if (!res.ok) {
        throw new Error(
          body && "error" in body && body.error
            ? body.error
            : "تعذر تحويل الطلب إلى استلام من المحل",
        );
      }

      const updatedOrder = body as Order;

      setOrders((prev) =>
        prev.map((item) =>
          item.id === order.id
            ? { ...item, ...updatedOrder }
            : item,
        ),
      );
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : "تعذر تحويل الطلب إلى استلام من المحل";

      showError(msg);

      if (Platform.OS !== "web") {
        Alert.alert("تعذر تعديل الطلب", msg);
      }
    } finally {
      setPickupConvertingId(null);
    }
  };

  const closeOrderEditor = () => {
    if (editSaving) return;
    setEditingOrder(null);
    setEditItems([]);
    setEditSearch("");
    setEditPickedProduct(null);
    setEditPickedColor(null);
    setEditPickedSize(null);
    setEditOrderError(null);
    setEditCustomerName("");
    setEditCustomerPhone("");
    setEditCustomerAddress("");
    setEditShippingZone("");
    setEditNotes("");
  };

  const loadEditProducts = async () => {
    setEditProductsLoading(true);

    try {
      const token = await getAuthToken();

      if (!token) {
        throw new Error("انتهت جلسة تسجيل الدخول");
      }

      const res = await fetch(`${API_BASE}/api/products/admin`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const body = await res.json().catch(() => null) as
        | AdminOrderEditProduct[]
        | { error?: string }
        | null;

      if (!res.ok) {
        throw new Error(
          body && !Array.isArray(body) && body.error
            ? body.error
            : "تعذر تحميل المنتجات",
        );
      }

      setEditProducts(
        Array.isArray(body)
          ? body.filter((product) => !product.deletedAt)
          : [],
      );
    } catch (error) {
      setEditOrderError(
        error instanceof Error
          ? error.message
          : "تعذر تحميل المنتجات",
      );
    } finally {
      setEditProductsLoading(false);
    }
  };

  const openOrderEditor = async (order: Order) => {
    if (order.status !== "new" && order.status !== "confirmed") {
      showError("يمكن تعديل الطلبات الجديدة أو المؤكدة فقط");
      return;
    }

    setEditingOrder(order);
    setEditItems(order.items.map((item) => ({ ...item })));
    setEditCustomerName(order.customerName);
    setEditCustomerPhone(order.customerPhone);
    setEditCustomerAddress(
      order.shippingZone === ADMIN_STORE_PICKUP_LABEL
        ? ""
        : order.customerAddress,
    );
    setEditShippingZone(
      order.shippingZone ?? "",
    );
    setEditNotes(order.notes ?? "");
    setEditSearch("");
    setEditPickedProduct(null);
    setEditPickedColor(null);
    setEditPickedSize(null);
    setEditOrderError(null);

    await loadEditProducts();
  };

  const changeEditItemQuantity = (
    index: number,
    change: number,
  ) => {
    setEditItems((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) return item;

        const nextQuantity = Math.max(
          1,
          Math.min(99, item.quantity + change),
        );

        return {
          ...item,
          quantity: nextQuantity,
        };
      }),
    );
  };

  const removeEditItem = (index: number) => {
    setEditItems((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
    setEditOrderError(null);
  };

  const chooseEditProduct = (product: AdminOrderEditProduct) => {
    setEditPickedProduct(product);
    setEditPickedColor(null);
    setEditPickedSize(null);
    setEditOrderError(null);
  };

  const addPickedProductToEdit = () => {
    const product = editPickedProduct;

    if (!product) return;

    const variants = Array.isArray(product.colorVariants)
      ? product.colorVariants
      : [];

    if (variants.length > 0 && !editPickedColor) {
      setEditOrderError(`اختر لون المنتج ${product.nameAr}`);
      return;
    }

    const selectedVariant =
      variants.length > 0
        ? variants.find((variant) => variant.color === editPickedColor)
        : undefined;

    const availableSizes =
      variants.length > 0
        ? selectedVariant?.sizes ?? []
        : (product.sizes ?? []).map((size) => ({ size }));

    if (availableSizes.length > 0 && !editPickedSize) {
      setEditOrderError(`اختر مقاس المنتج ${product.nameAr}`);
      return;
    }

    const color = editPickedColor ?? undefined;
    const size = editPickedSize ?? undefined;

    setEditItems((current) => {
      const existingIndex = current.findIndex(
        (item) =>
          item.id === product.id &&
          (item.color ?? "") === (color ?? "") &&
          (item.size ?? "") === (size ?? ""),
      );

      if (existingIndex >= 0) {
        return current.map((item, index) =>
          index === existingIndex
            ? {
                ...item,
                quantity: Math.min(99, item.quantity + 1),
              }
            : item,
        );
      }

      return [
        ...current,
        {
          id: product.id,
          name: product.nameAr,
          price: product.price,
          quantity: 1,
          image: selectedVariant?.image || product.image,
          color,
          size,
        },
      ];
    });

    setEditPickedProduct(null);
    setEditPickedColor(null);
    setEditPickedSize(null);
    setEditSearch("");
    setEditOrderError(null);
  };

  const saveOrderItemsEdit = async () => {
    if (!editingOrder || editSaving) return;

    if (editItems.length === 0) {
      setEditOrderError("يجب أن يحتوي الطلب على منتج واحد على الأقل");
      return;
    }

    if (!editCustomerName.trim()) {
      setEditOrderError("اسم الزبون مطلوب");
      return;
    }

    if (!editCustomerPhone.trim()) {
      setEditOrderError("رقم الهاتف مطلوب");
      return;
    }

    if (!editShippingZone) {
      setEditOrderError("اختر منطقة التوصيل أو الاستلام من المحل");
      return;
    }

    if (
      editShippingZone !== ADMIN_STORE_PICKUP_LABEL &&
      !editCustomerAddress.trim()
    ) {
      setEditOrderError("العنوان مطلوب لطلبات التوصيل");
      return;
    }

    setEditSaving(true);
    setEditOrderError(null);

    pendingOrderIdsRef.current.add(editingOrder.id);
    ordersFetchVersionRef.current += 1;
    setPendingOrderIds((prev) => new Set(prev).add(editingOrder.id));

    try {
      const token = await getAuthToken();

      if (!token) {
        throw new Error("انتهت جلسة تسجيل الدخول");
      }

      const res = await fetch(
        `${API_BASE}/api/orders/${editingOrder.id}/items`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            customerName: editCustomerName.trim(),
            customerPhone: editCustomerPhone.trim(),
            customerAddress:
              editShippingZone === ADMIN_STORE_PICKUP_LABEL
                ? ADMIN_STORE_PICKUP_LABEL
                : editCustomerAddress.trim(),
            shippingZone: editShippingZone,
            notes: editNotes.trim(),
            items: editItems.map((item) => ({
              id: item.id,
              quantity: item.quantity,
              color: item.color,
              size: item.size,
            })),
          }),
        },
      );

      const body = await res.json().catch(() => null) as
        | Order
        | { error?: string }
        | null;

      if (!res.ok) {
        throw new Error(
          body && "error" in body && body.error
            ? body.error
            : "تعذر تعديل الطلب",
        );
      }

      const updatedOrder = body as Order;

      setOrders((current) =>
        current.map((order) =>
          order.id === updatedOrder.id
            ? { ...order, ...updatedOrder }
            : order,
        ),
      );

      setEditingOrder(null);
      setEditItems([]);
      setEditPickedProduct(null);
      setEditPickedColor(null);
      setEditPickedSize(null);
      setEditSearch("");
    } catch (error) {
      setEditOrderError(
        error instanceof Error
          ? error.message
          : "تعذر تعديل الطلب",
      );
    } finally {
      pendingOrderIdsRef.current.delete(editingOrder.id);
      setPendingOrderIds((prev) => {
        const next = new Set(prev);
        next.delete(editingOrder.id);
        return next;
      });
      setEditSaving(false);
    }
  };

  const normalizedEditSearch = editSearch.trim().toLowerCase();

  const filteredEditProducts = normalizedEditSearch
    ? editProducts
        .filter((product) => {
          const haystack = [
            product.nameAr,
            product.name ?? "",
            product.productCode ?? "",
            product.barcode ?? "",
          ]
            .join(" ")
            .toLowerCase();

          return haystack.includes(normalizedEditSearch);
        })
        .slice(0, 12)
    : [];

  const pickedVariants = editPickedProduct?.colorVariants ?? [];

  const pickedVariant =
    editPickedColor && pickedVariants.length > 0
      ? pickedVariants.find(
          (variant) => variant.color === editPickedColor,
        )
      : undefined;

  const pickedSizes: AdminOrderEditSize[] = editPickedProduct
    ? pickedVariants.length > 0
      ? pickedVariant?.sizes ?? []
      : (editPickedProduct.sizes ?? []).map((size) => ({
          size,
          stock: undefined,
          outOfStock: false,
        }))
    : [];

  const editProductsTotal = editItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );

  const editShippingZones: ShippingZone[] = [
    {
      label: ADMIN_STORE_PICKUP_LABEL,
      cost: 0,
      promoCost: 0,
    },
    ...(settings.shippingZones?.length
      ? settings.shippingZones
      : ADMIN_DEFAULT_SHIPPING_ZONES
    ).filter(
      (zone) => zone.label !== ADMIN_STORE_PICKUP_LABEL,
    ),
  ];

  const editSelectedShippingZone =
    editShippingZones.find(
      (zone) => zone.label === editShippingZone,
    ) ?? null;

  const editShippingCost = editSelectedShippingZone
    ? getAdminEditShippingCost(
        settings,
        editSelectedShippingZone,
        editProductsTotal,
      )
    : 0;

  const editPreviewTotal =
    editProductsTotal + editShippingCost;

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

  const parseOrderSearch = (value: string): number | null => {
    const raw = value.trim();

    if (!raw) return null;

    const qrId = parseOrderQr(raw);

    if (qrId !== null) {
      return qrId;
    }

    // بعض أجهزة QR 2D تكتب الرابط بحروف مشوهة إذا كانت
    // لوحة المفاتيح عربية، لكن نهاية الرابط تبقى مثل =75.
    const scannedSuffix = raw.match(/=\s*#?(\d+)\s*$/);

    if (scannedSuffix) {
      const id = Number(scannedSuffix[1]);

      return Number.isInteger(id) && id > 0
        ? id
        : null;
    }

    const manual = raw.match(/^#?(\d+)$/);

    if (!manual) {
      return null;
    }

    const id = Number(manual[1]);

    return Number.isInteger(id) && id > 0
      ? id
      : null;
  };

  const openOrderFromSearch = (value: string) => {
    if (orderSearchTimerRef.current) {
      clearTimeout(orderSearchTimerRef.current);
      orderSearchTimerRef.current = null;
    }

    const id = parseOrderSearch(value);

    if (id === null) {
      showError("أدخل رقم طلب صحيح أو امسح QR الطلب");
      return;
    }

    if (openOrderById(id)) {
      setOrderSearch("");
    }
  };

  const handleOrderSearchChange = (value: string) => {
    setOrderSearch(value);

    if (orderSearchTimerRef.current) {
      clearTimeout(orderSearchTimerRef.current);
      orderSearchTimerRef.current = null;
    }

    const raw = value.trim();

    /*
     * فرد الباركود 2D يكتب رابط QR داخل الخانة.
     * ننتظر لحظة قصيرة حتى ينتهي من كتابة الرابط كاملاً،
     * ثم نفتح الطلب تلقائياً حتى لو الجهاز لا يرسل Enter.
     */
    if (
      (
        raw.includes("/admin/orders") &&
        /[?&]orderId=\d+/i.test(raw)
      ) ||
      /=\s*\d+\s*$/.test(raw)
    ) {
      orderSearchTimerRef.current = setTimeout(() => {
        openOrderFromSearch(raw);
      }, 180);
    }
  };

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

  const confirmPrintSuccess = (): Promise<boolean> =>
    new Promise((resolve) => {
      printConfirmResolverRef.current = resolve;
      setPrintConfirmVisible(true);
    });

  const resolvePrintConfirmation = (confirmed: boolean) => {
    setPrintConfirmVisible(false);

    const resolver = printConfirmResolverRef.current;
    printConfirmResolverRef.current = null;

    resolver?.(confirmed);
  };

  const handlePrintThermalReceipt = async (order: Order) => {
    if (thermalPrintingId !== null) return;

    setThermalPrintingId(order.id);

    try {
      const productsResponse = await fetch(`${API_BASE}/api/products`);

      if (!productsResponse.ok) {
        throw new Error("تعذر تحميل أكواد المنتجات للطباعة");
      }

      const productsPayload = await productsResponse.json();

      const productList = Array.isArray(productsPayload)
        ? productsPayload
        : Array.isArray(productsPayload?.products)
          ? productsPayload.products
          : [];

      const productCodeById = new Map<string, string | null>(
        productList.map((product: any) => [
          String(product.id),
          typeof product.productCode === "string"
            ? product.productCode
            : null,
        ]),
      );

      await printOrderThermalReceipt({
        ...order,
        items: order.items.map((orderItem) => ({
          ...orderItem,
          productCode:
            productCodeById.get(String(orderItem.id)) ?? null,
        })),
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "تعذر طباعة الإيصال الحراري";

      showError(message);
    } finally {
      setThermalPrintingId(null);
    }
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

        // Keep mobile print windows open so the OS print service is not
        // interrupted, but always provide an obvious way back to orders.
        const printReturnStyle = printWindow.document.createElement("style");
        printReturnStyle.textContent = `
          @media print {
            #lovely-kids-print-return {
              display: none !important;
            }
          }
        `;
        printWindow.document.head?.appendChild(printReturnStyle);

        const printReturnBar = printWindow.document.createElement("div");
        printReturnBar.id = "lovely-kids-print-return";
        printReturnBar.style.cssText = `
          position: fixed;
          left: 12px;
          right: 12px;
          bottom: calc(12px + env(safe-area-inset-bottom));
          z-index: 99999;
          display: flex;
          justify-content: center;
          direction: rtl;
          pointer-events: none;
        `;

        const printReturnButton = printWindow.document.createElement("button");
        printReturnButton.type = "button";
        printReturnButton.textContent = "← إغلاق والعودة للطلبات";
        printReturnButton.style.cssText = `
          pointer-events: auto;
          border: 0;
          border-radius: 14px;
          padding: 13px 22px;
          background: #E91E8C;
          color: #ffffff;
          font-family: Arial, sans-serif;
          font-size: 16px;
          font-weight: 700;
          box-shadow: 0 4px 18px rgba(0,0,0,0.22);
          cursor: pointer;
        `;

        printReturnButton.addEventListener("click", () => {
          try {
            window.focus();
          } catch {}

          if (!printWindow.closed) {
            printWindow.close();
          }

          // iOS/Safari fallback: never leave the user trapped
          // if the browser refuses to close the script-opened window.
          setTimeout(() => {
            if (!printWindow.closed) {
              printWindow.location.href =
                `${window.location.origin}/admin/orders`;
            }
          }, 250);
        });

        printReturnBar.appendChild(printReturnButton);
        printWindow.document.body?.appendChild(printReturnBar);

        const images = Array.from(printWindow.document.images);

        await Promise.all(
          images.map((image) => {
            if (image.complete) {
              return Promise.resolve();
            }

            return new Promise<void>((resolve) => {
              let finished = false;

              const done = () => {
                if (finished) return;
                finished = true;
                resolve();
              };

              image.addEventListener("load", done, { once: true });
              image.addEventListener("error", done, { once: true });

              setTimeout(done, 2500);
            });
          }),
        );

        await new Promise((resolve) => setTimeout(resolve, 150));

        const isMobileWeb =
          /Android|iPhone|iPad|iPod/i.test(
            window.navigator.userAgent,
          );

        printWindow.focus();
        printWindow.print();

        // على متصفح الهاتف يجب إبقاء صفحة الطباعة مفتوحة،
        // لأن إغلاقها مباشرة يقطع Android Print Service.
        if (!isMobileWeb) {
          if (!printWindow.closed) {
            printWindow.close();
          }

          window.focus();
        }
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

      <View
        style={[
          styles.orderSearchBar,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        <Pressable
          onPress={() => void handleOpenQrScanner()}
          style={[
            styles.orderSearchCamera,
            { borderColor: colors.border },
          ]}
          hitSlop={6}
        >
          <Ionicons
            name="camera-outline"
            size={21}
            color={colors.primary}
          />
        </Pressable>

        <TextInput
          value={orderSearch}
          onChangeText={handleOrderSearchChange}
          onSubmitEditing={() => openOrderFromSearch(orderSearch)}
          placeholder="ابحث برقم الطلب أو امسح QR"
          placeholderTextColor={colors.mutedForeground}
          style={[
            styles.orderSearchInput,
            {
              color: colors.foreground,
              borderColor: colors.border,
            },
          ]}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          textAlign="right"
        />

        <Pressable
          onPress={() => openOrderFromSearch(orderSearch)}
          style={[
            styles.orderSearchButton,
            { borderColor: colors.border },
          ]}
          hitSlop={6}
        >
          <Ionicons
            name="search-outline"
            size={21}
            color={colors.primary}
          />
        </Pressable>
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
                          <Ionicons
                            name={
                              item.shippingZone === "استلام من المحل"
                                ? "storefront-outline"
                                : "bicycle-outline"
                            }
                            size={16}
                            color={colors.mutedForeground}
                          />
                          <Text style={[styles.infoText, { color: colors.foreground }]}>
                            {item.shippingZone === "استلام من المحل"
                              ? "طريقة الاستلام: استلام من المحل"
                              : `منطقة التوصيل: ${item.shippingZone}`}
                            {item.shippingCost != null ? ` — ${item.shippingCost}₪` : ""}
                          </Text>
                        </View>
                      ) : null}

                      {item.shippingZone !== "استلام من المحل" &&
                      item.status !== "done" &&
                      item.status !== "cancelled" ? (
                        <Pressable
                          disabled={pickupConvertingId !== null}
                          onPress={() => setPickupConfirmOrder(item)}
                          style={{
                            marginTop: 4,
                            borderWidth: 1,
                            borderColor: "#F59E0B",
                            backgroundColor: "#FFF7ED",
                            borderRadius: 10,
                            paddingHorizontal: 12,
                            paddingVertical: 9,
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 6,
                            opacity:
                              pickupConvertingId === item.id
                                ? 0.55
                                : 1,
                          }}
                        >
                          {pickupConvertingId === item.id ? (
                            <ActivityIndicator size="small" color="#B45309" />
                          ) : (
                            <Ionicons
                              name="storefront-outline"
                              size={17}
                              color="#B45309"
                            />
                          )}

                          <Text
                            style={{
                              color: "#B45309",
                              fontWeight: "800",
                              fontSize: 13,
                            }}
                          >
                            تحويل إلى استلام من المحل
                          </Text>
                        </Pressable>
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

                    {item.shippingZone === "استلام من المحل" &&
                    item.status !== "done" &&
                    item.status !== "cancelled" ? (
                      <View
                        style={{
                          backgroundColor: "#FFF7ED",
                          borderWidth: 1,
                          borderColor: "#F59E0B",
                          borderRadius: 12,
                          padding: 10,
                          gap: 4,
                        }}
                      >
                        <Text
                          style={{
                            color: "#B45309",
                            fontWeight: "900",
                            textAlign: "right",
                          }}
                        >
                          🏪 استلام من المحل
                        </Text>
                        <Text
                          style={{
                            color: "#92400E",
                            fontWeight: "800",
                            textAlign: "right",
                          }}
                        >
                          ⏳ {pickupRemaining(item.createdAt, now)}
                        </Text>
                        <Text
                          style={{
                            color: "#92400E",
                            fontSize: 11,
                            textAlign: "right",
                          }}
                        >
                          يتم حجز الكمية لمدة 48 ساعة، وبعدها يتم إلغاء الطلب يدوياً من المتجر.
                        </Text>
                      </View>
                    ) : null}

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

                      {Platform.OS === "web" ? (
                        <Pressable
                          disabled={thermalPrintingId !== null}
                          onPress={(event) => {
                            event.stopPropagation();
                            void handlePrintThermalReceipt(item);
                          }}
                          style={[
                            styles.printBtn,
                            {
                              backgroundColor:
                                thermalPrintingId === item.id
                                  ? colors.mutedForeground
                                  : "#111827",
                              opacity:
                                thermalPrintingId !== null &&
                                thermalPrintingId !== item.id
                                  ? 0.55
                                  : 1,
                            },
                          ]}
                        >
                          {thermalPrintingId === item.id ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <Ionicons
                              name="receipt-outline"
                              size={19}
                              color="#fff"
                            />
                          )}
                          <Text style={styles.printBtnText}>
                            طباعة إيصال حراري
                          </Text>
                        </Pressable>
                      ) : null}

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

                    {(item.status === "new" || item.status === "confirmed") && (
                      <Pressable
                        disabled={pendingOrderIds.has(item.id)}
                        onPress={(event) => {
                          event.stopPropagation();
                          void openOrderEditor(item);
                        }}
                        style={[
                          styles.editOrderBtn,
                          {
                            backgroundColor: colors.primary + "14",
                            borderColor: colors.primary,
                            opacity: pendingOrderIds.has(item.id) ? 0.55 : 1,
                          },
                        ]}
                      >
                        <Ionicons
                          name="create-outline"
                          size={18}
                          color={colors.primary}
                        />
                        <Text
                          style={[
                            styles.editOrderBtnText,
                            { color: colors.primary },
                          ]}
                        >
                          تعديل منتجات الطلب
                        </Text>
                      </Pressable>
                    )}

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

      {/* Print Confirmation Modal */}
      <Modal
        visible={printConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => resolvePrintConfirmation(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.printConfirmCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.printConfirmIcon}>
              <Ionicons
                name="print-outline"
                size={34}
                color={colors.primary}
              />
            </View>

            <Text
              style={[
                styles.printConfirmTitle,
                { color: colors.foreground },
              ]}
            >
              تأكيد الطباعة
            </Text>

            <Text
              style={[
                styles.printConfirmSub,
                { color: colors.mutedForeground },
              ]}
            >
              هل تمت طباعة الطلب بنجاح؟
            </Text>

            <Pressable
              style={styles.printConfirmYes}
              onPress={() => resolvePrintConfirmation(true)}
            >
              <Ionicons
                name="checkmark-circle-outline"
                size={19}
                color="#fff"
              />
              <Text style={styles.printConfirmYesText}>
                نعم، تمت الطباعة
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.printConfirmNo,
                { borderColor: colors.border },
              ]}
              onPress={() => resolvePrintConfirmation(false)}
            >
              <Text
                style={[
                  styles.printConfirmNoText,
                  { color: colors.foreground },
                ]}
              >
                لا، لم تتم
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

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

      {/* Edit Order Items Modal */}
      <Modal
        visible={editingOrder !== null}
        transparent
        animationType="fade"
        onRequestClose={closeOrderEditor}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.editOrderModalCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.editOrderModalHeader}>
              <Pressable
                onPress={closeOrderEditor}
                disabled={editSaving}
                hitSlop={8}
              >
                <Ionicons
                  name="close"
                  size={25}
                  color={colors.foreground}
                />
              </Pressable>

              <View style={{ flex: 1, alignItems: "flex-end" }}>
                <Text
                  style={[
                    styles.editOrderModalTitle,
                    { color: colors.foreground },
                  ]}
                >
                  تعديل الطلب #{editingOrder?.id}
                </Text>
                <Text
                  style={[
                    styles.editOrderModalSub,
                    { color: colors.mutedForeground },
                  ]}
                >
                  عدّل بيانات الزبون، التوصيل والمنتجات
                </Text>
              </View>

              <Ionicons
                name="create-outline"
                size={24}
                color={colors.primary}
              />
            </View>

            {editOrderError ? (
              <View style={styles.editOrderErrorBox}>
                <Ionicons
                  name="alert-circle-outline"
                  size={18}
                  color="#DC2626"
                />
                <Text style={styles.editOrderErrorText}>
                  {editOrderError}
                </Text>
              </View>
            ) : null}

            <ScrollView
              style={styles.editOrderScroll}
              contentContainerStyle={styles.editOrderScrollContent}
              keyboardShouldPersistTaps="handled"
            >
              <Text
                style={[
                  styles.editOrderSectionTitle,
                  { color: colors.foreground },
                ]}
              >
                بيانات الزبون والتوصيل
              </Text>

              <View
                style={[
                  styles.editOrderDetailsBox,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.background,
                  },
                ]}
              >
                <Text style={[styles.editOrderFieldLabel, { color: colors.foreground }]}>
                  الاسم الكامل *
                </Text>
                <TextInput
                  value={editCustomerName}
                  onChangeText={(value) => {
                    setEditCustomerName(value);
                    setEditOrderError(null);
                  }}
                  style={[
                    styles.editOrderFieldInput,
                    {
                      color: colors.foreground,
                      borderColor: !editCustomerName.trim()
                        ? "#DC2626"
                        : colors.border,
                      backgroundColor: colors.card,
                    },
                  ]}
                  textAlign="right"
                />

                <Text style={[styles.editOrderFieldLabel, { color: colors.foreground }]}>
                  رقم الهاتف *
                </Text>
                <TextInput
                  value={editCustomerPhone}
                  onChangeText={(value) => {
                    setEditCustomerPhone(value);
                    setEditOrderError(null);
                  }}
                  keyboardType="phone-pad"
                  style={[
                    styles.editOrderFieldInput,
                    {
                      color: colors.foreground,
                      borderColor: !editCustomerPhone.trim()
                        ? "#DC2626"
                        : colors.border,
                      backgroundColor: colors.card,
                    },
                  ]}
                  textAlign="right"
                />

                <Text style={[styles.editOrderFieldLabel, { color: colors.foreground }]}>
                  منطقة التوصيل / الاستلام *
                </Text>

                <View style={styles.editOrderShippingZones}>
                  {editShippingZones.map((zone) => {
                    const selected =
                      editShippingZone === zone.label;

                    const cost = getAdminEditShippingCost(
                      settings,
                      zone,
                      editProductsTotal,
                    );

                    return (
                      <Pressable
                        key={zone.label}
                        onPress={() => {
                          setEditShippingZone(zone.label);
                          setEditOrderError(null);

                          if (
                            zone.label ===
                            ADMIN_STORE_PICKUP_LABEL
                          ) {
                            setEditCustomerAddress("");
                          }
                        }}
                        style={[
                          styles.editOrderShippingZoneBtn,
                          {
                            borderColor: selected
                              ? colors.primary
                              : colors.border,
                            backgroundColor: selected
                              ? colors.primary
                              : colors.card,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.editOrderShippingZoneText,
                            {
                              color: selected
                                ? "#fff"
                                : colors.foreground,
                            },
                          ]}
                        >
                          {zone.label}
                        </Text>
                        <Text
                          style={[
                            styles.editOrderShippingZoneCost,
                            {
                              color: selected
                                ? "#fff"
                                : colors.primary,
                            },
                          ]}
                        >
                          {cost}₪
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {editShippingZone !== ADMIN_STORE_PICKUP_LABEL ? (
                  <>
                    <Text style={[styles.editOrderFieldLabel, { color: colors.foreground }]}>
                      العنوان *
                    </Text>
                    <TextInput
                      value={editCustomerAddress}
                      onChangeText={(value) => {
                        setEditCustomerAddress(value);
                        setEditOrderError(null);
                      }}
                      placeholder="اكتب عنوان التوصيل"
                      placeholderTextColor={colors.mutedForeground}
                      multiline
                      style={[
                        styles.editOrderFieldInput,
                        styles.editOrderAddressInput,
                        {
                          color: colors.foreground,
                          borderColor:
                            editShippingZone &&
                            !editCustomerAddress.trim()
                              ? "#DC2626"
                              : colors.border,
                          backgroundColor: colors.card,
                        },
                      ]}
                      textAlign="right"
                    />
                  </>
                ) : (
                  <View
                    style={[
                      styles.editOrderPickupNotice,
                      { borderColor: colors.primary + "55" },
                    ]}
                  >
                    <Ionicons
                      name="storefront-outline"
                      size={18}
                      color={colors.primary}
                    />
                    <Text
                      style={{
                        color: colors.primary,
                        fontWeight: "700",
                      }}
                    >
                      استلام من المحل — رسوم التوصيل 0₪
                    </Text>
                  </View>
                )}

                <Text style={[styles.editOrderFieldLabel, { color: colors.foreground }]}>
                  ملاحظات الطلب
                </Text>
                <TextInput
                  value={editNotes}
                  onChangeText={setEditNotes}
                  placeholder="ملاحظات إضافية..."
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  style={[
                    styles.editOrderFieldInput,
                    styles.editOrderNotesInput,
                    {
                      color: colors.foreground,
                      borderColor: colors.border,
                      backgroundColor: colors.card,
                    },
                  ]}
                  textAlign="right"
                />
              </View>

              <View
                style={[
                  styles.editOrderDivider,
                  { backgroundColor: colors.border },
                ]}
              />

              <Text
                style={[
                  styles.editOrderSectionTitle,
                  { color: colors.foreground },
                ]}
              >
                منتجات الطلب الحالية
              </Text>

              {editItems.length === 0 ? (
                <View
                  style={[
                    styles.editOrderEmpty,
                    { borderColor: colors.border },
                  ]}
                >
                  <Ionicons
                    name="basket-outline"
                    size={26}
                    color={colors.mutedForeground}
                  />
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      textAlign: "center",
                    }}
                  >
                    لا يوجد منتجات في الطلب
                  </Text>
                </View>
              ) : (
                editItems.map((orderItem, index) => (
                  <View
                    key={`${orderItem.id}-${orderItem.color ?? ""}-${orderItem.size ?? ""}-${index}`}
                    style={[
                      styles.editOrderLine,
                      {
                        borderColor: colors.border,
                        backgroundColor: colors.background,
                      },
                    ]}
                  >
                    {orderItem.image ? (
                      <Image
                        source={{ uri: orderItem.image }}
                        style={styles.editOrderLineImage}
                        resizeMode="cover"
                      />
                    ) : (
                      <View
                        style={[
                          styles.editOrderLineImage,
                          styles.orderItemImagePlaceholder,
                          { backgroundColor: colors.secondary },
                        ]}
                      >
                        <Ionicons
                          name="image-outline"
                          size={20}
                          color={colors.mutedForeground}
                        />
                      </View>
                    )}

                    <View style={styles.editOrderLineInfo}>
                      <Text
                        style={{
                          color: colors.foreground,
                          fontWeight: "700",
                          textAlign: "right",
                        }}
                        numberOfLines={2}
                      >
                        {orderItem.name}
                      </Text>

                      <View style={styles.editOrderVariantRow}>
                        {orderItem.color ? (
                          <Text
                            style={[
                              styles.editOrderVariantText,
                              {
                                color: colors.foreground,
                                backgroundColor: colors.secondary,
                              },
                            ]}
                          >
                            {orderItem.color}
                          </Text>
                        ) : null}

                        {orderItem.size ? (
                          <Text
                            style={[
                              styles.editOrderVariantText,
                              {
                                color: colors.foreground,
                                backgroundColor: colors.secondary,
                              },
                            ]}
                          >
                            مقاس {orderItem.size}
                          </Text>
                        ) : null}
                      </View>

                      <Text
                        style={{
                          color: colors.primary,
                          fontWeight: "800",
                          textAlign: "right",
                        }}
                      >
                        {orderItem.price}₪ × {orderItem.quantity}
                      </Text>
                    </View>

                    <View style={styles.editOrderQtyBox}>
                      <Pressable
                        onPress={() =>
                          changeEditItemQuantity(index, 1)
                        }
                        style={[
                          styles.editOrderQtyBtn,
                          { borderColor: colors.border },
                        ]}
                      >
                        <Ionicons
                          name="add"
                          size={17}
                          color={colors.foreground}
                        />
                      </Pressable>

                      <Text
                        style={[
                          styles.editOrderQtyText,
                          { color: colors.foreground },
                        ]}
                      >
                        {orderItem.quantity}
                      </Text>

                      <Pressable
                        onPress={() =>
                          changeEditItemQuantity(index, -1)
                        }
                        style={[
                          styles.editOrderQtyBtn,
                          { borderColor: colors.border },
                        ]}
                      >
                        <Ionicons
                          name="remove"
                          size={17}
                          color={colors.foreground}
                        />
                      </Pressable>

                      <Pressable
                        onPress={() => removeEditItem(index)}
                        style={styles.editOrderRemoveBtn}
                      >
                        <Ionicons
                          name="trash-outline"
                          size={17}
                          color="#DC2626"
                        />
                      </Pressable>
                    </View>
                  </View>
                ))
              )}

              <View
                style={[
                  styles.editOrderDivider,
                  { backgroundColor: colors.border },
                ]}
              />

              <Text
                style={[
                  styles.editOrderSectionTitle,
                  { color: colors.foreground },
                ]}
              >
                إضافة منتج
              </Text>

              <View
                style={[
                  styles.editOrderSearchBox,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.background,
                  },
                ]}
              >
                <Ionicons
                  name="search-outline"
                  size={20}
                  color={colors.mutedForeground}
                />
                <TextInput
                  value={editSearch}
                  onChangeText={(value) => {
                    setEditSearch(value);
                    setEditPickedProduct(null);
                    setEditPickedColor(null);
                    setEditPickedSize(null);
                    setEditOrderError(null);
                  }}
                  placeholder="ابحث باسم المنتج أو الكود أو الباركود"
                  placeholderTextColor={colors.mutedForeground}
                  style={[
                    styles.editOrderSearchInput,
                    { color: colors.foreground },
                  ]}
                  textAlign="right"
                />
              </View>

              {editProductsLoading ? (
                <View style={styles.editOrderLoadingProducts}>
                  <ActivityIndicator
                    size="small"
                    color={colors.primary}
                  />
                  <Text style={{ color: colors.mutedForeground }}>
                    جاري تحميل المنتجات...
                  </Text>
                </View>
              ) : null}

              {!editProductsLoading &&
              normalizedEditSearch &&
              filteredEditProducts.length === 0 ? (
                <Text
                  style={{
                    color: colors.mutedForeground,
                    textAlign: "center",
                    paddingVertical: 12,
                  }}
                >
                  لم يتم العثور على منتج
                </Text>
              ) : null}

              {filteredEditProducts.map((product) => (
                <Pressable
                  key={product.id}
                  onPress={() => chooseEditProduct(product)}
                  style={[
                    styles.editOrderSearchResult,
                    {
                      borderColor:
                        editPickedProduct?.id === product.id
                          ? colors.primary
                          : colors.border,
                      backgroundColor:
                        editPickedProduct?.id === product.id
                          ? colors.primary + "0D"
                          : colors.background,
                    },
                  ]}
                >
                  {product.image ? (
                    <Image
                      source={{ uri: product.image }}
                      style={styles.editOrderSearchImage}
                      resizeMode="cover"
                    />
                  ) : (
                    <View
                      style={[
                        styles.editOrderSearchImage,
                        styles.orderItemImagePlaceholder,
                        { backgroundColor: colors.secondary },
                      ]}
                    >
                      <Ionicons
                        name="image-outline"
                        size={18}
                        color={colors.mutedForeground}
                      />
                    </View>
                  )}

                  <View style={{ flex: 1, alignItems: "flex-end" }}>
                    <Text
                      style={{
                        color: colors.foreground,
                        fontWeight: "700",
                        textAlign: "right",
                      }}
                      numberOfLines={2}
                    >
                      {product.nameAr}
                    </Text>

                    <Text
                      style={{
                        color: colors.primary,
                        fontWeight: "800",
                        marginTop: 3,
                      }}
                    >
                      {product.price}₪
                    </Text>

                    {product.productCode ? (
                      <Text
                        style={{
                          color: colors.mutedForeground,
                          fontSize: 11,
                        }}
                      >
                        كود: {product.productCode}
                      </Text>
                    ) : null}
                  </View>

                  <Ionicons
                    name={
                      editPickedProduct?.id === product.id
                        ? "checkmark-circle"
                        : "add-circle-outline"
                    }
                    size={25}
                    color={colors.primary}
                  />
                </Pressable>
              ))}

              {editPickedProduct ? (
                <View
                  style={[
                    styles.editOrderPickedBox,
                    {
                      borderColor: colors.primary,
                      backgroundColor: colors.primary + "0A",
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.editOrderPickedTitle,
                      { color: colors.foreground },
                    ]}
                  >
                    {editPickedProduct.nameAr}
                  </Text>

                  {pickedVariants.length > 0 ? (
                    <>
                      <Text
                        style={[
                          styles.editOrderChoiceLabel,
                          { color: colors.foreground },
                        ]}
                      >
                        اختر اللون:
                      </Text>

                      <View style={styles.editOrderChoiceRow}>
                        {pickedVariants.map((variant) => (
                          <Pressable
                            key={variant.color}
                            onPress={() => {
                              setEditPickedColor(variant.color);
                              setEditPickedSize(null);
                              setEditOrderError(null);
                            }}
                            style={[
                              styles.editOrderChoiceChip,
                              {
                                borderColor:
                                  editPickedColor === variant.color
                                    ? colors.primary
                                    : colors.border,
                                backgroundColor:
                                  editPickedColor === variant.color
                                    ? colors.primary
                                    : colors.card,
                              },
                            ]}
                          >
                            <Text
                              style={{
                                color:
                                  editPickedColor === variant.color
                                    ? "#fff"
                                    : colors.foreground,
                                fontWeight: "700",
                              }}
                            >
                              {variant.color}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </>
                  ) : null}

                  {pickedSizes.length > 0 ? (
                    <>
                      <Text
                        style={[
                          styles.editOrderChoiceLabel,
                          { color: colors.foreground },
                        ]}
                      >
                        اختر المقاس:
                      </Text>

                      <View style={styles.editOrderChoiceRow}>
                        {pickedSizes.map((entry) => (
                          <Pressable
                            key={entry.size}
                            disabled={entry.outOfStock === true}
                            onPress={() => {
                              setEditPickedSize(entry.size);
                              setEditOrderError(null);
                            }}
                            style={[
                              styles.editOrderChoiceChip,
                              {
                                borderColor:
                                  editPickedSize === entry.size
                                    ? colors.primary
                                    : colors.border,
                                backgroundColor:
                                  editPickedSize === entry.size
                                    ? colors.primary
                                    : colors.card,
                                opacity: entry.outOfStock ? 0.55 : 1,
                              },
                            ]}
                          >
                            <Text
                              style={{
                                color:
                                  editPickedSize === entry.size
                                    ? "#fff"
                                    : colors.foreground,
                                fontWeight: "700",
                              }}
                            >
                              {entry.size}
                              {typeof entry.stock === "number"
                                ? ` (${entry.stock})`
                                : ""}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </>
                  ) : null}

                  <Pressable
                    onPress={addPickedProductToEdit}
                    style={[
                      styles.editOrderAddBtn,
                      { backgroundColor: colors.primary },
                    ]}
                  >
                    <Ionicons
                      name="add-circle-outline"
                      size={19}
                      color="#fff"
                    />
                    <Text style={styles.editOrderAddBtnText}>
                      إضافة للطلب
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              <View
                style={[
                  styles.editOrderSummary,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.background,
                  },
                ]}
              >
                <View style={styles.editOrderSummaryRow}>
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontWeight: "600",
                    }}
                  >
                    المنتجات
                  </Text>
                  <Text
                    style={{
                      color: colors.foreground,
                      fontWeight: "700",
                    }}
                  >
                    {editProductsTotal}₪
                  </Text>
                </View>

                <View style={styles.editOrderSummaryRow}>
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontWeight: "600",
                    }}
                  >
                    التوصيل
                  </Text>
                  <Text
                    style={{
                      color: colors.foreground,
                      fontWeight: "700",
                    }}
                  >
                    {editShippingCost}₪
                  </Text>
                </View>

                <View
                  style={[
                    styles.editOrderDivider,
                    { backgroundColor: colors.border },
                  ]}
                />

                <View style={styles.editOrderSummaryRow}>
                  <Text
                    style={{
                      color: colors.foreground,
                      fontSize: 16,
                      fontWeight: "900",
                    }}
                  >
                    الإجمالي الجديد
                  </Text>
                  <Text
                    style={{
                      color: colors.primary,
                      fontSize: 18,
                      fontWeight: "900",
                    }}
                  >
                    {editPreviewTotal}₪
                  </Text>
                </View>
              </View>
            </ScrollView>

            <View
              style={[
                styles.editOrderFooter,
                { borderTopColor: colors.border },
              ]}
            >
              <Pressable
                disabled={editSaving}
                onPress={closeOrderEditor}
                style={[
                  styles.editOrderCancelBtn,
                  { borderColor: colors.border },
                ]}
              >
                <Text
                  style={{
                    color: colors.foreground,
                    fontWeight: "700",
                  }}
                >
                  إلغاء
                </Text>
              </Pressable>

              <Pressable
                disabled={editSaving}
                onPress={() => void saveOrderItemsEdit()}
                style={[
                  styles.editOrderSaveBtn,
                  {
                    backgroundColor: colors.primary,
                    opacity: editSaving ? 0.7 : 1,
                  },
                ]}
              >
                {editSaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={20}
                    color="#fff"
                  />
                )}

                <Text style={styles.editOrderSaveBtnText}>
                  {editSaving
                    ? "جاري حفظ التعديل..."
                    : "حفظ تعديل الطلب"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Store Pickup Confirmation Modal */}
      <Modal
        visible={pickupConfirmOrder !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPickupConfirmOrder(null)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setPickupConfirmOrder(null)}
        >
          <Pressable
            style={[
              styles.deleteConfirmCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
            onPress={() => {}}
          >
            <View
              style={[
                styles.deleteConfirmIcon,
                { backgroundColor: "#FFF7ED" },
              ]}
            >
              <Ionicons
                name="storefront-outline"
                size={36}
                color="#F59E0B"
              />
            </View>

            <Text
              style={[
                styles.deleteConfirmTitle,
                { color: colors.foreground },
              ]}
            >
              تحويل إلى استلام من المحل
            </Text>

            <Text
              style={[
                styles.deleteConfirmSub,
                { color: colors.mutedForeground },
              ]}
            >
              {pickupConfirmOrder
                ? `سيتم تحويل الطلب #${pickupConfirmOrder.id} إلى استلام من المحل، وإلغاء رسوم التوصيل من الإجمالي.`
                : ""}
            </Text>

            {pickupConfirmOrder ? (
              <Text
                style={{
                  color: "#B45309",
                  fontWeight: "800",
                  textAlign: "center",
                  marginBottom: 4,
                }}
              >
                الإجمالي الجديد:{" "}
                {Math.max(
                  0,
                  pickupConfirmOrder.totalPrice -
                    (pickupConfirmOrder.shippingCost ?? 0),
                )}
                ₪
              </Text>
            ) : null}

            <Pressable
              style={[
                styles.deleteConfirmBtn,
                { backgroundColor: "#F59E0B" },
              ]}
              onPress={() => {
                if (pickupConfirmOrder) {
                  void convertToStorePickup(pickupConfirmOrder);
                }
              }}
            >
              <Text style={styles.deleteConfirmBtnText}>
                تأكيد التحويل
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.deleteCancelBtn,
                { borderColor: colors.border },
              ]}
              onPress={() => setPickupConfirmOrder(null)}
            >
              <Text
                style={[
                  styles.deleteCancelBtnText,
                  { color: colors.foreground },
                ]}
              >
                رجوع
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
  header: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 16 },
  headerCenter: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", gap: 8 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 14 },
  headerTitle: { fontSize: 18, fontWeight: "800", color: "#fff" },
  newBadge: { backgroundColor: "#FFD700", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  newBadgeText: { fontSize: 11, fontWeight: "800", color: "#000" },
  notifBanner: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 100, flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#E91E8C", paddingHorizontal: 16, paddingVertical: 14 },
  notifText: { color: "#fff", fontWeight: "700", fontSize: 14, flex: 1, textAlign: "center" },
  errorBanner: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", gap: 8, backgroundColor: "#c0392b", paddingHorizontal: 16, paddingVertical: 12, zIndex: 99 },
  errorBannerText: { color: "#fff", fontWeight: "700", fontSize: 13, flex: 1, textAlign: "right" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  loadingText: { fontSize: 14 },
  emptyText: { fontSize: 18, fontWeight: "700" },
  emptySub: { fontSize: 13, textAlign: "center" },
  orderSearchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginHorizontal: 12,
    marginTop: 10,
    padding: 6,
    borderWidth: 1,
    borderRadius: 12,
  },
  orderSearchCamera: {
    width: 40,
    height: 40,
    borderWidth: 1,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  orderSearchInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 14,
  },
  orderSearchButton: {
    width: 40,
    height: 40,
    borderWidth: 1,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  list: { padding: 12, gap: 10 },
  orderCard: { borderRadius: 16, overflow: "hidden" },
  cardTop: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "flex-start", padding: 14, gap: 10 },
  cardTopLeft: { marginRight: 2, paddingTop: 2 },
  cardTopRight: { flex: 1, gap: 2, alignItems: "flex-end" },
  orderIdRow: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  orderId: { fontSize: 14, fontWeight: "800" },
  newDot: { borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  newDotText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  customerName: { fontSize: 15, fontWeight: "700", textAlign: "right" },
  timeAgo: { fontSize: 11 },
  statusBadges: { gap: 4, alignItems: "flex-end" },
  statusChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  statusText: { fontSize: 11, fontWeight: "700" },
  priceRow: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1 },
  priceLeft: { gap: 2 },
  payMethodBadge: { fontSize: 12, fontWeight: "600" },
  totalAmount: { fontSize: 17, fontWeight: "800" },
  expandedContent: { padding: 12, gap: 10 },
  infoSection: { borderRadius: 12, padding: 12, gap: 8 },
  infoRow: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "flex-start", gap: 8 },
  infoText: { fontSize: 13, flex: 1, textAlign: "right" },
  itemsSection: { borderRadius: 12, padding: 12, gap: 6 },
  sectionLabel: { fontSize: 13, fontWeight: "700", textAlign: "right", marginBottom: 2 },
  orderItemRow: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", justifyContent: "space-between", alignItems: "center" },
  orderItemCard: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  orderItemImage: { width: 52, height: 52, borderRadius: 10 },
  orderItemImagePlaceholder: { alignItems: "center", justifyContent: "center" },
  orderItemInfo: { flex: 1, gap: 4, alignItems: "flex-end" },
  orderItemVariantRow: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", flexWrap: "wrap", gap: 6 },
  variantChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  variantChipText: { fontSize: 11, fontWeight: "600" },
  orderItemName: { fontSize: 13, textAlign: "right", flex: 1 },
  orderItemPrice: { fontSize: 13, fontWeight: "700" },
  proofSection: { borderRadius: 12, borderWidth: 1.5, padding: 12, gap: 10 },
  proofThumbContainer: { borderRadius: 10, overflow: "hidden", position: "relative" },
  proofThumb: { width: "100%", height: 180, borderRadius: 10 },
  proofOverlay: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.45)", flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 8 },
  proofViewText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  confirmPayBtn: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 12 },
  confirmPayBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  confirmedBadge: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 10, borderRadius: 10 },
  confirmedText: { fontSize: 14, fontWeight: "700" },
  noProofBox: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderStyle: "dashed" },
  noProofText: { fontSize: 13, flex: 1, textAlign: "right" },
  printSection: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 10 },
  printStatusRow: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", gap: 9 },
  printStatusTextWrap: { flex: 1, alignItems: "flex-end" },
  printStatusTitle: { fontSize: 13, fontWeight: "700", textAlign: "right" },
  printStatusSub: { fontSize: 11, marginTop: 2, textAlign: "right" },
  printBtn: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 11, borderRadius: 10 },
  printBtnText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  contactBtns: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", gap: 8 },
  contactBtn: { flex: 1, flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10 },
  contactBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  statusBtns: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", flexWrap: "wrap", gap: 6 },
  statusBtn: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20 },
  statusBtnText: { fontSize: 12, fontWeight: "700" },
  editOrderBtn: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
  },
  editOrderBtnText: {
    fontSize: 14,
    fontWeight: "800",
  },
  editOrderModalCard: {
    width: Platform.OS === "web" ? 760 : "94%",
    maxWidth: "96%",
    height: Platform.OS === "web" ? "88%" : "92%",
    maxHeight: 850,
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
  },
  editOrderModalHeader: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  editOrderModalTitle: {
    fontSize: 18,
    fontWeight: "900",
    textAlign: "right",
  },
  editOrderModalSub: {
    fontSize: 12,
    marginTop: 2,
    textAlign: "right",
  },
  editOrderErrorBox: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 10,
    backgroundColor: "#FEE2E2",
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    gap: 8,
  },
  editOrderErrorText: {
    flex: 1,
    color: "#B91C1C",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "right",
  },
  editOrderScroll: {
    flex: 1,
  },
  editOrderScrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    gap: 9,
  },
  editOrderSectionTitle: {
    fontSize: 15,
    fontWeight: "900",
    textAlign: "right",
    marginTop: 4,
    marginBottom: 3,
  },
  editOrderDetailsBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 7,
  },
  editOrderFieldLabel: {
    fontSize: 12,
    fontWeight: "800",
    textAlign: "right",
    marginTop: 3,
  },
  editOrderFieldInput: {
    width: "100%",
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 9,
    fontSize: 14,
  },
  editOrderAddressInput: {
    minHeight: 66,
    textAlignVertical: "top",
  },
  editOrderNotesInput: {
    minHeight: 64,
    textAlignVertical: "top",
  },
  editOrderShippingZones: {
    flexDirection:
      Platform.OS === "web" ? "row-reverse" : "row",
    flexWrap: "wrap",
    gap: 7,
  },
  editOrderShippingZoneBtn: {
    minWidth: 115,
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  editOrderShippingZoneText: {
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  editOrderShippingZoneCost: {
    fontSize: 12,
    fontWeight: "900",
  },
  editOrderPickupNotice: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 9,
    flexDirection:
      Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 10,
  },
  editOrderEmpty: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 18,
  },
  editOrderLine: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    padding: 9,
    gap: 9,
  },
  editOrderLineImage: {
    width: 58,
    height: 58,
    borderRadius: 9,
  },
  editOrderLineInfo: {
    flex: 1,
    alignItems: "flex-end",
    gap: 4,
  },
  editOrderVariantRow: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    flexWrap: "wrap",
    gap: 5,
  },
  editOrderVariantText: {
    fontSize: 10,
    fontWeight: "700",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
    overflow: "hidden",
  },
  editOrderQtyBox: {
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  editOrderQtyBtn: {
    width: 30,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  editOrderQtyText: {
    minWidth: 28,
    textAlign: "center",
    fontSize: 14,
    fontWeight: "900",
  },
  editOrderRemoveBtn: {
    width: 30,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FEE2E2",
    marginTop: 3,
  },
  editOrderDivider: {
    height: 1,
    width: "100%",
    marginVertical: 7,
  },
  editOrderSearchBox: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 11,
    minHeight: 45,
    gap: 8,
  },
  editOrderSearchInput: {
    flex: 1,
    minHeight: 42,
    fontSize: 14,
    outlineStyle: "none",
  } as any,
  editOrderLoadingProducts: {
    paddingVertical: 12,
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  editOrderSearchResult: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 11,
    padding: 8,
    gap: 9,
  },
  editOrderSearchImage: {
    width: 48,
    height: 48,
    borderRadius: 8,
  },
  editOrderPickedBox: {
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 12,
    gap: 9,
    marginTop: 4,
  },
  editOrderPickedTitle: {
    fontSize: 15,
    fontWeight: "900",
    textAlign: "right",
  },
  editOrderChoiceLabel: {
    fontSize: 12,
    fontWeight: "800",
    textAlign: "right",
  },
  editOrderChoiceRow: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    flexWrap: "wrap",
    gap: 7,
  },
  editOrderChoiceChip: {
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 9,
  },
  editOrderAddBtn: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 11,
    borderRadius: 10,
    marginTop: 2,
  },
  editOrderAddBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
  },
  editOrderSummary: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 7,
    marginTop: 8,
  },
  editOrderSummaryRow: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  editOrderFooter: {
    borderTopWidth: 1,
    padding: 12,
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    gap: 8,
  },
  editOrderCancelBtn: {
    minWidth: 100,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  editOrderSaveBtn: {
    flex: 1,
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  editOrderSaveBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "900",
  },
  deleteBtn: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10, marginTop: 4 },
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
  printConfirmCard: {
    width: 320,
    maxWidth: "90%",
    borderRadius: 18,
    borderWidth: 1,
    padding: 22,
    alignItems: "center",
    gap: 10,
  },
  printConfirmIcon: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: "#E91E8C18",
    alignItems: "center",
    justifyContent: "center",
  },
  printConfirmTitle: {
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  printConfirmSub: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 4,
  },
  printConfirmYes: {
    width: "100%",
    backgroundColor: "#22c55e",
    paddingVertical: 12,
    borderRadius: 11,
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  printConfirmYesText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
  },
  printConfirmNo: {
    width: "100%",
    borderWidth: 1,
    paddingVertical: 11,
    borderRadius: 11,
    alignItems: "center",
  },
  printConfirmNoText: {
    fontSize: 14,
    fontWeight: "700",
  },
  scannerCard: { width: "92%", maxWidth: 480, borderRadius: 18, borderWidth: 1, padding: 16, gap: 10 },
  scannerTitle: { fontSize: 18, fontWeight: "800", textAlign: "center" },
  scannerHint: { fontSize: 13, textAlign: "center", lineHeight: 19 },
  scannerCamera: { width: "100%", height: 270, overflow: "hidden", borderRadius: 12, backgroundColor: "#000" },
  scannerCloseBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  scannerCloseText: { fontSize: 14, fontWeight: "700" },
});
