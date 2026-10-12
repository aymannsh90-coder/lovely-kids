import {
  bankAccountsTable,
  banksTable,
  cashSessionsTable,
  expenseCategoriesTable,
  exchangeDocumentsTable,
  financeAccountsTable,
  financeTransactionLinesTable,
  financeTransactionsTable,
  posSaleReturnsTable,
  posSalesTable,
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


const palestineDateFormatter =
  new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: "Asia/Hebron",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    },
  );

function palestineDate(
  value: Date,
) {
  const parts =
    palestineDateFormatter
      .formatToParts(value);

  const values =
    Object.fromEntries(
      parts.map((part) => [
        part.type,
        part.value,
      ]),
    );

  return `${values.year}-${values.month}-${values.day}`;
}

interface CashStatementEvent {
  key: string;
  at: Date;
  priority: number;
  publicId: string;
  sourceType: string;
  sourceId: string;
  sourceEvent: string;
  status: string;
  memo: string;
  debitMinor: number;
  creditMinor: number;
  absoluteBalanceMinor?: number;
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

async function handleCashStatement(
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
          "الصندوق غير صالح",
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

  if (
    !account ||
    !account.code.startsWith(
      "CASH_",
    )
  ) {
    return json(
      {
        error:
          "حساب الصندوق غير موجود",
      },
      404,
    );
  }

  const registerKey =
    account.code
      .slice(
        "CASH_".length,
      )
      .toLowerCase();

  const [
    financeRows,
    sessions,
    sales,
    returns,
    exchanges,
  ] =
    await Promise.all([
      db
        .select({
          lineId:
            financeTransactionLinesTable.id,
          lineNumber:
            financeTransactionLinesTable.lineNumber,
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
          eq(
            financeTransactionLinesTable.accountId,
            accountId,
          ),
        ),

      db
        .select()
        .from(
          cashSessionsTable,
        )
        .where(
          eq(
            cashSessionsTable.registerKey,
            registerKey,
          ),
        )
        .orderBy(
          asc(
            cashSessionsTable.openedAt,
          ),
        ),

      db
        .select()
        .from(
          posSalesTable,
        )
        .where(
          eq(
            posSalesTable.registerKey,
            registerKey,
          ),
        ),

      db
        .select()
        .from(
          posSaleReturnsTable,
        )
        .where(
          eq(
            posSaleReturnsTable.registerKey,
            registerKey,
          ),
        ),

      db
        .select()
        .from(
          exchangeDocumentsTable,
        )
        .where(
          eq(
            exchangeDocumentsTable.registerKey,
            registerKey,
          ),
        ),
    ]);

  const events:
    CashStatementEvent[] = [];

  const salePosted =
    new Set<string>();

  const saleVoidPosted =
    new Set<string>();

  const returnPosted =
    new Set<string>();

  const returnVoidPosted =
    new Set<string>();

  const exchangePosted =
    new Set<string>();

  const exchangeVoidPosted =
    new Set<string>();

  for (
    const row of financeRows
  ) {
    if (
      row.sourceType ===
      "pos_sale"
    ) {
      if (
        row.sourceEvent ===
        "cash_settlement"
      ) {
        salePosted.add(
          row.sourceId,
        );
      }

      if (
        row.sourceEvent ===
        "cash_settlement_void"
      ) {
        saleVoidPosted.add(
          row.sourceId,
        );
      }
    }

    if (
      row.sourceType ===
      "pos_sale_return"
    ) {
      if (
        row.sourceEvent ===
        "cash_refund"
      ) {
        returnPosted.add(
          row.sourceId,
        );
      }

      if (
        row.sourceEvent ===
        "cash_refund_void"
      ) {
        returnVoidPosted.add(
          row.sourceId,
        );
      }
    }

    if (
      row.sourceType ===
      "exchange"
    ) {
      if (
        row.sourceEvent ===
        "cash_settlement"
      ) {
        exchangePosted.add(
          row.sourceId,
        );
      }

      if (
        row.sourceEvent ===
        "cash_settlement_void"
      ) {
        exchangeVoidPosted.add(
          row.sourceId,
        );
      }
    }

    events.push({
      key:
        `finance:${row.lineId}`,
      at:
        row.createdAt,
      priority: 1,
      publicId:
        row.publicId,
      sourceType:
        row.sourceType,
      sourceId:
        row.sourceId,
      sourceEvent:
        row.sourceEvent,
      status:
        row.status,
      memo:
        row.memo ||
        row.transactionNotes ||
        `${row.sourceType} / ${row.sourceEvent}`,
      debitMinor:
        row.debitMinor,
      creditMinor:
        row.creditMinor,
    });
  }

  for (
    const sale of sales
  ) {
    const cashMinor =
      sale.paymentMethod ===
      "cash"
        ? sale.totalMinor
        : sale.paymentMethod ===
            "mixed"
          ? sale.paidMinor -
            sale.changeMinor
          : 0;

    if (
      cashMinor <= 0
    ) {
      continue;
    }

    const sourceId =
      String(
        sale.id,
      );

    if (
      !salePosted.has(
        sourceId,
      )
    ) {
      events.push({
        key:
          `legacy-sale:${sale.id}`,
        at:
          sale.createdAt,
        priority: 1,
        publicId:
          sale.publicId,
        sourceType:
          "pos_sale",
        sourceId,
        sourceEvent:
          "legacy_cash_sale",
        status:
          sale.status,
        memo:
          `بيع نقدي — فاتورة ${sale.publicId}`,
        debitMinor:
          cashMinor,
        creditMinor: 0,
      });
    }

    if (
      sale.status ===
        "voided" &&
      sale.voidedAt &&
      !saleVoidPosted.has(
        sourceId,
      )
    ) {
      events.push({
        key:
          `legacy-sale-void:${sale.id}`,
        at:
          sale.voidedAt,
        priority: 1,
        publicId:
          `VOID-${sale.publicId}`,
        sourceType:
          "pos_sale",
        sourceId,
        sourceEvent:
          "legacy_cash_sale_void",
        status:
          "posted",
        memo:
          `إلغاء بيع نقدي — فاتورة ${sale.publicId}`,
        debitMinor: 0,
        creditMinor:
          cashMinor,
      });
    }
  }

  for (
    const saleReturn of returns
  ) {
    if (
      saleReturn.refundMethod !==
        "cash" ||
      saleReturn.refundAmountMinor <=
        0
    ) {
      continue;
    }

    const sourceId =
      String(
        saleReturn.id,
      );

    if (
      !returnPosted.has(
        sourceId,
      )
    ) {
      events.push({
        key:
          `legacy-return:${saleReturn.id}`,
        at:
          saleReturn.createdAt,
        priority: 1,
        publicId:
          saleReturn.publicId,
        sourceType:
          "pos_sale_return",
        sourceId,
        sourceEvent:
          "legacy_cash_refund",
        status:
          saleReturn.status,
        memo:
          `مردود مبيعات نقدي — ${saleReturn.publicId}`,
        debitMinor: 0,
        creditMinor:
          saleReturn.refundAmountMinor,
      });
    }

    if (
      saleReturn.status ===
        "voided" &&
      saleReturn.voidedAt &&
      !returnVoidPosted.has(
        sourceId,
      )
    ) {
      events.push({
        key:
          `legacy-return-void:${saleReturn.id}`,
        at:
          saleReturn.voidedAt,
        priority: 1,
        publicId:
          `VOID-${saleReturn.publicId}`,
        sourceType:
          "pos_sale_return",
        sourceId,
        sourceEvent:
          "legacy_cash_refund_void",
        status:
          "posted",
        memo:
          `إلغاء مردود نقدي — ${saleReturn.publicId}`,
        debitMinor:
          saleReturn.refundAmountMinor,
        creditMinor: 0,
      });
    }
  }

  for (
    const exchange of exchanges
  ) {
    if (
      exchange.settlementType !==
        "cash" ||
      exchange.settlementAmountMinor ===
        0
    ) {
      continue;
    }

    const sourceId =
      String(
        exchange.id,
      );

    const amountMinor =
      Math.abs(
        exchange.settlementAmountMinor,
      );

    if (
      !exchangePosted.has(
        sourceId,
      )
    ) {
      events.push({
        key:
          `legacy-exchange:${exchange.id}`,
        at:
          exchange.createdAt,
        priority: 1,
        publicId:
          exchange.publicId,
        sourceType:
          "exchange",
        sourceId,
        sourceEvent:
          "legacy_cash_settlement",
        status:
          exchange.status,
        memo:
          exchange.settlementAmountMinor >
          0
            ? `تحصيل فرق تبديل نقدي — ${exchange.publicId}`
            : `رد فرق تبديل نقدي — ${exchange.publicId}`,
        debitMinor:
          exchange.settlementAmountMinor >
          0
            ? amountMinor
            : 0,
        creditMinor:
          exchange.settlementAmountMinor <
          0
            ? amountMinor
            : 0,
      });
    }

    if (
      exchange.status ===
        "voided" &&
      exchange.voidedAt &&
      !exchangeVoidPosted.has(
        sourceId,
      )
    ) {
      events.push({
        key:
          `legacy-exchange-void:${exchange.id}`,
        at:
          exchange.voidedAt,
        priority: 1,
        publicId:
          `VOID-${exchange.publicId}`,
        sourceType:
          "exchange",
        sourceId,
        sourceEvent:
          "legacy_cash_settlement_void",
        status:
          "posted",
        memo:
          `إلغاء فرق تبديل نقدي — ${exchange.publicId}`,
        debitMinor:
          exchange.settlementAmountMinor <
          0
            ? amountMinor
            : 0,
        creditMinor:
          exchange.settlementAmountMinor >
          0
            ? amountMinor
            : 0,
      });
    }
  }

  for (
    const session of sessions
  ) {
    events.push({
      key:
        `session-open:${session.id}`,
      at:
        session.openedAt,
      priority: 0,
      publicId:
        `CASH-OPEN-${session.id}`,
      sourceType:
        "cash_session",
      sourceId:
        String(
          session.id,
        ),
      sourceEvent:
        "opening_balance",
      status:
        session.status,
      memo:
        `تثبيت رصيد افتتاح جلسة الصندوق #${session.id}`,
      debitMinor: 0,
      creditMinor: 0,
      absoluteBalanceMinor:
        session.openingBalanceMinor,
    });

    if (
      session.closedAt &&
      session.closingBalanceMinor !==
        null
    ) {
      events.push({
        key:
          `session-close:${session.id}`,
        at:
          session.closedAt,
        priority: 2,
        publicId:
          `CASH-CLOSE-${session.id}`,
        sourceType:
          "cash_session",
        sourceId:
          String(
            session.id,
        ),
        sourceEvent:
          "closing_count",
        status:
          session.status,
        memo:
          `تثبيت الجرد الفعلي عند إغلاق جلسة الصندوق #${session.id}`,
        debitMinor: 0,
        creditMinor: 0,
        absoluteBalanceMinor:
          session.closingBalanceMinor,
      });
    }
  }

  events.sort(
    (left, right) =>
      left.at.getTime() -
        right.at.getTime() ||
      left.priority -
        right.priority ||
      left.key.localeCompare(
        right.key,
      ),
  );

  let runningBalanceMinor =
    0;

  let openingBalanceMinor =
    0;

  let openingCaptured =
    false;

  let periodDebitMinor = 0;
  let periodCreditMinor = 0;

  let syntheticLineId =
    -1;

  const entries:
    Array<{
      lineId: number;
      lineNumber: number;
      businessDate: string;
      transactionId: number;
      publicId: string;
      transactionType: string;
      sourceType: string;
      sourceId: string;
      sourceEvent: string;
      status: string;
      transactionNotes: string | null;
      createdAt: string;
      debitMinor: number;
      creditMinor: number;
      currencyCode: null;
      currencyAmountMinor: null;
      exchangeRateMicros: null;
      memo: string;
      changeMinor: number;
      runningBalanceMinor: number;
    }> = [];

  for (
    const event of events
  ) {
    const eventDate =
      palestineDate(
        event.at,
      );

    if (
      !openingCaptured &&
      eventDate >= from
    ) {
      openingBalanceMinor =
        runningBalanceMinor;

      openingCaptured =
        true;
    }

    let changeMinor =
      event.debitMinor -
      event.creditMinor;

    if (
      event.absoluteBalanceMinor !==
      undefined
    ) {
      changeMinor =
        event.absoluteBalanceMinor -
        runningBalanceMinor;
    }

    const debitMinor =
      changeMinor > 0
        ? changeMinor
        : 0;

    const creditMinor =
      changeMinor < 0
        ? -changeMinor
        : 0;

    runningBalanceMinor +=
      changeMinor;

    if (
      eventDate < from ||
      eventDate > to ||
      changeMinor === 0
    ) {
      continue;
    }

    periodDebitMinor +=
      debitMinor;

    periodCreditMinor +=
      creditMinor;

    entries.push({
      lineId:
        syntheticLineId--,
      lineNumber: 1,
      businessDate:
        eventDate,
      transactionId: 0,
      publicId:
        event.publicId,
      transactionType:
        "cash_movement",
      sourceType:
        event.sourceType,
      sourceId:
        event.sourceId,
      sourceEvent:
        event.sourceEvent,
      status:
        event.status,
      transactionNotes: null,
      createdAt:
        event.at.toISOString(),
      debitMinor,
      creditMinor,
      currencyCode: null,
      currencyAmountMinor: null,
      exchangeRateMicros: null,
      memo:
        event.memo,
      changeMinor,
      runningBalanceMinor,
    });
  }

  if (
    !openingCaptured
  ) {
    openingBalanceMinor =
      runningBalanceMinor;
  }

  const closingBalanceMinor =
    openingBalanceMinor +
    periodDebitMinor -
    periodCreditMinor;

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
    closingBalanceMinor,
    entries,
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
      "/api/pos/finance/statements/cash"
  ) {
    return handleCashStatement(
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
