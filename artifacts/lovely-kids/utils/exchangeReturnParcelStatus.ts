/**
 * Physical receipt of the OLD exchanged parcel is distinct from delivery
 * of the replacement order to the customer.
 *
 * "pending" means the exchange has financially completed (replacement handed
 * over), but the old parcel has not yet been received into our inventory.
 * It does NOT claim the delivery company has physically collected the parcel.
 */
export type ExchangeReturnParcelState =
  | "received"
  | "pending"
  | "awaiting_delivery"
  | null;

export interface ExchangeReturnParcelOrder {
  exchangePublicId?: string | null;
  exchangeFinancialCompletedAt?: string | null;
  exchangeReturnReceivedAt?: string | null;
  mergedIntoOrderId?: number | null;
}

export function getExchangeReturnParcelState(
  order: ExchangeReturnParcelOrder,
): ExchangeReturnParcelState {
  if (!order.exchangePublicId?.trim()) return null;
  if (order.exchangeReturnReceivedAt) return "received";
  if (order.exchangeFinancialCompletedAt) return "pending";
  return "awaiting_delivery";
}

export function countExchangeReturnParcels(
  orders: readonly ExchangeReturnParcelOrder[],
) {
  const counts = { pending: 0, received: 0, awaiting_delivery: 0 };
  for (const order of orders) {
    // Merged orders remain searchable, but must never double-count parcels.
    if (order.mergedIntoOrderId != null) continue;
    const status = getExchangeReturnParcelState(order);
    if (status) counts[status] += 1;
  }
  return counts;
}
