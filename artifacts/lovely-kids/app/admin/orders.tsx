import { getResponsiveTopPadding } from "@/utils/webLayout";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Print from "expo-print";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { buildCustomerWhatsappUrl } from "@/utils/whatsappPhone";
import { startWebBarcodeScanner } from "@/utils/webBarcodeScanner";
import {
  captureScannerKeyboardEvent,
  createScannerKeyboardBuffer,
} from "@/utils/scannerKeyboard";

interface OrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  promotionDiscountMinor?: number;
  promotionAllocations?: Array<{
    promotionId: number;
    promotionName: string;
    groupKey: string;
    discountMinor: number;
  }>;
  invoiceDiscountMinor?: number;
  image?: string;
  size?: string;
  color?: string;
  rewardForPromotionId?: number;
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

interface AdminOrderEditBarcode {
  barcode: string;
  color?: string | null;
  size?: string | null;
}

interface AdminOrderEditProduct {
  id: string;
  name?: string;
  nameAr: string;
  price: number;
  image?: string;
  productCode?: string | null;
  barcode?: string | null;
  additionalBarcodes?: AdminOrderEditBarcode[];
  stock?: number | null;
  sizes?: string[];
  colorVariants?: AdminOrderEditVariant[];
  deletedAt?: string | null;
}

interface EditableOrderItem extends OrderItem {}

interface Order {
  id: number;
  exchangeOriginalOrderId?: number | null;
  exchangePublicId?: string | null;
  exchangeReplacementOrderOrigin?: "system_created" | "existing_order" | null;
  exchangeReturnNetMinor?: number | null;
  exchangeNewNetMinor?: number | null;
  exchangeDifferenceMinor?: number | null;
  exchangeDeliveryChargeMinor?: number | null;
  exchangeSettlementAmountMinor?: number | null;
  exchangeFinancialCompletedAt?: string | null;
  exchangeReturnReceivedAt?: string | null;
  mergedIntoOrderId?: number | null;
  mergedAt?: string | null;
  mergedByUserId?: number | null;
  mergedOrderIds?: number[];
  mergedOrderCount?: number;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  items: OrderItem[];
  totalPrice: number;
  shippingZone?: string;
  shippingCost?: number;
  deliveryCompanyCost?: number | null;
  courierCashReceivedAt?: string | null;
  courierCashReversedAt?: string | null;
  shippingOriginalCost?: number | null;
  shippingPromotionDiscount?: number | null;
  promotionDiscountAmount?: number;
  discountCode?: string | null;
  discountCodeLabel?: string | null;
  discountCodePercent?: number | null;
  discountCodeAmount?: number | null;
  discountCodeStacksWithShippingPromotion?: boolean | null;
  fulfillmentMethod?: "delivery" | "pickup" | null;
  status: string;
  notes?: string;
  paymentMethod: string;
  paymentStatus: string;
  paymentProof?: string;
  printedAt?: string | null;
  printCount?: number;
  createdAt: string;
}

interface OnlineExchangeReturnItem {
  id?: string;
  productId?: string | null;
  productNameAr: string;
  productCode?: string | null;
  barcode?: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  soldUnitPriceMinor: number;
  returnNetMinor: number;
  allocatedDiscountMinor?: number;
}

interface OnlineExchangeStatusPayload {
  exchange: {
    publicId: string;
    status: string;
    replacementOrderId: string | null;
    returnNetMinor: number;
    newNetMinor: number;
    differenceMinor: number;
    deliveryBaseChargeMinor: number;
    deliveryDiscountMinor: number;
    deliveryChargeMinor: number;
    settlementAmountMinor: number;
    financialCompletedAt: string | null;
    returnReceivedAt: string | null;
    deliveryDiscountMode: "none" | "half" | "full" | "manual";
  };
  returnItems: OnlineExchangeReturnItem[];
}

interface OnlineExchangeReceivePayload {
  alreadyReceived: boolean;
  exchange: {
    publicId: string;
    returnReceivedAt: string | null;
  };
  items?: OnlineExchangeReturnItem[];
}

interface ExchangeReturnConfirmation {
  orderId: number;
  publicId: string;
  items: OnlineExchangeReturnItem[];
}

const ADMIN_STORE_PICKUP_LABEL = "استلام من المحل";
const ADMIN_LOCAL_DELIVERY_LABEL = "ديلفري داخل مدينة نابلس";
const ADMIN_LOCAL_DELIVERY_BASE_ILS = 15;

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
  if (shipping.label === ADMIN_LOCAL_DELIVERY_LABEL) {
    return ADMIN_LOCAL_DELIVERY_BASE_ILS;
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

const ORDER_FILTER_OPTIONS = [
  { key: "all", label: "الكل", color: "#64748B", icon: "apps-outline" as const },
  {
    key: "exchange",
    label: "طلبات التبديل",
    color: "#7C3AED",
    icon: "swap-horizontal-outline" as const,
  },
  ...STATUS_OPTIONS,
];

const ORDER_TRANSITIONS: Record<string, readonly string[]> = {
  new: ["confirmed", "cancelled"],
  confirmed: ["new", "delivering", "cancelled"],
  delivering: ["new", "confirmed", "done", "cancelled"],
  done: [],
  cancelled: ["confirmed", "delivering", "done"],
};

const PICKUP_ORDER_TRANSITIONS: Record<
  string,
  readonly string[]
> = {
  new: ["confirmed", "cancelled"],
  confirmed: ["new", "done", "cancelled"],
  delivering: ["confirmed", "done", "cancelled"],
  done: [],
  cancelled: ["confirmed"],
};

function isStorePickupOrder(
  order: Pick<
    Order,
    "shippingZone" | "fulfillmentMethod"
  >,
) {
  return (
    order.shippingZone ===
      ADMIN_STORE_PICKUP_LABEL ||
    order.fulfillmentMethod ===
      "pickup"
  );
}

function statusInfo(
  s: string,
  isPickup = false,
) {
  if (s === "merged") {
    return {
      key: "merged",
      label: "مدمج",
      color: "#64748B",
      icon: "git-merge-outline" as const,
    };
  }

  const found =
    STATUS_OPTIONS.find(
      (o) => o.key === s,
    ) ?? STATUS_OPTIONS[0];

  if (
    isPickup &&
    s === "done"
  ) {
    return {
      ...found,
      label:
        "تم الاستلام",
      icon:
        "storefront-outline" as const,
    };
  }

  if (
    isPickup &&
    s === "delivering"
  ) {
    return {
      ...found,
      label:
        "مؤكد",
      color:
        "#2196F3",
      icon:
        "checkmark-circle-outline" as const,
    };
  }

  return found;
}

function paymentMethodLabel(m: string) {
  return m === "bank_transfer" ? "تحويل بنكي" : m === "local_store_cash" ? "نقدًا للمحل - ديلفري نابلس" : "عند الاستلام";
}

function getOrderInvoiceDiscount(items: OrderItem[]): number {
  return items.reduce(
    (sum, item) =>
      sum +
      (Number.isSafeInteger(item.invoiceDiscountMinor)
        ? Number(item.invoiceDiscountMinor)
        : 0),
    0,
  ) / 100;
}

function formatMinorMoney(
  minor: number,
) {
  const value =
    minor / 100;

  return Number.isInteger(value)
    ? `${value}₪`
    : `${value.toFixed(2)}₪`;
}

function getOnlineExchangeDisplay(
  order: Order,
) {
  const hasExchangeLink =
    Number.isSafeInteger(
      order.exchangeOriginalOrderId,
    ) &&
    Number(
      order.exchangeOriginalOrderId,
    ) > 0;

  if (!hasExchangeLink) {
    return null;
  }

  const amounts = [
    order.exchangeReturnNetMinor,
    order.exchangeNewNetMinor,
    order.exchangeDifferenceMinor,
    order.exchangeDeliveryChargeMinor,
    order.exchangeSettlementAmountMinor,
  ];

  if (
    amounts.some(
      (value) =>
        !Number.isSafeInteger(
          value,
        ),
    )
  ) {
    return null;
  }

  const returnNetMinor =
    Number(
      order.exchangeReturnNetMinor,
    );
  const newNetMinor =
    Number(
      order.exchangeNewNetMinor,
    );
  const differenceMinor =
    Number(
      order.exchangeDifferenceMinor,
    );
  const deliveryChargeMinor =
    Number(
      order.exchangeDeliveryChargeMinor,
    );
  const settlementAmountMinor =
    Number(
      order.exchangeSettlementAmountMinor,
    );

  const settlementLabel =
    settlementAmountMinor > 0
      ? "المطلوب من الزبون"
      : settlementAmountMinor < 0
        ? "مستحق للزبون"
        : "صافي التبديل";

  const differenceLabel =
    differenceMinor > 0
      ? "فرق الأصناف — على الزبون"
      : differenceMinor < 0
        ? "فرق الأصناف — للزبون"
        : "فرق الأصناف";

  return {
    returnNetMinor,
    newNetMinor,
    differenceMinor,
    deliveryChargeMinor,
    settlementAmountMinor,
    settlementLabel,
    differenceLabel,
  };
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

function normalizeOrderLookup(value: string) {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const persianDigits = "۰۱۲۳۴۵۶۷۸۹";

  return value
    .trim()
    .toLowerCase()
    .replace(/[٠-٩]/g, (d) => String(arabicDigits.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(persianDigits.indexOf(d)));
}

function normalizeMergePhone(value: string) {
  const digits = value
    .replace(/[^0-9]/g, "")
    .replace(/^00/, "");

  return digits.length >= 9
    ? digits.slice(-9)
    : digits;
}

function isMergeEligibleOrder(order: Order) {
  return (
    (order.status === "new" ||
      order.status === "confirmed") &&
    order.paymentMethod === "cod" &&
    order.mergedIntoOrderId == null &&
    (order.mergedOrderCount ?? 0) === 0 &&
    !order.exchangePublicId &&
    order.shippingZone !== ADMIN_LOCAL_DELIVERY_LABEL
  );
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
  const [hasLoadedOrders, setHasLoadedOrders] = useState(false);
  const [ordersRefreshError, setOrdersRefreshError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [proofModal, setProofModal] = useState<string | null>(null);
  const [whatsappTarget, setWhatsappTarget] = useState<{
    phone: string;
    orderId: number;
  } | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [pickupConfirmOrder, setPickupConfirmOrder] = useState<Order | null>(null);
  const [pickupConvertingId, setPickupConvertingId] = useState<number | null>(null);
  const [courierCashTarget, setCourierCashTarget] = useState<Order | null>(null);
  const [courierCashBusy, setCourierCashBusy] = useState(false);
  const [courierCashError, setCourierCashError] = useState("");
  const [courierReversalTarget, setCourierReversalTarget] = useState<Order | null>(null);
  const [courierReversalReason, setCourierReversalReason] = useState("");
  const [courierReversalGoodsReturned, setCourierReversalGoodsReturned] = useState(false);
  const [courierReversalCashRefunded, setCourierReversalCashRefunded] = useState(false);
  const [courierReversalNoFee, setCourierReversalNoFee] = useState(false);
  const [courierReversalBusy, setCourierReversalBusy] = useState(false);
  const [courierReversalError, setCourierReversalError] = useState("");
  const [
    pickupSettlementOrder,
    setPickupSettlementOrder,
  ] = useState<Order | null>(null);
  const [
    pickupSettlementMethod,
    setPickupSettlementMethod,
  ] = useState<"cash" | "card">("cash");
  const [
    pickupCardProcessor,
    setPickupCardProcessor,
  ] = useState<
    "arab" | "bop" | null
  >(null);
  const [exchangeVoidTarget, setExchangeVoidTarget] = useState<Order | null>(null);
  const [exchangeVoidReason, setExchangeVoidReason] = useState("");
  const [exchangeVoidBusy, setExchangeVoidBusy] = useState(false);
  const [exchangeVoidError, setExchangeVoidError] = useState("");
  const [exchangeReturnConfirm, setExchangeReturnConfirm] =
    useState<ExchangeReturnConfirmation | null>(null);
  const [exchangeReturnBusyId, setExchangeReturnBusyId] =
    useState<number | null>(null);
  const [pendingOrderIds, setPendingOrderIds] = useState<Set<number>>(new Set());
  const [printingId, setPrintingId] = useState<number | null>(null);
  const [thermalPrintingId, setThermalPrintingId] =
    useState<number | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [qrScanned, setQrScanned] = useState(false);
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [mergeSelectedIds, setMergeSelectedIds] =
    useState<Set<number>>(new Set());
  const [mergePreviewVisible, setMergePreviewVisible] =
    useState(false);
  const [mergeBusy, setMergeBusy] =
    useState(false);
  const [printConfirmVisible, setPrintConfirmVisible] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [companyCostOrder, setCompanyCostOrder] = useState<Order | null>(null);
  const [companyCostValue, setCompanyCostValue] = useState("");
  const [companyCostError, setCompanyCostError] = useState<string | null>(null);
  const [companyCostSaving, setCompanyCostSaving] = useState(false);
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
  const [editInvoiceDiscount, setEditInvoiceDiscount] = useState("0");
  const [editLocalDiscount, setEditLocalDiscount] = useState("0");
  const [editLocalExtra, setEditLocalExtra] = useState("0");
  const [editLocalCourierCost, setEditLocalCourierCost] = useState("");
  const editLocalCharge =
    ADMIN_LOCAL_DELIVERY_BASE_ILS -
    (Number(editLocalDiscount) || 0) +
    (Number(editLocalExtra) || 0);
  const [editLocalCustomerConfirmed, setEditLocalCustomerConfirmed] = useState(false);
  const [editExchangeDeliveryMode, setEditExchangeDeliveryMode] =
    useState<"none" | "half" | "full" | "manual">("none");
  const [editExchangeManualDelivery, setEditExchangeManualDelivery] = useState("0");
  const [editPaymentMethod, setEditPaymentMethod] =
    useState<"cod" | "bank_transfer" | "local_store_cash">("cod");

  const editScannerKeyboard =
    useRef(createScannerKeyboardBuffer());

  const editScannerSearchFocused =
    useRef(false);

  const printConfirmResolverRef =
    useRef<((confirmed: boolean) => void) | null>(null);

  const orderSearchTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const pendingOrderIdsRef = useRef<Set<number>>(new Set());
  const ordersFetchVersionRef = useRef(0);
  const ordersRequestIdRef = useRef(0);
  const ordersRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchOrdersRef = useRef<() => Promise<void>>(async () => {});
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
    const requestId = ++ordersRequestIdRef.current;

    try {
      const token = await getAuthToken();
      if (!token) throw new Error("Orders refresh: admin session unavailable");

      const res = await fetch(`${API_BASE}/api/orders`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Orders refresh: HTTP ${res.status}`);

      const data: unknown = await res.json();
      if (!Array.isArray(data)) throw new Error("Orders refresh: invalid response");

      if (fetchVersion !== ordersFetchVersionRef.current || requestId !== ordersRequestIdRef.current) return;
      setOrders(data);
      setHasLoadedOrders(true);
      setOrdersRefreshError(null);
      if (ordersRetryTimerRef.current !== null) {
        clearTimeout(ordersRetryTimerRef.current);
        ordersRetryTimerRef.current = null;
      }
    } catch (error) {
      if (fetchVersion !== ordersFetchVersionRef.current || requestId !== ordersRequestIdRef.current) return;
      console.warn("Failed to refresh admin orders:", error);
      setOrdersRefreshError("تعذّر تحديث الطلبات مؤقتًا. نعرض آخر بيانات صحيحة وسنعيد المحاولة تلقائيًا.");
      // Never replace known orders with an empty list after a transient API or session failure.
      if (ordersRetryTimerRef.current === null) {
        ordersRetryTimerRef.current = setTimeout(() => {
          ordersRetryTimerRef.current = null;
          void fetchOrdersRef.current();
        }, 5000);
      }
    } finally {
      if (requestId === ordersRequestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [getAuthToken]);
  fetchOrdersRef.current = fetchOrders;

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
    void fetchOrders();
    const interval = setInterval(() => void fetchOrders(), 30000);
    return () => {
      clearInterval(interval);
      if (ordersRetryTimerRef.current !== null) {
        clearTimeout(ordersRetryTimerRef.current);
        ordersRetryTimerRef.current = null;
      }
      ordersRequestIdRef.current += 1;
    };
  }, [fetchOrders]);

  // عداد الاستلام يتحرك محلياً فقط بدون أي طلبات للسيرفر
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);

  const fetchOnlineExchangeStatus = useCallback(
    async (publicId: string): Promise<OnlineExchangeStatusPayload> => {
      const token = await getAuthToken();

      if (!token) {
        throw new Error("انتهت جلسة تسجيل الدخول");
      }

      const res = await fetch(
        `${API_BASE}/api/pos/exchanges/online/status?publicId=${encodeURIComponent(publicId)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const body = (await res.json().catch(() => null)) as
        | OnlineExchangeStatusPayload
        | { error?: string }
        | null;

      if (!res.ok) {
        throw new Error(
          body && "error" in body && body.error
            ? body.error
            : "تعذر تحميل حالة طرد التبديل",
        );
      }

      if (
        !body ||
        !("exchange" in body) ||
        !Array.isArray(body.returnItems)
      ) {
        throw new Error("بيانات عملية التبديل غير مكتملة");
      }

      return body;
    },
    [getAuthToken],
  );

  const confirmVoidOnlineExchange = async () => {
    const target = exchangeVoidTarget;
    const reason = exchangeVoidReason.trim();
    if (!target?.exchangePublicId || exchangeVoidBusy) return;
    if (reason.length < 3) {
      setExchangeVoidError("أدخل سبب الإلغاء (3 أحرف على الأقل)");
      return;
    }

    setExchangeVoidBusy(true);
    setExchangeVoidError("");
    try {
      const token = await getAuthToken();
      if (!token) throw new Error("انتهت جلسة تسجيل الدخول");

      const response = await fetch(`${API_BASE}/api/pos/exchanges/online/void`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ publicId: target.exchangePublicId, reason }),
      });
      const body = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!response.ok || !body?.ok) {
        throw new Error(body?.error ?? "تعذر إلغاء التبديل");
      }

      setExchangeVoidTarget(null);
      setExchangeVoidReason("");
      setOrders((current) =>
        current.map((order) =>
          order.id === target.id
            ? { ...order, status: "cancelled", exchangePublicId: null }
            : order,
        ),
      );
      await fetchOrdersRef.current();
      Alert.alert("تم إلغاء التبديل", "أُلغي الطلب البديل بأمان، ويمكن إنشاء تبديل جديد من الطلب الأصلي.");
    } catch (error) {
      setExchangeVoidError(error instanceof Error ? error.message : "تعذر إلغاء التبديل");
    } finally {
      setExchangeVoidBusy(false);
    }
  };

  const openExchangeReturnReceipt = async (order: Order) => {
    const publicId = order.exchangePublicId?.trim();

    if (!publicId || exchangeReturnBusyId !== null) {
      return;
    }

    setExchangeReturnBusyId(order.id);

    try {
      const status = await fetchOnlineExchangeStatus(publicId);

      setOrders((prev) =>
        prev.map((item) =>
          item.id === order.id
            ? {
                ...item,
                exchangeFinancialCompletedAt:
                  status.exchange.financialCompletedAt,
                exchangeReturnReceivedAt:
                  status.exchange.returnReceivedAt,
              }
            : item,
        ),
      );

      if (status.exchange.returnReceivedAt) {
        if (Platform.OS !== "web") {
          Alert.alert(
            "تم الاستلام مسبقًا",
            "هذا الطرد المرتجع تم استلامه وإرجاع أصنافه إلى المخزون مسبقًا.",
          );
        }
        return;
      }

      if (!status.exchange.financialCompletedAt) {
        throw new Error(
          "يجب تسجيل تسليم الطلب البديل أولًا قبل استلام الطرد المرتجع",
        );
      }

      if (status.returnItems.length === 0) {
        throw new Error("لا توجد أصناف مرتجعة مرتبطة بعملية التبديل");
      }

      setExchangeReturnConfirm({
        orderId: order.id,
        publicId,
        items: status.returnItems,
      });
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : "تعذر تحميل حالة طرد التبديل";

      showError(msg);

      if (Platform.OS !== "web") {
        Alert.alert("تعذر استلام التبديل", msg);
      }
    } finally {
      setExchangeReturnBusyId(null);
    }
  };

  const confirmReceiveOnlineExchangeReturn = async () => {
    const confirmation = exchangeReturnConfirm;

    if (!confirmation || exchangeReturnBusyId !== null) {
      return;
    }

    setExchangeReturnBusyId(confirmation.orderId);

    try {
      const token = await getAuthToken();

      if (!token) {
        throw new Error("انتهت جلسة تسجيل الدخول");
      }

      const res = await fetch(
        `${API_BASE}/api/pos/exchanges/online/receive-return`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            publicId: confirmation.publicId,
          }),
        },
      );

      const body = (await res.json().catch(() => null)) as
        | OnlineExchangeReceivePayload
        | { error?: string }
        | null;

      if (!res.ok) {
        throw new Error(
          body && "error" in body && body.error
            ? body.error
            : "تعذر تسجيل استلام طرد التبديل",
        );
      }

      if (
        !body ||
        !("exchange" in body) ||
        !body.exchange.returnReceivedAt
      ) {
        throw new Error("تعذر تأكيد حالة استلام الطرد المرتجع");
      }

      setOrders((prev) =>
        prev.map((item) =>
          item.id === confirmation.orderId
            ? {
                ...item,
                exchangeReturnReceivedAt:
                  body.exchange.returnReceivedAt,
              }
            : item,
        ),
      );

      setExchangeReturnConfirm(null);

      if (Platform.OS !== "web") {
        Alert.alert(
          "تم استلام التبديل",
          "تم إرجاع الأصناف القديمة إلى المخزون وتحديث تكلفة المخزون بنجاح.",
        );
      }
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : "تعذر تسجيل استلام طرد التبديل";

      showError(msg);

      if (Platform.OS !== "web") {
        Alert.alert("تعذر استلام التبديل", msg);
      }
    } finally {
      setExchangeReturnBusyId(null);
    }
  };

  const updateStatus = async (
    id: number,
    status: string,
    pickupSettlement?: {
      pickupSettlementMethod:
        | "cash"
        | "card";
      cardProcessor?:
        | "arab"
        | "bop";
    },
  ) => {
    if (
      pendingOrderIdsRef.current.has(
        id,
      )
    ) {
      return false;
    }

    const order = orders.find(
      (o) => o.id === id,
    );

    const previousStatus =
      order?.status;

    if (
      !order ||
      !previousStatus ||
      previousStatus === status
    ) {
      return false;
    }

    const isPickup =
      isStorePickupOrder(order);

    const transitions =
      isPickup
        ? PICKUP_ORDER_TRANSITIONS
        : ORDER_TRANSITIONS;

    const allowed =
      transitions[
        previousStatus
      ] ?? [];

    if (
      !allowed.includes(
        status,
      )
    ) {
      return false;
    }

    pendingOrderIdsRef.current.add(
      id,
    );
    ordersFetchVersionRef.current +=
      1;

    setOrders((prev) =>
      prev.map((o) =>
        o.id === id
          ? {
              ...o,
              status,
              ...(
                isPickup &&
                status === "done"
                  ? {
                      paymentStatus:
                        "confirmed",
                    }
                  : {}
              ),
            }
          : o,
      ),
    );

    setPendingOrderIds(
      (prev) =>
        new Set(prev).add(
          id,
        ),
    );

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          0,
        ),
    );

    try {
      const token =
        await getAuthToken();

      if (!token) {
        throw new Error(
          "انتهت جلسة تسجيل الدخول",
        );
      }

      const statusUrl = `${API_BASE}/api/orders/${id}/status`;
      const statusRequest = {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          status,
          ...(pickupSettlement ?? {}),
        }),
      };

      // Only the idempotent "delivering" transition can be safely retried.
      // Never replay a financial completion or cancellation on network errors.
      let res: Response;
      try {
        res = await fetch(statusUrl, statusRequest);
      } catch (networkError) {
        if (status !== "delivering") throw networkError;
        await new Promise((resolve) => setTimeout(resolve, 750));
        try {
          res = await fetch(statusUrl, statusRequest);
        } catch {
          // A lost response might have concealed a successful PATCH.
          try {
            const check = await fetch(`${API_BASE}/api/orders`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (check.ok) {
              const latest = await check.json() as Order[];
              const serverOrder = Array.isArray(latest)
                ? latest.find((row) => row.id === id)
                : undefined;
              if (serverOrder?.status === status) {
                setOrders((prev) => prev.map((row) =>
                  row.id === id ? { ...row, ...serverOrder } : row,
                ));
                return true;
              }
            }
          } catch {
            // Still offline, preserve original state.
          }
          throw new Error(
            "تعذّر الاتصال بخادم الطلبات لتغيير الحالة. افتح lovelykids.net/admin/orders مباشرة وحدث الصفحة. لم يتم تسجيل أي قبض جديد.",
          );
        }
      }

      if (!res.ok) {
        let msg =
          "تعذر تحديث الحالة";

        try {
          const body =
            (await res.json()) as {
              error?: string;
            };

          if (body.error) {
            msg = body.error;
          }
        } catch {
          // ignore
        }

        throw new Error(
          msg,
        );
      }

      const updatedOrder =
        (await res.json()) as Order;

      setOrders((prev) =>
        prev.map((o) =>
          o.id === id
            ? {
                ...o,
                ...updatedOrder,
              }
            : o,
        ),
      );

      return true;
    } catch (error) {
      setOrders((prev) =>
        prev.map((o) =>
          o.id === id
            ? {
                ...o,
                status:
                  previousStatus,
                paymentStatus:
                  order.paymentStatus,
              }
            : o,
        ),
      );

      const msg =
        error instanceof Error
          ? error.message
          : "حدث خطأ غير متوقع";

      showError(msg);

      if (
        Platform.OS !==
        "web"
      ) {
        Alert.alert(
          "تعذر تحديث الحالة",
          msg,
        );
      }

      return false;
    } finally {
      pendingOrderIdsRef.current.delete(
        id,
      );

      setPendingOrderIds(
        (prev) => {
          const next =
            new Set(prev);

          next.delete(id);
          return next;
        },
      );
    }
  };

  const confirmCourierCashHandover = async () => {
    const target = courierCashTarget;
    if (!target || courierCashBusy) return;

    setCourierCashBusy(true);
    setCourierCashError("");
    try {
      const token = await getAuthToken();
      if (!token) throw new Error("انتهت جلسة تسجيل الدخول");
      const res = await fetch(
        `${API_BASE}/api/orders/${target.id}/local-courier-cash`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const body = await res.json().catch(() => null) as
        | { ok?: boolean; error?: string; receivedAt?: string; amountMinor?: number }
        | null;
      if (!res.ok || !body?.ok || !body.receivedAt) {
        throw new Error(body?.error ?? "تعذر تسجيل قبض المندوب");
      }

      setOrders((current) => current.map((order) =>
        order.id === target.id
          ? { ...order, courierCashReceivedAt: body.receivedAt }
          : order,
      ));
      setCourierCashTarget(null);
      await fetchOrdersRef.current();
      Alert.alert(
        "تم تسجيل قبض المندوب",
        `تم تسجيل ${(body.amountMinor ?? 0) / 100}₪ بالصندوق الرئيسي، دون أجرة التوصيل.`,
      );
    } catch (error) {
      setCourierCashError(
        error instanceof Error ? error.message : "تعذر تسجيل قبض المندوب",
      );
    } finally {
      setCourierCashBusy(false);
    }
  };

  const openLocalCourierReversal = (order: Order) => {
    setCourierReversalReason("");
    setCourierReversalGoodsReturned(false);
    setCourierReversalCashRefunded(false);
    setCourierReversalNoFee(false);
    setCourierReversalError("");
    setCourierReversalTarget(order);
  };

  const confirmLocalCourierReversal = async () => {
    const order = courierReversalTarget;
    if (!order || courierReversalBusy) return;
    setCourierReversalBusy(true);
    setCourierReversalError("");
    try {
      const token = await getAuthToken();
      if (!token) throw new Error("انتهت جلسة تسجيل الدخول");
      const response = await fetch(
        `${API_BASE}/api/orders/${order.id}/local-courier-reverse`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            reason: courierReversalReason.trim(),
            goodsReturned: courierReversalGoodsReturned,
            courierRefunded: courierReversalCashRefunded,
            noCourierFeeOwed: courierReversalNoFee,
          }),
        },
      );
      const result = await response.json().catch(() => null) as
        | { ok?: boolean; error?: string; order?: Order; cashRefundMinor?: number }
        | null;
      if (!response.ok || !result?.ok || !result.order) {
        throw new Error(result?.error ?? "تعذر عكس الطلب مالياً");
      }

      setOrders((prev) => prev.map((row) =>
        row.id === order.id
          ? { ...row, ...result.order, courierCashReversedAt: new Date().toISOString() }
          : row,
      ));
      setCourierReversalTarget(null);
      await fetchOrdersRef.current();
      Alert.alert(
        "تم عكس طلب الديلفري",
        `تم رد ${(result.cashRefundMinor ?? 0) / 100}₪ من الصندوق وإرجاع البضاعة وعكس قيود الطلب.`,
      );
    } catch (error) {
      setCourierReversalError(
        error instanceof Error ? error.message : "تعذر عكس طلب الديلفري",
      );
    } finally {
      setCourierReversalBusy(false);
    }
  };

  const openStorePickupCompletion = (
    order: Order,
  ) => {
    if (
      order.status !==
        "confirmed" &&
      order.status !==
        "delivering"
    ) {
      showError(
        "يجب تأكيد الطلب أولًا قبل تسجيل الاستلام من المحل",
      );
      return;
    }

    if (
      order.paymentMethod ===
      "bank_transfer"
    ) {
      void updateStatus(
        order.id,
        "done",
      );
      return;
    }

    setPickupSettlementOrder(
      order,
    );
    setPickupSettlementMethod(
      "cash",
    );
    setPickupCardProcessor(
      null,
    );
  };

  const confirmStorePickupCompletion =
    async () => {
      const order =
        pickupSettlementOrder;

      if (!order) {
        return;
      }

      if (
        pickupSettlementMethod ===
          "card" &&
        !pickupCardProcessor
      ) {
        showError(
          "اختر ماكينة الفيزا: البنك العربي أو بنك فلسطين",
        );
        return;
      }

      const succeeded =
        await updateStatus(
          order.id,
          "done",
          {
            pickupSettlementMethod,
            cardProcessor:
              pickupSettlementMethod ===
                "card"
                ? pickupCardProcessor ??
                  undefined
                : undefined,
          },
        );

      if (succeeded) {
        setPickupSettlementOrder(
          null,
        );
        setPickupCardProcessor(
          null,
        );
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


  const openCompanyCostEditor = (order: Order) => {
    const zone = settings.shippingZones?.find(
      (entry) => entry.label === order.shippingZone,
    );
    const suggestedCost =
      order.deliveryCompanyCost ?? zone?.companyCost ?? zone?.cost ?? 0;
    setCompanyCostOrder(order);
    setCompanyCostValue(String(suggestedCost));
    setCompanyCostError(null);
  };

  const saveCompanyCost = async () => {
    if (!companyCostOrder || companyCostSaving) return;
    if (!/^\\d+$/.test(companyCostValue) || Number(companyCostValue) > 10000) {
      setCompanyCostError("أدخل تكلفة الشركة بالشيكل الصحيح");
      return;
    }
    setCompanyCostSaving(true);
    setCompanyCostError(null);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error("انتهت جلسة تسجيل الدخول");
      const response = await fetch(
        `${API_BASE}/api/orders/${companyCostOrder.id}/delivery-company-cost`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            companyCost: Number(companyCostValue),
            expectedCost: companyCostOrder.deliveryCompanyCost ?? null,
          }),
        },
      );
      const result = await response.json().catch(() => null) as Order | { error?: string } | null;
      if (!response.ok) {
        throw new Error(result && "error" in result && result.error
          ? result.error : "تعذر تعديل تكلفة شركة التوصيل");
      }
      const updated = result as Order;
      setOrders((previous) =>
        previous.map((order) => order.id === updated.id ? { ...order, ...updated } : order),
      );
      setCompanyCostOrder(null);
    } catch (error) {
      setCompanyCostError(error instanceof Error ? error.message : "تعذر حفظ التكلفة");
    } finally {
      setCompanyCostSaving(false);
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
    setEditLocalDiscount("0");
    setEditLocalExtra("0");
    setEditLocalCourierCost("");
    setEditLocalCustomerConfirmed(false);
    setEditNotes("");
    setEditExchangeDeliveryMode("none");
    setEditExchangeManualDelivery("0");
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

      let products = Array.isArray(body)
        ? body.filter((product) => !product.deletedAt)
        : [];

      try {
        const barcodeRes = await fetch(
          `${API_BASE}/api/products/barcodes`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );

        if (!barcodeRes.ok) {
          throw new Error("تعذر تحميل الباركودات الإضافية");
        }

        const barcodeRows: Array<{
          productId: string;
          barcode: string;
          color: string | null;
          size: string | null;
        }> = await barcodeRes.json();

        const barcodesByProduct =
          new Map<string, AdminOrderEditBarcode[]>();

        for (const row of barcodeRows) {
          const items =
            barcodesByProduct.get(row.productId) ?? [];

          items.push({
            barcode: row.barcode,
            color: row.color,
            size: row.size,
          });

          barcodesByProduct.set(
            row.productId,
            items,
          );
        }

        products = products.map((product) => ({
          ...product,
          additionalBarcodes:
            barcodesByProduct.get(product.id) ?? [],
        }));
      } catch (error) {
        console.warn(
          "Order editor: failed to load additional barcodes",
          error,
        );
      }

      setEditProducts(products);
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
    if (
      order.status !== "new" &&
      order.status !== "confirmed" &&
      order.status !== "delivering"
    ) {
      showError(
        "يمكن تعديل الطلبات الجديدة أو المؤكدة أو قيد التوصيل فقط",
      );
      return;
    }

    if (order.exchangeFinancialCompletedAt) {
      showError("لا يمكن تعديل طلب تبديل تم تسجيله محاسبياً");
      return;
    }

    if (order.exchangePublicId) {
      try {
        const latest = await fetchOnlineExchangeStatus(order.exchangePublicId);
        if (latest.exchange.financialCompletedAt) {
          showError("تم تسليم طلب التبديل وتسجيله محاسبياً، ولا يمكن تعديله");
          return;
        }
        setEditExchangeDeliveryMode(latest.exchange.deliveryDiscountMode);
        setEditExchangeManualDelivery(
          String(latest.exchange.deliveryDiscountMinor / 100),
        );
      } catch (error) {
        showError(error instanceof Error ? error.message : "تعذر تحميل خصم توصيل التبديل");
        return;
      }
    } else {
      setEditExchangeDeliveryMode("none");
      setEditExchangeManualDelivery("0");
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
    // Preserve previously quoted prices when reopening existing local orders.
    const storedLocalCharge =
      order.shippingZone === ADMIN_LOCAL_DELIVERY_LABEL &&
      order.deliveryCompanyCost !== null
        ? (order.shippingCost ?? ADMIN_LOCAL_DELIVERY_BASE_ILS)
        : ADMIN_LOCAL_DELIVERY_BASE_ILS;
    setEditLocalDiscount(String(
      Math.max(0, ADMIN_LOCAL_DELIVERY_BASE_ILS - storedLocalCharge),
    ));
    setEditLocalExtra(String(
      Math.max(0, storedLocalCharge - ADMIN_LOCAL_DELIVERY_BASE_ILS),
    ));
    setEditLocalCourierCost(
      order.shippingZone === ADMIN_LOCAL_DELIVERY_LABEL &&
      order.deliveryCompanyCost !== null
        ? String(order.deliveryCompanyCost)
        : "",
    );
    setEditLocalCustomerConfirmed(
      order.shippingZone === ADMIN_LOCAL_DELIVERY_LABEL &&
      order.deliveryCompanyCost !== null,
    );
    setEditNotes(order.notes ?? "");
    setEditInvoiceDiscount(
      String(getOrderInvoiceDiscount(order.items)),
    );
    setEditPaymentMethod(
      order.paymentMethod === "bank_transfer"
        ? "bank_transfer"
        : order.paymentMethod === "local_store_cash"
          ? "local_store_cash"
          : "cod",
    );
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

  const changeEditItemPrice = (
    index: number,
    price: number,
  ) => {
    if (
      !Number.isSafeInteger(price) ||
      price < 0
    ) {
      return;
    }

    setEditItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              price,
            }
          : item,
      ),
    );

    setEditOrderError(null);
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
          (item.size ?? "") === (size ?? "") &&
          !item.rewardForPromotionId,
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

    const hasCodeDiscount =
      typeof editingOrder.discountCode === "string" &&
      editingOrder.discountCode.trim().length > 0 &&
      Number.isSafeInteger(editingOrder.discountCodePercent) &&
      Number(editingOrder.discountCodePercent) >= 1 &&
      Number(editingOrder.discountCodePercent) <= 100;

    const invoiceDiscount =
      hasCodeDiscount
        ? Math.floor(
            (
              editProductsTotal *
              Number(editingOrder.discountCodePercent)
            ) /
              100,
          )
        : editInvoiceDiscount.trim() === ""
          ? 0
          : Number(editInvoiceDiscount);

    if (
      !Number.isSafeInteger(invoiceDiscount) ||
      invoiceDiscount < 0
    ) {
      setEditOrderError(
        hasCodeDiscount
          ? "تعذر احتساب خصم كود الخصم"
          : "الخصم العام يجب أن يكون رقماً صحيحاً",
      );
      return;
    }

    if (invoiceDiscount > editProductsTotal) {
      setEditOrderError("الخصم العام أكبر من إجمالي المنتجات");
      return;
    }

    if (editShippingZone === ADMIN_LOCAL_DELIVERY_LABEL) {
      const discount = Number(editLocalDiscount);
      const extra = Number(editLocalExtra);
      const charge = editLocalCharge;
      const cost = Number(editLocalCourierCost);
      if (
        !/^\d+$/.test(editLocalDiscount) ||
        !/^\d+$/.test(editLocalExtra) ||
        !/^\d+$/.test(editLocalCourierCost) ||
        !Number.isSafeInteger(discount) ||
        !Number.isSafeInteger(extra) ||
        !Number.isSafeInteger(charge) ||
        !Number.isSafeInteger(cost) ||
        discount > ADMIN_LOCAL_DELIVERY_BASE_ILS ||
        extra > 10000 ||
        charge < 0 ||
        charge > 10000 ||
        cost > 10000 ||
        (discount > 0 && extra > 0)
      ) {
        setEditOrderError("تحقق من الخصم (0–15₪) والرسوم الإضافية وتكلفة المندوب بالأرقام الصحيحة");
        return;
      }
      if (!editLocalCustomerConfirmed) {
        setEditOrderError("يجب تأكيد موافقة الزبون على أجرة الديلفري قبل حفظ الطلب");
        return;
      }
    }

    if (editShippingZone !== ADMIN_LOCAL_DELIVERY_LABEL && editPaymentMethod === "local_store_cash") {
      setEditOrderError("اختر طريقة دفع عادية عند الخروج من الديلفري المحلي");
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
            invoiceDiscount,
            paymentMethod: editPaymentMethod,
            ...(editShippingZone === ADMIN_LOCAL_DELIVERY_LABEL
              ? {
                  localDeliveryCharge: editLocalCharge,
                  localDeliveryCourierCost: Number(editLocalCourierCost),
                }
              : {}),
            ...(editingOrder.exchangePublicId
              ? {
                  exchangeDeliveryDiscountMode: editExchangeDeliveryMode,
                  exchangeManualDeliveryDiscountMinor:
                    Number(editExchangeManualDelivery) * 100,
                }
              : {}),
            items: editItems.map((item) => ({
              id: item.id,
              quantity: item.quantity,
              price: item.price,
              color: item.color,
              size: item.size,
              ...(item.rewardForPromotionId
                ? {
                    rewardForPromotionId:
                      item.rewardForPromotionId,
                  }
                : {}),
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

  useEffect(() => {
    if (Platform.OS !== "web") return;

    const windowRef = (globalThis as any).window;

    if (!windowRef?.addEventListener) return;

    const handleEditProductScannerKeyDown = (event: any) => {
      if (!editScannerSearchFocused.current) {
        return;
      }

      const scannedValue = captureScannerKeyboardEvent(
        editScannerKeyboard.current,
        event,
      );

      if (event.key === "Enter" && scannedValue) {
        event.preventDefault?.();

        setEditSearch(scannedValue);
        setEditPickedProduct(null);
        setEditPickedColor(null);
        setEditPickedSize(null);
        setEditOrderError(null);
      }
    };

    windowRef.addEventListener(
      "keydown",
      handleEditProductScannerKeyDown,
      true,
    );

    return () => {
      windowRef.removeEventListener(
        "keydown",
        handleEditProductScannerKeyDown,
        true,
      );
    };
  }, []);

  const normalizedEditSearch = editSearch.trim().toLowerCase();

  useEffect(() => {
    if (!normalizedEditSearch) return;

    for (const product of editProducts) {
      const barcodeMatch = (product.additionalBarcodes ?? []).find(
        (item) =>
          item.barcode.trim().toLowerCase() === normalizedEditSearch,
      );

      if (!barcodeMatch) continue;

      setEditPickedProduct(product);
      setEditPickedColor(barcodeMatch.color ?? null);
      setEditPickedSize(barcodeMatch.size ?? null);
      setEditOrderError(null);

      break;
    }
  }, [normalizedEditSearch, editProducts]);

  const filteredEditProducts = normalizedEditSearch
    ? editProducts
        .filter((product) => {
          const haystack = [
            product.nameAr,
            product.name ?? "",
            product.productCode ?? "",
            product.barcode ?? "",
            ...(product.additionalBarcodes ?? []).map(
              (item) => item.barcode,
            ),
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

  const adminRegionOrder = ["الضفة الغربية", "القدس", "أراضي الـ48"];
  const editShippingZones: ShippingZone[] = [
    ...(settings.shippingZones?.length
      ? settings.shippingZones
      : ADMIN_DEFAULT_SHIPPING_ZONES
    ).filter(
      (zone) => zone.label !== ADMIN_STORE_PICKUP_LABEL &&
                zone.label !== ADMIN_LOCAL_DELIVERY_LABEL,
    ).sort((a, b) => {
      const ai = adminRegionOrder.indexOf(a.label);
      const bi = adminRegionOrder.indexOf(b.label);
      return (ai < 0 ? 3 : ai) - (bi < 0 ? 3 : bi);
    }),
    { label: ADMIN_LOCAL_DELIVERY_LABEL, cost: ADMIN_LOCAL_DELIVERY_BASE_ILS, promoCost: ADMIN_LOCAL_DELIVERY_BASE_ILS },
    { label: ADMIN_STORE_PICKUP_LABEL, cost: 0, promoCost: 0 },
  ];

  const editSelectedShippingZone =
    editShippingZones.find(
      (zone) => zone.label === editShippingZone,
    ) ?? null;

  const editingOrderHasDiscountCode =
    !!editingOrder &&
    typeof editingOrder.discountCode === "string" &&
    editingOrder.discountCode.trim().length > 0 &&
    Number.isSafeInteger(editingOrder.discountCodePercent) &&
    Number(editingOrder.discountCodePercent) >= 1 &&
    Number(editingOrder.discountCodePercent) <= 100;

  const editShippingCost = editSelectedShippingZone
    ? editShippingZone === ADMIN_LOCAL_DELIVERY_LABEL
      ? Number(editLocalCharge) || 0
    : editingOrder?.exchangePublicId
      ? Math.max(
          0,
          editSelectedShippingZone.cost -
            (editExchangeDeliveryMode === "full"
              ? editSelectedShippingZone.cost
              : editExchangeDeliveryMode === "half"
                ? editSelectedShippingZone.cost / 2
                : editExchangeDeliveryMode === "manual"
                  ? Number(editExchangeManualDelivery) || 0
                  : 0),
        )
      : editingOrderHasDiscountCode &&
          editingOrder?.discountCodeStacksWithShippingPromotion === false
        ? editSelectedShippingZone.cost
        : getAdminEditShippingCost(
            settings,
            editSelectedShippingZone,
            editProductsTotal,
          )
    : 0;

  const editInvoiceDiscountValue = (() => {
    if (
      editingOrderHasDiscountCode &&
      editingOrder
    ) {
      return Math.floor(
        (
          editProductsTotal *
          Number(editingOrder.discountCodePercent)
        ) /
          100,
      );
    }

    const value =
      editInvoiceDiscount.trim() === ""
        ? 0
        : Number(editInvoiceDiscount);

    return Number.isSafeInteger(value) && value >= 0
      ? value
      : 0;
  })();

  const editPreviewTotal =
    Math.max(
      0,
      editProductsTotal - editInvoiceDiscountValue,
    ) + editShippingCost;

  const callCustomer = (phone: string) => Linking.openURL(`tel:${phone}`);
  const whatsappCustomer = (phone: string, orderId: number) => {
    setWhatsappTarget({ phone, orderId });
  };

  const openWhatsappForCountry = (countryCode: "970" | "972") => {
    if (!whatsappTarget) return;

    const whatsappUrl = buildCustomerWhatsappUrl(
      whatsappTarget.phone,
      countryCode,
      whatsappTarget.orderId,
    );

    setWhatsappTarget(null);

    Linking.openURL(whatsappUrl).catch(() => {
      showError("تعذر فتح واتساب");
    });
  };

  const mergeSelectedOrders = useMemo(
    () =>
      orders.filter(
        (order) =>
          mergeSelectedIds.has(order.id),
      ),
    [orders, mergeSelectedIds],
  );

  const mergePreview = useMemo(() => {
    if (mergeSelectedOrders.length < 2) {
      return {
        error: "اختر طلبين أو أكثر للدمج",
        productsNet: 0,
        shippingCost: 0,
        originalShippingTotal: 0,
        total: 0,
        zone: "",
      };
    }

    const first =
      mergeSelectedOrders[0]!;

    const phone =
      normalizeMergePhone(
        first.customerPhone,
      );

    if (
      !phone ||
      mergeSelectedOrders.some(
        (order) =>
          normalizeMergePhone(
            order.customerPhone,
          ) !== phone,
      )
    ) {
      return {
        error: "الطلبات المختارة ليست لنفس رقم هاتف الزبون",
        productsNet: 0,
        shippingCost: 0,
        originalShippingTotal: 0,
        total: 0,
        zone: "",
      };
    }

    const zone =
      first.shippingZone?.trim() ?? "";

    if (
      !zone ||
      mergeSelectedOrders.some(
        (order) =>
          (order.shippingZone?.trim() ?? "") !==
          zone,
      )
    ) {
      return {
        error: "يجب أن تكون الطلبات على نفس منطقة التوصيل أو نفس طريقة الاستلام",
        productsNet: 0,
        shippingCost: 0,
        originalShippingTotal: 0,
        total: 0,
        zone,
      };
    }

    if (
      mergeSelectedOrders.some(
        (order) =>
          !isMergeEligibleOrder(order),
      )
    ) {
      return {
        error: "أحد الطلبات المختارة لا يسمح بالدمج",
        productsNet: 0,
        shippingCost: 0,
        originalShippingTotal: 0,
        total: 0,
        zone,
      };
    }

    const productsNet =
      mergeSelectedOrders.reduce(
        (sum, order) =>
          sum +
          Math.max(
            0,
            order.totalPrice -
              (order.shippingCost ?? 0),
          ),
        0,
      );

    const originalShippingTotal =
      mergeSelectedOrders.reduce(
        (sum, order) =>
          sum +
          Math.max(
            0,
            order.shippingCost ?? 0,
          ),
        0,
      );

    const shippingZone =
      zone === ADMIN_STORE_PICKUP_LABEL
        ? {
            label: ADMIN_STORE_PICKUP_LABEL,
            cost: 0,
            promoCost: 0,
          }
        : (
            settings.shippingZones ??
            []
          ).find(
            (candidate) =>
              candidate.label === zone,
          ) ?? null;

    if (!shippingZone) {
      return {
        error: "منطقة التوصيل الحالية غير موجودة في الإعدادات",
        productsNet,
        shippingCost: 0,
        originalShippingTotal,
        total: productsNet,
        zone,
      };
    }

    const hasNonStackingDiscount =
      mergeSelectedOrders.some(
        (order) =>
          !!order.discountCode &&
          order.discountCodeStacksWithShippingPromotion ===
            false,
      );

    const shippingCost =
      zone === ADMIN_STORE_PICKUP_LABEL
        ? 0
        : hasNonStackingDiscount
          ? shippingZone.cost
          : getAdminEditShippingCost(
              settings,
              shippingZone,
              productsNet,
            );

    return {
      error: null as string | null,
      productsNet,
      shippingCost,
      originalShippingTotal,
      total:
        productsNet +
        shippingCost,
      zone,
    };
  }, [
    mergeSelectedOrders,
    settings,
  ]);

  const toggleMergeSelection = (
    order: Order,
  ) => {
    if (!isMergeEligibleOrder(order)) {
      showError(
        "يمكن دمج الطلبات الجديدة أو المؤكدة والدفع عند الاستلام فقط",
      );
      return;
    }

    setMergeSelectedIds(
      (current) => {
        const next =
          new Set(current);

        if (next.has(order.id)) {
          next.delete(order.id);
          return next;
        }

        if (next.size >= 10) {
          showError(
            "يمكن دمج حتى 10 طلبات في العملية الواحدة",
          );
          return next;
        }

        next.add(order.id);
        return next;
      },
    );
  };

  const openMergePreview = () => {
    if (mergePreview.error) {
      showError(
        mergePreview.error,
      );
      return;
    }

    setMergePreviewVisible(true);
  };

  const selectCustomerMergeCandidates = (
    order: Order,
  ) => {
    const phone =
      normalizeMergePhone(
        order.customerPhone,
      );

    const orderTime =
      new Date(
        order.createdAt,
      ).getTime();

    const candidates =
      orders.filter(
        (candidate) => {
          if (
            !isMergeEligibleOrder(
              candidate,
            )
          ) {
            return false;
          }

          if (
            normalizeMergePhone(
              candidate.customerPhone,
            ) !== phone
          ) {
            return false;
          }

          if (
            (candidate.shippingZone?.trim() ?? "") !==
            (order.shippingZone?.trim() ?? "")
          ) {
            return false;
          }

          const candidateTime =
            new Date(
              candidate.createdAt,
            ).getTime();

          return (
            Number.isFinite(
              candidateTime,
            ) &&
            Number.isFinite(
              orderTime,
            ) &&
            Math.abs(
              candidateTime -
                orderTime,
            ) <=
              24 *
                60 *
                60 *
                1000
          );
        },
      );

    if (candidates.length < 2) {
      showError(
        "لا توجد طلبات أخرى قابلة للدمج لنفس الزبون خلال 24 ساعة",
      );
      return;
    }

    if (candidates.length > 10) {
      showError(
        "يوجد أكثر من 10 طلبات. اختر حتى 10 طلبات يدويًا للدمج.",
      );
      return;
    }

    setMergeSelectedIds(
      new Set(
        candidates.map(
          (candidate) =>
            candidate.id,
        ),
      ),
    );

    setMergePreviewVisible(
      true,
    );
  };

  const performMergeOrders = async () => {
    if (
      mergeBusy ||
      mergePreview.error ||
      mergeSelectedOrders.length <
        2
    ) {
      return;
    }

    setMergeBusy(true);

    try {
      const token =
        await getAuthToken();

      if (!token) {
        throw new Error(
          "انتهت جلسة تسجيل الدخول",
        );
      }

      const response =
        await fetch(
          `${API_BASE}/api/orders/merge`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
              Authorization:
                `Bearer ${token}`,
            },
            body:
              JSON.stringify({
                orderIds:
                  mergeSelectedOrders.map(
                    (order) =>
                      order.id,
                  ),
              }),
          },
        );

      const body =
        (await response
          .json()
          .catch(
            () => null,
          )) as
          | (
              Order & {
                mergedOrderIds?: number[];
              }
            )
          | {
              error?: string;
            }
          | null;

      if (
        !response.ok ||
        !body ||
        !("id" in body)
      ) {
        throw new Error(
          body &&
          "error" in body &&
          body.error
            ? body.error
            : "تعذر دمج الطلبات",
        );
      }

      setMergePreviewVisible(
        false,
      );
      setMergeSelectedIds(
        new Set(),
      );
      setExpanded(body.id);

      await fetchOrders();

      if (
        Platform.OS !==
        "web"
      ) {
        Alert.alert(
          "تم دمج الطلبات",
          `تم إنشاء الطلب الرئيسي #${body.id} بدون خصم المخزون مرة ثانية.`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "تعذر دمج الطلبات";

      showError(message);

      if (
        Platform.OS !==
        "web"
      ) {
        Alert.alert(
          "تعذر دمج الطلبات",
          message,
        );
      }
    } finally {
      setMergeBusy(false);
    }
  };

  const orderStatusCounts = useMemo(() => {
    const operationalOrders =
      orders.filter(
        (order) =>
          order.mergedIntoOrderId ==
          null,
      );

    const counts: Record<string, number> = {
      all:
        operationalOrders.length,
      exchange: 0,
    };

    for (const option of STATUS_OPTIONS) {
      counts[option.key] = 0;
    }

    for (const order of operationalOrders) {
      if (order.exchangePublicId) {
        counts.exchange += 1;
      }

      if (typeof counts[order.status] === "number") {
        counts[order.status] += 1;
      }
    }

    return counts;
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const search = normalizeOrderLookup(orderSearch);
    const needle = search.replace(/^#/, "");
    const compactNeedle = needle.replace(/\s+/g, "");

    return orders.filter((order) => {
      if (
        order.mergedIntoOrderId !== null &&
        !needle
      ) {
        return false;
      }

      if (
        orderStatusFilter === "exchange" &&
        !order.exchangePublicId
      ) {
        return false;
      }

      if (
        orderStatusFilter !== "all" &&
        orderStatusFilter !== "exchange" &&
        order.status !== orderStatusFilter
      ) {
        return false;
      }

      if (!needle) return true;

      const values = [
        String(order.id),
        order.customerName ?? "",
        order.customerPhone ?? "",
      ].map(normalizeOrderLookup);

      return values.some(
        (value) =>
          value.includes(needle) ||
          value.replace(/\s+/g, "").includes(compactNeedle),
      );
    });
  }, [orders, orderSearch, orderStatusFilter]);

  const openOrderById = useCallback((id: number) => {
    const index = orders.findIndex((order) => order.id === id);

    if (index < 0) {
      showError(`الطلب #${id} غير موجود`);
      return false;
    }

    setOrderStatusFilter("all");
    setOrderSearch("");
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
      // For exchanges, print the actual return lines and delivery pricing
      // snapshot. The replacement order's items alone cannot describe the
      // returned goods, and its shippingCost only contains net delivery.
      const exchangePrintData = order.exchangePublicId
        ? await fetchOnlineExchangeStatus(order.exchangePublicId)
        : null;

      if (order.exchangeOriginalOrderId && !exchangePrintData) {
        throw new Error("تعذر تحميل تفاصيل التبديل المرتجعة للطباعة.");
      }

      if (exchangePrintData) {
        if (
          exchangePrintData.exchange.status !== "completed" ||
          exchangePrintData.exchange.replacementOrderId !== String(order.id) ||
          exchangePrintData.exchange.publicId !== order.exchangePublicId
        ) {
          throw new Error("بيانات التبديل تغيرت، حدّث قائمة الطلبات قبل الطباعة.");
        }
      }

      const productCodeById = new Map<string, string | null>();

      // Thermal receipts are printed from the admin screen, so use the
      // authenticated catalog. The public catalog intentionally excludes
      // hidden / trashed products, which can make an order lose its printed
      // code as soon as the sold item becomes hidden after stock reaches zero.
      //
      // A catalog lookup failure must never block printing an already-loaded
      // order, so we keep a public-catalog fallback and finally print "—".
      try {
        const authToken = await getAuthToken();

        let productsResponse: Response | null = null;

        if (authToken) {
          productsResponse = await fetch(
            `${API_BASE}/api/products/admin`,
            {
              headers: {
                Authorization:
                  `Bearer ${authToken}`,
              },
              cache: "no-store",
            },
          );
        }

        if (!productsResponse?.ok) {
          productsResponse = await fetch(
            `${API_BASE}/api/products`,
            {
              cache: "no-store",
            },
          );
        }

        if (productsResponse.ok) {
          const productsPayload = await productsResponse.json();

          const productList = Array.isArray(productsPayload)
            ? productsPayload
            : Array.isArray(productsPayload?.products)
              ? productsPayload.products
              : [];

          productList.forEach((product: any) => {
            const productCode =
              typeof product.productCode === "string" &&
              product.productCode.trim()
                ? product.productCode.trim()
                : typeof product.barcode === "string" &&
                    product.barcode.trim()
                  ? product.barcode.trim()
                  : null;

            productCodeById.set(
              String(product.id),
              productCode,
            );
          });
        } else {
          console.warn(
            "تعذر تحميل أكواد المنتجات للطباعة، سيتم طباعة الطلب بدون الأكواد",
          );
        }
      } catch (productCodeError) {
        console.warn(
          "تعذر تحميل أكواد المنتجات للطباعة، سيتم طباعة الطلب بدون الأكواد",
          productCodeError,
        );
      }

      await printOrderThermalReceipt({
        ...order,
        ...(exchangePrintData
          ? {
              exchangeReturnNetMinor: exchangePrintData.exchange.returnNetMinor,
              exchangeNewNetMinor: exchangePrintData.exchange.newNetMinor,
              exchangeDifferenceMinor: exchangePrintData.exchange.differenceMinor,
              exchangeDeliveryChargeMinor: exchangePrintData.exchange.deliveryChargeMinor,
              exchangeDeliveryBaseChargeMinor: exchangePrintData.exchange.deliveryBaseChargeMinor,
              exchangeDeliveryDiscountMinor: exchangePrintData.exchange.deliveryDiscountMinor,
              exchangeSettlementAmountMinor: exchangePrintData.exchange.settlementAmountMinor,
              exchangeReturnItems: exchangePrintData.returnItems.map((item) => ({
                ...item,
                // Older online exchange snapshots do not store the product
                // code, so fall back to the admin catalog when available.
                productCode:
                  item.productCode?.trim() ||
                  (item.productId
                    ? productCodeById.get(String(item.productId))
                    : null) ||
                  null,
              })),
            }
          : {}),
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

      {ordersRefreshError && (
        <View style={styles.ordersRefreshWarning}>
          <Ionicons name="warning-outline" size={18} color="#92400e" />
          <Text style={styles.ordersRefreshWarningText}>
            {hasLoadedOrders
              ? ordersRefreshError
              : "تعذّر تحميل الطلبات مؤقتًا. سنعيد المحاولة تلقائيًا."}
          </Text>
          <Pressable onPress={() => { setRefreshing(true); void fetchOrders(); }} style={styles.ordersRefreshRetry}>
            <Text style={styles.ordersRefreshRetryText}>إعادة المحاولة</Text>
          </Pressable>
        </View>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.orderFilters}
        contentContainerStyle={styles.orderFiltersContent}
      >
        {ORDER_FILTER_OPTIONS.map((option) => {
          const selected = orderStatusFilter === option.key;
          const count = hasLoadedOrders ? (orderStatusCounts[option.key] ?? 0) : "—";

          return (
            <Pressable
              key={option.key}
              onPress={() => {
                setOrderStatusFilter(option.key);
                setExpanded(null);
              }}
              style={[
                styles.orderFilterButton,
                {
                  borderColor: option.color,
                  backgroundColor: selected
                    ? option.color
                    : option.color + "12",
                },
              ]}
            >
              <Ionicons
                name={option.icon}
                size={16}
                color={selected ? "#fff" : option.color}
              />

              <Text
                style={[
                  styles.orderFilterText,
                  {
                    color: selected ? "#fff" : option.color,
                  },
                ]}
              >
                {option.label}
              </Text>

              <View
                style={[
                  styles.orderFilterCount,
                  {
                    backgroundColor: selected
                      ? "rgba(255,255,255,0.22)"
                      : option.color + "18",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.orderFilterCountText,
                    {
                      color: selected ? "#fff" : option.color,
                    },
                  ]}
                >
                  {count}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

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
          onSubmitEditing={() => {
            if (parseOrderSearch(orderSearch) !== null) {
              openOrderFromSearch(orderSearch);
            }
          }}
          placeholder="ابحث برقم الطلب، اسم الزبون، رقم الهاتف أو امسح QR"
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
          onPress={() => {
            if (parseOrderSearch(orderSearch) !== null) {
              openOrderFromSearch(orderSearch);
            }
          }}
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

      {mergeSelectedIds.size > 0 ? (
        <View
          style={[
            styles.mergeSelectionBar,
            {
              backgroundColor: "#EFF6FF",
              borderColor: "#93C5FD",
            },
          ]}
        >
          <View style={styles.mergeSelectionInfo}>
            <Ionicons name="git-merge-outline" size={20} color="#2563EB" />
            <View style={{ flex: 1, alignItems: "flex-end" }}>
              <Text style={styles.mergeSelectionTitle}>
                تم اختيار {mergeSelectedIds.size} طلب/طلبات للدمج
              </Text>
              <Text style={styles.mergeSelectionSub}>
                الدمج لا يخصم المخزون مرة ثانية
              </Text>
            </View>
          </View>

          <View style={styles.mergeSelectionActions}>
            <Pressable
              onPress={() => {
                setMergeSelectedIds(new Set());
                setMergePreviewVisible(false);
              }}
              style={[
                styles.mergeSecondaryButton,
                { borderColor: "#94A3B8" },
              ]}
            >
              <Text style={styles.mergeSecondaryButtonText}>
                إلغاء التحديد
              </Text>
            </Pressable>

            <Pressable
              disabled={mergeSelectedIds.size < 2}
              onPress={openMergePreview}
              style={[
                styles.mergePrimaryButton,
                {
                  backgroundColor:
                    mergeSelectedIds.size < 2
                      ? "#94A3B8"
                      : "#2563EB",
                },
              ]}
            >
              <Ionicons name="git-merge-outline" size={17} color="#fff" />
              <Text style={styles.mergePrimaryButtonText}>
                معاينة الدمج
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <Modal
        transparent
        visible={mergePreviewVisible}
        animationType="fade"
        onRequestClose={() => {
          if (!mergeBusy) setMergePreviewVisible(false);
        }}
      >
        <View style={styles.mergeModalOverlay}>
          <View
            style={[
              styles.mergeModalCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.mergeModalHeader}>
              <Pressable
                disabled={mergeBusy}
                onPress={() => setMergePreviewVisible(false)}
                hitSlop={8}
              >
                <Ionicons name="close" size={22} color={colors.mutedForeground} />
              </Pressable>
              <View style={{ flex: 1, alignItems: "flex-end" }}>
                <Text style={[styles.mergeModalTitle, { color: colors.foreground }]}>
                  معاينة دمج الطلبات
                </Text>
                <Text style={[styles.mergeModalSub, { color: colors.mutedForeground }]}>
                  سيتم إنشاء طلب رئيسي واحد مع إبقاء الطلبات الأصلية محفوظة كسجل.
                </Text>
              </View>
            </View>

            <ScrollView
              style={styles.mergeModalScroll}
              contentContainerStyle={styles.mergeModalScrollContent}
            >
              {mergePreview.error ? (
                <View style={styles.mergeErrorBox}>
                  <Ionicons name="alert-circle-outline" size={19} color="#B91C1C" />
                  <Text style={styles.mergeErrorText}>{mergePreview.error}</Text>
                </View>
              ) : null}

              <View
                style={[
                  styles.mergeSummaryBox,
                  { backgroundColor: colors.background, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.mergeSummaryTitle, { color: colors.foreground }]}>
                  الطلبات المختارة
                </Text>
                {mergeSelectedOrders.map((order) => (
                  <View
                    key={order.id}
                    style={[styles.mergeOrderRow, { borderBottomColor: colors.border }]}
                  >
                    <Text style={[styles.mergeOrderAmount, { color: colors.primary }]}>
                      {order.totalPrice}₪
                    </Text>
                    <View style={{ flex: 1, alignItems: "flex-end" }}>
                      <Text style={[styles.mergeOrderName, { color: colors.foreground }]}>
                        #{order.id} — {order.customerName}
                      </Text>
                      <Text style={[styles.mergeOrderMeta, { color: colors.mutedForeground }]}>
                        {order.items.length} صنف · {order.shippingZone ?? "بدون منطقة"}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>

              <View style={styles.mergeTotalsBox}>
                <View style={styles.mergeTotalRow}>
                  <Text style={styles.mergeTotalValue}>{mergePreview.productsNet}₪</Text>
                  <Text style={styles.mergeTotalLabel}>قيمة المنتجات بعد الخصومات</Text>
                </View>
                <View style={styles.mergeTotalRow}>
                  <Text style={styles.mergeRemovedShippingValue}>
                    {mergePreview.originalShippingTotal}₪
                  </Text>
                  <Text style={styles.mergeTotalLabel}>رسوم التوصيل قبل الدمج</Text>
                </View>
                <View style={styles.mergeTotalRow}>
                  <Text style={styles.mergeTotalValue}>{mergePreview.shippingCost}₪</Text>
                  <Text style={styles.mergeTotalLabel}>التوصيل بعد الدمج — مرة واحدة</Text>
                </View>
                <View style={[styles.mergeTotalRow, styles.mergeGrandTotalRow]}>
                  <Text style={styles.mergeGrandTotalValue}>{mergePreview.total}₪</Text>
                  <Text style={styles.mergeGrandTotalLabel}>الإجمالي المتوقع بعد الدمج</Text>
                </View>
              </View>

              <View style={styles.mergeSafetyBox}>
                <Text style={styles.mergeSafetyTitle}>ما الذي سيحدث؟</Text>
                <Text style={styles.mergeSafetyText}>• المنتجات والمخزون المحجوز لن يتم خصمهما مرة ثانية.</Text>
                <Text style={styles.mergeSafetyText}>• سيتم إلغاء رسوم التوصيل المنفصلة للطلبات الأصلية والإبقاء على توصيل واحد فقط.</Text>
                <Text style={styles.mergeSafetyText}>• إذا وصل مجموع المنتجات بعد الخصومات إلى حد عرض التوصيل، سيُطبق العرض تلقائيًا من Settings الحالية.</Text>
                <Text style={styles.mergeSafetyText}>• سيتم اعتماد بيانات أحدث طلب من الطلبات المختارة.</Text>
                <Text style={styles.mergeSafetyText}>• الطلبات الأصلية ستبقى محفوظة بحالة «مدمج» للرجوع إليها والتقارير.</Text>
              </View>
            </ScrollView>

            <View style={[styles.mergeModalActions, { borderTopColor: colors.border }]}>
              <Pressable
                disabled={mergeBusy}
                onPress={() => setMergePreviewVisible(false)}
                style={[styles.mergeSecondaryButton, { borderColor: colors.border }]}
              >
                <Text style={[styles.mergeSecondaryButtonText, { color: colors.foreground }]}>
                  رجوع
                </Text>
              </Pressable>
              <Pressable
                disabled={mergeBusy || !!mergePreview.error}
                onPress={() => void performMergeOrders()}
                style={[
                  styles.mergeConfirmButton,
                  { opacity: mergeBusy || mergePreview.error ? 0.55 : 1 },
                ]}
              >
                {mergeBusy ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="git-merge-outline" size={18} color="#fff" />
                )}
                <Text style={styles.mergePrimaryButtonText}>
                  {mergeBusy
                    ? "جاري الدمج..."
                    : "تأكيد دمج " + mergeSelectedOrders.length + " طلبات"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>جاري التحميل...</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={filteredOrders}
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
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                {ordersRefreshError && !hasLoadedOrders
                  ? "تعذّر تحميل الطلبات"
                  : orderStatusFilter !== "all" || orderSearch.trim()
                    ? "لا توجد طلبات مطابقة"
                    : "لا توجد طلبات بعد"}
              </Text>

              <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                {ordersRefreshError && !hasLoadedOrders
                  ? "سنحاول الاتصال مجددًا دون حذف أي طلب."
                  : orderStatusFilter !== "all" || orderSearch.trim()
                    ? "جرّب تغيير الفلتر أو عبارة البحث"
                    : "ستظهر الطلبات هنا فور استلامها"}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const isPickup =
              isStorePickupOrder(item);
            const st =
              statusInfo(
                item.status,
                isPickup,
              );
            const pst = paymentStatusInfo(item.paymentStatus);
            const isOpen = expanded === item.id;
            const statusOptions =
              isPickup
                ? STATUS_OPTIONS
                    .filter(
                      (option) =>
                        option.key !==
                        "delivering",
                    )
                    .map(
                      (option) =>
                        option.key ===
                        "done"
                          ? {
                              ...option,
                              label:
                                "تم الاستلام",
                              icon:
                                "storefront-outline" as const,
                            }
                          : option,
                    )
                : STATUS_OPTIONS;
            const orderTransitions =
              isPickup
                ? PICKUP_ORDER_TRANSITIONS
                : ORDER_TRANSITIONS;
            const hasBankTransfer = item.paymentMethod === "bank_transfer";
            const hasProof = !!item.paymentProof;
            const paymentConfirmed = item.paymentStatus === "confirmed";
            const invoiceDiscount =
              getOrderInvoiceDiscount(item.items);
            const exchangeDisplay =
              getOnlineExchangeDisplay(item);
            const mergeEligible =
              isMergeEligibleOrder(item);
            const mergeSelected =
              mergeSelectedIds.has(item.id);
            const mergeCustomerCandidates =
              mergeEligible
                ? orders.filter((candidate) => {
                    if (!isMergeEligibleOrder(candidate)) {
                      return false;
                    }

                    if (
                      normalizeMergePhone(candidate.customerPhone) !==
                      normalizeMergePhone(item.customerPhone)
                    ) {
                      return false;
                    }

                    if (
                      (candidate.shippingZone?.trim() ?? "") !==
                      (item.shippingZone?.trim() ?? "")
                    ) {
                      return false;
                    }

                    const candidateTime =
                      new Date(candidate.createdAt).getTime();
                    const itemTime =
                      new Date(item.createdAt).getTime();

                    return (
                      Number.isFinite(candidateTime) &&
                      Number.isFinite(itemTime) &&
                      Math.abs(candidateTime - itemTime) <=
                        24 * 60 * 60 * 1000
                    );
                  })
                : [];

            const mergeSuggestionLatestId =
              mergeCustomerCandidates.reduce(
                (max, candidate) =>
                  Math.max(max, candidate.id),
                0,
              );

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
                    {mergeEligible ? (
                      <Pressable
                        onPress={(event) => {
                          event.stopPropagation();
                          toggleMergeSelection(item);
                        }}
                        style={[
                          styles.mergeSelectButton,
                          {
                            borderColor: mergeSelected
                              ? "#2563EB"
                              : colors.border,
                            backgroundColor: mergeSelected
                              ? "#DBEAFE"
                              : colors.background,
                          },
                        ]}
                        hitSlop={4}
                      >
                        <Ionicons
                          name={
                            mergeSelected
                              ? "checkbox"
                              : "square-outline"
                          }
                          size={20}
                          color={
                            mergeSelected
                              ? "#2563EB"
                              : colors.mutedForeground
                          }
                        />
                      </Pressable>
                    ) : null}
                    <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.mutedForeground} />
                  </View>
                  <View style={styles.cardTopRight}>
                    <View style={styles.orderIdRow}>
                      <Text style={[styles.orderId, { color: colors.primary }]}>#{item.id}</Text>

                      {item.exchangeOriginalOrderId && (
                        <View style={[styles.newDot, { backgroundColor: "#7C3AED" }]}>
                          <Text style={styles.newDotText}>
                            طلب تبديل — بدل الطلب #{item.exchangeOriginalOrderId}
                          </Text>
                        </View>
                      )}

                      {(item.mergedOrderCount ?? 0) > 0 ? (
                        <View
                          style={[
                            styles.newDot,
                            { backgroundColor: "#2563EB" },
                          ]}
                        >
                          <Text style={styles.newDotText}>
                            طلب مدمج من {item.mergedOrderCount} طلبات
                          </Text>
                        </View>
                      ) : null}

                      {item.mergedIntoOrderId ? (
                        <View
                          style={[
                            styles.newDot,
                            { backgroundColor: "#64748B" },
                          ]}
                        >
                          <Text style={styles.newDotText}>
                            مدمج في #{item.mergedIntoOrderId}
                          </Text>
                        </View>
                      ) : null}

                      {item.discountCode &&
                      item.discountCodeLabel &&
                      Number.isSafeInteger(item.discountCodePercent) ? (
                        <View
                          style={[
                            styles.newDot,
                            { backgroundColor: "#16A34A" },
                          ]}
                        >
                          <Text style={styles.newDotText}>
                            كود {item.discountCodeLabel} {item.discountCodePercent}%
                          </Text>
                        </View>
                      ) : null}

                      {item.courierCashReversedAt ? (
                        <View style={[styles.newDot, { backgroundColor: "#B45309" }]}>
                          <Text style={styles.newDotText}>إلغاء مع عكس الصندوق والمبيعات والمخزون</Text>
                        </View>
                      ) : null}

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
                    {(hasBankTransfer ||
                      (isPickup &&
                        item.status === "done")) && (
                      <View style={[styles.statusChip, { backgroundColor: pst.color + "20" }]}>
                        <Ionicons name={pst.icon} size={13} color={pst.color} />
                        <Text style={[styles.statusText, { color: pst.color }]}>{pst.label}</Text>
                      </View>
                    )}
                  </View>
                </View>

                {mergeEligible &&
                mergeCustomerCandidates.length >= 2 &&
                item.id === mergeSuggestionLatestId ? (
                  <Pressable
                    onPress={(event) => {
                      event.stopPropagation();
                      selectCustomerMergeCandidates(item);
                    }}
                    style={[
                      styles.mergeSuggestion,
                      {
                        backgroundColor: "#EFF6FF",
                        borderColor: "#93C5FD",
                      },
                    ]}
                  >
                    <Ionicons
                      name="git-merge-outline"
                      size={17}
                      color="#2563EB"
                    />
                    <Text style={styles.mergeSuggestionText}>
                      يوجد {mergeCustomerCandidates.length} طلبات قابلة للدمج لنفس الزبون خلال 24 ساعة — معاينة الدمج
                    </Text>
                  </Pressable>
                ) : null}

                {/* Price row */}
                <View style={[styles.priceRow, { borderTopColor: colors.border }]}>
                  <View style={styles.priceLeft}>
                    <Text style={[styles.payMethodBadge, { color: hasBankTransfer ? "#9B59B6" : "#607D8B" }]}>
                      {hasBankTransfer ? "💳" : "💵"} {paymentMethodLabel(item.paymentMethod)}
                    </Text>
                    {invoiceDiscount > 0 ? (
                      <Text
                        style={[
                          styles.payMethodBadge,
                          { color: "#DC2626" },
                        ]}
                      >
                        {item.discountCodeLabel &&
                        Number.isSafeInteger(item.discountCodePercent)
                          ? `كود ${item.discountCodeLabel} ${item.discountCodePercent}% · خصم ${invoiceDiscount}₪`
                          : `خصم ${invoiceDiscount}₪`}
                      </Text>
                    ) : null}
                  </View>
                  <View
                    style={{
                      alignItems: "flex-start",
                      gap: 2,
                    }}
                  >
                    {exchangeDisplay ? (
                      <Text
                        style={{
                          color: "#7C3AED",
                          fontSize: 11,
                          fontWeight: "800",
                        }}
                      >
                        {exchangeDisplay.settlementLabel}
                      </Text>
                    ) : null}
                    <Text
                      style={[
                        styles.totalAmount,
                        {
                          color:
                            exchangeDisplay
                              ? "#7C3AED"
                              : colors.primary,
                        },
                      ]}
                    >
                      {exchangeDisplay
                        ? formatMinorMoney(
                            Math.abs(
                              exchangeDisplay.settlementAmountMinor,
                            ),
                          )
                        : `${item.totalPrice}₪`}
                    </Text>
                  </View>
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

                    {item.discountCode &&
                    item.discountCodeLabel &&
                    Number.isSafeInteger(item.discountCodePercent) &&
                    Number.isSafeInteger(item.discountCodeAmount) ? (
                      <View
                        style={{
                          backgroundColor: "#F0FDF4",
                          borderWidth: 1,
                          borderColor: "#86EFAC",
                          borderRadius: 12,
                          padding: 12,
                          gap: 5,
                        }}
                      >
                        <Text
                          style={{
                            color: "#166534",
                            fontWeight: "900",
                            textAlign: "right",
                          }}
                        >
                          🎟️ كود الخصم: {item.discountCode}
                        </Text>
                        <Text
                          style={{
                            color: "#166534",
                            fontWeight: "800",
                            textAlign: "right",
                          }}
                        >
                          {item.discountCodeLabel} · {item.discountCodePercent}% · خصم {item.discountCodeAmount}₪
                        </Text>
                        <Text
                          style={{
                            color: "#15803D",
                            fontSize: 11,
                            textAlign: "right",
                          }}
                        >
                          {item.discountCodeStacksWithShippingPromotion
                            ? "الكود مسموح مع عرض التوصيل"
                            : "الكود لا يجتمع مع عرض التوصيل — تم اعتماد سعر التوصيل الأصلي"}
                        </Text>
                      </View>
                    ) : null}

                    {exchangeDisplay ? (
                      <View
                        style={{
                          backgroundColor:
                            "#F5F3FF",
                          borderWidth: 1,
                          borderColor:
                            "#C4B5FD",
                          borderRadius: 12,
                          padding: 12,
                          gap: 7,
                        }}
                      >
                        <Text
                          style={{
                            color:
                              "#6D28D9",
                            fontWeight:
                              "900",
                            textAlign:
                              "right",
                            fontSize: 14,
                          }}
                        >
                          🔄 ملخص التبديل
                        </Text>

                        <View
                          style={{
                            flexDirection:
                              "row-reverse",
                            justifyContent:
                              "space-between",
                            gap: 12,
                          }}
                        >
                          <Text
                            style={{
                              color:
                                colors.foreground,
                              fontWeight:
                                "700",
                            }}
                          >
                            قيمة الأصناف المرتجعة
                          </Text>
                          <Text
                            style={{
                              color:
                                colors.foreground,
                              fontWeight:
                                "900",
                            }}
                          >
                            {formatMinorMoney(
                              exchangeDisplay.returnNetMinor,
                            )}
                          </Text>
                        </View>

                        <View
                          style={{
                            flexDirection:
                              "row-reverse",
                            justifyContent:
                              "space-between",
                            gap: 12,
                          }}
                        >
                          <Text
                            style={{
                              color:
                                colors.foreground,
                              fontWeight:
                                "700",
                            }}
                          >
                            قيمة الأصناف الجديدة
                          </Text>
                          <Text
                            style={{
                              color:
                                colors.foreground,
                              fontWeight:
                                "900",
                            }}
                          >
                            {formatMinorMoney(
                              exchangeDisplay.newNetMinor,
                            )}
                          </Text>
                        </View>

                        <View
                          style={{
                            flexDirection:
                              "row-reverse",
                            justifyContent:
                              "space-between",
                            gap: 12,
                          }}
                        >
                          <Text
                            style={{
                              color:
                                exchangeDisplay.differenceMinor < 0
                                  ? "#059669"
                                  : exchangeDisplay.differenceMinor > 0
                                    ? "#DC2626"
                                    : colors.foreground,
                              fontWeight:
                                "800",
                            }}
                          >
                            {exchangeDisplay.differenceLabel}
                          </Text>
                          <Text
                            style={{
                              color:
                                exchangeDisplay.differenceMinor < 0
                                  ? "#059669"
                                  : exchangeDisplay.differenceMinor > 0
                                    ? "#DC2626"
                                    : colors.foreground,
                              fontWeight:
                                "900",
                            }}
                          >
                            {formatMinorMoney(
                              Math.abs(
                                exchangeDisplay.differenceMinor,
                              ),
                            )}
                          </Text>
                        </View>

                        <View
                          style={{
                            flexDirection:
                              "row-reverse",
                            justifyContent:
                              "space-between",
                            gap: 12,
                          }}
                        >
                          <Text
                            style={{
                              color:
                                colors.foreground,
                              fontWeight:
                                "700",
                            }}
                          >
                            رسوم التوصيل
                          </Text>
                          <Text
                            style={{
                              color:
                                colors.foreground,
                              fontWeight:
                                "900",
                            }}
                          >
                            {formatMinorMoney(
                              exchangeDisplay.deliveryChargeMinor,
                            )}
                          </Text>
                        </View>

                        <View
                          style={{
                            borderTopWidth: 1,
                            borderTopColor:
                              "#C4B5FD",
                            paddingTop: 8,
                            marginTop: 2,
                            flexDirection:
                              "row-reverse",
                            justifyContent:
                              "space-between",
                            gap: 12,
                          }}
                        >
                          <Text
                            style={{
                              color:
                                "#6D28D9",
                              fontWeight:
                                "900",
                            }}
                          >
                            {exchangeDisplay.settlementLabel}
                          </Text>
                          <Text
                            style={{
                              color:
                                "#6D28D9",
                              fontWeight:
                                "900",
                              fontSize: 16,
                            }}
                          >
                            {formatMinorMoney(
                              Math.abs(
                                exchangeDisplay.settlementAmountMinor,
                              ),
                            )}
                          </Text>
                        </View>
                      </View>
                    ) : item.exchangeOriginalOrderId ? (
                      <View
                        style={{
                          backgroundColor:
                            "#FFF7ED",
                          borderWidth: 1,
                          borderColor:
                            "#F59E0B",
                          borderRadius: 12,
                          padding: 10,
                        }}
                      >
                        <Text
                          style={{
                            color:
                              "#B45309",
                            fontWeight:
                              "800",
                            textAlign:
                              "right",
                          }}
                        >
                          بيانات تسوية التبديل غير مكتملة. حدّث الطلبات قبل الاعتماد على المبلغ الظاهر.
                        </Text>
                      </View>
                    ) : null}

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

                    {(item.status === "new" ||
                      item.status === "confirmed" ||
                      (item.status === "delivering" && !!item.exchangePublicId)) &&
                      (!item.exchangePublicId || !item.exchangeFinancialCompletedAt) && (
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
                          {item.exchangePublicId ? "تعديل أصناف ومبالغ التبديل" : "تعديل منتجات الطلب"}
                        </Text>
                      </Pressable>
                    )}


                    {!isPickup &&
                      item.shippingZone !== ADMIN_LOCAL_DELIVERY_LABEL &&
                      item.status !== "cancelled" &&
                      !!item.shippingZone &&
                      item.mergedIntoOrderId == null &&
                      ["new", "confirmed", "delivering", "done"].includes(item.status) &&
                      !(item.status === "done" && item.exchangePublicId) && (
                        <Pressable
                          disabled={pendingOrderIds.has(item.id)}
                          onPress={(event) => {
                            event.stopPropagation();
                            openCompanyCostEditor(item);
                          }}
                          style={[styles.editOrderBtn, {
                            borderColor: "#0D9488",
                            backgroundColor: "#0D948811",
                            opacity: pendingOrderIds.has(item.id) ? 0.5 : 1,
                          }]}
                        >
                          <Ionicons name="cash-outline" size={18} color="#0F766E" />
                          <Text style={[styles.editOrderBtnText, { color: "#0F766E" }]}>
                            تعديل تكلفة شركة التوصيل {item.deliveryCompanyCost == null ? "" : `(${item.deliveryCompanyCost}₪)`}
                          </Text>
                        </Pressable>
                      )}

                    {item.exchangePublicId && (
                      <View
                        style={{
                          borderWidth: 1,
                          borderColor: "#7C3AED33",
                          backgroundColor: "#7C3AED0D",
                          borderRadius: 12,
                          padding: 12,
                          gap: 9,
                          marginTop: 8,
                        }}
                      >
                        <Text
                          style={{
                            color: "#6D28D9",
                            fontWeight: "900",
                            textAlign: "right",
                          }}
                        >
                          🔄 متابعة طلب التبديل
                        </Text>

                        {item.exchangeReplacementOrderOrigin === "system_created" &&
                          item.status === "new" &&
                          !item.exchangeFinancialCompletedAt && (
                            <Pressable
                              disabled={exchangeVoidBusy || pendingOrderIds.has(item.id)}
                              onPress={(event) => {
                                event.stopPropagation();
                                setExchangeVoidTarget(item);
                                setExchangeVoidReason("");
                                setExchangeVoidError("");
                              }}
                              style={[
                                styles.editOrderBtn,
                                { backgroundColor: "#FEE2E2", borderColor: "#DC2626" },
                              ]}
                            >
                              <Ionicons name="close-circle-outline" size={18} color="#B91C1C" />
                              <Text style={[styles.editOrderBtnText, { color: "#B91C1C" }]}>
                                إلغاء التبديل والطلب البديل
                              </Text>
                            </Pressable>
                          )}

                        {item.status === "delivering" && (
                          <Pressable
                            disabled={pendingOrderIds.has(item.id)}
                            onPress={(event) => {
                              event.stopPropagation();
                              void updateStatus(item.id, "done");
                            }}
                            style={[
                              styles.editOrderBtn,
                              {
                                backgroundColor: "#22c55e18",
                                borderColor: "#22c55e",
                                opacity: pendingOrderIds.has(item.id) ? 0.55 : 1,
                              },
                            ]}
                          >
                            <Ionicons
                              name="bag-check-outline"
                              size={18}
                              color="#16A34A"
                            />
                            <Text
                              style={[
                                styles.editOrderBtnText,
                                { color: "#16A34A" },
                              ]}
                            >
                              ✅ تم تسليم الطرد
                            </Text>
                          </Pressable>
                        )}

                        {item.status === "done" &&
                          !item.exchangeReturnReceivedAt && (
                            <Pressable
                              disabled={exchangeReturnBusyId === item.id}
                              onPress={(event) => {
                                event.stopPropagation();
                                void openExchangeReturnReceipt(item);
                              }}
                              style={[
                                styles.editOrderBtn,
                                {
                                  backgroundColor: "#F59E0B18",
                                  borderColor: "#F59E0B",
                                  opacity:
                                    exchangeReturnBusyId === item.id
                                      ? 0.55
                                      : 1,
                                },
                              ]}
                            >
                              {exchangeReturnBusyId === item.id ? (
                                <ActivityIndicator
                                  size="small"
                                  color="#B45309"
                                />
                              ) : (
                                <Ionicons
                                  name="cube-outline"
                                  size={18}
                                  color="#B45309"
                                />
                              )}
                              <Text
                                style={[
                                  styles.editOrderBtnText,
                                  { color: "#B45309" },
                                ]}
                              >
                                📦 تم استلام الطرد المرتجع
                              </Text>
                            </Pressable>
                          )}

                        {item.exchangeReturnReceivedAt && (
                          <View
                            style={{
                              borderRadius: 10,
                              paddingVertical: 10,
                              paddingHorizontal: 12,
                              backgroundColor: "#22c55e18",
                              borderWidth: 1,
                              borderColor: "#22c55e55",
                            }}
                          >
                            <Text
                              style={{
                                color: "#15803D",
                                fontWeight: "900",
                                textAlign: "center",
                              }}
                            >
                              ✅ تم استلام الطرد المرتجع وإرجاعه للمخزون
                            </Text>
                          </View>
                        )}
                      </View>
                    )}

                    {item.shippingZone === ADMIN_LOCAL_DELIVERY_LABEL &&
                      (item.paymentMethod === "cod" || item.paymentMethod === "local_store_cash") &&
                      item.status !== "cancelled" &&
                      (item.status !== "new" || !!item.courierCashReceivedAt) && (
                        <View style={{
                          padding: 12, borderWidth: 1, borderRadius: 12,
                          gap: 8, borderColor: item.courierCashReceivedAt ? "#16A34A" : "#60A5FA",
                          backgroundColor: item.courierCashReceivedAt ? "#F0FDF4" : "#EFF6FF",
                        }}>
                          <Text style={{ textAlign: "right", fontWeight: "900", color: item.courierCashReceivedAt ? "#15803D" : "#1D4ED8" }}>
                            {item.courierCashReceivedAt
                              ? "✅ تم قبض قيمة البضاعة من المندوب في الصندوق"
                              : "🚴 قبض قيمة البضاعة نقداً من مندوب ديلفري نابلس"}
                          </Text>
                          <Text style={{ textAlign: "right", fontWeight: "800", color: "#1E40AF" }}>
                            قيمة البضاعة: {item.totalPrice - (item.shippingCost ?? 0)}₪ — أجرة الديلفري: {item.shippingCost ?? 0}₪ (للمندوب)
                          </Text>
                          {!item.courierCashReceivedAt && (item.status === "confirmed" || item.status === "delivering") && (
                            <Pressable
                              disabled={pendingOrderIds.has(item.id) || courierCashBusy || item.deliveryCompanyCost == null}
                              onPress={(event) => {
                                event.stopPropagation();
                                setCourierCashError("");
                                setCourierCashTarget(item);
                              }}
                              style={{
                                borderRadius: 10, padding: 11, alignItems: "center",
                                backgroundColor: item.deliveryCompanyCost == null ? "#94A3B8" : "#2563EB",
                              }}
                            >
                              <Text style={{ color: "#fff", fontWeight: "900" }}>
                                تأكيد استلام {item.totalPrice - (item.shippingCost ?? 0)}₪ من المندوب
                              </Text>
                            </Pressable>
                          )}
                          {!item.courierCashReceivedAt && item.deliveryCompanyCost == null && (
                            <Text style={{ color: "#B45309", textAlign: "right" }}>
                              يجب اعتماد أجرة الديلفري وتكلفة المندوب من تعديل الطلب أولاً.
                            </Text>
                          )}
                          {!item.courierCashReceivedAt && item.status === "delivering" && (
                            <Text style={{ color: "#B45309", textAlign: "right" }}>
                              قبل إتمام تسليم الطلب، سجّل القبض الفعلي من المندوب.
                            </Text>
                          )}
                        </View>
                      )}

                    {item.shippingZone === ADMIN_LOCAL_DELIVERY_LABEL &&
                      !!item.courierCashReceivedAt &&
                      (item.paymentMethod === "cod" || item.paymentMethod === "local_store_cash") &&
                      !item.courierCashReversedAt &&
                      ["confirmed", "delivering", "done"].includes(item.status) && (
                        <View style={{
                          borderWidth: 1, borderColor: "#F59E0B", borderRadius: 12,
                          padding: 12, gap: 8, backgroundColor: "#FFF7ED",
                        }}>
                          <Text style={{ textAlign: "right", fontWeight: "800", color: "#92400E" }}>
                            إذا الزبون رفض الطرد، رجعت البضاعة للمحل، وردّيت للمندوب قيمة البضاعة نقداً، يمكنك عكس الطلب كاملاً.
                          </Text>
                          <Pressable
                            disabled={courierReversalBusy || pendingOrderIds.has(item.id)}
                            onPress={(event) => {
                              event.stopPropagation();
                              openLocalCourierReversal(item);
                            }}
                            style={{
                              backgroundColor: "#B91C1C", padding: 12,
                              borderRadius: 10, alignItems: "center",
                            }}
                          >
                            <Text style={{ color: "#fff", fontWeight: "900" }}>
                              إلغاء الديلفري وعكس القبض والمبيعات والمخزون
                            </Text>
                          </Pressable>
                        </View>
                      )}

                    {/* Status Change */}
                    <Text
                      style={[
                        styles.sectionLabel,
                        {
                          color:
                            colors.foreground,
                        },
                      ]}
                    >
                      {isPickup
                        ? "حالة الاستلام:"
                        : "تغيير الحالة:"}
                    </Text>

                    <View
                      style={
                        styles.statusBtns
                      }
                    >
                      {statusOptions.map(
                        (s) => {
                          const canMove =
                            (
                              orderTransitions[
                                item.status
                              ] ?? []
                            ).includes(
                              s.key,
                            );

                          return (
                            <Pressable
                              key={s.key}
                              disabled={
                                pendingOrderIds.has(
                                  item.id,
                                ) ||
                                item.status ===
                                  s.key ||
                                !canMove
                              }
                              onPress={(
                                event,
                              ) => {
                                event.stopPropagation();

                                if (
                                  item.shippingZone === ADMIN_LOCAL_DELIVERY_LABEL &&
                                  (item.paymentMethod === "cod" || item.paymentMethod === "local_store_cash") &&
                                  s.key === "done" &&
                                  !item.courierCashReceivedAt
                                ) {
                                  showError("سجّل أولاً قبض قيمة البضاعة نقداً من المندوب قبل إتمام الطلب");
                                  return;
                                }

                                if (
                                  isPickup &&
                                  s.key ===
                                    "done"
                                ) {
                                  openStorePickupCompletion(
                                    item,
                                  );
                                  return;
                                }

                                void updateStatus(
                                  item.id,
                                  s.key,
                                );
                              }}
                              style={[
                                styles.statusBtn,
                                {
                                  backgroundColor:
                                    item.status ===
                                    s.key
                                      ? s.color
                                      : s.color +
                                        "20",
                                  opacity:
                                    pendingOrderIds.has(
                                      item.id,
                                    ) ||
                                    (
                                      item.status !==
                                        s.key &&
                                      !canMove
                                    )
                                      ? 0.45
                                      : 1,
                                },
                              ]}
                            >
                              <Ionicons
                                name={
                                  s.icon
                                }
                                size={14}
                                color={
                                  item.status ===
                                  s.key
                                    ? "#fff"
                                    : s.color
                                }
                              />
                              <Text
                                style={[
                                  styles.statusBtnText,
                                  {
                                    color:
                                      item.status ===
                                      s.key
                                        ? "#fff"
                                        : s.color,
                                  },
                                ]}
                              >
                                {s.label}
                              </Text>
                            </Pressable>
                          );
                        },
                      )}
                    </View>

                    {/* Delete Order */}
                    {(item.status === "cancelled" || item.status === "done") &&
                     !item.courierCashReceivedAt && (
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

      <Modal
        visible={courierReversalTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!courierReversalBusy) setCourierReversalTarget(null); }}
      >
        <View style={styles.modalOverlay}>
          <View style={[
            styles.editOrderModalCard,
            {
              maxWidth: 520, width: "94%", alignSelf: "center",
              backgroundColor: colors.card, borderColor: colors.border,
              padding: 18, gap: 12,
            },
          ]}>
            <Text style={{ fontWeight: "900", color: "#B91C1C", fontSize: 17, textAlign: "right" }}>
              إلغاء ديلفري نابلس وعكس جميع الحركات — الطلب #{courierReversalTarget?.id}
            </Text>
            <Text style={{ color: colors.foreground, textAlign: "right", lineHeight: 22 }}>
              سيتم رد {(courierReversalTarget?.totalPrice ?? 0) - (courierReversalTarget?.shippingCost ?? 0)}₪
              {" "}للمندوب من الصندوق، وإرجاع نفس الأصناف للمخزون، وعكس مبيعات وأجرة ديلفري الطلب إن كانت مسجلة.
              يجب أن تكون الحركة النقدية وإعادة الطرد تمت فعلياً، وألا يكون على المحل أي أجرة توصيل مستحقة.
            </Text>
            <TextInput
              value={courierReversalReason}
              onChangeText={(v) => setCourierReversalReason(v)}
              placeholder="سبب الإلغاء (إجباري، مثل: رفض الزبون الاستلام)"
              placeholderTextColor={colors.mutedForeground}
              maxLength={500}
              multiline
              style={[styles.editOrderFieldInput, {
                color: colors.foreground, borderColor: colors.border, minHeight: 62,
              }]}
              textAlign="right"
            />
            {([
              {
                key: "goods" as const,
                checked: courierReversalGoodsReturned,
                set: setCourierReversalGoodsReturned,
                label: "رجع الطرد للمحل وتم التأكد من نفس الأصناف والنمر",
              },
              {
                key: "cash" as const,
                checked: courierReversalCashRefunded,
                set: setCourierReversalCashRefunded,
                label: "تم رد قيمة البضاعة للمندوب فعلياً من الصندوق",
              },
              {
                key: "fee" as const,
                checked: courierReversalNoFee,
                set: setCourierReversalNoFee,
                label: "المندوب لم يأخذ أجرة ديلفري ولا توجد أجرة مستحقة له",
              },
            ]).map((confirmation) => (
              <Pressable
                key={confirmation.key}
                onPress={() => confirmation.set(!confirmation.checked)}
                style={{ flexDirection: "row-reverse", alignItems: "center", gap: 8, paddingVertical: 4 }}
              >
                <Ionicons
                  name={confirmation.checked ? "checkbox" : "square-outline"}
                  size={22}
                  color={confirmation.checked ? "#16A34A" : colors.mutedForeground}
                />
                <Text style={{ flex: 1, color: colors.foreground, textAlign: "right", fontWeight: "700" }}>
                  {confirmation.label}
                </Text>
              </Pressable>
            ))}
            {courierReversalError ? (
              <Text style={{ color: "#DC2626", textAlign: "right" }}>{courierReversalError}</Text>
            ) : null}
            <Pressable
              disabled={
                courierReversalBusy ||
                courierReversalReason.trim().length < 3 ||
                !courierReversalGoodsReturned ||
                !courierReversalCashRefunded ||
                !courierReversalNoFee
              }
              onPress={() => { void confirmLocalCourierReversal(); }}
              style={{
                padding: 14, borderRadius: 10, alignItems: "center",
                backgroundColor: "#B91C1C",
                opacity: courierReversalBusy ||
                  courierReversalReason.trim().length < 3 ||
                  !courierReversalGoodsReturned ||
                  !courierReversalCashRefunded ||
                  !courierReversalNoFee ? 0.45 : 1,
              }}
            >
              {courierReversalBusy
                ? <ActivityIndicator color="#fff" />
                : <Text style={{ color: "#fff", fontWeight: "900" }}>تأكيد الإلغاء وعكس الحركات المالية والمخزون</Text>}
            </Pressable>
            <Pressable
              disabled={courierReversalBusy}
              onPress={() => setCourierReversalTarget(null)}
              style={{ borderWidth: 1, borderColor: colors.border, padding: 12, borderRadius: 10, alignItems: "center" }}
            >
              <Text style={{ color: colors.foreground, fontWeight: "800" }}>رجوع بدون إلغاء</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={courierCashTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!courierCashBusy) setCourierCashTarget(null); }}
      >
        <View style={styles.modalOverlay}>
          <View style={[
            styles.editOrderModalCard,
            { maxWidth: 480, width: "92%", alignSelf: "center", backgroundColor: colors.card, borderColor: colors.border, padding: 20, gap: 14 },
          ]}>
            <Text style={{ color: colors.foreground, fontWeight: "900", fontSize: 18, textAlign: "right" }}>
              تأكيد قبض نقدي من مندوب ديلفري نابلس
            </Text>
            <Text style={{ color: colors.foreground, textAlign: "right", lineHeight: 24 }}>
              الطلب #{courierCashTarget?.id} — هل استلمت فعلياً
              {" "}{(courierCashTarget?.totalPrice ?? 0) - (courierCashTarget?.shippingCost ?? 0)}₪
              {" "}قيمة البضاعة نقداً من المندوب؟
              لا تدخل أجرة الديلفري للصندوق، ويُسجّل القبض مرة واحدة.
            </Text>
            {courierCashError ? (
              <Text style={{ color: "#DC2626", textAlign: "right" }}>{courierCashError}</Text>
            ) : null}
            <Pressable
              disabled={courierCashBusy}
              onPress={() => { void confirmCourierCashHandover(); }}
              style={{ padding: 14, borderRadius: 10, backgroundColor: "#16A34A", alignItems: "center" }}
            >
              {courierCashBusy ? <ActivityIndicator color="#fff" /> : (
                <Text style={{ color: "#fff", fontWeight: "900" }}>نعم، تم قبض قيمة البضاعة نقداً</Text>
              )}
            </Pressable>
            <Pressable
              disabled={courierCashBusy}
              onPress={() => setCourierCashTarget(null)}
              style={{ padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}
            >
              <Text style={{ color: colors.foreground, fontWeight: "800" }}>إلغاء</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={
          pickupSettlementOrder !==
          null
        }
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (
            !pickupSettlementOrder ||
            pendingOrderIds.has(
              pickupSettlementOrder.id,
            )
          ) {
            return;
          }

          setPickupSettlementOrder(
            null,
          );
          setPickupCardProcessor(
            null,
          );
        }}
      >
        <Pressable
          style={
            styles.modalOverlay
          }
          onPress={() => {
            if (
              pickupSettlementOrder &&
              !pendingOrderIds.has(
                pickupSettlementOrder.id,
              )
            ) {
              setPickupSettlementOrder(
                null,
              );
              setPickupCardProcessor(
                null,
              );
            }
          }}
        >
          <Pressable
            onPress={(
              event,
            ) =>
              event.stopPropagation()
            }
            style={[
              styles.editOrderModalCard,
              {
                maxWidth: 520,
                width: "92%",
                alignSelf:
                  "center",
                backgroundColor:
                  colors.card,
                borderColor:
                  colors.border,
              },
            ]}
          >
            <View
              style={{
                padding: 18,
                gap: 14,
              }}
            >
              <View
                style={{
                  flexDirection:
                    "row-reverse",
                  alignItems:
                    "center",
                  gap: 10,
                }}
              >
                <Ionicons
                  name="storefront-outline"
                  size={24}
                  color={
                    colors.primary
                  }
                />

                <View
                  style={{
                    flex: 1,
                    alignItems:
                      "flex-end",
                  }}
                >
                  <Text
                    style={{
                      color:
                        colors.foreground,
                      fontWeight:
                        "900",
                      fontSize: 18,
                    }}
                  >
                    تم استلام الطلب من المحل
                  </Text>

                  <Text
                    style={{
                      color:
                        colors.mutedForeground,
                      marginTop: 3,
                    }}
                  >
                    الطلب #{pickupSettlementOrder?.id} — الإجمالي {pickupSettlementOrder?.totalPrice ?? 0}₪
                  </Text>
                </View>
              </View>

              <Text
                style={{
                  color:
                    colors.foreground,
                  fontWeight:
                    "800",
                  textAlign:
                    "right",
                }}
              >
                اختر طريقة الدفع الفعلية عند الاستلام:
              </Text>

              <View
                style={{
                  flexDirection:
                    "row-reverse",
                  gap: 10,
                }}
              >
                <Pressable
                  onPress={() => {
                    setPickupSettlementMethod(
                      "cash",
                    );
                    setPickupCardProcessor(
                      null,
                    );
                  }}
                  style={{
                    flex: 1,
                    borderWidth: 1,
                    borderColor:
                      pickupSettlementMethod ===
                      "cash"
                        ? "#16A34A"
                        : colors.border,
                    backgroundColor:
                      pickupSettlementMethod ===
                      "cash"
                        ? "#16A34A18"
                        : colors.background,
                    borderRadius: 12,
                    padding: 14,
                    alignItems:
                      "center",
                    gap: 6,
                  }}
                >
                  <Ionicons
                    name="cash-outline"
                    size={22}
                    color="#16A34A"
                  />
                  <Text
                    style={{
                      color:
                        "#16A34A",
                      fontWeight:
                        "900",
                    }}
                  >
                    نقدي
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() =>
                    setPickupSettlementMethod(
                      "card",
                    )
                  }
                  style={{
                    flex: 1,
                    borderWidth: 1,
                    borderColor:
                      pickupSettlementMethod ===
                      "card"
                        ? colors.primary
                        : colors.border,
                    backgroundColor:
                      pickupSettlementMethod ===
                      "card"
                        ? colors.primary +
                          "18"
                        : colors.background,
                    borderRadius: 12,
                    padding: 14,
                    alignItems:
                      "center",
                    gap: 6,
                  }}
                >
                  <Ionicons
                    name="card-outline"
                    size={22}
                    color={
                      colors.primary
                    }
                  />
                  <Text
                    style={{
                      color:
                        colors.primary,
                      fontWeight:
                        "900",
                    }}
                  >
                    فيزا
                  </Text>
                </Pressable>
              </View>

              {pickupSettlementMethod ===
                "card" && (
                <View
                  style={{
                    gap: 8,
                  }}
                >
                  <Text
                    style={{
                      color:
                        colors.foreground,
                      fontWeight:
                        "800",
                      textAlign:
                        "right",
                    }}
                  >
                    ماكينة الفيزا:
                  </Text>

                  <View
                    style={{
                      flexDirection:
                        "row-reverse",
                      gap: 10,
                    }}
                  >
                    {[
                      {
                        key:
                          "arab" as const,
                        label:
                          "البنك العربي",
                      },
                      {
                        key:
                          "bop" as const,
                        label:
                          "بنك فلسطين",
                      },
                    ].map(
                      (
                        option,
                      ) => (
                        <Pressable
                          key={
                            option.key
                          }
                          onPress={() =>
                            setPickupCardProcessor(
                              option.key,
                            )
                          }
                          style={{
                            flex: 1,
                            borderWidth: 1,
                            borderColor:
                              pickupCardProcessor ===
                              option.key
                                ? colors.primary
                                : colors.border,
                            backgroundColor:
                              pickupCardProcessor ===
                              option.key
                                ? colors.primary +
                                  "12"
                                : colors.background,
                            borderRadius: 10,
                            paddingVertical: 12,
                            alignItems:
                              "center",
                          }}
                        >
                          <Text
                            style={{
                              color:
                                pickupCardProcessor ===
                                option.key
                                  ? colors.primary
                                  : colors.foreground,
                              fontWeight:
                                "800",
                            }}
                          >
                            {
                              option.label
                            }
                          </Text>
                        </Pressable>
                      ),
                    )}
                  </View>
                </View>
              )}

              <View
                style={{
                  flexDirection:
                    "row-reverse",
                  gap: 10,
                  marginTop: 4,
                }}
              >
                <Pressable
                  disabled={
                    !pickupSettlementOrder ||
                    pendingOrderIds.has(
                      pickupSettlementOrder.id,
                    )
                  }
                  onPress={() =>
                    void confirmStorePickupCompletion()
                  }
                  style={{
                    flex: 1,
                    backgroundColor:
                      "#16A34A",
                    borderRadius: 10,
                    paddingVertical: 13,
                    alignItems:
                      "center",
                    opacity:
                      pickupSettlementOrder &&
                      pendingOrderIds.has(
                        pickupSettlementOrder.id,
                      )
                        ? 0.55
                        : 1,
                  }}
                >
                  {pickupSettlementOrder &&
                  pendingOrderIds.has(
                    pickupSettlementOrder.id,
                  ) ? (
                    <ActivityIndicator
                      size="small"
                      color="#fff"
                    />
                  ) : (
                    <Text
                      style={{
                        color:
                          "#fff",
                        fontWeight:
                          "900",
                      }}
                    >
                      تأكيد الاستلام والدفع
                    </Text>
                  )}
                </Pressable>

                <Pressable
                  disabled={
                    Boolean(
                      pickupSettlementOrder &&
                      pendingOrderIds.has(
                        pickupSettlementOrder.id,
                      ),
                    )
                  }
                  onPress={() => {
                    setPickupSettlementOrder(
                      null,
                    );
                    setPickupCardProcessor(
                      null,
                    );
                  }}
                  style={{
                    paddingHorizontal: 18,
                    paddingVertical: 13,
                    borderWidth: 1,
                    borderColor:
                      colors.border,
                    borderRadius: 10,
                  }}
                >
                  <Text
                    style={{
                      color:
                        colors.foreground,
                      fontWeight:
                        "800",
                    }}
                  >
                    إلغاء
                  </Text>
                </Pressable>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={exchangeVoidTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!exchangeVoidBusy) setExchangeVoidTarget(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.deleteConfirmCard,
              {
                width: 440,
                maxWidth: "92%",
                backgroundColor: colors.card,
                borderColor: colors.border,
                alignItems: "stretch",
                gap: 12,
              },
            ]}
          >
            <Text style={{ color: "#B91C1C", fontWeight: "900", fontSize: 18, textAlign: "right" }}>
              إلغاء تبديل الطلب #{exchangeVoidTarget?.id}
            </Text>
            <Text style={{ color: colors.foreground, textAlign: "right" }}>
              متاح فقط قبل تأكيد وتجهيز الطلب. سيتم إلغاء عملية التبديل والطلب البديل معاً، دون حذف السجل، ويمكن إنشاء تبديل جديد من الطلب الأصلي.
            </Text>
            <TextInput
              value={exchangeVoidReason}
              onChangeText={(value) => {
                setExchangeVoidReason(value);
                setExchangeVoidError("");
              }}
              placeholder="سبب الإلغاء (إجباري)"
              placeholderTextColor={colors.mutedForeground}
              maxLength={500}
              multiline
              style={[styles.editOrderFieldInput, { color: colors.foreground, borderColor: colors.border, minHeight: 65 }]}
              textAlign="right"
            />
            {exchangeVoidError ? (
              <Text style={{ color: "#DC2626", textAlign: "right" }}>{exchangeVoidError}</Text>
            ) : null}
            <Pressable
              disabled={exchangeVoidBusy || exchangeVoidReason.trim().length < 3}
              onPress={() => void confirmVoidOnlineExchange()}
              style={[
                styles.deleteConfirmBtn,
                {
                  backgroundColor: "#DC2626",
                  opacity: exchangeVoidBusy || exchangeVoidReason.trim().length < 3 ? 0.5 : 1,
                },
              ]}
            >
              {exchangeVoidBusy
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.deleteConfirmBtnText}>تأكيد إلغاء التبديل</Text>}
            </Pressable>
            <Pressable
              disabled={exchangeVoidBusy}
              style={[styles.deleteCancelBtn, { borderColor: colors.border }]}
              onPress={() => setExchangeVoidTarget(null)}
            >
              <Text style={[styles.deleteCancelBtnText, { color: colors.foreground }]}>رجوع</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={exchangeReturnConfirm !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (exchangeReturnBusyId === null) {
            setExchangeReturnConfirm(null);
          }
        }}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => {
            if (exchangeReturnBusyId === null) {
              setExchangeReturnConfirm(null);
            }
          }}
        >
          <Pressable
            onPress={() => {}}
            style={[
              styles.deleteConfirmCard,
              {
                width: 440,
                maxWidth: "92%",
                maxHeight: "82%",
                backgroundColor: colors.card,
                borderColor: colors.border,
                alignItems: "stretch",
              },
            ]}
          >
            <View style={{ alignItems: "center", gap: 8 }}>
              <View
                style={[
                  styles.deleteConfirmIcon,
                  { backgroundColor: "#F59E0B18" },
                ]}
              >
                <Ionicons
                  name="cube-outline"
                  size={34}
                  color="#B45309"
                />
              </View>

              <Text
                style={[
                  styles.deleteConfirmTitle,
                  { color: colors.foreground },
                ]}
              >
                تأكيد استلام الطرد المرتجع
              </Text>

              <Text
                style={[
                  styles.deleteConfirmSub,
                  { color: colors.mutedForeground },
                ]}
              >
                سيتم إرجاع الأصناف التالية إلى المخزون بنفس اللون والمقاس
                والكمية، وتحديث تكلفة المخزون حسب البيانات المحاسبية المسجلة.
              </Text>
            </View>

            <ScrollView
              style={{ maxHeight: 300, width: "100%" }}
              contentContainerStyle={{ gap: 8 }}
            >
              {exchangeReturnConfirm?.items.map((returnItem, index) => (
                <View
                  key={
                    returnItem.id ??
                    `${returnItem.productId ?? "item"}-${index}`
                  }
                  style={{
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 10,
                    padding: 10,
                    gap: 4,
                  }}
                >
                  <Text
                    style={{
                      color: colors.foreground,
                      fontWeight: "900",
                      textAlign: "right",
                    }}
                  >
                    {returnItem.productNameAr}
                  </Text>
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      textAlign: "right",
                    }}
                  >
                    اللون: {returnItem.color || "—"} · المقاس:{" "}
                    {returnItem.size || "—"} · الكمية:{" "}
                    {returnItem.quantity}
                  </Text>
                </View>
              ))}
            </ScrollView>

            <Pressable
              disabled={exchangeReturnBusyId !== null}
              onPress={() => {
                void confirmReceiveOnlineExchangeReturn();
              }}
              style={[
                styles.deleteConfirmBtn,
                {
                  backgroundColor: "#F59E0B",
                  opacity: exchangeReturnBusyId !== null ? 0.55 : 1,
                },
              ]}
            >
              {exchangeReturnBusyId !== null ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.deleteConfirmBtnText}>
                  تأكيد الاستلام وإرجاع المخزون
                </Text>
              )}
            </Pressable>

            <Pressable
              disabled={exchangeReturnBusyId !== null}
              style={[
                styles.deleteCancelBtn,
                { borderColor: colors.border },
              ]}
              onPress={() => setExchangeReturnConfirm(null)}
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


      {/* Per-order delivery-company cost. Never changes the customer charge. */}
      <Modal
        visible={companyCostOrder !== null}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!companyCostSaving) setCompanyCostOrder(null); }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.editOrderModalCard, {
            backgroundColor: colors.card, borderColor: colors.border,
            maxWidth: 440, padding: 20, gap: 14,
          }]}>
            <Text style={[styles.editOrderModalTitle, { color: colors.foreground, textAlign: "right" }]}>
              تعديل تكلفة شركة التوصيل — طلب #{companyCostOrder?.id}
            </Text>
            <Text style={{ color: colors.mutedForeground, textAlign: "right" }}>
              التعديل لهذا الطلب فقط، ولا يغيّر أسعار الشركة العامة أو سعر التوصيل على الزبونة.
            </Text>
            <Text style={{ color: colors.foreground, textAlign: "right", fontWeight: "700" }}>
              توصيل الزبونة: {companyCostOrder?.shippingCost ?? 0}₪ (ثابت)
            </Text>
            <Text style={{ color: colors.foreground, textAlign: "right", fontWeight: "700" }}>
              تكلفة شركة التوصيل الفعلية (₪)
            </Text>
            <TextInput
              value={companyCostValue}
              onChangeText={(value) => {
                setCompanyCostValue(value.replace(/[^0-9]/g, ""));
                setCompanyCostError(null);
              }}
              keyboardType="number-pad"
              style={[styles.editOrderFieldInput, {
                color: colors.foreground, borderColor: colors.border,
                backgroundColor: colors.card,
              }]}
              textAlign="right"
            />
            <Text style={{ color: "#0F766E", fontWeight: "800", textAlign: "right" }}>
              فرق التوصيل: {(companyCostOrder?.shippingCost ?? 0) - (Number(companyCostValue) || 0)}₪
            </Text>
            {companyCostOrder?.status === "done" && (
              <Text style={{ color: "#B45309", textAlign: "right" }}>
                للطلب المكتمل، يُنشأ قيد فرق محاسبي إذا لم تتم تسويته مع شركة التوصيل.
              </Text>
            )}
            {companyCostError && (
              <Text style={{ color: "#DC2626", textAlign: "right" }}>{companyCostError}</Text>
            )}
            <View style={{ flexDirection: "row-reverse", gap: 10 }}>
              <Pressable
                disabled={companyCostSaving}
                onPress={() => setCompanyCostOrder(null)}
                style={[styles.editOrderCancelBtn, { borderColor: colors.border, flex: 1 }]}
              >
                <Text style={{ color: colors.foreground, fontWeight: "800" }}>إلغاء</Text>
              </Pressable>
              <Pressable
                disabled={companyCostSaving}
                onPress={() => void saveCompanyCost()}
                style={[styles.editOrderSaveBtn, { backgroundColor: "#0D9488", flex: 1 }]}
              >
                {companyCostSaving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.editOrderSaveBtnText}>حفظ تكلفة الشركة</Text>}
              </Pressable>
            </View>
          </View>
        </View>
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
                  {editingOrder?.exchangePublicId
                    ? "تعديل الأصناف والخصومات والتوصيل مع إعادة احتساب فرق التبديل"
                    : "عدّل بيانات الزبون، التوصيل، المنتجات والأسعار"}
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
                          if (zone.label === ADMIN_LOCAL_DELIVERY_LABEL) {
                            if (editShippingZone !== ADMIN_LOCAL_DELIVERY_LABEL) {
                              setEditLocalDiscount("0");
                              setEditLocalExtra("0");
                            }
                            setEditLocalCustomerConfirmed(false);
                          } else if (editPaymentMethod === "local_store_cash") {
                            setEditPaymentMethod("cod");
                          }

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
                          {zone.label === ADMIN_LOCAL_DELIVERY_LABEL ? "من 15₪" : `${cost}₪`}
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

                {editingOrder?.exchangePublicId && (
                  <View style={{ gap: 9, padding: 12, borderWidth: 1, borderColor: "#7C3AED55", borderRadius: 12 }}>
                    <Text style={[styles.editOrderFieldLabel, { color: colors.foreground }]}>
                      خصم توصيل التبديل
                    </Text>
                    <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: 8 }}>
                      {([
                        { key: "none", label: "بدون خصم" },
                        { key: "half", label: "نصف التوصيل" },
                        { key: "full", label: "توصيل مجاني" },
                        { key: "manual", label: "خصم يدوي" },
                      ] as const).map((option) => (
                        <Pressable
                          key={option.key}
                          onPress={() => setEditExchangeDeliveryMode(option.key)}
                          style={[
                            styles.editOrderShippingZoneBtn,
                            {
                              borderColor: editExchangeDeliveryMode === option.key ? "#7C3AED" : colors.border,
                              backgroundColor: editExchangeDeliveryMode === option.key ? "#7C3AED" : colors.card,
                            },
                          ]}
                        >
                          <Text style={{ color: editExchangeDeliveryMode === option.key ? "#fff" : colors.foreground, fontWeight: "700" }}>
                            {option.label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    {editExchangeDeliveryMode === "manual" && (
                      <>
                        <Text style={[styles.editOrderFieldLabel, { color: colors.foreground }]}>
                          قيمة خصم التوصيل بالشيكل
                        </Text>
                        <TextInput
                          value={editExchangeManualDelivery}
                          onChangeText={(value) => setEditExchangeManualDelivery(value.replace(/[^0-9]/g, ""))}
                          keyboardType="number-pad"
                          style={[styles.editOrderFieldInput, { color: colors.foreground, borderColor: colors.border }]}
                          textAlign="right"
                        />
                      </>
                    )}
                    <Text style={{ color: "#7C3AED", textAlign: "right", fontWeight: "700" }}>
                      رسوم التوصيل بعد الخصم: {editShippingCost} ₪ — يُحدَّث فرق التبديل تلقائياً عند الحفظ
                    </Text>
                  </View>
                )}

                {editShippingZone === ADMIN_LOCAL_DELIVERY_LABEL && (
                  <View style={{ padding: 12, gap: 8, borderWidth: 1, borderColor: "#93C5FD", borderRadius: 12, backgroundColor: "#EFF6FF" }}>
                    <Text style={{ fontWeight: "900", color: "#1D4ED8", textAlign: "right" }}>🚴 ديلفري نابلس — السعر الأساسي 15₪</Text>
                    <Text style={{ color: "#1E40AF", textAlign: "right" }}>
                      التكلفة الفعلية للمندوب للإدارة فقط. عند إدخال تكلفة أعلى من 15₪ تُحسب الزيادة تلقائيًا، ويمكنك تعديلها أو تقديم خصم للزبون.
                    </Text>
                    <Text style={[styles.editOrderFieldLabel, { color: colors.foreground }]}>التكلفة الفعلية للمندوب (₪) — للإدارة فقط</Text>
                    <TextInput
                      value={editLocalCourierCost}
                      onChangeText={(v) => {
                        const value = v.replace(/[^0-9]/g, "");
                        setEditLocalCourierCost(value);
                        setEditLocalExtra(String(Math.max(0, Number(value || 0) - ADMIN_LOCAL_DELIVERY_BASE_ILS)));
                        setEditLocalDiscount("0");
                        setEditLocalCustomerConfirmed(false);
                      }}
                      keyboardType="number-pad"
                      placeholder="كم اتفقت مع المندوب؟"
                      placeholderTextColor={colors.mutedForeground}
                      style={[styles.editOrderFieldInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
                      textAlign="right"
                    />
                    <Text style={[styles.editOrderFieldLabel, { color: colors.foreground }]}>رسوم توصيل إضافية (₪)</Text>
                    <TextInput
                      value={editLocalExtra}
                      onChangeText={(v) => {
                        const value = v.replace(/[^0-9]/g, "");
                        setEditLocalExtra(value);
                        if (Number(value) > 0) setEditLocalDiscount("0");
                        setEditLocalCustomerConfirmed(false);
                      }}
                      keyboardType="number-pad"
                      placeholder="0"
                      placeholderTextColor={colors.mutedForeground}
                      style={[styles.editOrderFieldInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
                      textAlign="right"
                    />
                    <Text style={[styles.editOrderFieldLabel, { color: colors.foreground }]}>خصم ديلفري للزبون من 15₪ (₪)</Text>
                    <TextInput
                      value={editLocalDiscount}
                      onChangeText={(v) => {
                        const value = v.replace(/[^0-9]/g, "");
                        setEditLocalDiscount(value);
                        if (Number(value) > 0) setEditLocalExtra("0");
                        setEditLocalCustomerConfirmed(false);
                      }}
                      keyboardType="number-pad"
                      placeholder="0 — مثال 5 يعني التوصيل 10₪"
                      placeholderTextColor={colors.mutedForeground}
                      style={[styles.editOrderFieldInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
                      textAlign="right"
                    />
                    <Text style={{ fontWeight: "900", color: "#1D4ED8", textAlign: "right" }}>
                      أجرة الزبون: 15₪ {Number(editLocalExtra) > 0 ? `+ ${editLocalExtra}₪ رسوم إضافية` : ""} {Number(editLocalDiscount) > 0 ? `− ${editLocalDiscount}₪ خصم` : ""} = {editLocalCharge}₪
                    </Text>
                    <Pressable onPress={() => setEditLocalCustomerConfirmed((v) => !v)} style={{ flexDirection: "row-reverse", gap: 8, alignItems: "center", paddingVertical: 8 }}>
                      <Ionicons name={editLocalCustomerConfirmed ? "checkbox" : "square-outline"} size={22} color="#1D4ED8"/>
                      <Text style={{ color: "#1E40AF", fontWeight: "800", flex: 1, textAlign: "right" }}>أكد الزبون السعر النهائي للديلفري</Text>
                    </Pressable>
                    <Text style={{ color: "#1D4ED8", textAlign: "right" }}>فرق التوصيل المتوقع: {editLocalCharge - (Number(editLocalCourierCost) || 0)} ₪</Text>
                  </View>
                )}

                <Text style={[styles.editOrderFieldLabel, { color: colors.foreground }]}>
                  {editShippingZone === ADMIN_LOCAL_DELIVERY_LABEL ? "من سيحصّل قيمة الطلب؟ *" : "طريقة الدفع *"}
                </Text>

                <View style={styles.editOrderShippingZones}>
                  {[
                    { key: "cod" as const, label: editShippingZone === ADMIN_LOCAL_DELIVERY_LABEL ? "المندوب يدفع قيمة البضاعة للمحل ويحتفظ بأجرة الديلفري" : "الدفع عند الاستلام" },
                    { key: "bank_transfer" as const, label: "تحويل بنكي للمحل" },
                    ...(editShippingZone === ADMIN_LOCAL_DELIVERY_LABEL
                      ? [{ key: "local_store_cash" as const, label: "قبض قيمة البضاعة من المندوب (نقداً)" }]
                      : []),
                  ].filter((option) => !editingOrder?.exchangePublicId || option.key === "cod").map((option) => {
                    const selected =
                      editPaymentMethod === option.key;

                    return (
                      <Pressable
                        key={option.key}
                        onPress={() => {
                          setEditPaymentMethod(option.key);
                          setEditOrderError(null);
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
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {editingOrderHasDiscountCode &&
                editingOrder ? (
                  <View
                    style={{
                      borderWidth: 1,
                      borderColor: "#86EFAC",
                      backgroundColor: "#F0FDF4",
                      borderRadius: 12,
                      padding: 12,
                      gap: 5,
                    }}
                  >
                    <Text
                      style={{
                        color: "#166534",
                        fontWeight: "900",
                        textAlign: "right",
                      }}
                    >
                      🎟️ خصم كود {editingOrder.discountCodeLabel ?? editingOrder.discountCode}
                    </Text>
                    <Text
                      style={{
                        color: "#166534",
                        textAlign: "right",
                        fontWeight: "800",
                      }}
                    >
                      {editingOrder.discountCodePercent}% — محسوب تلقائياً: {editInvoiceDiscountValue}₪
                    </Text>
                    <Text
                      style={{
                        color: "#15803D",
                        textAlign: "right",
                        fontSize: 11,
                      }}
                    >
                      لا يمكن تغيير الخصم يدوياً؛ عند تعديل المنتجات يعاد احتسابه بنفس نسبة الكود الأصلية مع التقريب لأسفل.
                    </Text>
                  </View>
                ) : (
                  <>
                    <Text style={[styles.editOrderFieldLabel, { color: colors.foreground }]}>
                      الخصم العام (₪)
                    </Text>

                    <TextInput
                      value={editInvoiceDiscount}
                      onChangeText={(value) => {
                        setEditInvoiceDiscount(
                          value.replace(/[^0-9]/g, ""),
                        );
                        setEditOrderError(null);
                      }}
                      keyboardType="number-pad"
                      placeholder="0"
                      placeholderTextColor={colors.mutedForeground}
                      style={[
                        styles.editOrderFieldInput,
                        {
                          color: colors.foreground,
                          borderColor:
                            editInvoiceDiscountValue > editProductsTotal
                              ? "#DC2626"
                              : colors.border,
                          backgroundColor: colors.card,
                        },
                      ]}
                      textAlign="right"
                    />
                  </>
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

                      <View
                        style={{
                          flexDirection:
                            Platform.OS === "web"
                              ? "row-reverse"
                              : "row",
                          alignItems: "center",
                          flexWrap: "wrap",
                          gap: 6,
                          marginTop: 5,
                        }}
                      >
                        <Text
                          style={{
                            color: colors.mutedForeground,
                            fontSize: 12,
                            fontWeight: "700",
                          }}
                        >
                          سعر القطعة
                        </Text>

                        <TextInput
                          value={String(orderItem.price)}
                          onChangeText={(value) => {
                            const arabicDigits =
                              "٠١٢٣٤٥٦٧٨٩";
                            const persianDigits =
                              "۰۱۲۳۴۵۶۷۸۹";

                            const normalized =
                              value
                                .replace(
                                  /[٠-٩]/g,
                                  (digit) =>
                                    String(
                                      arabicDigits.indexOf(
                                        digit,
                                      ),
                                    ),
                                )
                                .replace(
                                  /[۰-۹]/g,
                                  (digit) =>
                                    String(
                                      persianDigits.indexOf(
                                        digit,
                                      ),
                                    ),
                                )
                                .replace(
                                  /[^0-9]/g,
                                  "",
                                );

                            const nextPrice =
                              normalized
                                ? Number(normalized)
                                : 0;

                            if (
                              Number.isSafeInteger(
                                nextPrice,
                              )
                            ) {
                              changeEditItemPrice(
                                index,
                                nextPrice,
                              );
                            }
                          }}
                          keyboardType="number-pad"
                          selectTextOnFocus
                          style={{
                            width: 82,
                            borderWidth: 1,
                            borderColor:
                              colors.primary + "70",
                            borderRadius: 8,
                            paddingHorizontal: 8,
                            paddingVertical: 5,
                            color: colors.foreground,
                            backgroundColor: colors.card,
                            textAlign: "center",
                            fontWeight: "900",
                          }}
                        />

                        <Text
                          style={{
                            color: colors.primary,
                            fontWeight: "900",
                          }}
                        >
                          ₪
                        </Text>

                        <Text
                          style={{
                            color: colors.primary,
                            fontWeight: "800",
                            fontSize: 12,
                          }}
                        >
                          الإجمالي:{" "}
                          {orderItem.price *
                            orderItem.quantity}
                          ₪
                        </Text>
                      </View>
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
                  onFocus={() => {
                    editScannerSearchFocused.current = true;
                    editScannerKeyboard.current =
                      createScannerKeyboardBuffer();
                  }}
                  onBlur={() => {
                    editScannerSearchFocused.current = false;
                    editScannerKeyboard.current =
                      createScannerKeyboardBuffer();
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
                    {editingOrderHasDiscountCode
                      ? `خصم كود ${editingOrder?.discountCodeLabel ?? editingOrder?.discountCode ?? ""}`
                      : "الخصم العام"}
                  </Text>
                  <Text
                    style={{
                      color: editInvoiceDiscountValue > 0
                        ? "#DC2626"
                        : colors.foreground,
                      fontWeight: "700",
                    }}
                  >
                    -{editInvoiceDiscountValue}₪
                  </Text>
                </View>

                <View style={styles.editOrderSummaryRow}>
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontWeight: "600",
                    }}
                  >
                    صافي المنتجات
                  </Text>
                  <Text
                    style={{
                      color: colors.foreground,
                      fontWeight: "700",
                    }}
                  >
                    {Math.max(
                      0,
                      editProductsTotal - editInvoiceDiscountValue,
                    )}₪
                  </Text>
                </View>

                {editShippingZone === ADMIN_LOCAL_DELIVERY_LABEL && (
                  <>
                    <View style={styles.editOrderSummaryRow}>
                      <Text style={{ color: colors.mutedForeground, fontWeight: "600" }}>ديلفري نابلس الأساسي</Text>
                      <Text style={{ color: colors.foreground, fontWeight: "700" }}>{ADMIN_LOCAL_DELIVERY_BASE_ILS}₪</Text>
                    </View>
                    {Number(editLocalExtra) > 0 && (
                      <View style={styles.editOrderSummaryRow}>
                        <Text style={{ color: colors.mutedForeground, fontWeight: "600" }}>رسوم توصيل إضافية</Text>
                        <Text style={{ color: colors.foreground, fontWeight: "700" }}>+{editLocalExtra}₪</Text>
                      </View>
                    )}
                    {Number(editLocalDiscount) > 0 && (
                      <View style={styles.editOrderSummaryRow}>
                        <Text style={{ color: colors.mutedForeground, fontWeight: "600" }}>خصم ديلفري</Text>
                        <Text style={{ color: "#DC2626", fontWeight: "700" }}>-{editLocalDiscount}₪</Text>
                      </View>
                    )}
                  </>
                )}
                <View style={styles.editOrderSummaryRow}>
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontWeight: "600",
                    }}
                  >
                    {editShippingZone === ADMIN_LOCAL_DELIVERY_LABEL ? "التوصيل بعد التعديل" : "التوصيل"}
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
      <Modal
        visible={!!whatsappTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setWhatsappTarget(null)}
      >
        <Pressable
          onPress={() => setWhatsappTarget(null)}
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.45)",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 420,
              backgroundColor: "#fff",
              borderRadius: 18,
              padding: 20,
              gap: 14,
            }}
          >
            <Text
              style={{
                fontSize: 20,
                fontWeight: "800",
                textAlign: "center",
                color: "#111827",
              }}
            >
              اختيار رمز الدولة
            </Text>

            <Text
              style={{
                fontSize: 15,
                textAlign: "center",
                color: "#64748b",
              }}
            >
              رقم الزبون: {whatsappTarget?.phone}
            </Text>

            <View
              style={{
                flexDirection: "row",
                gap: 12,
              }}
            >
              <Pressable
                onPress={() => openWhatsappForCountry("970")}
                style={{
                  flex: 1,
                  backgroundColor: "#25D366",
                  borderRadius: 12,
                  paddingVertical: 14,
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    color: "#fff",
                    fontWeight: "800",
                    fontSize: 17,
                  }}
                >
                  +970
                </Text>
              </Pressable>

              <Pressable
                onPress={() => openWhatsappForCountry("972")}
                style={{
                  flex: 1,
                  backgroundColor: "#25D366",
                  borderRadius: 12,
                  paddingVertical: 14,
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    color: "#fff",
                    fontWeight: "800",
                    fontSize: 17,
                  }}
                >
                  +972
                </Text>
              </Pressable>
            </View>

            <Pressable
              onPress={() => setWhatsappTarget(null)}
              style={{
                borderRadius: 12,
                paddingVertical: 12,
                alignItems: "center",
                backgroundColor: "#f1f5f9",
              }}
            >
              <Text
                style={{
                  color: "#475569",
                  fontWeight: "700",
                }}
              >
                إلغاء
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

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
  ordersRefreshWarning: { flexDirection: "row-reverse", alignItems: "center", gap: 8, backgroundColor: "#fff7ed", borderBottomWidth: 1, borderBottomColor: "#fed7aa", paddingHorizontal: 14, paddingVertical: 10 },
  ordersRefreshWarningText: { flex: 1, color: "#92400e", fontWeight: "600", fontSize: 12, textAlign: "right" },
  ordersRefreshRetry: { paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "#ffedd5" },
  ordersRefreshRetryText: { color: "#9a3412", fontWeight: "700", fontSize: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  loadingText: { fontSize: 14 },
  emptyText: { fontSize: 18, fontWeight: "700" },
  emptySub: { fontSize: 13, textAlign: "center" },
  orderFilters: {
    marginTop: 10,
    height: 52,
    minHeight: 52,
    maxHeight: 52,
    flexGrow: 0,
    flexShrink: 0,
  },
  orderFiltersContent: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    minHeight: 52,
    alignItems: "center",
    gap: 8,
    flexDirection: "row-reverse",
  },
  orderFilterButton: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  orderFilterText: {
    fontSize: 12,
    fontWeight: "800",
  },
  orderFilterCount: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  orderFilterCountText: {
    fontSize: 11,
    fontWeight: "800",
  },
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
  mergeSelectionBar: {
    marginHorizontal: 12,
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 9,
  },
  mergeSelectionInfo: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    gap: 8,
  },
  mergeSelectionTitle: {
    color: "#1E3A8A",
    fontSize: 13,
    fontWeight: "900",
    textAlign: "right",
  },
  mergeSelectionSub: {
    color: "#475569",
    fontSize: 11,
    marginTop: 2,
    textAlign: "right",
  },
  mergeSelectionActions: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    gap: 8,
  },
  mergePrimaryButton: {
    flex: 1,
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  mergeConfirmButton: {
    flex: 1,
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: "#2563EB",
  },
  mergePrimaryButtonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "900",
  },
  mergeSecondaryButton: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    backgroundColor: "#fff",
  },
  mergeSecondaryButtonText: {
    color: "#475569",
    fontSize: 13,
    fontWeight: "800",
  },
  mergeModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.48)",
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
  },
  mergeModalCard: {
    width: Platform.OS === "web" ? 680 : "96%",
    maxWidth: "96%",
    maxHeight: "90%",
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
  },
  mergeModalHeader: {
    flexDirection: Platform.OS === "web" ? "row" : "row-reverse",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  mergeModalTitle: {
    fontSize: 18,
    fontWeight: "900",
    textAlign: "right",
  },
  mergeModalSub: {
    fontSize: 12,
    marginTop: 3,
    lineHeight: 18,
    textAlign: "right",
  },
  mergeModalScroll: {
    maxHeight: 560,
  },
  mergeModalScrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  mergeErrorBox: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#FEE2E2",
  },
  mergeErrorText: {
    flex: 1,
    color: "#B91C1C",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "right",
  },
  mergeSummaryBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 4,
  },
  mergeSummaryTitle: {
    fontSize: 14,
    fontWeight: "900",
    textAlign: "right",
    marginBottom: 3,
  },
  mergeOrderRow: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  mergeOrderAmount: {
    fontSize: 14,
    fontWeight: "900",
  },
  mergeOrderName: {
    fontSize: 13,
    fontWeight: "800",
    textAlign: "right",
  },
  mergeOrderMeta: {
    fontSize: 11,
    marginTop: 2,
    textAlign: "right",
  },
  mergeTotalsBox: {
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 12,
    padding: 11,
    gap: 8,
    backgroundColor: "#F8FAFC",
  },
  mergeTotalRow: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  mergeTotalLabel: {
    color: "#475569",
    fontSize: 12,
    fontWeight: "700",
  },
  mergeTotalValue: {
    color: "#0F172A",
    fontSize: 13,
    fontWeight: "900",
  },
  mergeRemovedShippingValue: {
    color: "#DC2626",
    fontSize: 13,
    fontWeight: "900",
    textDecorationLine: "line-through",
  },
  mergeGrandTotalRow: {
    borderTopWidth: 1,
    borderTopColor: "#CBD5E1",
    paddingTop: 9,
    marginTop: 2,
  },
  mergeGrandTotalLabel: {
    color: "#0F172A",
    fontSize: 14,
    fontWeight: "900",
  },
  mergeGrandTotalValue: {
    color: "#2563EB",
    fontSize: 19,
    fontWeight: "900",
  },
  mergeSafetyBox: {
    borderRadius: 12,
    padding: 11,
    backgroundColor: "#F0FDF4",
    gap: 5,
  },
  mergeSafetyTitle: {
    color: "#166534",
    fontSize: 13,
    fontWeight: "900",
    textAlign: "right",
  },
  mergeSafetyText: {
    color: "#166534",
    fontSize: 12,
    lineHeight: 19,
    textAlign: "right",
  },
  mergeModalActions: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    gap: 8,
    borderTopWidth: 1,
    padding: 12,
  },
  mergeSelectButton: {
    width: 32,
    height: 32,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  mergeSuggestion: {
    marginHorizontal: 12,
    marginBottom: 4,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    gap: 7,
  },
  mergeSuggestionText: {
    flex: 1,
    color: "#1D4ED8",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "right",
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
