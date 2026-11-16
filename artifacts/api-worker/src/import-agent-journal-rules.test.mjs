import test from "node:test";
import assert from "node:assert/strict";
import {
  IMPORT_AGENT_CODE,
  IMPORT_FREIGHT_CODE,
  classifyImportJournal,
  importDebitBalanceAllows,
  freightCanSettleAgainstPayable,
} from "./import-agent-journal-rules.ts";

const classify = (fromCode, fromKind, toCode, toKind) =>
  classifyImportJournal(fromCode, fromKind, toCode, toKind);

test("deposit of ILS already delivered to shipping agent is not a bank-to-bank transfer", () => {
  assert.equal(classify("BANK_BOP", "bank", IMPORT_AGENT_CODE, "finance_account"), "fund_agent");
  assert.equal(classify("CASH_MAIN", "cash", IMPORT_AGENT_CODE, "finance_account"), "fund_agent");
});

test("agent remittance extinguishes supplier payable; it does not post inventory again", () => {
  assert.equal(classify(IMPORT_AGENT_CODE, "finance_account", "SUPPLIER_PAYABLE_CONTROL", "supplier"), "pay_supplier");
});

test("freight and clearance have a separate settlement asset, not an expense", () => {
  assert.equal(classify(IMPORT_AGENT_CODE, "finance_account", IMPORT_FREIGHT_CODE, "finance_account"), "pay_freight");
  assert.equal(classify(IMPORT_FREIGHT_CODE, "finance_account", "SUPPLIER_PAYABLE_CONTROL", "supplier"), "settle_freight_on_purchase");
  assert.equal(classify(IMPORT_FREIGHT_CODE, "finance_account", IMPORT_AGENT_CODE, "finance_account"), "refund_freight_to_agent");
});

test("unspent agent money may be returned to real bank or cash", () => {
  assert.equal(classify(IMPORT_AGENT_CODE, "finance_account", "BANK_BOP", "bank"), "refund_to_bank_or_cash");
  assert.equal(classify(IMPORT_AGENT_CODE, "finance_account", "CASH_MAIN", "cash"), "refund_to_bank_or_cash");
});

test("cannot misclassify shipping cost as operating expense or make fake deposits", () => {
  assert.equal(classify(IMPORT_AGENT_CODE, "finance_account", "EXPENSE", "expense"), "invalid");
  assert.equal(classify(IMPORT_FREIGHT_CODE, "finance_account", "EXPENSE", "expense"), "invalid");
  assert.equal(classify("CUSTOMER_CONTROL", "customer", IMPORT_AGENT_CODE, "finance_account"), "invalid");
  assert.equal(classify("BANK_BOP", "bank", IMPORT_FREIGHT_CODE, "finance_account"), "invalid");
  assert.equal(classify(IMPORT_FREIGHT_CODE, "finance_account", "BANK_BOP", "bank"), "invalid");
  assert.equal(classify("BANK_BOP", "bank", "CASH_MAIN", "cash"), null);
});

test("never overdraw agent or freight clearing, including concurrent final balances", () => {
  assert.equal(importDebitBalanceAllows(535273, 499273), true);
  assert.equal(importDebitBalanceAllows(36000, 36000), true);
  assert.equal(importDebitBalanceAllows(35000, 36000), false);
  assert.equal(importDebitBalanceAllows(0, 1), false);
  assert.equal(importDebitBalanceAllows(-1, 1), false);
  assert.equal(importDebitBalanceAllows(1, 0), false);
});

test("fee settlement must match actual outstanding supplier payable", () => {
  assert.equal(freightCanSettleAgainstPayable(36000, 36000), true);
  assert.equal(freightCanSettleAgainstPayable(35999, 36000), false);
  assert.equal(freightCanSettleAgainstPayable(0, 36000), false);
});

test("illustrative shipping agent lifecycle nets to zero with no second inventory debit", () => {
  const importFunding = 499273 + 36000;
  let agent = importFunding;
  let freight = 0;
  agent -= 499273;
  agent -= 36000;
  freight += 36000;
  const supplierPayableAfterSupplierRemittance = 36000;
  assert.equal(freightCanSettleAgainstPayable(supplierPayableAfterSupplierRemittance, 36000), true);
  freight -= 36000;
  assert.deepEqual({agent, freight, supplierPayable: supplierPayableAfterSupplierRemittance - 36000}, {agent: 0, freight: 0, supplierPayable: 0});
});
