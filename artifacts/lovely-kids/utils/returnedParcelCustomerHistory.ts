/**
 * Staff-only, derived customer-return hint.
 *
 * Rejected courier parcels are recorded per order. We do not create a global
 * customer blacklist, change checkout, block payments, or link by name alone.
 *
 * A validated mobile number is the matching key. Names can legitimately differ
 * and are shown as context in the staff UI, not as a matching requirement.
 */

export interface ReturnedParcelCustomerOrder {
  id: number;
  customerName: string;
  customerPhone: string;
  createdAt: string;
  status: string;
  failedDeliveryReturnStatus?: "pending" | "received" | null;
  failedDeliveryReturnReason?: string | null;
  failedDeliveryReturnReportedAt?: string | null;
  mergedIntoOrderId?: number | null;
}

export interface ReturnedParcelHistoryEntry {
  orderId: number;
  customerName: string;
  state: "pending" | "received";
  reason: string | null;
  reportedAt: string;
  timestamp: number;
}

export type ReturnedParcelHistoryIndex = Map<string, ReturnedParcelHistoryEntry[]>;

/**
 * 0591234567, 591234567, +970591234567 and +972591234567 all identify
 * the same 9-digit mobile suffix. Separators and Arabic/Persian numerals work.
 *
 * Reject short/ambiguous and foreign-format numbers rather than link unrelated
 * people. A name match is never enough to assign a return warning.
 */
export function normalizeReturnedParcelMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const persian = "۰۱۲۳۴۵۶۷۸۹";
  let digits = raw
    .replace(/[٠-٩]/g, ch => String(arabic.indexOf(ch)))
    .replace(/[۰-۹]/g, ch => String(persian.indexOf(ch)))
    .replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("970") || digits.startsWith("972")) digits = digits.slice(3);
  if (digits.length === 10 && digits.startsWith("0")) digits = digits.slice(1);
  return /^5\d{8}$/.test(digits) ? digits : null;
}

/** Include only deliberate, recorded refusals (not ordinary cancellations).
 * An inconsistent state must not silently mark another customer's order.
 */
export function buildReturnedParcelHistoryIndex(
  orders: readonly ReturnedParcelCustomerOrder[],
): ReturnedParcelHistoryIndex {
  const index: ReturnedParcelHistoryIndex = new Map();
  for (const order of orders) {
    if (order.mergedIntoOrderId != null) continue;
    const state =
      order.status === "returning" && order.failedDeliveryReturnStatus === "pending"
        ? "pending"
        : order.status === "cancelled" && order.failedDeliveryReturnStatus === "received"
          ? "received"
          : null;
    if (!state) continue;

    const phone = normalizeReturnedParcelMobile(order.customerPhone);
    const reportedAt = order.failedDeliveryReturnReportedAt;
    const timestamp = reportedAt ? Date.parse(reportedAt) : NaN;
    if (!phone || !reportedAt || !Number.isFinite(timestamp)) continue;

    const record: ReturnedParcelHistoryEntry = {
      orderId: order.id,
      customerName: order.customerName,
      state,
      reason: order.failedDeliveryReturnReason ?? null,
      reportedAt,
      timestamp,
    };
    const matches = index.get(phone) ?? [];
    matches.push(record);
    index.set(phone, matches);
  }

  for (const records of index.values()) {
    records.sort((a, b) => b.timestamp - a.timestamp || b.orderId - a.orderId);
  }
  return index;
}

/** Warn on subsequent orders sharing a validated phone number. We exclude
 * the refused parcel itself and historical orders placed before it was refused
 * to avoid plastering old completed orders with misleading "customer risk" tags.
 */
export function getPriorReturnedParcels(
  order: ReturnedParcelCustomerOrder,
  index: ReturnedParcelHistoryIndex,
): ReturnedParcelHistoryEntry[] {
  const phone = normalizeReturnedParcelMobile(order.customerPhone);
  const createdAt = Date.parse(order.createdAt);
  if (!phone || !Number.isFinite(createdAt)) return [];
  return (index.get(phone) ?? []).filter(
    record => record.orderId !== order.id && record.timestamp <= createdAt,
  );
}
