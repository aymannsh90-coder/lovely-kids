import { getResponsiveTopPadding } from "@/utils/webLayout";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  FlatList,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppSettings } from "@/context/AppSettingsContext";
import type { ShippingZone } from "@/context/AppSettingsContext";
import { getProductShareUrl } from "@/utils/productShare";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import {
  usePromotions,
  type PromotionPreviewResult,
} from "@/context/PromotionsContext";
import { useColors } from "@/hooks/useColors";
import { useVisibleProducts } from "@/hooks/useVisibleProducts";
import { type Product, getAvailableStock } from "@/data/products";
import { getCartStockStatus } from "@/utils/cartStock";
import { confirmRemoveFromCart, showStockLimit } from "@/utils/cartPrompts";

import { API_BASE } from "@/constants/api";
import GuestOrderNotificationPrompt from "@/components/GuestOrderNotificationPrompt";

import { setMetaAdvancedMatching, trackMetaEvent } from "@/utils/metaPixel";

type Step = "cart" | "checkout" | "payment" | "success";

const STORE_PICKUP_LABEL = "استلام من المحل";
const LOCAL_NABLUS_DELIVERY_LABEL = "ديلفري داخل مدينة نابلس";
const LOCAL_NABLUS_DELIVERY_BASE_ILS = 15;

type AppliedDiscountCode = {
  code: string;
  campaignName: string;
  discountPercent: number;
  stackWithShippingPromotion: boolean;
};

type MetaBrowserAttribution = {
  metaFbp?: string;
  metaFbc?: string;
  metaEventSourceUrl?: string;
};

function readMetaWebCookie(name: string): string | undefined {
  if (Platform.OS !== "web") return undefined;

  const root = globalThis as typeof globalThis & {
    document?: {
      cookie?: string;
    };
  };

  const cookieText = root.document?.cookie;
  if (!cookieText) return undefined;

  const prefix = `${name}=`;
  const entry = cookieText
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  if (!entry) return undefined;

  const value = entry.slice(prefix.length);

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getMetaBrowserAttribution(): MetaBrowserAttribution {
  if (Platform.OS !== "web") return {};

  const root = globalThis as typeof globalThis & {
    location?: {
      href?: string;
    };
  };

  const metaFbp = readMetaWebCookie("_fbp");
  const metaFbc = readMetaWebCookie("_fbc");

  const metaEventSourceUrl =
    typeof root.location?.href === "string"
      ? root.location.href
      : undefined;

  return {
    ...(metaFbp ? { metaFbp } : {}),
    ...(metaFbc ? { metaFbc } : {}),
    ...(metaEventSourceUrl
      ? { metaEventSourceUrl }
      : {}),
  };
}

function createCheckoutRequestId(): string {
  return [
    "checkout",
    Date.now().toString(36),
    Math.random().toString(36).slice(2),
    Math.random().toString(36).slice(2),
  ].join("-");
}

function getStoreDate(): string {
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

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isShippingPromotionWindowActive(
  enabled: boolean,
  startDate: string,
  endDate: string,
): boolean {
  if (!enabled) return false;

  const today = getStoreDate();

  if (startDate) {
    if (!isValidDateOnly(startDate) || today < startDate) return false;
  }

  if (endDate) {
    if (!isValidDateOnly(endDate) || today > endDate) return false;
  }

  return true;
}

function isShippingPromotionActive(
  productsTotal: number,
  enabled: boolean,
  threshold: number,
  startDate: string,
  endDate: string,
): boolean {
  if (
    !isShippingPromotionWindowActive(
      enabled,
      startDate,
      endDate,
    )
  ) {
    return false;
  }

  const safeThreshold =
    Number.isInteger(threshold) && threshold >= 0 ? threshold : 0;

  return productsTotal >= safeThreshold;
}

function getShippingCost(
  zone: ShippingZone,
  productsTotal: number,
  enabled: boolean,
  threshold: number,
  startDate: string,
  endDate: string,
): number {
  if (zone.label === LOCAL_NABLUS_DELIVERY_LABEL) {
    return LOCAL_NABLUS_DELIVERY_BASE_ILS;
  }

  const active = isShippingPromotionActive(
    productsTotal,
    enabled,
    threshold,
    startDate,
    endDate,
  );

  if (!active) return zone.cost;

  return typeof zone.promoCost === "number" &&
    Number.isInteger(zone.promoCost) &&
    zone.promoCost >= 0
    ? zone.promoCost
    : zone.cost;
}

export default function CartScreen() {
  const colors = useColors();
  const { width: viewportWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const isDesktopWeb =
    Platform.OS === "web" && viewportWidth >= 1200;

  const desktopCartWidth = Math.min(
    Math.max(viewportWidth - 48, 0),
    1200,
  );
  const { settings } = useAppSettings();
  const { user, updateProfile, getAuthToken } = useAuth();
  const { items, updateQuantity, removeItem, totalPrice, totalItems, clearCart } = useCart();
  const { products, refreshProducts } = useVisibleProducts();
  const {
    previewCart,
    getPromotionById,
  } = usePromotions();

  const [step, setStep] = useState<Step>("cart");
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedZone, setSelectedZone] = useState<ShippingZone | null>(null);
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [checkoutValidationMessage, setCheckoutValidationMessage] = useState<string | null>(null);
  const isStorePickup = selectedZone?.label === STORE_PICKUP_LABEL;
  const isLocalDelivery = selectedZone?.label === LOCAL_NABLUS_DELIVERY_LABEL;
  const [paymentMethod] = useState<"cod" | "bank_transfer">("cod");
  const [orderId, setOrderId] = useState<number | null>(null);
  const [proofUploading, setProofUploading] = useState(false);
  const [proofUploaded, setProofUploaded] = useState(false);
  const [savedTotal, setSavedTotal] = useState(0);

  const [
    promotionPreview,
    setPromotionPreview,
  ] = useState<PromotionPreviewResult | null>(null);
  const [
    promotionPreviewLoading,
    setPromotionPreviewLoading,
  ] = useState(false);
  const [
    promotionPreviewError,
    setPromotionPreviewError,
  ] = useState<string | null>(null);

  const [discountCodeInput, setDiscountCodeInput] = useState("");
  const [appliedDiscountCode, setAppliedDiscountCode] =
    useState<AppliedDiscountCode | null>(null);
  const [discountCodeLoading, setDiscountCodeLoading] = useState(false);
  const [discountCodeError, setDiscountCodeError] = useState<string | null>(null);
  const [checkoutItemsExpanded, setCheckoutItemsExpanded] = useState(false);
  const [checkoutCouponExpanded, setCheckoutCouponExpanded] = useState(false);
  const [cartStockSnapshot, setCartStockSnapshot] = useState<Product[] | null>(null);
  const [cartStockChecking, setCartStockChecking] = useState(false);
  const checkoutSubmitLock = useRef(false);
  const checkoutRequestIdRef =
    useRef<string | null>(null);

  const topPadding = getResponsiveTopPadding(insets.top);
  const bottomPadding = Platform.OS === "web" ? 84 + 8 : insets.bottom + 49 + 8;

  useEffect(() => {
    if (step !== "cart" || items.length === 0) return;

    void refreshProducts();
  }, [step, items.length, refreshProducts]);

  useEffect(() => {
    setCartStockSnapshot(null);
  }, [items]);

  useEffect(() => {
    if (step === "checkout" && user) {
      if (!name.trim() && user.name) setName(user.name);
      if (!phone.trim() && user.phone) setPhone(user.phone);
      if (!address.trim() && user.deliveryAddress) setAddress(user.deliveryAddress);
    }
  }, [step]);

  useEffect(() => {
    if (settings.discountCodesEnabled === true) return;

    setDiscountCodeInput("");
    setAppliedDiscountCode(null);
    setDiscountCodeError(null);
  }, [settings.discountCodesEnabled]);

  useEffect(() => {
    if (items.length === 0) {
      setPromotionPreview(null);
      setPromotionPreviewError(null);
      setPromotionPreviewLoading(false);
      return;
    }

    let cancelled = false;

    const timer = setTimeout(() => {
      setPromotionPreviewLoading(true);
      setPromotionPreviewError(null);

      void previewCart(items)
        .then((preview) => {
          if (cancelled) return;
          setPromotionPreview(preview);
        })
        .catch((error) => {
          if (cancelled) return;

          setPromotionPreview(null);
          setPromotionPreviewError(
            error instanceof Error
              ? error.message
              : "تعذر احتساب عروض السلة",
          );
        })
        .finally(() => {
          if (!cancelled) {
            setPromotionPreviewLoading(false);
          }
        });
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [items, previewCart]);

  const sameCartLine = (
    left: (typeof items)[number],
    right: (typeof items)[number],
  ) =>
    left.id === right.id &&
    left.size === right.size &&
    left.color === right.color &&
    left.rewardForPromotionId ===
      right.rewardForPromotionId;

  const removeSelectedGiftForPromotion = (
    promotionId: number,
  ) => {
    items
      .filter(
        (item) =>
          item.rewardForPromotionId ===
          promotionId,
      )
      .forEach((gift) =>
        removeItem(
          gift.id,
          gift.size,
          gift.color,
          gift.rewardForPromotionId,
        ),
      );
  };

  const runCartChangeWithGiftGuard =
    async (
      nextItems: typeof items,
      action: () => void,
      useNormalRemovePrompt = false,
    ) => {
      const selectedGiftPromotionIds = [
        ...new Set(
          items
            .map(
              (item) =>
                item.rewardForPromotionId,
            )
            .filter(
              (
                id,
              ): id is number =>
                Number.isSafeInteger(
                  id,
                ) &&
                Number(id) > 0 &&
                getPromotionById(
                  id,
                )?.kind ===
                  "spend_x_get_gift",
            ),
        ),
      ];

      if (
        selectedGiftPromotionIds.length ===
        0
      ) {
        if (
          useNormalRemovePrompt
        ) {
          confirmRemoveFromCart(
            action,
          );
        } else {
          action();
        }
        return;
      }

      try {
        const nextPreview =
          await previewCart(
            nextItems,
          );

        const lostPromotionIds =
          selectedGiftPromotionIds.filter(
            (promotionId) => {
              const entitlement =
                nextPreview.entitlements.find(
                  (entry) =>
                    entry.promotionId ===
                    promotionId,
                );

              return (
                (
                  entitlement
                    ?.earnedRewardQuantity ??
                  0
                ) < 1
              );
            },
          );

        if (
          lostPromotionIds.length ===
          0
        ) {
          if (
            useNormalRemovePrompt
          ) {
            confirmRemoveFromCart(
              action,
            );
          } else {
            action();
          }
          return;
        }

        const lostLabels =
          lostPromotionIds
            .map(
              (promotionId) =>
                getPromotionById(
                  promotionId,
                )?.publicLabel,
            )
            .filter(
              (
                label,
              ): label is string =>
                !!label,
            );

        Alert.alert(
          "تنبيه",
          `حذف أو تقليل هذا الصنف سيُلغي استحقاقك للهدية${lostLabels.length > 0 ? ` في ${lostLabels.join("، ")}` : ""}، وسيتم إزالة الهدية غير المستحقة من السلة. هل تريد المتابعة؟`,
          [
            {
              text: "إلغاء",
              style: "cancel",
            },
            {
              text: "متابعة",
              style:
                "destructive",
              onPress: () => {
                action();
                lostPromotionIds.forEach(
                  (
                    promotionId,
                  ) =>
                    removeSelectedGiftForPromotion(
                      promotionId,
                    ),
                );
              },
            },
          ],
        );
      } catch {
        Alert.alert(
          "تعذر التحقق من العرض",
          "لم نتمكن من التحقق من استحقاق الهدية الآن. حاول مرة أخرى حتى لا تفقد الهدية بالخطأ.",
        );
      }
    };

  const promotionDiscountAmount =
    (promotionPreview?.totalDiscountMinor ?? 0) /
    100;

  const promotionBlocksDiscountCodes =
    (promotionPreview?.promotions ?? []).some(
      (promotion) =>
        !promotion.stackWithDiscountCodes,
    );

  const promotionsAllowShippingPromotion =
    (promotionPreview?.promotions ?? []).every(
      (promotion) =>
        promotion.stackWithShippingPromotion,
    );

  useEffect(() => {
    if (
      !promotionBlocksDiscountCodes ||
      !appliedDiscountCode
    ) {
      return;
    }

    setAppliedDiscountCode(null);
    setDiscountCodeInput("");
    setCheckoutCouponExpanded(false);
    setDiscountCodeError(
      "أحد عروض السلة لا يسمح بالجمع مع كود خصم.",
    );
  }, [
    promotionBlocksDiscountCodes,
    appliedDiscountCode,
  ]);

  const discountCodeBase = Math.max(
    0,
    totalPrice -
      promotionDiscountAmount,
  );

  const appliedDiscountAmount =
    appliedDiscountCode
      ? Math.floor(
          (
            discountCodeBase *
            appliedDiscountCode.discountPercent
          ) /
            100,
        )
      : 0;

  const handleApplyDiscountCode = async () => {
    const rawCode = discountCodeInput.trim();

    if (promotionBlocksDiscountCodes) {
      setAppliedDiscountCode(null);
      setDiscountCodeError(
        "العرض المطبق على السلة لا يسمح باستخدام كود خصم معه.",
      );
      return;
    }

    if (!rawCode) {
      setAppliedDiscountCode(null);
      setDiscountCodeError("أدخل كود الخصم");
      return;
    }

    setDiscountCodeLoading(true);
    setDiscountCodeError(null);

    try {
      const response = await fetch(
        `${API_BASE}/api/discount-codes/validate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            code: rawCode,
          }),
        },
      );

      const data = (await response.json().catch(() => ({}))) as {
        valid?: boolean;
        code?: string;
        campaignName?: string;
        discountPercent?: number;
        stackWithShippingPromotion?: boolean;
        error?: string;
      };

      if (
        !response.ok ||
        data.valid !== true ||
        typeof data.code !== "string" ||
        typeof data.campaignName !== "string" ||
        !Number.isSafeInteger(data.discountPercent)
      ) {
        throw new Error(
          data.error || "كود الخصم غير صالح أو غير فعال",
        );
      }

      setAppliedDiscountCode({
        code: data.code,
        campaignName: data.campaignName,
        discountPercent: Number(data.discountPercent),
        stackWithShippingPromotion:
          data.stackWithShippingPromotion === true,
      });
      setDiscountCodeInput(data.code);
      setDiscountCodeError(null);
      setCheckoutCouponExpanded(false);
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );
    } catch (error) {
      setAppliedDiscountCode(null);
      setDiscountCodeError(
        error instanceof Error
          ? error.message
          : "تعذر التحقق من كود الخصم",
      );
    } finally {
      setDiscountCodeLoading(false);
    }
  };

  const removeDiscountCode = () => {
    setAppliedDiscountCode(null);
    setDiscountCodeInput("");
    setDiscountCodeError(null);
    setCheckoutCouponExpanded(false);
  };

  const bank = settings.bankInfo;
  const hasBankInfo = bank.bankName || bank.accountNumber;
  const whatsapp = settings.whatsappNumber || "97292376808";

  const handleCheckout = async () => {
    const missingFields: string[] = [];

    if (!name.trim()) missingFields.push("الاسم الكامل");
    if (!phone.trim()) missingFields.push("رقم الهاتف");
    if (!selectedZone) {
      missingFields.push("منطقة التوصيل أو الاستلام من المحل");
    }
    if (!isStorePickup && !address.trim()) {
      missingFields.push("العنوان");
    }

    if (missingFields.length > 0) {
      setShowValidationErrors(true);
      setCheckoutValidationMessage(
        `يرجى إكمال البيانات التالية:\n\n• ${missingFields.join("\n• ")}`
      );
      return;
    }

    // TypeScript guard — عمليًا تم التحقق منها بالأعلى
    if (!selectedZone) return;

    if (checkoutSubmitLock.current) return;
    checkoutSubmitLock.current = true;

    setShowValidationErrors(false);
    setCheckoutValidationMessage(null);

    // Improve Meta Event Match Quality using customer-provided checkout data.
    // This does not fire an additional event; it only enriches subsequent events.
    setMetaAdvancedMatching({
      email: user?.email,
      phone: phone.trim(),
      fullName: name.trim(),
      externalId: user?.id,
    });

    setLoading(true);

    const allowShippingPromotion =
      promotionsAllowShippingPromotion &&
      (
        !appliedDiscountCode ||
        appliedDiscountCode.stackWithShippingPromotion
      );

    let currentDiscountAmount =
      appliedDiscountAmount;

    const checkoutProductsTotal = Math.max(
      0,
      totalPrice -
        promotionDiscountAmount -
        currentDiscountAmount,
    );

    let shippingCost = getShippingCost(
      selectedZone,
      checkoutProductsTotal,
      allowShippingPromotion &&
        settings.shippingPromotionEnabled === true,
      settings.shippingPromotionThreshold,
      settings.shippingPromotionStartDate,
      settings.shippingPromotionEndDate,
    );

    let currentTotal =
      checkoutProductsTotal +
      shippingCost;
    const currentItems = [...items];
    let createdOrderId: number | null = null;
    let createdTrackingToken: string | null = null;

    try {
        const checkoutRequestId =
          checkoutRequestIdRef.current ??
          createCheckoutRequestId();

        checkoutRequestIdRef.current =
          checkoutRequestId;

        const token = await getAuthToken();
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "Idempotency-Key":
            checkoutRequestId,
        };
        if (token) headers.Authorization = `Bearer ${token}`;

        const metaAttribution = getMetaBrowserAttribution();

      const res = await fetch(`${API_BASE}/api/orders`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          customerName: name.trim(),
          customerPhone: phone.trim(),
          customerAddress: isStorePickup
            ? STORE_PICKUP_LABEL
            : address.trim(),
          notes: notes.trim() || null,
          items: currentItems.map((i) => ({
            id: i.id,
            name: i.name,
            price: i.price,
            quantity: i.quantity,
            image: i.image,
            size: i.size,
            color: i.color,
            ...(i.rewardForPromotionId
              ? {
                  rewardForPromotionId:
                    i.rewardForPromotionId,
                }
              : {}),
          })),
          totalPrice: currentTotal,
          shippingZone: selectedZone.label,
          shippingCost,
          paymentMethod,
          ...(appliedDiscountCode
            ? { discountCode: appliedDiscountCode.code }
            : {}),
          ...metaAttribution,
        }),
      });
        if (!res.ok) {
          // A concrete HTTP error means the server answered and the
          // creation transaction did not succeed. A new logical attempt
          // may safely use a new key. Network/response-loss errors never
          // reach this branch, so their key is intentionally preserved.
          checkoutRequestIdRef.current =
            null;

          const errorData = await res.json().catch(() => ({}));
          throw new Error(
            (errorData as { error?: string }).error ??
              "تعذّر حفظ الطلب في السيرفر"
          );
        }

        const order = (await res.json()) as {
          id: number;
          shippingCost?: number;
          totalPrice?: number;
          discountCode?: string | null;
          discountCodeLabel?: string | null;
          discountCodePercent?: number | null;
          discountCodeAmount?: number | null;
          trackingToken?: string;
        };

        setOrderId(order.id);
        createdOrderId = order.id;
        createdTrackingToken =
          typeof order.trackingToken === "string"
            ? order.trackingToken
            : null;

        if (
          typeof order.shippingCost === "number" &&
          Number.isInteger(order.shippingCost) &&
          order.shippingCost >= 0
        ) {
          shippingCost = order.shippingCost;
        }

        if (
          typeof order.totalPrice === "number" &&
          Number.isInteger(order.totalPrice) &&
          order.totalPrice >= 0
        ) {
          currentTotal = order.totalPrice;
        }

        if (
          typeof order.discountCodeAmount === "number" &&
          Number.isInteger(order.discountCodeAmount) &&
          order.discountCodeAmount >= 0
        ) {
          currentDiscountAmount = order.discountCodeAmount;
        }

        trackMetaEvent("Purchase", {
          content_ids: currentItems.map((item) => item.id),
          contents: currentItems.map((item) => ({
            id: item.id,
            quantity: item.quantity,
            item_price: item.price,
          })),
          content_type: "product",
          num_items: currentItems.reduce(
            (sum, item) => sum + item.quantity,
            0,
          ),
          value: currentTotal,
          currency: "ILS",
          order_id: String(order.id),
        }, {
          eventId: `order-${order.id}`,
        });

        checkoutRequestIdRef.current =
          null;
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "تحقق من اتصال الإنترنت وحاول مرة أخرى";
        const isStockError =
          /غير متوفر|لم يعد متوفر|المخزون/.test(errorMessage);

        if (isStockError) {
          setCartStockSnapshot(null);
          void refreshProducts();
          setStep("cart");
        }

        Alert.alert(
          isStockError
            ? "تغيّر المخزون"
            : "تعذّر إنشاء الطلب",
          isStockError
            ? `${errorMessage}\n\nراجع المنتج المعلّم في السلة، ويمكنك اختيار لون أو مقاس بديل إن كان متوفرًا.`
            : errorMessage,
        );
        checkoutSubmitLock.current = false;
        setLoading(false);
        return;
      }

    const itemsList = currentItems
      .map((i, idx) => {
        const variant = [i.color ? `لون ${i.color}` : null, i.size ? `مقاس ${i.size}` : null].filter(Boolean).join("، ");
        const productUrl = getProductShareUrl(i.id, settings);
        return (
          `${idx + 1}. ${i.name}` +
          `\nالكمية: ${i.quantity}` +
          `\nالسعر: ${i.price * i.quantity}₪${variant ? ` (${variant})` : ""}` +
          `\nالرابط: ${productUrl}`
        );
      })
      .join("\n\n");

    const payLabel = paymentMethod === "bank_transfer" ? "💳 تحويل بنكي" : "💵 الدفع عند الاستلام";

    const trackingUrl =
      createdOrderId && createdTrackingToken
        ? `https://lovelykids.net/track-order?id=${createdOrderId}&token=${encodeURIComponent(createdTrackingToken)}`
        : null;

    const message = encodeURIComponent(
      `🛍️ *طلب جديد من Lovely Kids*\n\n` +
      `👤 الاسم: ${name}\n` +
      `📞 الهاتف: ${phone}\n` +
      (isStorePickup
        ? `🏪 طريقة الاستلام: استلام من المحل\n`
        : `📍 العنوان: ${address}\n🚚 منطقة التوصيل: ${selectedZone.label}\n`) +
      (notes ? `📝 ملاحظات: ${notes}\n` : "") +
      `💳 طريقة الدفع: ${payLabel}\n` +
      `\n──────────────\n` +
      `${itemsList}\n` +
      `──────────────\n` +
      (appliedDiscountCode
        ? `🎟️ كود الخصم: ${appliedDiscountCode.code} — ${appliedDiscountCode.campaignName} (${appliedDiscountCode.discountPercent}%)\n💸 الخصم: -${currentDiscountAmount}₪\n`
        : "") +
      (isLocalDelivery
        ? `🚴 ديلفري داخل نابلس: ${LOCAL_NABLUS_DELIVERY_BASE_ILS}₪ أساسي — أي زيادة تُؤكد مع الزبون قبل الإرسال\n`
        : `🚚 التوصيل (${selectedZone.label}): ${shippingCost}₪\n`) +
      (isLocalDelivery
        ? `💰 *الإجمالي مع ديلفري ${LOCAL_NABLUS_DELIVERY_BASE_ILS}₪: ${currentTotal}₪ (قبل أي زيادة مؤكدة)*`
        : `💰 *الإجمالي شامل التوصيل: ${currentTotal}₪*`) +
      (trackingUrl
        ? `\n\n🔗 *متابعة حالة الطلب:*\n${trackingUrl}`
        : "")
    );

    setSavedTotal(currentTotal);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    clearCart();
    setLoading(false);

    if (user && !isStorePickup && !user.deliveryAddress && address.trim()) {
      const savedAddr = address.trim();
      setTimeout(() => {
        Alert.alert(
          "حفظ عنوان التوصيل",
          "هل تريد حفظ هذا العنوان لاستخدامه في طلباتك القادمة؟",
          [
            { text: "لا", style: "cancel" },
            { text: "حفظ", onPress: () => updateProfile({ deliveryAddress: savedAddr }).catch(() => {}) },
          ]
        );
      }, 1200);
    }

    if (paymentMethod === "bank_transfer") {
      setStep("payment");
    } else {
      setStep("success");
    }

    setTimeout(() => {
      Linking.openURL(`https://wa.me/${whatsapp}?text=${message}`).catch(() => {});
    }, 800);
  };

  const fetchFreshCartProducts = async (): Promise<Product[]> => {
    const response = await fetch(`${API_BASE}/api/products?cartStockCheck=${Date.now()}`);

    if (!response.ok) {
      throw new Error("تعذر تحديث المخزون");
    }

    const freshProducts = (await response.json()) as Product[];

    if (!Array.isArray(freshProducts)) {
      throw new Error("بيانات المخزون غير صالحة");
    }

    setCartStockSnapshot(freshProducts);
    return freshProducts;
  };

  const handleContinueToCheckout = async () => {
    if (cartStockChecking) return;

    setCartStockChecking(true);

    try {
      let validationProducts = products;

      try {
        validationProducts = await fetchFreshCartProducts();
      } catch {
        // The backend still performs the final authoritative stock check.
        // If the catalog refresh fails briefly, use the latest in-memory data.
      }

      if (validationProducts.length > 0) {
        const hasStockIssue = items.some((item) => {
          const product = validationProducts.find(
            (entry) => entry.id === item.id,
          );

          return !getCartStockStatus(item, product).valid;
        });

        if (hasStockIssue) {
          Alert.alert(
            "راجعي السلة",
            "بعض المنتجات أو الألوان أو المقاسات في سلتك لم تعد متوفرة بنفس الاختيار. عدّلي المنتجات المعلّمة أولًا ثم تابعي الطلب.",
          );
          return;
        }
      }

      if (user) {
        setMetaAdvancedMatching({
          email: user.email,
          phone: user.phone,
          fullName: user.name,
          externalId: user.id,
        });
      }

      trackMetaEvent("InitiateCheckout", {
        content_ids: items.map((item) => item.id),
        contents: items.map((item) => ({
          id: item.id,
          quantity: item.quantity,
          item_price: item.price,
        })),
        content_type: "product",
        num_items: totalItems,
        value: totalPrice,
        currency: "ILS",
      });

      setStep("checkout");
    } finally {
      setCartStockChecking(false);
    }
  };

  const handleUploadProof = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("تنبيه", "يجب السماح بالوصول إلى الصور لرفع وصل التحويل");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
    });

    if (result.canceled || !result.assets[0]?.uri || !orderId) return;

    const asset = result.assets[0];
    const resizeAction =
      (asset.width ?? 0) >= (asset.height ?? 0)
        ? [{ resize: { width: (asset.width ?? 0) > 1200 ? 1200 : asset.width } }]
        : [{ resize: { height: (asset.height ?? 0) > 1200 ? 1200 : asset.height } }];

    const processed = await manipulateAsync(
      asset.uri,
      resizeAction,
      { compress: 0.7, format: SaveFormat.JPEG, base64: true }
    );

    const base64 = processed.base64;
    if (!base64) return;

    setProofUploading(true);
    try {
      const token = await getAuthToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(`${API_BASE}/api/orders/${orderId}/payment-proof`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          paymentProof: `data:image/jpeg;base64,${base64}`,
          customerPhone: phone.trim(),
        }),
      });
      if (res.ok) {
        setProofUploaded(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {
      Alert.alert("خطأ", "فشل رفع الوصل، تأكد من اتصالك بالإنترنت");
    } finally {
      setProofUploading(false);
    }
  };

  // ── Payment / Bank Transfer Screen ──
  if (step === "payment") {
    return (
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={[styles.center, { paddingBottom: bottomPadding, paddingTop: topPadding + 20 }]}
      >
        <View style={[styles.successIcon, { backgroundColor: "#22c55e20" }]}>
          <Ionicons name="checkmark-circle" size={72} color="#22c55e" />
        </View>
        <Text style={[styles.successTitle, { color: colors.foreground }]}>تم استلام طلبك!</Text>
        <Text style={[styles.successSub, { color: colors.mutedForeground }]}>
          أكمل خطوة التحويل البنكي لتأكيد طلبك
        </Text>

        {/* Bank Info Card */}
        <View style={[styles.bankCard, { backgroundColor: colors.card, borderColor: colors.primary + "40" }]}>
          <View style={styles.bankHeader}>
            <Ionicons name="card-outline" size={22} color={colors.primary} />
            <Text style={[styles.bankTitle, { color: colors.foreground }]}>بيانات التحويل البنكي</Text>
          </View>

          {hasBankInfo ? (
            <View style={styles.bankRows}>
              {bank.bankName ? (
                <BankRow icon="business-outline" label="اسم البنك" value={bank.bankName} colors={colors} />
              ) : null}
              {bank.accountHolder ? (
                <BankRow icon="person-outline" label="اسم صاحب الحساب" value={bank.accountHolder} colors={colors} />
              ) : null}
              {bank.accountNumber ? (
                <BankRow icon="document-text-outline" label="رقم الحساب" value={bank.accountNumber} colors={colors} />
              ) : null}
              {bank.iban ? (
                <BankRow icon="globe-outline" label="IBAN" value={bank.iban} colors={colors} />
              ) : null}
            </View>
          ) : (
            <Text style={[styles.noBankText, { color: colors.mutedForeground }]}>
              يرجى التواصل مع المتجر عبر واتساب للحصول على بيانات التحويل
            </Text>
          )}

          <View style={[styles.amountRow, { backgroundColor: colors.primary + "15", borderRadius: 10 }]}>
            <Text style={[styles.amountLabel, { color: colors.foreground }]}>المبلغ المطلوب</Text>
            <Text style={[styles.amountValue, { color: colors.primary }]}>{savedTotal}₪</Text>
          </View>
        </View>

        {!user && orderId ? (
          <View
            style={[
              styles.guestOrderNumberCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.primary + "55",
              },
            ]}
          >
            <Text
              style={[
                styles.guestOrderNumberLabel,
                { color: colors.mutedForeground },
              ]}
            >
              رقم طلبك
            </Text>
            <Text
              selectable
              style={[
                styles.guestOrderNumberValue,
                { color: colors.primary },
              ]}
            >
              #{orderId}
            </Text>
            <Text
              style={[
                styles.guestOrderNumberHint,
                { color: colors.mutedForeground },
              ]}
            >
              احتفظ بهذا الرقم لمتابعة حالة طلبك
            </Text>
          </View>
        ) : null}

        {/* Upload Receipt */}
        <View style={[styles.uploadCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.uploadTitle, { color: colors.foreground }]}>
            {proofUploaded ? "✅ تم رفع وصل التحويل" : "ارفع وصل التحويل"}
          </Text>
          <Text style={[styles.uploadSub, { color: colors.mutedForeground }]}>
            {proofUploaded
              ? "سيقوم المتجر بمراجعة الوصل وتأكيد طلبك قريباً"
              : "بعد التحويل، ارفع صورة الوصل لتأكيد دفعك"}
          </Text>

          {!proofUploaded && (
            <Pressable
              onPress={handleUploadProof}
              disabled={proofUploading}
              style={[styles.uploadBtn, { backgroundColor: proofUploading ? colors.muted : colors.primary }]}
            >
              {proofUploading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
              )}
              <Text style={styles.uploadBtnText}>
                {proofUploading ? "جاري الرفع..." : "رفع صورة الوصل"}
              </Text>
            </Pressable>
          )}
        </View>

        {orderId ? (
          <GuestOrderNotificationPrompt
            phone={phone}
            orderId={orderId}
            getAuthToken={getAuthToken}
          />
        ) : null}

        {proofUploaded && (
          <Pressable
            onPress={() => { setStep("cart"); router.push("/my-orders"); }}
            style={[styles.backHomeBtn, { backgroundColor: colors.primary }]}
          >
            <Ionicons name="bag-outline" size={18} color="#fff" />
            <Text style={styles.backHomeBtnText}>عرض طلباتي</Text>
          </Pressable>
        )}
        <Pressable
          onPress={() => { setStep("success"); router.push("/"); }}
          style={[styles.backHomeBtn, { backgroundColor: proofUploaded ? colors.secondary : colors.secondary }]}
        >
          <Text style={[styles.backHomeBtnText, { color: colors.foreground }]}>
            {proofUploaded ? "العودة للرئيسية" : "سأرفع الوصل لاحقاً"}
          </Text>
        </Pressable>
      </ScrollView>
    );
  }

  // ── Success Screen (COD) ──
  if (step === "success") {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <View style={[styles.successIcon, { backgroundColor: "#22c55e20" }]}>
          <Ionicons name="checkmark-circle" size={72} color="#22c55e" />
        </View>
        <Text style={[styles.successTitle, { color: colors.foreground }]}>تم استلام طلبك!</Text>
        <Text style={[styles.successSub, { color: colors.mutedForeground }]}>
          سيتم التواصل معك قريباً على رقم الهاتف المُدخل
        </Text>
        {!user && orderId ? (
          <View
            style={[
              styles.guestOrderNumberCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.primary + "55",
              },
            ]}
          >
            <Text
              style={[
                styles.guestOrderNumberLabel,
                { color: colors.mutedForeground },
              ]}
            >
              رقم طلبك
            </Text>
            <Text
              selectable
              style={[
                styles.guestOrderNumberValue,
                { color: colors.primary },
              ]}
            >
              #{orderId}
            </Text>
            <Text
              style={[
                styles.guestOrderNumberHint,
                { color: colors.mutedForeground },
              ]}
            >
              احتفظ بهذا الرقم لمتابعة حالة طلبك
            </Text>
          </View>
        ) : null}

        <View style={[styles.successInfo, { backgroundColor: colors.secondary + "40", borderColor: colors.secondary }]}>
          <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
          <Text style={[styles.successInfoText, { color: colors.foreground }]}>
            تم إرسال تفاصيل طلبك عبر WhatsApp للمتجر
          </Text>
        </View>
        {orderId ? (
          <GuestOrderNotificationPrompt
            phone={phone}
            orderId={orderId}
            getAuthToken={getAuthToken}
          />
        ) : null}
        <Pressable
          onPress={() => { setStep("cart"); router.push("/my-orders"); }}
          style={[styles.backHomeBtn, { backgroundColor: colors.primary }]}
        >
          <Ionicons name="bag-outline" size={18} color="#fff" />
          <Text style={styles.backHomeBtnText}>عرض طلباتي</Text>
        </Pressable>
        <Pressable
          onPress={() => { setStep("cart"); router.push("/"); }}
          style={[styles.backHomeBtn, { backgroundColor: colors.secondary, marginTop: -4 }]}
        >
          <Text style={[styles.backHomeBtnText, { color: colors.foreground }]}>العودة للرئيسية</Text>
        </Pressable>
      </View>
    );
  }

  // ── Checkout Form ──
  if (step === "checkout") {
    const configuredShippingZones = settings.shippingZones ?? [];

    // Canonical regions first; pickup comes last and offers local
    // Nablus delivery as an optional sub-choice.
    const regionOrder = ["الضفة الغربية", "القدس", "أراضي الـ48"];
    const regionalZones = configuredShippingZones
      .filter((zone) =>
        zone.label !== STORE_PICKUP_LABEL &&
        zone.label !== LOCAL_NABLUS_DELIVERY_LABEL,
      )
      .sort((a, b) => {
        const ai = regionOrder.indexOf(a.label);
        const bi = regionOrder.indexOf(b.label);
        return (ai < 0 ? 3 : ai) - (bi < 0 ? 3 : bi);
      });
    const shippingZones: ShippingZone[] = [
      ...regionalZones,
      { label: STORE_PICKUP_LABEL, cost: 0 },
    ];
    const allowShippingPromotion =
      promotionsAllowShippingPromotion &&
      (
        !appliedDiscountCode ||
        appliedDiscountCode.stackWithShippingPromotion
      );

    const discountedProductsTotal = Math.max(
      0,
      totalPrice -
      promotionDiscountAmount -
      appliedDiscountAmount,
    );

    const promotionActive = isShippingPromotionActive(
      discountedProductsTotal,
      allowShippingPromotion &&
        settings.shippingPromotionEnabled === true,
      settings.shippingPromotionThreshold,
      settings.shippingPromotionStartDate,
      settings.shippingPromotionEndDate,
    );

    const shippingCost = selectedZone
      ? getShippingCost(
          selectedZone,
          discountedProductsTotal,
          allowShippingPromotion &&
            settings.shippingPromotionEnabled === true,
          settings.shippingPromotionThreshold,
          settings.shippingPromotionStartDate,
          settings.shippingPromotionEndDate,
        )
      : 0;

    const shippingOriginalCost = selectedZone?.cost ?? 0;
    const shippingPromotionDiscount =
      selectedZone && promotionActive && !isLocalDelivery
        ? Math.max(0, shippingOriginalCost - shippingCost)
        : 0;

    const finalTotal =
      discountedProductsTotal +
      shippingCost;
    const canSubmit =
      name.trim().length > 0 &&
      phone.trim().length > 0 &&
      selectedZone !== null &&
      (isStorePickup || address.trim().length > 0);
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View
        style={[
          styles.header,
          {
            paddingTop: isDesktopWeb ? 28 : topPadding + 12,
          },
          isDesktopWeb
            ? {
                width: desktopCartWidth,
                alignSelf: "center",
                paddingHorizontal: 0,
              }
            : null,
        ]}
      >
          <Pressable onPress={() => setStep("cart")}>
            <Ionicons name="arrow-forward" size={24} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>تفاصيل الطلب</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView
          contentContainerStyle={[styles.formContent, { paddingBottom: bottomPadding + 20 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Order Summary */}
          <View
            style={[
              styles.orderSummary,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.orderSummaryHeader}>
              <View style={styles.orderSummaryHeading}>
                <Text
                  style={[
                    styles.orderSummaryTitle,
                    { color: colors.foreground },
                  ]}
                >
                  ملخص الطلب
                </Text>
                <Text
                  style={[
                    styles.orderSummaryCount,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {totalItems} {totalItems === 1 ? "منتج" : "منتجات"} — {discountedProductsTotal}₪
                </Text>
              </View>

              <Pressable
                onPress={() =>
                  setCheckoutItemsExpanded((current) => !current)
                }
                style={[
                  styles.summaryToggle,
                  { backgroundColor: colors.input },
                ]}
              >
                <Ionicons
                  name={
                    checkoutItemsExpanded
                      ? "chevron-up"
                      : "chevron-down"
                  }
                  size={16}
                  color={colors.primary}
                />
                <Text
                  style={[
                    styles.summaryToggleText,
                    { color: colors.primary },
                  ]}
                >
                  {checkoutItemsExpanded
                    ? "إخفاء المنتجات"
                    : "عرض المنتجات"}
                </Text>
              </Pressable>
            </View>

            {checkoutItemsExpanded ? (
              <View
                style={[
                  styles.summaryItemsList,
                  { borderTopColor: colors.border },
                ]}
              >
                {items.map((item) => (
                  <View
                    key={`${item.id}-${item.color ?? ""}-${item.size ?? ""}`}
                    style={styles.summaryItem}
                  >
                    <Text
                      style={[
                        styles.summaryItemPrice,
                        { color: colors.primary },
                      ]}
                    >
                      {item.price * item.quantity}₪
                    </Text>
                    <Text
                      style={[
                        styles.summaryItemName,
                        { color: colors.foreground },
                      ]}
                      numberOfLines={1}
                    >
                      {item.name} x{item.quantity}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View
              style={[
                styles.summaryBreakdown,
                { borderTopColor: colors.border },
              ]}
            >
              <View style={styles.summaryRow}>
                <Text
                  style={[
                    styles.summaryValue,
                    { color: colors.foreground },
                  ]}
                >
                  {totalPrice}₪
                </Text>
                <Text
                  style={[
                    styles.summaryLabel,
                    { color: colors.mutedForeground },
                  ]}
                >
                  قيمة المنتجات
                </Text>
              </View>

              {(promotionPreview?.promotions ?? []).map(
                (promotion) => (
                  <View
                    style={styles.summaryRow}
                    key={`checkout-promotion-${promotion.promotionId}`}
                  >
                    <Text
                      style={[
                        styles.summaryValue,
                        { color: "#16A34A" },
                      ]}
                    >
                      -{promotion.discountMinor / 100}₪
                    </Text>
                    <Text
                      style={[
                        styles.summaryLabel,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      خصم {promotion.publicLabel}
                    </Text>
                  </View>
                ),
              )}

              {appliedDiscountCode ? (
                <View style={styles.summaryRow}>
                  <Text
                    style={[
                      styles.summaryValue,
                      { color: "#16A34A" },
                    ]}
                  >
                    -{appliedDiscountAmount}₪
                  </Text>
                  <Text
                    style={[
                      styles.summaryLabel,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    خصم الكود
                  </Text>
                </View>
              ) : null}

              {selectedZone ? (
                isStorePickup || isLocalDelivery ? (
                  <View style={styles.summaryRow}>
                    <Text
                      style={[
                        styles.summaryValue,
                        { color: colors.foreground },
                      ]}
                    >
                      {isLocalDelivery ? `${LOCAL_NABLUS_DELIVERY_BASE_ILS}₪` : "0₪"}
                    </Text>
                    <Text
                      style={[
                        styles.summaryLabel,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      {isLocalDelivery ? "ديلفري داخل نابلس (الأساسي)" : "الاستلام من المحل"}
                    </Text>
                  </View>
                ) : (
                  <>
                    <View style={styles.summaryRow}>
                      <Text
                        style={[
                          styles.summaryValue,
                          { color: colors.foreground },
                        ]}
                      >
                        {shippingOriginalCost}₪
                      </Text>
                      <Text
                        style={[
                          styles.summaryLabel,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        التوصيل الأصلي ({selectedZone.label})
                      </Text>
                    </View>

                    {shippingPromotionDiscount > 0 ? (
                      <View style={styles.summaryRow}>
                        <Text
                          style={[
                            styles.summaryValue,
                            { color: "#16A34A" },
                          ]}
                        >
                          -{shippingPromotionDiscount}₪
                        </Text>
                        <Text
                          style={[
                            styles.summaryLabel,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          خصم عرض التوصيل
                        </Text>
                      </View>
                    ) : null}

                    <View style={styles.summaryRow}>
                      <View style={styles.shippingValueWrap}>
                        <Text
                          style={[
                            styles.summaryValue,
                            { color: colors.foreground },
                          ]}
                        >
                          {shippingCost}₪
                        </Text>
                        {shippingPromotionDiscount > 0 ? (
                          <View style={styles.shippingPromoBadge}>
                            <Ionicons
                              name="checkmark-circle"
                              size={13}
                              color="#16A34A"
                            />
                            <Text style={styles.shippingPromoBadgeText}>
                              عرض التوصيل
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <Text
                        style={[
                          styles.summaryLabel,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {shippingPromotionDiscount > 0
                          ? "التوصيل بعد العرض"
                          : "التوصيل"}
                      </Text>
                    </View>
                  </>
                )
              ) : (
                <View style={styles.summaryRow}>
                  <Text
                    style={[
                      styles.summaryValue,
                      { color: colors.foreground },
                    ]}
                  >
                    —
                  </Text>
                  <Text
                    style={[
                      styles.summaryLabel,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    التوصيل
                  </Text>
                </View>
              )}
            </View>

            {settings.discountCodesEnabled === true ? (
              appliedDiscountCode ? (
                <View
                  style={[
                    styles.appliedCouponCompact,
                    { backgroundColor: "#22C55E10" },
                  ]}
                >
                  <Ionicons
                    name="checkmark-circle"
                    size={20}
                    color="#16A34A"
                  />
                  <View style={styles.appliedCouponInfo}>
                    <Text style={styles.appliedCouponCode}>
                      {appliedDiscountCode.code} · خصم{" "}
                      {appliedDiscountCode.discountPercent}%
                    </Text>
                    <Text style={styles.appliedCouponSaving}>
                      وفرت {appliedDiscountAmount}₪
                    </Text>
                  </View>
                  <Pressable
                    onPress={removeDiscountCode}
                    hitSlop={8}
                    style={styles.removeCouponButton}
                  >
                    <Text style={styles.removeCouponText}>إزالة</Text>
                  </Pressable>
                </View>
              ) : checkoutCouponExpanded ? (
                <View style={styles.checkoutCouponArea}>
                  <View
                    style={[
                      styles.inputRow,
                      {
                        backgroundColor: colors.input,
                        borderColor: discountCodeError
                          ? "#DC2626"
                          : colors.border,
                      },
                    ]}
                  >
                    <Ionicons
                      name="ticket-outline"
                      size={18}
                      color={colors.mutedForeground}
                    />
                    <TextInput
                      value={discountCodeInput}
                      onChangeText={(value) => {
                        setDiscountCodeInput(value);
                        setDiscountCodeError(null);
                      }}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      placeholder="أدخل كود الخصم"
                      placeholderTextColor={colors.mutedForeground}
                      style={[
                        styles.input,
                        { color: colors.foreground },
                      ]}
                      textAlign="right"
                      onSubmitEditing={() => {
                        void handleApplyDiscountCode();
                      }}
                    />
                    <Pressable
                      disabled={discountCodeLoading}
                      onPress={() => {
                        void handleApplyDiscountCode();
                      }}
                      style={[
                        styles.applyCouponButton,
                        {
                          backgroundColor: colors.primary,
                          opacity: discountCodeLoading ? 0.7 : 1,
                        },
                      ]}
                    >
                      {discountCodeLoading ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.applyCouponText}>تطبيق</Text>
                      )}
                    </Pressable>
                  </View>

                  <Pressable
                    onPress={() => {
                      setCheckoutCouponExpanded(false);
                      setDiscountCodeError(null);
                    }}
                    style={styles.cancelCouponButton}
                  >
                    <Text
                      style={[
                        styles.cancelCouponText,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      إلغاء
                    </Text>
                  </Pressable>

                  {discountCodeError ? (
                    <Text style={styles.discountErrorText}>
                      {discountCodeError}
                    </Text>
                  ) : null}
                </View>
              ) : (
                <Pressable
                  onPress={() => setCheckoutCouponExpanded(true)}
                  style={styles.couponCollapsedRow}
                >
                  <View style={styles.couponCollapsedLabel}>
                    <Ionicons
                      name="ticket-outline"
                      size={18}
                      color={colors.primary}
                    />
                    <Text
                      style={[
                        styles.couponCollapsedText,
                        { color: colors.foreground },
                      ]}
                    >
                      عندك كود خصم؟
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.couponAddText,
                      { color: colors.primary },
                    ]}
                  >
                    إضافة
                  </Text>
                </Pressable>
              )
            ) : null}

            <View
              style={[
                styles.totalRow,
                { borderTopColor: colors.border },
              ]}
            >
              <Text
                style={[
                  styles.totalAmount,
                  { color: colors.primary },
                ]}
              >
                {finalTotal}₪
              </Text>
              <Text
                style={[
                  styles.totalText,
                  { color: colors.foreground },
                ]}
              >
                {isLocalDelivery ? "الإجمالي مع ديلفري 15₪ قبل أي رسوم إضافية" : "الإجمالي شامل التوصيل"}
              </Text>
            </View>
          </View>

          {/* Form Fields */}
          <Text style={[styles.formSection, { color: colors.foreground }]}>
            {isStorePickup ? "بيانات الاستلام" : "بيانات التوصيل"}
          </Text>

          {[
            { label: "الاسم الكامل *", value: name, set: setName, placeholder: "محمد أحمد", icon: "person-outline" },
            { label: "رقم الهاتف *", value: phone, set: setPhone, placeholder: "059XXXXXXX", icon: "call-outline", keyType: "phone-pad" as const },
            ...(isStorePickup
              ? []
              : [{ label: "العنوان *", value: address, set: setAddress, placeholder: "المدينة، الشارع، رقم المنزل", icon: "location-outline" }]),
          ].map((f) => (
            <View key={f.label} style={styles.fieldGroup}>
              <Text
                style={[
                  styles.fieldLabel,
                  {
                    color:
                      showValidationErrors &&
                      !f.value.trim()
                        ? "#DC2626"
                        : colors.foreground,
                  },
                ]}
              >
                {f.label}
              </Text>
              <View
                style={[
                  styles.inputRow,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  showValidationErrors &&
                  !f.value.trim()
                    ? { borderColor: "#DC2626", borderWidth: 1.5 }
                    : null,
                ]}
              >
                <Ionicons name={f.icon as "person-outline"} size={18} color={colors.mutedForeground} />
                <TextInput
                  value={f.value}
                  onChangeText={f.set}
                  placeholder={f.placeholder}
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType={f.keyType}
                  style={[styles.input, { color: colors.foreground }]}
                  textAlign="right"
                />
              </View>
            </View>
          ))}

          {/* Shipping Zone */}
          <Text
            style={[
              styles.formSection,
              { color: showValidationErrors && !selectedZone ? "#DC2626" : colors.foreground },
            ]}
          >
            طريقة الاستلام / منطقة التوصيل *
          </Text>
          <View
            style={[
              styles.zoneOptions,
              showValidationErrors && !selectedZone
                ? {
                    borderWidth: 1.5,
                    borderColor: "#DC2626",
                    borderRadius: 14,
                    padding: 4,
                  }
                : null,
            ]}
          >
            {shippingZones.map((zone) => {
              const isSelected = selectedZone?.label === zone.label ||
                (zone.label === STORE_PICKUP_LABEL && isLocalDelivery);

              const displayedCost = getShippingCost(
                zone,
                discountedProductsTotal,
                allowShippingPromotion &&
                  settings.shippingPromotionEnabled === true,
                settings.shippingPromotionThreshold,
                settings.shippingPromotionStartDate,
                settings.shippingPromotionEndDate,
              );

              return (
                <React.Fragment key={zone.label}>
                <Pressable
                  onPress={() => setSelectedZone(zone)}
                  style={[
                    styles.zoneOption,
                    {
                      backgroundColor: isSelected ? colors.primary + "15" : colors.card,
                      borderColor: isSelected ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <View style={styles.zoneOptionContent}>
                    <Text style={[styles.zoneOptionCost, { color: isSelected ? colors.primary : colors.foreground }]}>
                      {zone.label === STORE_PICKUP_LABEL
                        ? (isLocalDelivery ? "ديلفري 15₪" : "مجانًا")
                        : promotionActive && displayedCost !== zone.cost
                          ? `${displayedCost}₪ بدل ${zone.cost}₪`
                          : `${displayedCost}₪`}
                    </Text>
                    <Text style={[styles.zoneOptionLabel, { color: isSelected ? colors.primary : colors.foreground }]}>
                      {zone.label}
                    </Text>
                  </View>
                  <Ionicons
                    name={zone.label === STORE_PICKUP_LABEL ? "storefront-outline" : "bicycle-outline"}
                    size={20}
                    color={isSelected ? colors.primary : colors.mutedForeground}
                  />
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={18} color={colors.primary} style={styles.zoneCheck} />
                  )}
                </Pressable>
                {zone.label === STORE_PICKUP_LABEL && (isStorePickup || isLocalDelivery) && (
                  <View style={{ marginHorizontal: 10, marginTop: 5, marginBottom: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: isLocalDelivery ? "#60A5FA" : colors.border, backgroundColor: isLocalDelivery ? "#EFF6FF" : colors.card }}>
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: isLocalDelivery }}
                      onPress={() => setSelectedZone(
                        isLocalDelivery
                          ? { label: STORE_PICKUP_LABEL, cost: 0 }
                          : { label: LOCAL_NABLUS_DELIVERY_LABEL, cost: LOCAL_NABLUS_DELIVERY_BASE_ILS },
                      )}
                      style={{ flexDirection: "row-reverse", alignItems: "center", gap: 8, paddingVertical: 5 }}
                    >
                      <Ionicons name={isLocalDelivery ? "checkbox" : "square-outline"} size={23} color="#1D4ED8" />
                      <Text style={{ color: colors.foreground, textAlign: "right", fontWeight: "800", flex: 1 }}>
                        🚴 بدي توصيل عبر ديلفري داخل مدينة نابلس (+15₪)
                      </Text>
                    </Pressable>
                    <Text style={{ color: "#1E40AF", textAlign: "right", fontSize: 12, lineHeight: 20 }}>
                      {isLocalDelivery
                        ? "سيُطلب عنوان التوصيل. السعر الأساسي 15₪، وإذا احتاج العنوان رسومًا إضافية، بنتواصل معك لتأكيدها قبل الإرسال."
                        : "اختياري: بدلاً من الحضور للمحل، يمكنك طلب ديلفري داخل نابلس بسعر أساسي 15₪."}
                    </Text>
                  </View>
                )}
                </React.Fragment>
              );
            })}
          </View>

          {isLocalDelivery ? (
            <View style={{ backgroundColor: "#EFF6FF", borderWidth: 1, borderColor: "#93C5FD", borderRadius: 14, padding: 13, gap: 6 }}>
              <Text style={{ color: "#1D4ED8", fontWeight: "900", textAlign: "right" }}>
                🚴 ديلفري نابلس — الأساسي 15₪
              </Text>
              <Text style={{ color: "#1E40AF", textAlign: "right", lineHeight: 21, fontSize: 13 }}>
                رسوم التوصيل الأساسية 15₪ ومشمولة بالمبلغ المعروض. في حال احتاج العنوان رسومًا إضافية، يتواصل معك المحل لتأكيدها قبل الإرسال.
              </Text>
            </View>
          ) : isStorePickup ? (
            <View
              style={{
                backgroundColor: "#FFF7ED",
                borderWidth: 1,
                borderColor: "#F59E0B",
                borderRadius: 14,
                padding: 13,
                gap: 5,
              }}
            >
              <Text style={{ color: "#B45309", fontWeight: "900", textAlign: "right" }}>
                🏪 استلام من المحل — التوصيل 0₪
              </Text>
              <Text style={{ color: "#92400E", textAlign: "right", lineHeight: 21, fontSize: 13 }}>
                يتم حجز الكمية لمدة يومين فقط (48 ساعة) من وقت إنشاء الطلب.
                بعد انتهاء المدة يعتبر الحجز منتهيًا ويتم إلغاء الطلب من قبل المتجر.
              </Text>
            </View>
          ) : null}

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>ملاحظات (اختياري)</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="أي ملاحظات إضافية..."
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={3}
              style={[styles.notesInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              textAlign="right"
              textAlignVertical="top"
            />
          </View>

          {/* Payment Method */}
          <Text style={[styles.formSection, { color: colors.foreground }]}>
            طريقة الدفع
          </Text>
          <View
            style={[
              styles.codOnlyCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <Ionicons
              name="cash-outline"
              size={22}
              color={colors.primary}
            />
            <View style={styles.codOnlyText}>
              <Text
                style={[
                  styles.payOptionTitle,
                  { color: colors.foreground },
                ]}
              >
                الدفع عند الاستلام
              </Text>
              <Text
                style={[
                  styles.payOptionSub,
                  { color: colors.mutedForeground },
                ]}
              >
                {isStorePickup
                  ? "ادفع نقدًا عند استلام الطلب من المحل"
                  : "ادفع نقدًا عند وصول الطلب"}
              </Text>
            </View>
            <Ionicons
              name="checkmark-circle"
              size={20}
              color="#16A34A"
            />
          </View>

          {/* Confirm Button */}
          <Pressable
            onPress={handleCheckout}
            disabled={loading}
            style={[
              styles.confirmBtn,
              { backgroundColor: colors.primary, opacity: loading ? 0.8 : 1 }
            ]}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Ionicons
                name="checkmark-circle-outline"
                size={22}
                color="#fff"
              />
            )}
            <Text style={styles.confirmBtnText}>
              {loading
                ? isLocalDelivery
                  ? "جاري إرسال طلب الديلفري..."
                  : "جاري تأكيد الطلب..."
                : isLocalDelivery
                  ? `تأكيد الطلب — ${finalTotal}₪ شامل ديلفري 15₪`
                  : `تأكيد الطلب — ${finalTotal} ₪`}
            </Text>
          </Pressable>
          <Text
            style={[
              styles.confirmHelperText,
              { color: colors.mutedForeground },
            ]}
          >
            {isLocalDelivery
              ? "السعر يشمل 15₪ ديلفري داخل نابلس. أي رسوم إضافية لا تُعتمد إلا بعد موافقتك."
              : "سيتم حفظ طلبك مباشرة وإرسال نسخة عبر واتساب"}
          </Text>

          {showValidationErrors && !canSubmit && (
            <Text style={[styles.validationHint, { color: "#DC2626" }]}>
              * الحقول المحددة بالأحمر مطلوبة لإتمام الطلب
            </Text>
          )}

          <Modal
            transparent
            visible={checkoutValidationMessage !== null}
            animationType="fade"
            onRequestClose={() => setCheckoutValidationMessage(null)}
          >
            <View
              style={{
                flex: 1,
                backgroundColor: "rgba(0,0,0,0.42)",
                justifyContent: "center",
                padding: 24,
              }}
            >
              <View
                style={{
                  backgroundColor: colors.card,
                  borderRadius: 20,
                  padding: 20,
                  gap: 12,
                }}
              >
                <Ionicons
                  name="alert-circle-outline"
                  size={40}
                  color="#DC2626"
                  style={{ alignSelf: "center" }}
                />

                <Text
                  style={{
                    color: colors.foreground,
                    fontSize: 18,
                    fontWeight: "900",
                    textAlign: "center",
                  }}
                >
                  أكمل بيانات الطلب
                </Text>

                <Text
                  style={{
                    color: colors.foreground,
                    fontSize: 14,
                    lineHeight: 24,
                    textAlign: "right",
                  }}
                >
                  {checkoutValidationMessage}
                </Text>

                <Pressable
                  onPress={() => setCheckoutValidationMessage(null)}
                  style={{
                    backgroundColor: colors.primary,
                    borderRadius: 12,
                    paddingVertical: 12,
                    alignItems: "center",
                    marginTop: 4,
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "800" }}>
                    حسنًا، سأكمل البيانات
                  </Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        </ScrollView>
      </View>
    );
  }

  const cartProducts =
    cartStockSnapshot && cartStockSnapshot.length > 0
      ? cartStockSnapshot
      : products;
  const hasCartStockData = cartProducts.length > 0;
  const cartHasKnownStockIssues =
    hasCartStockData &&
    items.some((item) => {
      const product = cartProducts.find(
        (entry) => entry.id === item.id,
      );

      return !getCartStockStatus(item, product).valid;
    });

  const cartPromotionCanStack =
    promotionsAllowShippingPromotion &&
    (
      !appliedDiscountCode ||
      appliedDiscountCode.stackWithShippingPromotion
    );
  const cartPromotionProductsTotal = Math.max(
    0,
    totalPrice -
      promotionDiscountAmount -
      appliedDiscountAmount,
  );
  const cartPromotionWindowActive =
    isShippingPromotionWindowActive(
      cartPromotionCanStack &&
        settings.shippingPromotionEnabled === true,
      settings.shippingPromotionStartDate,
      settings.shippingPromotionEndDate,
    );
  const cartPromotionThreshold =
    Number.isInteger(settings.shippingPromotionThreshold) &&
    settings.shippingPromotionThreshold >= 0
      ? settings.shippingPromotionThreshold
      : 0;
  const cartPromotionReached =
    cartPromotionWindowActive &&
    cartPromotionProductsTotal >= cartPromotionThreshold;
  const cartPromotionRemaining = Math.max(
    0,
    cartPromotionThreshold - cartPromotionProductsTotal,
  );
  const cartPromotionProgress =
    cartPromotionThreshold > 0
      ? Math.min(
          1,
          cartPromotionProductsTotal / cartPromotionThreshold,
        )
      : 1;

  // ── Cart ──
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 12 }]}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-forward" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>سلة التسوق</Text>
        {items.length > 0 && (
          <Pressable onPress={clearCart}>
            <Text style={[styles.clearText, { color: colors.primary }]}>مسح الكل</Text>
          </Pressable>
        )}
      </View>

      {items.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="bag-outline" size={64} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>السلة فارغة</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            أضيفي منتجات لإتمام الطلب
          </Text>
          <Pressable
            onPress={() => router.push("/products")}
            style={[styles.shopBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.shopBtnText}>تصفحي المنتجات</Text>
          </Pressable>
        </View>
      ) : (
        <View
          style={[
            styles.cartBody,
            isDesktopWeb
              ? {
                  width: desktopCartWidth,
                  alignSelf: "center",
                  flexDirection: "row-reverse",
                  gap: 24,
                  paddingBottom: 24,
                }
              : null,
          ]}
        >
          <FlatList
            style={isDesktopWeb ? { flex: 1 } : undefined}
            data={items}
            keyExtractor={(item) =>
              `${item.id}-${item.color ?? ""}-${item.size ?? ""}-${item.rewardForPromotionId ?? ""}`
            }
            contentContainerStyle={[
              styles.list,
              isDesktopWeb
                ? {
                    paddingHorizontal: 0,
                    paddingTop: 0,
                    paddingBottom: 20,
                  }
                : null,
            ]}
            renderItem={({ item }) => {
              const product = hasCartStockData
                ? cartProducts.find((entry) => entry.id === item.id)
                : undefined;
              const stockStatus = hasCartStockData
                ? getCartStockStatus(item, product)
                : {
                    valid: true,
                    kind: null,
                    message: null,
                    detail: null,
                    hasAlternatives: false,
                    availableQuantity: null,
                  };
              const hasStockIssue = !stockStatus.valid;
              const isSpendGiftReward =
                !!item.rewardForPromotionId &&
                getPromotionById(
                  item.rewardForPromotionId,
                )?.kind ===
                  "spend_x_get_gift";

              return (
                <View
                  style={[
                    styles.cartItem,
                    {
                      backgroundColor: colors.card,
                      borderColor: hasStockIssue ? "#EF4444" : colors.border,
                      borderWidth: hasStockIssue ? 1.5 : 1,
                    },
                    isDesktopWeb ? styles.desktopCartItem : null,
                  ]}
                >
                  <View style={styles.itemRight}>
                    <Text style={[styles.itemName, { color: colors.foreground }]}>{item.name}</Text>
                    {(item.size || item.color) && (
                      <Text style={[styles.itemSize, { color: colors.mutedForeground }]}>
                        {[item.color ? `اللون: ${item.color}` : null, item.size ? `المقاس: ${item.size}` : null]
                          .filter(Boolean)
                          .join(" — ")}
                      </Text>
                    )}
                    <Text style={[styles.itemPrice, { color: colors.primary }]}>
                      {item.price * item.quantity} ₪
                    </Text>

                    {isSpendGiftReward ? (
                      <Text
                        style={{
                          color: "#16A34A",
                          fontSize: 12,
                          fontWeight: "900",
                          textAlign: "right",
                          marginTop: 3,
                        }}
                      >
                        🎁 هدية من العرض
                      </Text>
                    ) : null}

                    {hasStockIssue ? (
                      <View
                        style={{
                          backgroundColor: "#FEF2F2",
                          borderColor: "#FCA5A5",
                          borderWidth: 1,
                          borderRadius: 10,
                          paddingHorizontal: 10,
                          paddingVertical: 8,
                          marginTop: 6,
                          gap: 4,
                        }}
                      >
                        <Text
                          style={{
                            color: "#B91C1C",
                            fontSize: 12,
                            fontWeight: "900",
                            textAlign: "right",
                          }}
                        >
                          {stockStatus.message}
                        </Text>
                        {stockStatus.detail ? (
                          <Text
                            style={{
                              color: "#7F1D1D",
                              fontSize: 11,
                              lineHeight: 18,
                              textAlign: "right",
                            }}
                          >
                            {stockStatus.detail}
                          </Text>
                        ) : null}

                        <View
                          style={{
                            flexDirection: "row-reverse",
                            flexWrap: "wrap",
                            gap: 8,
                            marginTop: 4,
                          }}
                        >
                          {stockStatus.kind === "quantity_exceeds_stock" &&
                          stockStatus.availableQuantity !== null &&
                          stockStatus.availableQuantity > 0 ? (
                            <Pressable
                              onPress={() =>
                                updateQuantity(
                                  item.id,
                                  stockStatus.availableQuantity!,
                                  item.size,
                                  item.color,
                                )
                              }
                              style={{
                                backgroundColor: "#fff",
                                borderColor: "#FCA5A5",
                                borderWidth: 1,
                                borderRadius: 8,
                                paddingHorizontal: 10,
                                paddingVertical: 7,
                              }}
                            >
                              <Text
                                style={{
                                  color: "#B91C1C",
                                  fontWeight: "800",
                                  fontSize: 11,
                                }}
                              >
                                تحديث للكمية المتوفرة
                              </Text>
                            </Pressable>
                          ) : null}

                          {stockStatus.hasAlternatives && product ? (
                            <Pressable
                              onPress={() =>
                                router.push({
                                  pathname: "/product/[id]",
                                  params: {
                                    id: item.id,
                                    cartEdit: "1",
                                    cartSize: item.size ?? "",
                                    cartColor: item.color ?? "",
                                    ...(item.rewardForPromotionId
                                      ? {
                                          cartRewardForPromotionId:
                                            String(
                                              item.rewardForPromotionId,
                                            ),
                                        }
                                      : {}),
                                  },
                                })
                              }
                              style={{
                                backgroundColor: colors.primary,
                                borderRadius: 8,
                                paddingHorizontal: 10,
                                paddingVertical: 7,
                              }}
                            >
                              <Text
                                style={{
                                  color: "#fff",
                                  fontWeight: "900",
                                  fontSize: 11,
                                }}
                              >
                                تعديل الاختيار
                              </Text>
                            </Pressable>
                          ) : null}
                        </View>
                      </View>
                    ) : null}

                    <Pressable
                      onPress={() => {
                        const nextItems =
                          items.filter(
                            (entry) =>
                              !sameCartLine(
                                entry,
                                item,
                              ),
                          );

                        void runCartChangeWithGiftGuard(
                          nextItems,
                          () =>
                            removeItem(
                              item.id,
                              item.size,
                              item.color,
                              item.rewardForPromotionId,
                            ),
                          true,
                        );
                      }}
                      style={styles.deleteBtn}
                    >
                      <Ionicons name="trash-outline" size={15} color="#dc2626" />
                      <Text style={styles.deleteText}>حذف</Text>
                    </Pressable>
                  </View>
                  <Image
                    source={{ uri: item.image }}
                    style={[
                      styles.itemImage,
                      isDesktopWeb ? styles.desktopItemImage : null,
                    ]}
                  />
                  {isSpendGiftReward ? (
                    <View
                      style={[
                        styles.quantityRow,
                        isDesktopWeb
                          ? styles.desktopQuantityRow
                          : null,
                      ]}
                    >
                      <View
                        style={[
                          styles.qtyBtn,
                          {
                            backgroundColor:
                              colors.muted,
                          },
                        ]}
                      >
                        <Ionicons
                          name="gift-outline"
                          size={16}
                          color={
                            colors.mutedForeground
                          }
                        />
                      </View>
                      <Text
                        style={[
                          styles.qty,
                          {
                            color:
                              colors.foreground,
                          },
                        ]}
                      >
                        1
                      </Text>
                    </View>
                  ) : (
                                      <View
                                        style={[
                                          styles.quantityRow,
                                          isDesktopWeb ? styles.desktopQuantityRow : null,
                                        ]}
                                      >
                                        <Pressable
                                          disabled={hasStockIssue}
                                          onPress={() => {
                                            const availableStock = product
                                              ? getAvailableStock(product, item.size, item.color)
                                              : null;
                    
                                            if (
                                              availableStock !== null &&
                                              item.quantity >= availableStock
                                            ) {
                                              showStockLimit(availableStock);
                                              return;
                                            }
                    
                                            updateQuantity(
                                              item.id,
                                              item.quantity + 1,
                                              item.size,
                                              item.color,
                                              item.rewardForPromotionId,
                                            );
                                          }}
                                          style={[
                                            styles.qtyBtn,
                                            {
                                              backgroundColor: hasStockIssue
                                                ? colors.muted
                                                : colors.primary,
                                            },
                                          ]}
                                        >
                                          <Ionicons
                                            name="add"
                                            size={16}
                                            color={
                                              hasStockIssue
                                                ? colors.mutedForeground
                                                : "#fff"
                                            }
                                          />
                                        </Pressable>
                                        <Text style={[styles.qty, { color: colors.foreground }]}>{item.quantity}</Text>
                                        <Pressable
                                          onPress={() => {
                                            const nextItems =
                                              item.quantity ===
                                              1
                                                ? items.filter(
                                                    (entry) =>
                                                      !sameCartLine(
                                                        entry,
                                                        item,
                                                      ),
                                                  )
                                                : items.map(
                                                    (entry) =>
                                                      sameCartLine(
                                                        entry,
                                                        item,
                                                      )
                                                        ? {
                                                            ...entry,
                                                            quantity:
                                                              entry.quantity -
                                                              1,
                                                          }
                                                        : entry,
                                                  );
                    
                                            void runCartChangeWithGiftGuard(
                                              nextItems,
                                              () => {
                                                if (
                                                  item.quantity ===
                                                  1
                                                ) {
                                                  removeItem(
                                                    item.id,
                                                    item.size,
                                                    item.color,
                                                    item.rewardForPromotionId,
                                                  );
                                                  return;
                                                }
                    
                                                updateQuantity(
                                                  item.id,
                                                  item.quantity -
                                                    1,
                                                  item.size,
                                                  item.color,
                                                  item.rewardForPromotionId,
                                                );
                                              },
                                              item.quantity ===
                                                1,
                                            );
                                          }}
                                          style={[styles.qtyBtn, { backgroundColor: item.quantity === 1 ? colors.muted : colors.primary }]}
                                        >
                                          <Ionicons name="remove" size={16} color={item.quantity === 1 ? colors.mutedForeground : "#fff"} />
                                        </Pressable>
                                      </View>
                  )}
                </View>
              );
            }}
          />

          <View
            style={[
              styles.summary,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                paddingBottom: isDesktopWeb ? 20 : bottomPadding,
              },
              isDesktopWeb ? styles.desktopSummary : null,
            ]}
          >
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>{totalItems} منتج</Text>
              <Text style={[styles.summaryValue, { color: colors.foreground }]}>المجموع</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={[styles.totalPrice, { color: colors.primary }]}>{totalPrice} ₪</Text>
              <Text style={[styles.totalLabel, { color: colors.foreground }]}>الإجمالي</Text>
            </View>

            {promotionPreviewLoading ? (
              <View style={styles.summaryRow}>
                <ActivityIndicator
                  size="small"
                  color={colors.primary}
                />
                <Text
                  style={[
                    styles.summaryLabel,
                    { color: colors.mutedForeground },
                  ]}
                >
                  جاري احتساب عروض السلة...
                </Text>
              </View>
            ) : null}

            {(promotionPreview?.promotions ?? []).map(
              (promotion) => {
                const configuredPromotion =
                  getPromotionById(
                    promotion.promotionId,
                  );

                let displayLabel =
                  promotion.publicLabel;

                if (
                  configuredPromotion?.kind ===
                    "buy_x_get_y" &&
                  configuredPromotion.buyQuantity &&
                  configuredPromotion.rewardQuantity
                ) {
                  const buyQuantity =
                    configuredPromotion.buyQuantity;
                  const rewardQuantity =
                    configuredPromotion.rewardQuantity;

                  if (
                    configuredPromotion.rewardMode ===
                    "free"
                  ) {
                    displayLabel =
                      `اشتري ${buyQuantity} وخذ ${rewardQuantity} مجانًا`;
                  } else if (
                    configuredPromotion.rewardMode ===
                      "percent_off" &&
                    configuredPromotion.rewardPercent
                  ) {
                    displayLabel =
                      `اشتري ${buyQuantity} وخذ ${rewardQuantity} بخصم ${configuredPromotion.rewardPercent}%`;
                  } else if (
                    configuredPromotion.rewardMode ===
                      "fixed_price" &&
                    configuredPromotion.rewardPriceMinor !==
                      null &&
                    configuredPromotion.rewardPriceMinor !==
                      undefined
                  ) {
                    displayLabel =
                      `اشتري ${buyQuantity} وخذ ${rewardQuantity} بسعر ${configuredPromotion.rewardPriceMinor / 100} ₪`;
                  }
                }

                return (
                  <View
                    style={styles.summaryRow}
                    key={`cart-promotion-${promotion.promotionId}`}
                  >
                    <Text
                      style={{
                        color: "#16A34A",
                        fontWeight: "900",
                      }}
                    >
                      -{promotion.discountMinor / 100} ₪
                    </Text>
                    <Text
                      style={{
                        color: colors.foreground,
                        fontWeight: "800",
                      }}
                    >
                      🎁 {displayLabel}
                    </Text>
                  </View>
                );
              },
            )}

            {promotionDiscountAmount > 0 ? (
              <View style={styles.summaryRow}>
                <Text
                  style={[
                    styles.totalPrice,
                    { color: "#16A34A" },
                  ]}
                >
                  {totalPrice - promotionDiscountAmount} ₪
                </Text>
                <Text
                  style={[
                    styles.totalLabel,
                    { color: colors.foreground },
                  ]}
                >
                  الإجمالي بعد العرض
                </Text>
              </View>
            ) : null}

            {(promotionPreview?.entitlements ?? [])
              .filter(
                (entitlement) =>
                  entitlement.remainingRewardQuantity > 0 ||
                  (
                    entitlement.nextBundleRemainingQuantity ??
                    0
                  ) > 0 ||
                  (
                    entitlement.thresholdRemainingMinor ??
                    0
                  ) > 0,
              )
              .map((entitlement) => {
                const promotion =
                  getPromotionById(
                    entitlement.promotionId,
                  );

                if (!promotion) return null;

                const chooseReward =
                  promotion.rewardSelectionMode ===
                    "customer_choice" &&
                  entitlement.remainingRewardQuantity >
                    0;

                const remainingForNextBundle =
                  entitlement.nextBundleRemainingQuantity ??
                  entitlement.remainingRewardQuantity;

                const isSpendGift =
                  promotion.kind ===
                  "spend_x_get_gift";

                const thresholdRemaining =
                  (
                    entitlement.thresholdRemainingMinor ??
                    0
                  ) / 100;

                return (
                  <View
                    key={`promotion-entitlement-${entitlement.promotionId}`}
                    style={{
                      borderWidth: 1,
                      borderColor:
                        colors.primary + "55",
                      backgroundColor:
                        colors.primary + "0D",
                      borderRadius: 12,
                      padding: 10,
                      gap: 7,
                      marginTop: 5,
                    }}
                  >
                    <Text
                      style={{
                        color: colors.foreground,
                        fontWeight: "800",
                        textAlign: "right",
                      }}
                    >
                      {chooseReward
                        ? "🎁 استحققت مكافأة من العرض"
                        : isSpendGift
                          ? `باقي ${thresholdRemaining} ₪ للحصول على الهدية`
                          : `باقي ${remainingForNextBundle} قطعة للاستفادة من العرض`}
                    </Text>

                    {chooseReward ||
                    !isSpendGift ? (
                      <Pressable
                        onPress={() =>
                          router.push({
                            pathname:
                              "/(tabs)/products",
                            params: {
                              promotionId:
                                String(
                                  entitlement.promotionId,
                                ),
                              ...(chooseReward
                                ? {
                                    rewardForPromotionId:
                                      String(
                                        entitlement.promotionId,
                                      ),
                                  }
                                : {}),
                            },
                          } as never)
                        }
                        style={{
                          alignSelf: "flex-end",
                        }}
                      >
                        <Text
                          style={{
                            color: colors.primary,
                            fontWeight: "900",
                            textDecorationLine:
                              "underline",
                          }}
                        >
                          {chooseReward
                            ? (
                                isSpendGift
                                  ? "اختيار الهدية"
                                  : "اختر قطعتك من الأصناف المشمولة"
                              )
                            : "مشاهدة الأصناف المشمولة"}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}

            {promotionPreviewError ? (
              <Text
                style={{
                  color: "#DC2626",
                  fontSize: 12,
                  textAlign: "right",
                  marginTop: 4,
                }}
              >
                {promotionPreviewError}
              </Text>
            ) : null}

            {settings.discountCodesEnabled === true &&
            !promotionBlocksDiscountCodes ? (
              <View
                style={{
                  gap: 8,
                  marginTop: 4,
                  marginBottom: 6,
                }}
              >
                {appliedDiscountCode ? (
                  <View
                    style={{
                      borderWidth: 1,
                      borderColor: "#22C55E",
                      borderRadius: 12,
                      padding: 10,
                      backgroundColor: "#22C55E12",
                      gap: 5,
                    }}
                  >
                    <Text
                      style={{
                        color: "#16A34A",
                        fontWeight: "900",
                        textAlign: "right",
                      }}
                    >
                      🎟️ {appliedDiscountCode.campaignName} — {appliedDiscountCode.code} ({appliedDiscountCode.discountPercent}%)
                    </Text>
                    <View style={styles.summaryRow}>
                      <Text style={{ color: "#16A34A", fontWeight: "900" }}>
                        -{appliedDiscountAmount} ₪
                      </Text>
                      <Text style={{ color: colors.foreground, fontWeight: "800" }}>
                        خصم الكود
                      </Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={{ color: colors.primary, fontWeight: "900" }}>
                        {totalPrice -
      promotionDiscountAmount -
      appliedDiscountAmount} ₪
                      </Text>
                      <Text style={{ color: colors.foreground, fontWeight: "800" }}>
                        بعد الخصم
                      </Text>
                    </View>
                    <Pressable onPress={removeDiscountCode}>
                      <Text
                        style={{
                          color: "#DC2626",
                          fontWeight: "800",
                          textAlign: "right",
                          fontSize: 12,
                        }}
                      >
                        إزالة الكود
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={{ gap: 6 }}>
                    <Text
                      style={{
                        color: colors.foreground,
                        fontWeight: "800",
                        textAlign: "right",
                      }}
                    >
                      🎟️ عندك كود خصم؟
                    </Text>
                    <View
                      style={[
                        styles.inputRow,
                        {
                          backgroundColor: colors.input,
                          borderColor: discountCodeError
                            ? "#DC2626"
                            : colors.border,
                        },
                      ]}
                    >
                      <TextInput
                        value={discountCodeInput}
                        onChangeText={(value) => {
                          setDiscountCodeInput(value);
                          setDiscountCodeError(null);
                        }}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        placeholder="أدخل كود الخصم"
                        placeholderTextColor={colors.mutedForeground}
                        style={[styles.input, { color: colors.foreground }]}
                        textAlign="right"
                        onSubmitEditing={() => void handleApplyDiscountCode()}
                      />
                      <Pressable
                        onPress={() => void handleApplyDiscountCode()}
                        disabled={discountCodeLoading}
                        style={{
                          backgroundColor: colors.primary,
                          borderRadius: 9,
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                        }}
                      >
                        {discountCodeLoading ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={{ color: "#fff", fontWeight: "900" }}>
                            تطبيق
                          </Text>
                        )}
                      </Pressable>
                    </View>
                    {discountCodeError ? (
                      <Text
                        style={{
                          color: "#DC2626",
                          fontSize: 12,
                          textAlign: "right",
                        }}
                      >
                        {discountCodeError}
                      </Text>
                    ) : null}
                  </View>
                )}
              </View>
            ) : null}

            {cartPromotionWindowActive ? (
              <View
                style={[
                  styles.shippingProgressCard,
                  {
                    backgroundColor: cartPromotionReached
                      ? "#22C55E12"
                      : colors.input,
                    borderColor: cartPromotionReached
                      ? "#22C55E45"
                      : colors.border,
                  },
                ]}
              >
                <View style={styles.shippingProgressHeader}>
                  <Ionicons
                    name={
                      cartPromotionReached
                        ? "checkmark-circle"
                        : "bicycle-outline"
                    }
                    size={18}
                    color={
                      cartPromotionReached
                        ? "#16A34A"
                        : colors.primary
                    }
                  />
                  <Text
                    style={[
                      styles.shippingProgressText,
                      {
                        color: cartPromotionReached
                          ? "#15803D"
                          : colors.foreground,
                      },
                    ]}
                  >
                    {cartPromotionReached
                      ? "🎉 مبروك! حصلتِ على عرض التوصيل"
                      : `🚚 باقي ${cartPromotionRemaining} ₪ واستفيدي من عرض التوصيل`}
                  </Text>
                </View>

                {!cartPromotionReached ? (
                  <View
                    style={[
                      styles.shippingProgressTrack,
                      { backgroundColor: colors.border },
                    ]}
                  >
                    <View
                      style={[
                        styles.shippingProgressFill,
                        {
                          backgroundColor: colors.primary,
                          width: `${Math.round(
                            cartPromotionProgress * 100,
                          )}%` as `${number}%`,
                        },
                      ]}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}
            <Pressable
              onPress={handleContinueToCheckout}
              disabled={cartStockChecking}
              style={[
                styles.orderBtn,
                {
                  backgroundColor: cartStockChecking
                    ? colors.muted
                    : cartHasKnownStockIssues
                      ? "#DC2626"
                      : colors.primary,
                },
              ]}
            >
              {cartStockChecking ? (
                <ActivityIndicator
                  size="small"
                  color={colors.mutedForeground}
                />
              ) : (
                <Ionicons
                  name={
                    cartHasKnownStockIssues
                      ? "alert-circle-outline"
                      : "arrow-back"
                  }
                  size={20}
                  color="#fff"
                />
              )}
              <Text
                style={[
                  styles.orderBtnText,
                  cartStockChecking
                    ? { color: colors.mutedForeground }
                    : null,
                ]}
              >
                {cartStockChecking
                  ? "جاري التحقق من المخزون..."
                  : cartHasKnownStockIssues
                    ? "راجعي المنتجات غير المتوفرة"
                    : "متابعة الطلب"}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

function BankRow({ icon, label, value, colors }: { icon: string; label: string; value: string; colors: any }) {
  return (
    <View style={styles.bankRow}>
      <View style={{ flex: 1, alignItems: "flex-end" }}>
        <Text style={[styles.bankRowLabel, { color: colors.mutedForeground }]}>{label}</Text>
        <Text style={[styles.bankRowValue, { color: colors.foreground }]} selectable>{value}</Text>
      </View>
      <Ionicons name={icon as "card-outline"} size={18} color={colors.primary} style={{ marginTop: 2 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  header: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: { fontSize: 20, fontWeight: "800" },
  clearText: { fontSize: 14, fontWeight: "600" },
  emptyTitle: { fontSize: 20, fontWeight: "700" },
  emptySub: { fontSize: 14 },
  shopBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14, marginTop: 8 },
  shopBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  list: { padding: 16, gap: 12 },
  cartBody: {
    flex: 1,
  },
  desktopCartItem: {
    minHeight: 150,
    padding: 18,
  },
  desktopItemImage: {
    width: 120,
    height: 120,
    borderRadius: 16,
  },
  desktopQuantityRow: {
    flexDirection: "row-reverse",
    gap: 10,
  },
  desktopSummary: {
    width: 350,
    flexShrink: 0,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
    marginTop: 0,
  },
  cartItem: {
    flexDirection: "row-reverse",
    alignItems: "center",
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    position: "relative",
  },
  deleteBtn: {
    flexDirection: "row-reverse",
    alignItems: "center",
    alignSelf: "flex-end",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 2,
    marginTop: 2,
  },
  deleteText: { color: "#dc2626", fontSize: 12, fontWeight: "600" },
  itemImage: { width: 70, height: 70, borderRadius: 12, resizeMode: "cover" },
  itemRight: { flex: 1, gap: 4, alignItems: "flex-end" },
  itemName: { fontSize: 14, fontWeight: "700", textAlign: "right" },
  itemSize: { fontSize: 12 },
  itemPrice: { fontSize: 15, fontWeight: "700" },
  quantityRow: { flexDirection: "column", alignItems: "center", gap: 8 },
  qtyBtn: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  qty: { fontSize: 16, fontWeight: "700" },
  summary: { padding: 16, borderTopWidth: 1, gap: 10 },
  summaryRow: { flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center" },
  summaryLabel: { fontSize: 14 },
  summaryValue: { fontSize: 14, fontWeight: "600" },
  totalPrice: { fontSize: 24, fontWeight: "800" },
  totalLabel: { fontSize: 16, fontWeight: "700" },
  freeShipping: { flexDirection: "row-reverse", alignItems: "center", gap: 6, padding: 10, borderRadius: 10, justifyContent: "center" },
  shippingProgressCard: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 8 },
  shippingProgressHeader: { flexDirection: "row-reverse", alignItems: "center", gap: 7 },
  shippingProgressText: { flex: 1, fontSize: 13, fontWeight: "800", textAlign: "right" },
  shippingProgressTrack: { height: 7, borderRadius: 999, overflow: "hidden" },
  shippingProgressFill: { height: "100%", borderRadius: 999 },
  orderBtn: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: 16, marginTop: 4 },
  orderBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  formContent: { padding: 16, gap: 12 },
  orderSummary: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 12 },
  orderSummaryHeader: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", gap: 12 },
  orderSummaryHeading: { alignItems: "flex-end", gap: 2 },
  orderSummaryTitle: { fontSize: 16, fontWeight: "800", textAlign: "right" },
  orderSummaryCount: { fontSize: 12, fontWeight: "600", textAlign: "right" },
  summaryToggle: { flexDirection: "row-reverse", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10 },
  summaryToggleText: { fontSize: 12, fontWeight: "800" },
  summaryItemsList: { gap: 7, borderTopWidth: 1, paddingTop: 10 },
  summaryBreakdown: { gap: 8, borderTopWidth: 1, paddingTop: 10 },
  summaryItem: { flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center" },
  summaryItemName: { fontSize: 13, textAlign: "right", flex: 1 },
  summaryItemPrice: { fontSize: 13, fontWeight: "700", marginLeft: 8 },
  shippingValueWrap: { flexDirection: "row-reverse", alignItems: "center", gap: 7, flexWrap: "wrap" },
  shippingPromoBadge: { flexDirection: "row-reverse", alignItems: "center", gap: 3, backgroundColor: "#22C55E12", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  shippingPromoBadgeText: { color: "#16A34A", fontSize: 10, fontWeight: "800" },
  appliedCouponCompact: { flexDirection: "row-reverse", alignItems: "center", gap: 9, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9 },
  appliedCouponInfo: { flex: 1, alignItems: "flex-end", gap: 1 },
  appliedCouponCode: { color: "#15803D", fontSize: 12, fontWeight: "900", textAlign: "right" },
  appliedCouponSaving: { color: "#16A34A", fontSize: 11, fontWeight: "700", textAlign: "right" },
  removeCouponButton: { paddingHorizontal: 6, paddingVertical: 5 },
  removeCouponText: { color: "#DC2626", fontSize: 11, fontWeight: "800" },
  checkoutCouponArea: { gap: 6 },
  applyCouponButton: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 9 },
  applyCouponText: { color: "#fff", fontWeight: "900" },
  cancelCouponButton: { alignSelf: "flex-start", paddingHorizontal: 6, paddingVertical: 2 },
  cancelCouponText: { fontSize: 11, fontWeight: "700" },
  discountErrorText: { color: "#DC2626", fontSize: 12, textAlign: "right", fontWeight: "700" },
  couponCollapsedRow: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  couponCollapsedLabel: { flexDirection: "row-reverse", alignItems: "center", gap: 6 },
  couponCollapsedText: { fontSize: 13, fontWeight: "700" },
  couponAddText: { fontSize: 12, fontWeight: "900" },
  totalRow: { flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, paddingTop: 11, marginTop: 1 },
  totalAmount: { fontSize: 22, fontWeight: "900" },
  totalText: { fontSize: 15, fontWeight: "800" },
  formSection: { fontSize: 16, fontWeight: "800", textAlign: "right" },
  fieldGroup: { gap: 6 },
  fieldLabel: { fontSize: 14, fontWeight: "600", textAlign: "right" },
  inputRow: { flexDirection: "row-reverse", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  input: { flex: 1, fontSize: 15, padding: 0 },
  notesInput: { borderRadius: 12, borderWidth: 1, padding: 12, fontSize: 14, minHeight: 80 },
  zoneOptions: { gap: 8 },
  zoneOption: { flexDirection: "row-reverse", alignItems: "center", borderRadius: 14, borderWidth: 2, paddingVertical: 12, paddingHorizontal: 14, gap: 10, position: "relative" },
  zoneOptionContent: { flex: 1, alignItems: "flex-end", gap: 2 },
  zoneOptionLabel: { fontSize: 15, fontWeight: "700", textAlign: "right" },
  zoneOptionCost: { fontSize: 13, fontWeight: "600", textAlign: "right" },
  zoneCheck: { position: "absolute", top: 8, left: 8 },
  paymentOptions: { gap: 10 },
  codOnlyCard: { flexDirection: "row-reverse", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  codOnlyText: { flex: 1, alignItems: "flex-end", gap: 2 },
  payOption: { borderRadius: 14, borderWidth: 2, padding: 14, gap: 4, alignItems: "flex-end", position: "relative" },
  payOptionTitle: { fontSize: 15, fontWeight: "700", textAlign: "right" },
  payOptionSub: { fontSize: 12, textAlign: "right" },
  payCheck: { position: "absolute", top: 12, left: 12 },
  confirmBtn: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 18, borderRadius: 16, marginTop: 8 },
  confirmBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  confirmHelperText: { fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: -2 },
  validationHint: { fontSize: 13, textAlign: "center", marginTop: 6 },
  successIcon: { width: 100, height: 100, borderRadius: 50, alignItems: "center", justifyContent: "center" },
  successTitle: { fontSize: 24, fontWeight: "800" },
  successSub: { fontSize: 14, textAlign: "center", maxWidth: 280 },
  successInfo: { flexDirection: "row-reverse", alignItems: "center", gap: 10, padding: 14, borderRadius: 14, borderWidth: 1, marginTop: 8 },
  successInfoText: { fontSize: 13, textAlign: "right", flex: 1 },
  guestOrderNumberCard: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    alignItems: "center",
    gap: 4,
  },
  guestOrderNumberLabel: {
    fontSize: 12,
    textAlign: "center",
  },
  guestOrderNumberValue: {
    fontSize: 26,
    fontWeight: "900",
    textAlign: "center",
  },
  guestOrderNumberHint: {
    fontSize: 12,
    textAlign: "center",
  },
  backHomeBtn: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 16, marginTop: 8 },
  backHomeBtnText: { fontSize: 16, fontWeight: "700", color: "#fff" },
  bankCard: { width: "100%", borderRadius: 16, borderWidth: 1.5, padding: 16, gap: 12 },
  bankHeader: { flexDirection: "row-reverse", alignItems: "center", gap: 8 },
  bankTitle: { fontSize: 16, fontWeight: "800" },
  bankRows: { gap: 10 },
  bankRow: { flexDirection: "row-reverse", alignItems: "flex-start", gap: 10 },
  bankRowLabel: { fontSize: 11, marginBottom: 2 },
  bankRowValue: { fontSize: 15, fontWeight: "700" },
  noBankText: { fontSize: 13, textAlign: "right", lineHeight: 20 },
  amountRow: { flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center", padding: 12 },
  amountLabel: { fontSize: 14, fontWeight: "600" },
  amountValue: { fontSize: 22, fontWeight: "800" },
  uploadCard: { width: "100%", borderRadius: 16, borderWidth: 1, padding: 16, gap: 10, alignItems: "flex-end" },
  uploadTitle: { fontSize: 15, fontWeight: "700", textAlign: "right" },
  uploadSub: { fontSize: 13, textAlign: "right" },
  uploadBtn: { flexDirection: "row-reverse", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
  uploadBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
});
