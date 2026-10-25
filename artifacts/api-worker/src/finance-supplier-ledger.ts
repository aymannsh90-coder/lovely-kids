import {
  financeAccountsTable,
  financeTransactionLinesTable,
} from "@workspace/db/schema";
import {
  and,
  eq,
  inArray,
} from "drizzle-orm";

export const SUPPLIER_PAYABLE_CONTROL_CODE =
  "SUPPLIER_PAYABLE_CONTROL";

const SUPPLIER_PAYABLE_CONTROL_NAME =
  "ذمم الموردين - حساب رقابي";

function positiveSupplierId(supplierId: number) {
  if (
    !Number.isSafeInteger(supplierId) ||
    supplierId <= 0
  ) {
    throw new Error(
      "FINANCE_SUPPLIER_ID_INVALID",
    );
  }

  return supplierId;
}

export async function findSupplierPayableControlAccount(
  db: any,
) {
  const rows =
    await db
      .select()
      .from(financeAccountsTable)
      .where(
        eq(
          financeAccountsTable.code,
          SUPPLIER_PAYABLE_CONTROL_CODE,
        ),
      )
      .limit(1);

  const account =
    rows[0] ?? null;

  if (
    account &&
    account.accountType !== "liability"
  ) {
    throw new Error(
      "FINANCE_SUPPLIER_CONTROL_ACCOUNT_TYPE_INVALID",
    );
  }

  return account;
}

export async function ensureSupplierPayableControlAccount(
  tx: any,
) {
  const existing =
    await findSupplierPayableControlAccount(
      tx,
    );

  if (existing) {
    return existing;
  }

  const insertedRows =
    await tx
      .insert(financeAccountsTable)
      .values({
        code:
          SUPPLIER_PAYABLE_CONTROL_CODE,
        name:
          SUPPLIER_PAYABLE_CONTROL_NAME,
        accountType:
          "liability",
        linkedEntityType:
          null,
        linkedEntityId:
          null,
        currencyCode:
          "ILS",
        status:
          "active",
        notes:
          "Control account for supplier payables; supplier identity is stored on finance transaction lines.",
      })
      .onConflictDoNothing()
      .returning();

  if (insertedRows[0]) {
    return insertedRows[0];
  }

  const retry =
    await findSupplierPayableControlAccount(
      tx,
    );

  if (!retry) {
    throw new Error(
      "FINANCE_SUPPLIER_CONTROL_ACCOUNT_CREATE_FAILED",
    );
  }

  return retry;
}

export async function supplierPayableBalances(
  db: any,
) {
  const result =
    new Map<number, number>();

  const legacyAccounts =
    await db
      .select({
        id:
          financeAccountsTable.id,
        supplierId:
          financeAccountsTable
            .linkedEntityId,
      })
      .from(financeAccountsTable)
      .where(
        eq(
          financeAccountsTable
            .linkedEntityType,
          "supplier",
        ),
      );

  const supplierIdByAccountId =
    new Map<number, number>();

  for (
    const account of
    legacyAccounts
  ) {
    if (
      account.supplierId !==
      null
    ) {
      supplierIdByAccountId.set(
        account.id,
        account.supplierId,
      );
    }
  }

  const legacyIds =
    [...supplierIdByAccountId.keys()];

  if (
    legacyIds.length >
    0
  ) {
    const lines =
      await db
        .select({
          accountId:
            financeTransactionLinesTable
              .accountId,
          debitMinor:
            financeTransactionLinesTable
              .debitMinor,
          creditMinor:
            financeTransactionLinesTable
              .creditMinor,
        })
        .from(
          financeTransactionLinesTable,
        )
        .where(
          inArray(
            financeTransactionLinesTable
              .accountId,
            legacyIds,
          ),
        );

    for (
      const line of lines
    ) {
      const supplierId =
        supplierIdByAccountId.get(
          line.accountId,
        );

      if (
        supplierId ===
        undefined
      ) {
        continue;
      }

      result.set(
        supplierId,
        (
          result.get(
            supplierId,
          ) ?? 0
        ) +
          line.creditMinor -
          line.debitMinor,
      );
    }
  }

  const controlAccount =
    await findSupplierPayableControlAccount(
      db,
    );

  if (controlAccount) {
    const lines =
      await db
        .select({
          supplierId:
            financeTransactionLinesTable
              .supplierId,
          debitMinor:
            financeTransactionLinesTable
              .debitMinor,
          creditMinor:
            financeTransactionLinesTable
              .creditMinor,
        })
        .from(
          financeTransactionLinesTable,
        )
        .where(
          eq(
            financeTransactionLinesTable
              .accountId,
            controlAccount.id,
          ),
        );

    for (
      const line of lines
    ) {
      if (
        line.supplierId ===
        null
      ) {
        continue;
      }

      result.set(
        line.supplierId,
        (
          result.get(
            line.supplierId,
          ) ?? 0
        ) +
          line.creditMinor -
          line.debitMinor,
      );
    }
  }

  return result;
}

async function legacySupplierAccountIds(
  db: any,
  supplierId: number,
) {
  const rows =
    await db
      .select({
        id:
          financeAccountsTable.id,
      })
      .from(financeAccountsTable)
      .where(
        and(
          eq(
            financeAccountsTable
              .linkedEntityType,
            "supplier",
          ),
          eq(
            financeAccountsTable
              .linkedEntityId,
            supplierId,
          ),
        ),
      );

  return rows.map(
    (row: { id: number }) =>
      row.id,
  );
}

export async function supplierPayableLedgerLines(
  db: any,
  rawSupplierId: number,
) {
  const supplierId =
    positiveSupplierId(
      rawSupplierId,
    );

  const legacyIds =
    await legacySupplierAccountIds(
      db,
      supplierId,
    );

  const legacyLines =
    legacyIds.length > 0
      ? await db
          .select()
          .from(
            financeTransactionLinesTable,
          )
          .where(
            inArray(
              financeTransactionLinesTable
                .accountId,
              legacyIds,
            ),
          )
      : [];

  const controlAccount =
    await findSupplierPayableControlAccount(
      db,
    );

  const controlLines =
    controlAccount
      ? await db
          .select()
          .from(
            financeTransactionLinesTable,
          )
          .where(
            and(
              eq(
                financeTransactionLinesTable
                  .accountId,
                controlAccount.id,
              ),
              eq(
                financeTransactionLinesTable
                  .supplierId,
                supplierId,
              ),
            ),
          )
      : [];

  return [
    ...legacyLines,
    ...controlLines,
  ].sort(
    (
      left:
        typeof financeTransactionLinesTable.$inferSelect,
      right:
        typeof financeTransactionLinesTable.$inferSelect,
    ) =>
      left.id - right.id,
  );
}

export async function supplierPayableBalanceMinor(
  db: any,
  rawSupplierId: number,
) {
  const supplierId =
    positiveSupplierId(
      rawSupplierId,
    );

  const balances =
    await supplierPayableBalances(
      db,
    );

  return balances.get(
    supplierId,
  ) ?? 0;
}
