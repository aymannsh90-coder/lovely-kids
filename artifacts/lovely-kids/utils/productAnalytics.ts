import { API_BASE } from "@/constants/api";

import {
  getOrCreateAnalyticsVisitorId,
} from "@/utils/analyticsVisitor";

export type ProductAnalyticsEvent =
  | "view"
  | "add_to_cart";

export async function trackProductAnalyticsEvent(
  productId: string,
  eventType: ProductAnalyticsEvent,
) {
  try {
    const numericProductId =
      Number(productId);

    if (
      !Number.isSafeInteger(
        numericProductId,
      ) ||
      numericProductId <= 0
    ) {
      return;
    }

    const visitorId =
      await getOrCreateAnalyticsVisitorId();

    await fetch(
      `${API_BASE}/api/analytics/product-event`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          visitorId,
          productId:
            numericProductId,
          eventType,
        }),
      },
    );
  } catch {
    // Analytics must never affect the shopping experience.
  }
}
