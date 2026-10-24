import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";

import { API_BASE } from "@/constants/api";
import type { CartItem } from "@/context/CartContext";

export type StorePromotionKind =
  | "buy_x_get_y"
  | "percent_off"
  | "bundle_price";

export interface StorePromotion {
  id: number;
  name: string;
  publicLabel: string;
  description?: string | null;

  kind: StorePromotionKind;
  scope: "all_products" | "selected_products";
  channel: "web" | "pos" | "both";

  buyQuantity?: number | null;
  rewardQuantity?: number | null;
  rewardMode?: "free" | "percent_off" | "fixed_price" | null;
  rewardPercent?: number | null;
  rewardPriceMinor?: number | null;
  rewardSelectionMode: "cheapest" | "customer_choice";

  percentOff?: number | null;

  bundleQuantity?: number | null;
  bundlePriceMinor?: number | null;

  repeatable: boolean;
  maxApplicationsPerOrder?: number | null;

  stackWithOtherPromotions: boolean;
  stackWithDiscountCodes: boolean;
  stackWithShippingPromotion: boolean;

  priority: number;

  qualifyingProductIds: number[];
  rewardProductIds: number[];
  excludedProductIds: number[];
}

export interface PromotionPreviewAllocation {
  promotionId: number;
  promotionName: string;
  groupKey: string;
  discountMinor: number;
}

export interface PromotionPreviewLine {
  key: string;
  promotionDiscountMinor: number;
  allocations: PromotionPreviewAllocation[];
}

export interface PromotionPreviewApplied {
  promotionId: number;
  promotionName: string;
  publicLabel: string;
  kind: StorePromotionKind;
  discountMinor: number;
  applicationCount: number;
  stackWithDiscountCodes: boolean;
  stackWithShippingPromotion: boolean;
}

export interface PromotionPreviewEntitlement {
  promotionId: number;
  promotionName: string;
  earnedRewardQuantity: number;
  selectedRewardQuantity: number;
  remainingRewardQuantity: number;
  nextBundleRemainingQuantity?: number;
}

export interface PromotionPreviewResult {
  originalTotalMinor: number;
  totalDiscountMinor: number;
  netTotalMinor: number;
  lines: PromotionPreviewLine[];
  promotions: PromotionPreviewApplied[];
  entitlements: PromotionPreviewEntitlement[];
}

interface PromotionsContextValue {
  promotions: StorePromotion[];
  loading: boolean;
  refreshPromotions: () => Promise<void>;
  getPromotionsForProduct: (
    productId: string | number,
  ) => StorePromotion[];
  getPromotionById: (
    promotionId: string | number | null | undefined,
  ) => StorePromotion | null;
  previewCart: (
    items: CartItem[],
  ) => Promise<PromotionPreviewResult>;
}

const PromotionsContext =
  createContext<PromotionsContextValue>({
    promotions: [],
    loading: true,
    refreshPromotions: async () => {},
    getPromotionsForProduct: () => [],
    getPromotionById: () => null,
    previewCart: async () => ({
      originalTotalMinor: 0,
      totalDiscountMinor: 0,
      netTotalMinor: 0,
      lines: [],
      promotions: [],
      entitlements: [],
    }),
  });

const REFRESH_MS = 60_000;

function itemKey(
  item: Pick<CartItem, "id" | "size" | "color" | "rewardForPromotionId">,
) {
  return JSON.stringify([
    item.id,
    item.color ?? "",
    item.size ?? "",
    item.rewardForPromotionId ?? null,
  ]);
}

export function bidiSafePromotionText(
  value: string,
) {
  return value.replace(
    /\d+\s*\+\s*\d+/g,
    (match) => `\u2066${match}\u2069`,
  );
}

export function promotionShortLabel(
  promotion: StorePromotion,
) {
  if (
    promotion.kind === "buy_x_get_y" &&
    promotion.buyQuantity &&
    promotion.rewardQuantity
  ) {
    if (promotion.rewardMode === "free") {
      return bidiSafePromotionText(`عرض ${promotion.buyQuantity}+${promotion.rewardQuantity} 🎁`);
    }

    if (
      promotion.rewardMode === "percent_off" &&
      promotion.rewardPercent
    ) {
      return (
        promotion.buyQuantity === 1 &&
        promotion.rewardQuantity === 1
          ? `الثانية بخصم ${promotion.rewardPercent}%`
          : bidiSafePromotionText(`عرض ${promotion.buyQuantity}+${promotion.rewardQuantity} · خصم ${promotion.rewardPercent}%`)
      );
    }

    if (
      promotion.rewardMode === "fixed_price" &&
      promotion.rewardPriceMinor !== null &&
      promotion.rewardPriceMinor !== undefined
    ) {
      const rewardPrice = (
        promotion.rewardPriceMinor / 100
      ).toFixed(
        promotion.rewardPriceMinor % 100 === 0 ? 0 : 2,
      );

      return (
        promotion.buyQuantity === 1 &&
        promotion.rewardQuantity === 1
          ? `الثانية بـ${rewardPrice} ₪`
          : bidiSafePromotionText(`عرض ${promotion.buyQuantity}+${promotion.rewardQuantity} · المكافأة بـ${rewardPrice} ₪`)
      );
    }
  }

  if (
    promotion.kind === "percent_off" &&
    promotion.percentOff
  ) {
    return `خصم ${promotion.percentOff}% ✨`;
  }

  if (
    promotion.kind === "bundle_price" &&
    promotion.bundleQuantity &&
    promotion.bundlePriceMinor !== null &&
    promotion.bundlePriceMinor !== undefined
  ) {
    return `${promotion.bundleQuantity} بـ${(
      promotion.bundlePriceMinor / 100
    ).toFixed(
      promotion.bundlePriceMinor % 100 === 0 ? 0 : 2,
    )} ₪`;
  }

  return bidiSafePromotionText(promotion.publicLabel);
}

export function promotionCustomerTitle(
  promotion: StorePromotion,
) {
  if (
    promotion.kind === "buy_x_get_y" &&
    promotion.buyQuantity &&
    promotion.rewardQuantity
  ) {
    if (promotion.rewardMode === "free") {
      return `اشتري ${promotion.buyQuantity} وخذ ${promotion.rewardQuantity} مجانًا 🎁`;
    }

    if (
      promotion.rewardMode === "percent_off" &&
      promotion.rewardPercent
    ) {
      return `اشتري ${promotion.buyQuantity} وخذ ${promotion.rewardQuantity} بخصم ${promotion.rewardPercent}%`;
    }

    if (
      promotion.rewardMode === "fixed_price" &&
      promotion.rewardPriceMinor !== null &&
      promotion.rewardPriceMinor !== undefined
    ) {
      const rewardPrice = (
        promotion.rewardPriceMinor / 100
      ).toFixed(
        promotion.rewardPriceMinor % 100 === 0 ? 0 : 2,
      );

      return `اشتري ${promotion.buyQuantity} وخذ ${promotion.rewardQuantity} بـ${rewardPrice} ₪`;
    }
  }

  return promotionShortLabel(
    promotion,
  );
}

export function promotionDetailText(
  promotion: StorePromotion,
) {
  const customDescription =
    promotion.description?.trim();

  if (customDescription) {
    return bidiSafePromotionText(
      customDescription,
    );
  }
  if (
    promotion.kind === "buy_x_get_y" &&
    promotion.buyQuantity &&
    promotion.rewardQuantity
  ) {
    if (promotion.rewardMode === "free") {
      return `اشتري ${promotion.buyQuantity} وخذ ${promotion.rewardQuantity} مجانًا`;
    }

    if (
      promotion.rewardMode === "percent_off" &&
      promotion.rewardPercent
    ) {
      return `اشتري ${promotion.buyQuantity} واحصل على ${promotion.rewardQuantity} بخصم ${promotion.rewardPercent}%`;
    }

    if (
      promotion.rewardMode === "fixed_price" &&
      promotion.rewardPriceMinor !== null &&
      promotion.rewardPriceMinor !== undefined
    ) {
      return `اشتري ${promotion.buyQuantity} واحصل على ${promotion.rewardQuantity} بسعر ${(
        promotion.rewardPriceMinor / 100
      ).toFixed(
        promotion.rewardPriceMinor % 100 === 0 ? 0 : 2,
      )} ₪`;
    }
  }

  if (
    promotion.kind === "percent_off" &&
    promotion.percentOff
  ) {
    return `خصم ${promotion.percentOff}% على الأصناف المشمولة`;
  }

  if (
    promotion.kind === "bundle_price" &&
    promotion.bundleQuantity &&
    promotion.bundlePriceMinor !== null &&
    promotion.bundlePriceMinor !== undefined
  ) {
    return `اختر ${promotion.bundleQuantity} بسعر ${(
      promotion.bundlePriceMinor / 100
    ).toFixed(
      promotion.bundlePriceMinor % 100 === 0 ? 0 : 2,
    )} ₪`;
  }

  return bidiSafePromotionText(
    promotion.publicLabel,
  );
}

export function PromotionsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [promotions, setPromotions] =
    useState<StorePromotion[]>([]);
  const [loading, setLoading] =
    useState(true);
  const lastFetchRef = useRef(0);

  const refreshPromotions =
    useCallback(async () => {
      try {
        const response = await fetch(
          `${API_BASE}/api/promotions/active?channel=web`,
        );

        if (!response.ok) {
          throw new Error(
            "تعذر تحميل عروض المتجر",
          );
        }

        const data =
          (await response.json()) as StorePromotion[];

        setPromotions(
          Array.isArray(data)
            ? data
            : [],
        );

        lastFetchRef.current =
          Date.now();
      } catch (error) {
        console.warn(
          "PromotionsContext: failed to load promotions",
          error,
        );
      } finally {
        setLoading(false);
      }
    }, []);

  useEffect(() => {
    void refreshPromotions();

    const interval =
      setInterval(() => {
        void refreshPromotions();
      }, REFRESH_MS);

    return () =>
      clearInterval(interval);
  }, [refreshPromotions]);

  useEffect(() => {
    const subscription =
      AppState.addEventListener(
        "change",
        (state) => {
          if (
            state === "active" &&
            Date.now() -
              lastFetchRef.current >
              REFRESH_MS
          ) {
            void refreshPromotions();
          }
        },
      );

    return () =>
      subscription.remove();
  }, [refreshPromotions]);

  const getPromotionsForProduct =
    useCallback(
      (
        productId:
          | string
          | number,
      ) => {
        const id =
          Number(productId);

        if (
          !Number.isSafeInteger(id) ||
          id <= 0
        ) {
          return [];
        }

        return promotions
          .filter(
            (promotion) => {
            if (
              promotion.excludedProductIds.includes(
                id,
              )
            ) {
              return false;
            }

            if (
              promotion.scope ===
              "all_products"
            ) {
              return true;
            }

              return (
                promotion.qualifyingProductIds.includes(
                  id,
                ) ||
                promotion.rewardProductIds.includes(
                  id,
                )
              );
            },
          )
          .sort(
            (left, right) =>
              right.priority -
                left.priority ||
              left.id -
                right.id,
          );
      },
      [promotions],
    );

  const byId = useMemo(
    () =>
      new Map(
        promotions.map(
          (promotion) => [
            promotion.id,
            promotion,
          ],
        ),
      ),
    [promotions],
  );

  const getPromotionById =
    useCallback(
      (
        promotionId:
          | string
          | number
          | null
          | undefined,
      ) => {
        const id =
          Number(promotionId);

        if (
          !Number.isSafeInteger(id) ||
          id <= 0
        ) {
          return null;
        }

        return (
          byId.get(id) ??
          null
        );
      },
      [byId],
    );

  const previewCart =
    useCallback(
      async (
        items: CartItem[],
      ) => {
        if (
          items.length === 0
        ) {
          return {
            originalTotalMinor: 0,
            totalDiscountMinor: 0,
            netTotalMinor: 0,
            lines: [],
            promotions: [],
            entitlements: [],
          };
        }

        const response =
          await fetch(
            `${API_BASE}/api/promotions/preview`,
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json",
              },
              body: JSON.stringify({
                items:
                  items.map(
                    (item) => ({
                      key:
                        itemKey(
                          item,
                        ),
                      productId:
                        item.id,
                      quantity:
                        item.quantity,
                      rewardForPromotionId:
                        item.rewardForPromotionId,
                    }),
                  ),
              }),
            },
          );

        const data =
          (await response
            .json()
            .catch(
              () => ({}),
            )) as
            | PromotionPreviewResult
            | {
                error?: string;
              };

        if (
          !response.ok ||
          !(
            "totalDiscountMinor" in
            data
          )
        ) {
          throw new Error(
            (
              "error" in data &&
              data.error
            ) ||
              "تعذر احتساب عروض السلة",
          );
        }

        return data;
      },
      [],
    );

  return (
    <PromotionsContext.Provider
      value={{
        promotions,
        loading,
        refreshPromotions,
        getPromotionsForProduct,
        getPromotionById,
        previewCart,
      }}
    >
      {children}
    </PromotionsContext.Provider>
  );
}

export function usePromotions() {
  return useContext(
    PromotionsContext,
  );
}

export function promotionCartItemKey(
  item: Pick<CartItem, "id" | "size" | "color" | "rewardForPromotionId">,
) {
  return itemKey(item);
}
