import assert from "node:assert/strict";
import test from "node:test";
import { getFailedDeliveryReturnState, countFailedDeliveryReturns, canMarkFailedDeliveryReturn } from "./failedDeliveryReturnStatus.ts";

const pending = { id: 330, status: "returning", failedDeliveryReturnStatus: "pending" };
const received = { id: 329, status: "cancelled", failedDeliveryReturnStatus: "received" };

test("pending return is not available or considered received", () => {
  assert.equal(getFailedDeliveryReturnState(pending), "pending");
  assert.deepEqual(countFailedDeliveryReturns([pending]), { pending: 1, received: 0 });
});
test("receipt counted separately after cancellation", () => {
  assert.equal(getFailedDeliveryReturnState(received), "received");
  assert.deepEqual(countFailedDeliveryReturns([pending, received]), { pending: 1, received: 1 });
});
test("legacy cancellations, ordinary delivering and merged orders are not guessed as returns", () => {
  assert.deepEqual(countFailedDeliveryReturns([
    { id: 10, status: "cancelled" },
    { id: 11, status: "delivering" },
    { ...pending, mergedIntoOrderId: 10 },
  ]), { pending: 0, received: 0 });
});
test("inconsistent server status never inflates courier return counts", () => {
  assert.equal(getFailedDeliveryReturnState({ ...pending, status: "done" }), null);
  assert.equal(getFailedDeliveryReturnState({ ...received, status: "delivering" }), null);
});

const validCourierOrder = {
  id: 347,
  status: "delivering",
  mergedIntoOrderId: null,
  failedDeliveryReturnStatus: null,
  fulfillmentMethod: "delivery",
  deliveryCompanyId: 1,
  shippingZone: "الضفة الغربية",
  paymentMethod: "cod",
  paymentStatus: "pending",
  exchangePublicId: null,
};

test("COD courier order in delivery can open the returning reason dialog", () => {
  assert.equal(canMarkFailedDeliveryReturn(validCourierOrder), true);
});

test("do not offer refused-return transition for pickup, local courier, already exchanged/returned or paid orders", () => {
  const prohibited = [
    { status: "confirmed" },
    { status: "returning" },
    { mergedIntoOrderId: 10 },
    { failedDeliveryReturnStatus: "pending" },
    { fulfillmentMethod: "pickup" },
    { deliveryCompanyId: null },
    { shippingZone: "استلام من المحل" },
    { shippingZone: "ديلفري داخل مدينة نابلس" },
    { paymentMethod: "bank_transfer" },
    { paymentStatus: "confirmed" },
    { exchangePublicId: "EXC-3" },
  ];
  for (const change of prohibited) {
    assert.equal(canMarkFailedDeliveryReturn({ ...validCourierOrder, ...change }), false, JSON.stringify(change));
  }
});
