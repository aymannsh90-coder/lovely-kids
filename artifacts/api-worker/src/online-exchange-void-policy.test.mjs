import assert from "node:assert/strict";
import test from "node:test";
import { canVoidOnlineExchangeBeforeProcessing } from "./online-exchange-void-policy.ts";

const pending = {
  replacementOrderOrigin: "system_created",
  replacementOrderStatus: "new",
  financialCompletedAt: null,
  returnReceivedAt: null,
};

test("void is allowed for an unprocessed system-created replacement", () => {
  assert.equal(canVoidOnlineExchangeBeforeProcessing(pending), true);
});

test("void is allowed for an unprocessed customer-created replacement", () => {
  assert.equal(canVoidOnlineExchangeBeforeProcessing({
    ...pending,
    replacementOrderOrigin: "existing_order",
  }), true);
});

test("void is refused once replacement processing has started", () => {
  for (const replacementOrderStatus of ["confirmed", "delivering", "done", "cancelled"]) {
    for (const replacementOrderOrigin of ["existing_order", "system_created"]) {
      assert.equal(canVoidOnlineExchangeBeforeProcessing({
        ...pending,
        replacementOrderOrigin,
        replacementOrderStatus,
      }), false);
    }
  }
});

test("void is refused once finances are finalized or the return is received", () => {
  assert.equal(canVoidOnlineExchangeBeforeProcessing({
    ...pending,
    financialCompletedAt: new Date(),
  }), false);
  assert.equal(canVoidOnlineExchangeBeforeProcessing({
    ...pending,
    replacementOrderOrigin: "existing_order",
    returnReceivedAt: new Date(),
  }), false);
});

test("void fails closed for unexpected replacement order origins", () => {
  for (const replacementOrderOrigin of [null, "other"]) {
    assert.equal(canVoidOnlineExchangeBeforeProcessing({
      ...pending,
      replacementOrderOrigin,
    }), false);
  }
});
