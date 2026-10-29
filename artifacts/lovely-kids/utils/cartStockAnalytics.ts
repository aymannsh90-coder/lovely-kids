import { API_BASE } from "@/constants/api";
import type { CartItem } from "@/context/CartContext";
import type { CartStockIssueKind } from "@/utils/cartStock";
import { getOrCreateAnalyticsVisitorId } from "@/utils/analyticsVisitor";

export type CartStockEventType =
  | "issue_seen"
  | "checkout_blocked"
  | "item_corrected"
  | "item_removed";

// Fire and forget: tracking errors must never prevent a customer order.
export async function trackCartStockEvent(
  eventType: CartStockEventType,
  item: Pick<CartItem, "id" | "color" | "size" | "quantity">,
  issueKind: CartStockIssueKind,
  availableQuantity: number | null,
): Promise<void> {
  try {
    const productId = Number(item.id);
    if (!Number.isSafeInteger(productId) || productId <= 0) return;
    const visitorId = await getOrCreateAnalyticsVisitorId();
    const eventId =
      globalThis.crypto?.randomUUID?.().replace(/-/g, "_") ??
      ["lk", Date.now().toString(36), Math.random().toString(36).slice(2), Math.random().toString(36).slice(2)].join("_");
    await fetch(`${API_BASE}/api/analytics/cart-stock-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId,
        visitorId,
        productId,
        eventType,
        issueKind,
        selectedColor: item.color ?? null,
        selectedSize: item.size ?? null,
        requestedQuantity: item.quantity,
        availableQuantity,
      }),
    });
  } catch {
    // Analytics must not interrupt shopping.
  }
}
