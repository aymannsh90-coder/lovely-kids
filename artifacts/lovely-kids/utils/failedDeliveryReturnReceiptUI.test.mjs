import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ordersScreen = readFileSync(
  new URL("../app/admin/orders.tsx", import.meta.url),
  "utf8",
);

test("normal failed-delivery physical receipt is not nested inside exchange-only UI", () => {
  const exchangePanel = ordersScreen.indexOf("                    {item.exchangePublicId && (");
  const localCourierPanel = ordersScreen.indexOf(
    "                    {item.shippingZone === ADMIN_LOCAL_DELIVERY_LABEL",
    exchangePanel,
  );
  const receiptLabel = ordersScreen.indexOf(
    "✓ استلام الطرد الراجع وإلغاء البيع وإرجاع المخزون",
  );
  const statusChange = ordersScreen.indexOf("                    {/* Status Change */}", localCourierPanel);

  assert.ok(exchangePanel >= 0, "exchange-specific panel must exist");
  assert.ok(localCourierPanel > exchangePanel, "exchange panel ends before local courier section");
  assert.ok(receiptLabel > localCourierPanel, "receipt button must be OUTSIDE exchange-only panel");
  assert.ok(receiptLabel < statusChange, "receipt button must be visible above the normal status buttons");
  assert.equal(
    ordersScreen.split("✓ استلام الطرد الراجع وإلغاء البيع وإرجاع المخزون").length - 1,
    1,
    "physical receipt action must not be duplicated",
  );
});

test("receipt still requires confirmed physical arrival and uses dedicated API route", () => {
  assert.match(ordersScreen, /failed-delivery-return\/receive/);
  assert.match(ordersScreen, /confirmPhysicalReceipt: true/);
  assert.match(ordersScreen, /setFailedReceiptTarget\(item\)/);
  assert.match(ordersScreen, /failedReturnState === "pending"/);
});
