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
