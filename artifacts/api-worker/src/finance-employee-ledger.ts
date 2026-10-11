import {
  financeAccountsTable,
  financeTransactionLinesTable,
} from "@workspace/db/schema";
import {
  and,
  eq,
  inArray,
} from "drizzle-orm";

export const EMPLOYEE_ADVANCE_CONTROL_CODE =
  "EMPLOYEE_ADVANCE_CONTROL";

export const EMPLOYEE_PAYABLE_CONTROL_CODE =
  "EMPLOYEE_PAYABLE_CONTROL";

type EmployeeLedgerKind =
  | "employee_advance"
  | "employee_payable";

function positiveEmployeeId(employeeId: number) {
  if (
    !Number.isSafeInteger(employeeId) ||
    employeeId <= 0
  ) {
    throw new Error(
      "FINANCE_EMPLOYEE_ID_INVALID",
    );
  }

  return employeeId;
}

async function findControlAccount(
  db: any,
  code: string,
  expectedType:
    | "asset"
    | "liability",
) {
  const rows =
    await db
      .select()
      .from(financeAccountsTable)
      .where(
        eq(
          financeAccountsTable.code,
          code,
        ),
      )
      .limit(1);

  const account =
    rows[0] ?? null;

  if (
    account &&
    account.accountType !== expectedType
  ) {
    throw new Error(
      "FINANCE_EMPLOYEE_CONTROL_ACCOUNT_TYPE_INVALID",
    );
  }

  return account;
}

async function ensureControlAccount(
  tx: any,
  input: {
    code: string;
    name: string;
    accountType:
      | "asset"
      | "liability";
    notes: string;
  },
) {
  const existing =
    await findControlAccount(
      tx,
      input.code,
      input.accountType,
    );

  if (existing) {
    return existing;
  }

  const insertedRows =
    await tx
      .insert(financeAccountsTable)
      .values({
        code:
          input.code,
        name:
          input.name,
        accountType:
          input.accountType,
        linkedEntityType:
          null,
        linkedEntityId:
          null,
        currencyCode:
          "ILS",
        status:
          "active",
        notes:
          input.notes,
      })
      .onConflictDoNothing()
      .returning();

  if (insertedRows[0]) {
    return insertedRows[0];
  }

  const retry =
    await findControlAccount(
      tx,
      input.code,
      input.accountType,
    );

  if (!retry) {
    throw new Error(
      "FINANCE_EMPLOYEE_CONTROL_ACCOUNT_CREATE_FAILED",
    );
  }

  return retry;
}

export async function ensureEmployeeAdvanceControlAccount(
  tx: any,
) {
  return ensureControlAccount(
    tx,
    {
      code:
        EMPLOYEE_ADVANCE_CONTROL_CODE,
      name:
        "سلف الموظفين - حساب رقابي",
      accountType:
        "asset",
      notes:
        "Control account for employee advances; employee identity is stored on finance transaction lines.",
    },
  );
}

export async function ensureEmployeePayableControlAccount(
  tx: any,
) {
  return ensureControlAccount(
    tx,
    {
      code:
        EMPLOYEE_PAYABLE_CONTROL_CODE,
      name:
        "مستحقات الموظفين - حساب رقابي",
      accountType:
        "liability",
      notes:
        "Control account for employee payables; employee identity is stored on finance transaction lines.",
    },
  );
}

async function legacyEmployeeAccounts(
  db: any,
  employeeId?: number,
) {
  const conditions = [
    inArray(
      financeAccountsTable.linkedEntityType,
      [
        "employee_advance",
        "employee_payable",
      ],
    ),
  ];

  if (employeeId !== undefined) {
    conditions.push(
      eq(
        financeAccountsTable.linkedEntityId,
        employeeId,
      ),
    );
  }

  return db
    .select({
      id:
        financeAccountsTable.id,
      kind:
        financeAccountsTable
          .linkedEntityType,
      employeeId:
        financeAccountsTable
          .linkedEntityId,
    })
    .from(financeAccountsTable)
    .where(
      conditions.length === 1
        ? conditions[0]
        : and(...conditions),
    );
}

export async function employeeLedgerLines(
  db: any,
  rawEmployeeId: number,
) {
  const employeeId =
    positiveEmployeeId(
      rawEmployeeId,
    );

  const legacyAccounts =
    await legacyEmployeeAccounts(
      db,
      employeeId,
    );

  const legacyKindByAccountId =
    new Map<
      number,
      EmployeeLedgerKind
    >();

  for (
    const account of
    legacyAccounts
  ) {
    if (
      account.kind ===
        "employee_advance" ||
      account.kind ===
        "employee_payable"
    ) {
      legacyKindByAccountId.set(
        account.id,
        account.kind,
      );
    }
  }

  const legacyIds =
    [...legacyKindByAccountId.keys()];

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

  const [advanceControl, payableControl] =
    await Promise.all([
      findControlAccount(
        db,
        EMPLOYEE_ADVANCE_CONTROL_CODE,
        "asset",
      ),
      findControlAccount(
        db,
        EMPLOYEE_PAYABLE_CONTROL_CODE,
        "liability",
      ),
    ]);

  const controlParts: Array<{
    line:
      typeof financeTransactionLinesTable.$inferSelect;
    kind:
      EmployeeLedgerKind;
  }> = [];

  if (advanceControl) {
    const lines =
      await db
        .select()
        .from(
          financeTransactionLinesTable,
        )
        .where(
          and(
            eq(
              financeTransactionLinesTable
                .accountId,
              advanceControl.id,
            ),
            eq(
              financeTransactionLinesTable
                .employeeId,
              employeeId,
            ),
          ),
        );

    controlParts.push(
      ...lines.map(
        (
          line:
            typeof financeTransactionLinesTable.$inferSelect,
        ) => ({
          line,
          kind:
            "employee_advance" as const,
        }),
      ),
    );
  }

  if (payableControl) {
    const lines =
      await db
        .select()
        .from(
          financeTransactionLinesTable,
        )
        .where(
          and(
            eq(
              financeTransactionLinesTable
                .accountId,
              payableControl.id,
            ),
            eq(
              financeTransactionLinesTable
                .employeeId,
              employeeId,
            ),
          ),
        );

    controlParts.push(
      ...lines.map(
        (
          line:
            typeof financeTransactionLinesTable.$inferSelect,
        ) => ({
          line,
          kind:
            "employee_payable" as const,
        }),
      ),
    );
  }

  const combined = [
    ...legacyLines.map(
      (
        line:
          typeof financeTransactionLinesTable.$inferSelect,
      ) => ({
        line,
        kind:
          legacyKindByAccountId.get(
            line.accountId,
          )!,
      }),
    ),
    ...controlParts,
  ];

  return combined.sort(
    (left, right) =>
      left.line.id -
      right.line.id,
  );
}

export async function employeeBalancesAll(
  db: any,
) {
  const result =
    new Map<
      number,
      {
        advanceMinor: number;
        payableMinor: number;
      }
    >();

  const legacyAccounts =
    await legacyEmployeeAccounts(
      db,
    );

  const legacyInfoByAccountId =
    new Map<
      number,
      {
        employeeId: number;
        kind:
          EmployeeLedgerKind;
      }
    >();

  for (
    const account of
    legacyAccounts
  ) {
    if (
      account.employeeId !== null &&
      (
        account.kind ===
          "employee_advance" ||
        account.kind ===
          "employee_payable"
      )
    ) {
      legacyInfoByAccountId.set(
        account.id,
        {
          employeeId:
            account.employeeId,
          kind:
            account.kind,
        },
      );
    }
  }

  const legacyIds =
    [...legacyInfoByAccountId.keys()];

  if (legacyIds.length > 0) {
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
      const info =
        legacyInfoByAccountId.get(
          line.accountId,
        );

      if (!info) {
        continue;
      }

      const current =
        result.get(
          info.employeeId,
        ) ?? {
          advanceMinor: 0,
          payableMinor: 0,
        };

      if (
        info.kind ===
        "employee_advance"
      ) {
        current.advanceMinor +=
          line.debitMinor -
          line.creditMinor;
      } else {
        current.payableMinor +=
          line.creditMinor -
          line.debitMinor;
      }

      result.set(
        info.employeeId,
        current,
      );
    }
  }

  const [advanceControl, payableControl] =
    await Promise.all([
      findControlAccount(
        db,
        EMPLOYEE_ADVANCE_CONTROL_CODE,
        "asset",
      ),
      findControlAccount(
        db,
        EMPLOYEE_PAYABLE_CONTROL_CODE,
        "liability",
      ),
    ]);

  for (
    const config of [
      {
        account:
          advanceControl,
        kind:
          "employee_advance" as const,
      },
      {
        account:
          payableControl,
        kind:
          "employee_payable" as const,
      },
    ]
  ) {
    if (!config.account) {
      continue;
    }

    const lines =
      await db
        .select({
          employeeId:
            financeTransactionLinesTable
              .employeeId,
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
            config.account.id,
          ),
        );

    for (
      const line of lines
    ) {
      if (
        line.employeeId ===
        null
      ) {
        continue;
      }

      const current =
        result.get(
          line.employeeId,
        ) ?? {
          advanceMinor: 0,
          payableMinor: 0,
        };

      if (
        config.kind ===
        "employee_advance"
      ) {
        current.advanceMinor +=
          line.debitMinor -
          line.creditMinor;
      } else {
        current.payableMinor +=
          line.creditMinor -
          line.debitMinor;
      }

      result.set(
        line.employeeId,
        current,
      );
    }
  }

  return result;
}

export async function employeeAdvanceBalanceMinor(
  db: any,
  employeeId: number,
) {
  const entries =
    await employeeLedgerLines(
      db,
      employeeId,
    );

  return entries.reduce(
    (total, entry) =>
      entry.kind ===
      "employee_advance"
        ? total +
          entry.line.debitMinor -
          entry.line.creditMinor
        : total,
    0,
  );
}

export async function employeePayableBalanceMinor(
  db: any,
  employeeId: number,
) {
  const entries =
    await employeeLedgerLines(
      db,
      employeeId,
    );

  return entries.reduce(
    (total, entry) =>
      entry.kind ===
      "employee_payable"
        ? total +
          entry.line.creditMinor -
          entry.line.debitMinor
        : total,
    0,
  );
}
