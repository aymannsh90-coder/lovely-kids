import {
  financeAccountsTable,
  financeTransactionLinesTable,
  financeTransactionsTable,
} from "@workspace/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  assertPostedSaleCashMatches,
  cashAccountNetMinor,
  cashEditRevisionFromEvent,
} from "./pos-sale-cash-adjustment-rules";

/**
 * Read-only integrity gate, called under the already-locked POS sale row.
 * Reject missing/partial legacy journals instead of silently booking an edit
 * or void that would leave a different balance in the general ledger.
 */
export async function inspectPostedSaleCashLedger(
  tx: any,
  sale: { id: number; publicId: string; totalMinor: number },
) {
  const accounts: Array<typeof financeAccountsTable.$inferSelect> =
    await tx.select().from(financeAccountsTable).where(
      inArray(financeAccountsTable.code, ["CASH_MAIN", "POS_SALES_CASH"]),
    );
  const cash = accounts.find(account => account.code === "CASH_MAIN");
  const sales = accounts.find(account => account.code === "POS_SALES_CASH");
  if (!cash || !sales) {
    throw new Error("POS_CASH_LEDGER_ACCOUNTS_MISSING");
  }

  const transactions: Array<typeof financeTransactionsTable.$inferSelect> =
    await tx.select().from(financeTransactionsTable).where(
      and(
        eq(financeTransactionsTable.sourceType, "pos_sale"),
        eq(financeTransactionsTable.sourceId, String(sale.id)),
        eq(financeTransactionsTable.status, "posted"),
      ),
    ).orderBy(asc(financeTransactionsTable.id)).for("update");

  const originals = transactions.filter(t => t.sourceEvent === "cash_settlement");
  if (originals.length !== 1) {
    throw new Error("POS_CASH_LEDGER_ORIGINAL_MISSING_OR_DUPLICATED");
  }
  const adjustments = transactions.filter(
    t => cashEditRevisionFromEvent(t.sourceEvent) !== null,
  );
  const tracked = [originals[0], ...adjustments];
  const transactionIds = tracked.map(t => t.id);
  const lines: Array<typeof financeTransactionLinesTable.$inferSelect> =
    await tx.select().from(financeTransactionLinesTable).where(
      inArray(financeTransactionLinesTable.transactionId, transactionIds),
    ).orderBy(
      asc(financeTransactionLinesTable.transactionId),
      asc(financeTransactionLinesTable.lineNumber),
    );
  const cashNet = cashAccountNetMinor(lines, cash.id);
  const incomeNet = -cashAccountNetMinor(lines, sales.id);
  assertPostedSaleCashMatches(sale.totalMinor, cashNet, incomeNet);

  const byTransaction = new Map<number, typeof lines>();
  for (const line of lines) {
    const group = byTransaction.get(line.transactionId) ?? [];
    group.push(line);
    byTransaction.set(line.transactionId, group);
  }
  if (tracked.some(t => (byTransaction.get(t.id)?.length ?? 0) < 2)) {
    throw new Error("POS_CASH_LEDGER_LINES_MISSING");
  }

  return {
    cashAccountId: cash.id,
    salesAccountId: sales.id,
    cashNetMinor: cashNet,
    original: originals[0],
    adjustments: adjustments.map(transaction => ({
      transaction,
      lines: byTransaction.get(transaction.id) ?? [],
    })),
  };
}
