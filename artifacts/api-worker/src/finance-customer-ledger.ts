import {
  financeAccountsTable,
  financeTransactionLinesTable,
} from "@workspace/db/schema";
import {
  and,
  eq,
  inArray,
} from "drizzle-orm";

export const CUSTOMER_RECEIVABLE_CONTROL_CODE =
  "CUSTOMER_RECEIVABLE_CONTROL";

const CUSTOMER_RECEIVABLE_CONTROL_NAME =
  "ذمم الزبائن - حساب رقابي";

function positiveCustomerId(customerId: number) {
  if (
    !Number.isSafeInteger(customerId) ||
    customerId <= 0
  ) {
    throw new Error(
      "FINANCE_CUSTOMER_ID_INVALID",
    );
  }

  return customerId;
}

export async function findCustomerReceivableControlAccount(
  db: any,
) {
  const rows =
    await db
      .select()
      .from(financeAccountsTable)
      .where(
        eq(
          financeAccountsTable.code,
          CUSTOMER_RECEIVABLE_CONTROL_CODE,
        ),
      )
      .limit(1);

  const account =
    rows[0] ?? null;

  if (
    account &&
    account.accountType !== "asset"
  ) {
    throw new Error(
      "FINANCE_CUSTOMER_CONTROL_ACCOUNT_TYPE_INVALID",
    );
  }

  return account;
}

export async function ensureCustomerReceivableControlAccount(
  tx: any,
) {
  const existing =
    await findCustomerReceivableControlAccount(
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
          CUSTOMER_RECEIVABLE_CONTROL_CODE,
        name:
          CUSTOMER_RECEIVABLE_CONTROL_NAME,
        accountType:
          "asset",
        linkedEntityType:
          null,
        linkedEntityId:
          null,
        currencyCode:
          "ILS",
        status:
          "active",
        notes:
          "Control account for customer receivables; customer identity is stored on finance transaction lines.",
      })
      .onConflictDoNothing()
      .returning();

  if (insertedRows[0]) {
    return insertedRows[0];
  }

  const retry =
    await findCustomerReceivableControlAccount(
      tx,
    );

  if (!retry) {
    throw new Error(
      "FINANCE_CUSTOMER_CONTROL_ACCOUNT_CREATE_FAILED",
    );
  }

  return retry;
}

async function legacyCustomerAccountIds(
  db: any,
  customerId: number,
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
            "customer_receivable",
          ),
          eq(
            financeAccountsTable
              .linkedEntityId,
            customerId,
          ),
        ),
      );

  return rows.map(
    (row: { id: number }) =>
      row.id,
  );
}

export async function customerReceivableLedgerLines(
  db: any,
  rawCustomerId: number,
) {
  const customerId =
    positiveCustomerId(
      rawCustomerId,
    );

  const legacyIds =
    await legacyCustomerAccountIds(
      db,
      customerId,
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
    await findCustomerReceivableControlAccount(
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
                  .customerId,
                customerId,
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

export async function customerReceivableBalanceMinor(
  db: any,
  customerId: number,
) {
  const lines =
    await customerReceivableLedgerLines(
      db,
      customerId,
    );

  return lines.reduce(
    (
      total: number,
      line:
        typeof financeTransactionLinesTable.$inferSelect,
    ) =>
      total +
      line.debitMinor -
      line.creditMinor,
    0,
  );
}

export async function customerReceivableBalances(
  db: any,
) {
  const result =
    new Map<number, number>();

  const legacyAccounts =
    await db
      .select({
        id:
          financeAccountsTable.id,
        customerId:
          financeAccountsTable
            .linkedEntityId,
      })
      .from(financeAccountsTable)
      .where(
        eq(
          financeAccountsTable
            .linkedEntityType,
          "customer_receivable",
        ),
      );

  const legacyAccountMap =
    new Map<number, number>();

  for (
    const account of
    legacyAccounts
  ) {
    if (
      account.customerId !==
      null
    ) {
      legacyAccountMap.set(
        account.id,
        account.customerId,
      );
    }
  }

  const legacyIds =
    [...legacyAccountMap.keys()];

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
      const customerId =
        legacyAccountMap.get(
          line.accountId,
        );

      if (
        customerId ===
        undefined
      ) {
        continue;
      }

      result.set(
        customerId,
        (
          result.get(
            customerId,
          ) ?? 0
        ) +
          line.debitMinor -
          line.creditMinor,
      );
    }
  }

  const controlAccount =
    await findCustomerReceivableControlAccount(
      db,
    );

  if (controlAccount) {
    const lines =
      await db
        .select({
          customerId:
            financeTransactionLinesTable
              .customerId,
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
        line.customerId ===
        null
      ) {
        continue;
      }

      result.set(
        line.customerId,
        (
          result.get(
            line.customerId,
          ) ?? 0
        ) +
          line.debitMinor -
          line.creditMinor,
      );
    }
  }

  return result;
}
