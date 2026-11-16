/** Physical return of failed COD delivery is independent of the customer's order cancellation. */
export interface FailedDeliveryOrder {
  id: number;
  status: string;
  failedDeliveryReturnStatus?: "pending" | "received" | null;
  mergedIntoOrderId?: number | null;
}

export function getFailedDeliveryReturnState(order: FailedDeliveryOrder): "pending" | "received" | null {
  if (order.mergedIntoOrderId != null) return null;
  if (order.failedDeliveryReturnStatus === "pending" && order.status === "returning") return "pending";
  if (order.failedDeliveryReturnStatus === "received" && order.status === "cancelled") return "received";
  return null;
}
export function countFailedDeliveryReturns(orders: readonly FailedDeliveryOrder[]) {
  const result = { pending: 0, received: 0 };
  for (const order of orders) {
    const status = getFailedDeliveryReturnState(order);
    if (status) result[status] += 1;
  }
  return result;
}

/** Can the staff START the refused-courier-parcel flow from the normal status
 * selector? The API performs authoritative finance/settlement validation.
 * Never send "returning" through the generic status PATCH route. */
export interface FailedDeliveryReturnCandidate extends FailedDeliveryOrder {
  shippingZone?: string | null;
  fulfillmentMethod?: "pickup" | "delivery" | null;
  deliveryCompanyId?: number | null;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  exchangePublicId?: string | null;
}
export function canMarkFailedDeliveryReturn(order: FailedDeliveryReturnCandidate): boolean {
  return (
    order.status === "delivering" &&
    order.mergedIntoOrderId == null &&
    order.failedDeliveryReturnStatus == null &&
    order.fulfillmentMethod === "delivery" &&
    typeof order.deliveryCompanyId === "number" &&
    order.deliveryCompanyId > 0 &&
    order.shippingZone !== "استلام من المحل" &&
    order.shippingZone !== "ديلفري داخل مدينة نابلس" &&
    order.paymentMethod === "cod" &&
    order.paymentStatus === "pending" &&
    !order.exchangePublicId
  );
}
