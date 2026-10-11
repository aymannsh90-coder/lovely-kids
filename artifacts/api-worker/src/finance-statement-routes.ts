import {
  bankAccountsTable,
  banksTable,
  expenseCategoriesTable,
  financeAccountsTable,
  financeTransactionLinesTable,
  financeTransactionsTable,
} from "@workspace/db/schema";
import {
  and,
  asc,
  eq,
  gte,
  like,
  lt,
  lte,
  sql,
} from "drizzle-orm";

import { getCurrentUser } from "./auth";
import type { Env, openDb } from "./db";

type Db =
  Awaited<ReturnType<typeof openDb>>["db"];

const json = (
  data: unknown,
  status = 200,
) =>
  Response.json(data, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  });

function validDate(
  value: string | null,
): value is string {
  if (
    !value ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const date =
    new Date(`${value}T00:00:00Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date
      .toISOString()
      .slice(0, 10) === value
  );
}

function signedAmount(
  accountType: string,
  debitMinor: number,
  creditMinor: number,
) {
  return (
    accountType === "asset" ||
    accountType === "expense"
      ? debitMinor - creditMinor
      : creditMinor - debitMinor
  );
}

async function requireOwner(
  request: Request,
  db: Db,
  env: Env,
) {
  const user =
    await getCurrentUser(
      db,
      request,
      env,
    );

  if (!user) {
    return {
      ok: false as const,
      response: json(
        {
          error:
            "غير مصرح",
        },
        401,
      ),
    };
  }

  if (!user.isOwner) {
    return {
      ok: false as const,
      response: json(
        {
          error:
            "هذه البيانات متاحة للمالك فقط",
        },
        403,
      ),
    };
  }

  return {
    ok: true as const,
    user,
  };
}

async function handleReference(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth =
    await requireOwner(
      request,
      db,
      env,
    );

  if (!auth.ok) {
    return auth.response;
  }

  const [
    cashAccounts,
    bankAccounts,
    expenseCategories,
  ] = await Promise.all([
    db
      .select({
        id:
          financeAccountsTable.id,
        code:
          financeAccountsTable.code,
        name:
          financeAccountsTable.name,
        currencyCode:
          financeAccountsTable.currencyCode,
        accountType:
          financeAccountsTable.accountType,
      })
      .from(
        financeAccountsTable,
      )
      .where(
        and(
          eq(
            financeAccountsTable.status,
            "active",
          ),
          like(
            financeAccountsTable.code,
            "CASH_%",
          ),
        ),
      )
      .orderBy(
        asc(
          financeAccountsTable.name,
        ),
      ),

    db
      .select({
        id:
          bankAccountsTable.id,
        name:
          bankAccountsTable.name,
        currencyCode:
          bankAccountsTable.currencyCode,
        financeAccountId:
          bankAccountsTable.financeAccountId,
        bankName:
          banksTable.nameAr,
      })
      .from(
        bankAccountsTable,
      )
      .innerJoin(
        banksTable,
        eq(
          bankAccountsTable.bankId,
          banksTable.id,
        ),
      )
      .where(
        eq(
          bankAccountsTable.status,
          "active",
        ),
      )
      .orderBy(
        asc(
          banksTable.nameAr,
        ),
        asc(
          bankAccountsTable.name,
        ),
      ),

    db
      .select({
        id:
          expenseCategoriesTable.id,
        code:
          expenseCategoriesTable.code,
        name:
          expenseCategoriesTable.name,
        financeAccountId:
          expenseCategoriesTable.financeAccountId,
      })
      .from(
        expenseCategoriesTable,
      )
      .where(
        eq(
          expenseCategoriesTable.status,
          "active",
        ),
      )
      .orderBy(
        asc(
          expenseCategoriesTable.name,
        ),
      ),
  ]);

  return json({
    cashAccounts,
    bankAccounts,
    expenseCategories,
  });
}

async function handleAccountStatement(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth =
    await requireOwner(
      request,
      db,
      env,
    );

  if (!auth.ok) {
    return auth.response;
  }

  const url =
    new URL(request.url);

  const accountId =
    Number(
      url.searchParams.get(
        "accountId",
      ),
    );

  const from =
    url.searchParams.get(
      "from",
    );

  const to =
    url.searchParams.get(
      "to",
    );

  if (
    !Number.isSafeInteger(
      accountId,
    ) ||
    accountId <= 0
  ) {
    return json(
      {
        error:
          "الحساب غير صالح",
      },
      400,
    );
  }

  if (
    !validDate(from) ||
    !validDate(to) ||
    from > to
  ) {
    return json(
      {
        error:
          "الفترة الزمنية غير صالحة",
      },
      400,
    );
  }

  const accountRows =
    await db
      .select()
      .from(
        financeAccountsTable,
      )
      .where(
        eq(
          financeAccountsTable.id,
          accountId,
        ),
      )
      .limit(1);

  const account =
    accountRows[0];

  if (!account) {
    return json(
      {
        error:
          "الحساب غير موجود",
      },
      404,
    );
  }

  const openingRows =
    await db
      .select({
        debitMinor:
          sql<number>`coalesce(sum(${financeTransactionLinesTable.debitMinor}), 0)`.mapWith(Number),
        creditMinor:
          sql<number>`coalesce(sum(${financeTransactionLinesTable.creditMinor}), 0)`.mapWith(Number),
      })
      .from(
        financeTransactionLinesTable,
      )
      .innerJoin(
        financeTransactionsTable,
        eq(
          financeTransactionLinesTable.transactionId,
          financeTransactionsTable.id,
        ),
      )
      .where(
        and(
          eq(
            financeTransactionLinesTable.accountId,
            accountId,
          ),
          lt(
            financeTransactionsTable.businessDate,
            from,
          ),
        ),
      );

  const openingDebitMinor =
    openingRows[0]
      ?.debitMinor ?? 0;

  const openingCreditMinor =
    openingRows[0]
      ?.creditMinor ?? 0;

  const openingBalanceMinor =
    signedAmount(
      account.accountType,
      openingDebitMinor,
      openingCreditMinor,
    );

  const rows =
    await db
      .select({
        lineId:
          financeTransactionLinesTable.id,
        lineNumber:
          financeTransactionLinesTable.lineNumber,
        businessDate:
          financeTransactionsTable.businessDate,
        transactionId:
          financeTransactionsTable.id,
        publicId:
          financeTransactionsTable.publicId,
        transactionType:
          financeTransactionsTable.transactionType,
        sourceType:
          financeTransactionsTable.sourceType,
        sourceId:
          financeTransactionsTable.sourceId,
        sourceEvent:
          financeTransactionsTable.sourceEvent,
        status:
          financeTransactionsTable.status,
        transactionNotes:
          financeTransactionsTable.notes,
        createdAt:
          financeTransactionsTable.createdAt,
        debitMinor:
          financeTransactionLinesTable.debitMinor,
        creditMinor:
          financeTransactionLinesTable.creditMinor,
        currencyCode:
          financeTransactionLinesTable.currencyCode,
        currencyAmountMinor:
          financeTransactionLinesTable.currencyAmountMinor,
        exchangeRateMicros:
          financeTransactionLinesTable.exchangeRateMicros,
        memo:
          financeTransactionLinesTable.memo,
      })
      .from(
        financeTransactionLinesTable,
      )
      .innerJoin(
        financeTransactionsTable,
        eq(
          financeTransactionLinesTable.transactionId,
          financeTransactionsTable.id,
        ),
      )
      .where(
        and(
          eq(
            financeTransactionLinesTable.accountId,
            accountId,
          ),
          gte(
            financeTransactionsTable.businessDate,
            from,
          ),
          lte(
            financeTransactionsTable.businessDate,
            to,
          ),
        ),
      )
      .orderBy(
        asc(
          financeTransactionsTable.businessDate,
        ),
        asc(
          financeTransactionsTable.createdAt,
        ),
        asc(
          financeTransactionLinesTable.lineNumber,
        ),
      );

  let runningBalanceMinor =
    openingBalanceMinor;

  let periodDebitMinor = 0;
  let periodCreditMinor = 0;

  const entries =
    rows.map(
      (row) => {
        periodDebitMinor +=
          row.debitMinor;

        periodCreditMinor +=
          row.creditMinor;

        const changeMinor =
          signedAmount(
            account.accountType,
            row.debitMinor,
            row.creditMinor,
          );

        runningBalanceMinor +=
          changeMinor;

        return {
          ...row,
          changeMinor,
          runningBalanceMinor,
        };
      },
    );

  return json({
    account: {
      id:
        account.id,
      code:
        account.code,
      name:
        account.name,
      accountType:
        account.accountType,
      currencyCode:
        account.currencyCode,
    },

    range: {
      from,
      to,
    },

    openingBalanceMinor,
    periodDebitMinor,
    periodCreditMinor,
    closingBalanceMinor:
      runningBalanceMinor,

    entries,
  });
}

export async function handleFinanceStatementRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const url =
    new URL(request.url);

  if (
    request.method === "GET" &&
    url.pathname ===
      "/api/pos/finance/statements/reference"
  ) {
    return handleReference(
      request,
      db,
      env,
    );
  }

  if (
    request.method === "GET" &&
    url.pathname ===
      "/api/pos/finance/statements/account"
  ) {
    return handleAccountStatement(
      request,
      db,
      env,
    );
  }

  return null;
}
