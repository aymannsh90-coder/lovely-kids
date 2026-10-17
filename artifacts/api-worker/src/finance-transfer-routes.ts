import {
  cashSessionsTable,
  financeAccountsTable,
  financeCurrenciesTable,
  financeTransactionLinesTable,
  financeTransactionsTable,
} from "@workspace/db/schema";
import {
  and,
  asc,
  desc,
  eq,
  like,
  sql,
} from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getCurrentUser } from "./auth";
import { openDb, type Env } from "./db";
import { postFinanceTransaction } from "./finance-posting";

type Db =
  Awaited<ReturnType<typeof openDb>>["db"];

const MAX_MINOR = 2_147_483_647;

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

const json = (
  data: unknown,
  status = 200,
) =>
  new Response(
    JSON.stringify(data),
    {
      status,
      headers,
    },
  );

class FinanceTransferError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function requiredText(
  value: unknown,
  field: string,
  maxLength: number,
) {
  if (typeof value !== "string") {
    throw new FinanceTransferError(
      `${field} مطلوب`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new FinanceTransferError(
      `${field} مطلوب`,
    );
  }

  if (normalized.length > maxLength) {
    throw new FinanceTransferError(
      `${field} طويل جدًا`,
    );
  }

  return normalized;
}

function optionalText(
  value: unknown,
  maxLength: number,
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (typeof value !== "string") {
    throw new FinanceTransferError(
      "القيمة النصية غير صالحة",
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  if (normalized.length > maxLength) {
    throw new FinanceTransferError(
      "القيمة النصية طويلة جدًا",
    );
  }

  return normalized;
}

function positiveId(
  value: unknown,
  field: string,
) {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" &&
          value.trim()
        ? Number(value)
        : NaN;

  if (
    !Number.isSafeInteger(numeric) ||
    numeric <= 0
  ) {
    throw new FinanceTransferError(
      `${field} غير صالح`,
    );
  }

  return numeric;
}

function moneyMinor(
  value: unknown,
) {
  const normalized =
    typeof value === "number"
      ? String(value)
      : typeof value === "string"
        ? value.trim().replace(",", ".")
        : "";

  const match =
    /^(\d+)(?:\.(\d{1,2}))?$/.exec(
      normalized,
    );

  if (!match) {
    throw new FinanceTransferError(
      "المبلغ غير صالح",
    );
  }

  const whole =
    Number(match[1]);

  const fraction =
    Number(
      (match[2] ?? "")
        .padEnd(2, "0"),
    );

  const minor =
    whole * 100 + fraction;

  if (
    !Number.isSafeInteger(minor) ||
    minor <= 0 ||
    minor > MAX_MINOR
  ) {
    throw new FinanceTransferError(
      "المبلغ خارج الحد المسموح",
    );
  }

  return minor;
}

function currentPalestineDate() {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "Asia/Hebron",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    },
  ).format(new Date());
}

function isCashAccount(
  account: {
    code: string;
  },
) {
  return account.code.startsWith(
    "CASH_",
  );
}

function registerKeyForCash(
  account: {
    code: string;
  },
) {
  return account.code
    .slice("CASH_".length)
    .toLowerCase();
}

function convertedBaseMinor(
  currencyAmountMinor: number,
  exchangeRateMicros: number,
) {
  const rounded =
    (
      BigInt(currencyAmountMinor) *
        BigInt(exchangeRateMicros) +
      500_000n
    ) /
    1_000_000n;

  if (
    rounded <= 0n ||
    rounded > BigInt(MAX_MINOR)
  ) {
    throw new FinanceTransferError(
      "قيمة التحويل بعد تحويل العملة خارج الحد المسموح",
    );
  }

  return Number(rounded);
}

type PosUser = NonNullable<
  Awaited<
    ReturnType<typeof getCurrentUser>
  >
>;

async function requireOwner(
  request: Request,
  db: Db,
  env: Env,
): Promise<
  | {
      ok: true;
      user: PosUser;
    }
  | {
      ok: false;
      response: Response;
    }
> {
  const user =
    await getCurrentUser(
      db,
      request,
      env,
    );

  if (!user) {
    return {
      ok: false,
      response: json(
        {
          error:
            "يجب تسجيل الدخول",
        },
        401,
      ),
    };
  }

  if (!user.isOwner) {
    return {
      ok: false,
      response: json(
        {
          error:
            "هذه العملية للمالك فقط",
        },
        403,
      ),
    };
  }

  return {
    ok: true,
    user,
  };
}

async function loadAccount(
  tx: any,
  accountId: number,
) {
  const rows =
    await tx
      .select()
      .from(
        financeAccountsTable,
      )
      .where(
        and(
          eq(
            financeAccountsTable.id,
            accountId,
          ),
          eq(
            financeAccountsTable.status,
            "active",
          ),
        ),
      )
      .limit(1);

  const account = rows[0];

  if (
    !account ||
    account.accountType !== "asset" ||
    !(
      account.code.startsWith(
        "CASH_",
      ) ||
      account.linkedEntityType ===
        "bank_account"
    )
  ) {
    throw new FinanceTransferError(
      "الحساب المالي غير موجود أو غير صالح للتحويل",
      404,
    );
  }

  return account;
}

async function accountBalanceMinor(
  tx: any,
  account: {
    id: number;
    currencyCode: string;
  },
) {
  if (
    account.currencyCode ===
    "ILS"
  ) {
    const rows =
      await tx
        .select({
          balanceMinor:
            sql<number>`
              coalesce(
                sum(
                  ${financeTransactionLinesTable.debitMinor}
                  -
                  ${financeTransactionLinesTable.creditMinor}
                ),
                0
              )::integer
            `,
        })
        .from(
          financeTransactionLinesTable,
        )
        .where(
          eq(
            financeTransactionLinesTable.accountId,
            account.id,
          ),
        );

    return (
      rows[0]?.balanceMinor ??
      0
    );
  }

  const rows =
    await tx
      .select({
        balanceMinor:
          sql<number>`
            coalesce(
              sum(
                case
                  when ${financeTransactionLinesTable.currencyAmountMinor} is null
                    then 0
                  when ${financeTransactionLinesTable.debitMinor} > 0
                    then ${financeTransactionLinesTable.currencyAmountMinor}
                  else -${financeTransactionLinesTable.currencyAmountMinor}
                end
              ),
              0
            )::integer
          `,
      })
      .from(
        financeTransactionLinesTable,
      )
      .where(
        eq(
          financeTransactionLinesTable.accountId,
          account.id,
        ),
      );

  return (
    rows[0]?.balanceMinor ??
    0
  );
}

async function assertForeignAccountBookHistoryComplete(
  tx: any,
  account: {
    id: number;
    name: string;
    currencyCode: string;
  },
) {
  if (
    account.currencyCode ===
    "ILS"
  ) {
    return;
  }

  const rows =
    await tx
      .select({
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
      })
      .from(
        financeTransactionLinesTable,
      )
      .where(
        eq(
          financeTransactionLinesTable.accountId,
          account.id,
        ),
      );

  const incomplete =
    rows.some(
      (
        line: {
          debitMinor: number;
          creditMinor: number;
          currencyCode: string | null;
          currencyAmountMinor: number | null;
          exchangeRateMicros: number | null;
        },
      ) => {
        const baseMinor =
          line.debitMinor >
            0
            ? line.debitMinor
            : line.creditMinor;

        if (baseMinor <= 0) {
          return false;
        }

        if (
          line.currencyCode !==
            account.currencyCode ||
          line.currencyAmountMinor ===
            null ||
          line.currencyAmountMinor <=
            0 ||
          line.exchangeRateMicros ===
            null ||
          line.exchangeRateMicros <=
            0
        ) {
          return true;
        }

        const reproducedBase =
          (
            BigInt(
              line.currencyAmountMinor,
            ) *
              BigInt(
                line.exchangeRateMicros,
              ) +
            500_000n
          ) /
          1_000_000n;

        return (
          reproducedBase !==
          BigInt(baseMinor)
        );
      },
    );

  if (incomplete) {
    throw new FinanceTransferError(
      `السجل الدفتري لـ ${account.name} يحتوي حركة قديمة لا تتطابق فيها قيمة العملة وسعر الصرف مع قيمة القيد بالشيكل؛ لا يمكن احتساب متوسط القيمة الدفترية بأمان.`,
      409,
    );
  }
}

async function accountBaseBalanceMinor(
  tx: any,
  accountId: number,
) {
  const rows =
    await tx
      .select({
        balanceMinor:
          sql<number>`
            coalesce(
              sum(
                ${financeTransactionLinesTable.debitMinor}
                -
                ${financeTransactionLinesTable.creditMinor}
              ),
              0
            )::integer
          `,
      })
      .from(
        financeTransactionLinesTable,
      )
      .where(
        eq(
          financeTransactionLinesTable.accountId,
          accountId,
        ),
      );

  return (
    rows[0]?.balanceMinor ??
    0
  );
}

function rateMicrosFromAmounts(
  baseAmountMinor: number,
  currencyAmountMinor: number,
) {
  if (
    baseAmountMinor <= 0 ||
    currencyAmountMinor <= 0
  ) {
    throw new FinanceTransferError(
      "تعذر احتساب سعر الصرف من المبالغ المدخلة",
      409,
    );
  }

  const rounded =
    (
      BigInt(
        baseAmountMinor,
      ) *
        1_000_000n +
      BigInt(
        Math.floor(
          currencyAmountMinor /
          2,
        ),
      )
    ) /
    BigInt(
      currencyAmountMinor,
    );

  if (
    rounded <= 0n ||
    rounded >
      BigInt(
        MAX_MINOR,
      )
  ) {
    throw new FinanceTransferError(
      "سعر الصرف الناتج خارج الحد المسموح",
      409,
    );
  }

  return Number(
    rounded,
  );
}

function exactRateMicrosFromAmounts(
  baseAmountMinor: number,
  currencyAmountMinor: number,
) {
  const candidate =
    rateMicrosFromAmounts(
      baseAmountMinor,
      currencyAmountMinor,
    );

  const candidates = [
    candidate,
    candidate - 1,
    candidate + 1,
  ].filter(
    (value) =>
      Number.isSafeInteger(
        value,
      ) &&
      value > 0 &&
      value <= MAX_MINOR,
  );

  for (const rateMicros of candidates) {
    if (
      convertedBaseMinor(
        currencyAmountMinor,
        rateMicros,
      ) ===
      baseAmountMinor
    ) {
      return rateMicros;
    }
  }

  throw new FinanceTransferError(
    "تعذر تمثيل سعر الصرف بدقة كافية لمطابقة قيمة القيد بالشيكل؛ عدّل المبلغ المستلم/المصروف قليلًا ثم أعد المحاولة.",
    409,
  );
}

function proportionalBaseMinor(
  totalBaseMinor: number,
  partCurrencyMinor: number,
  totalCurrencyMinor: number,
) {
  if (
    totalBaseMinor <= 0 ||
    partCurrencyMinor <= 0 ||
    totalCurrencyMinor <= 0 ||
    partCurrencyMinor >
      totalCurrencyMinor
  ) {
    throw new FinanceTransferError(
      "القيمة الدفترية للعملة غير مكتملة",
      409,
    );
  }

  const rounded =
    (
      BigInt(
        totalBaseMinor,
      ) *
        BigInt(
          partCurrencyMinor,
        ) +
      BigInt(
        Math.floor(
          totalCurrencyMinor /
          2,
        ),
      )
    ) /
    BigInt(
      totalCurrencyMinor,
    );

  if (
    rounded <= 0n ||
    rounded >
      BigInt(
        MAX_MINOR,
      )
  ) {
    throw new FinanceTransferError(
      "القيمة الدفترية الناتجة خارج الحد المسموح",
      409,
    );
  }

  return Number(
    rounded,
  );
}

async function requireCurrencyCashSession(
  tx: any,
  account: {
    code: string;
    name: string;
    currencyCode: string;
  },
  businessDate: string,
) {
  if (!isCashAccount(account)) {
    throw new FinanceTransferError(
      "تحويل العملات في هذه المرحلة متاح بين الصناديق النقدية فقط",
      409,
    );
  }

  const session =
    await openCashSession(
      tx,
      account,
    );

  if (!session) {
    throw new FinanceTransferError(
      `يجب فتح جلسة ${account.name} قبل تحويل العملة`,
      409,
    );
  }

  if (
    session.businessDate !==
      businessDate
  ) {
    throw new FinanceTransferError(
      `جلسة ${account.name} مفتوحة بتاريخ ${session.businessDate}. أغلقها وافتح جلسة اليوم ${businessDate}.`,
      409,
    );
  }

  return session;
}

async function ensureFxDifferenceAccount(
  tx: any,
  kind:
    | "gain"
    | "loss",
) {
  const config =
    kind === "gain"
      ? {
          code:
            "FX_GAIN_REALIZED",
          name:
            "أرباح فروقات العملة المحققة",
          accountType:
            "income",
        }
      : {
          code:
            "FX_LOSS_REALIZED",
          name:
            "خسائر فروقات العملة المحققة",
          accountType:
            "expense",
        };

  const existingRows =
    await tx
      .select()
      .from(
        financeAccountsTable,
      )
      .where(
        eq(
          financeAccountsTable.code,
          config.code,
        ),
      )
      .limit(1);

  const existing =
    existingRows[0] ??
    null;

  if (existing) {
    if (
      existing.accountType !==
        config.accountType ||
      existing.currencyCode !==
        "ILS" ||
      existing.status !==
        "active"
    ) {
      throw new FinanceTransferError(
        `حساب ${config.name} موجود بإعدادات غير متوافقة`,
        409,
      );
    }

    return existing;
  }

  const rows =
    await tx
      .insert(
        financeAccountsTable,
      )
      .values({
        code:
          config.code,
        name:
          config.name,
        accountType:
          config.accountType,
        currencyCode:
          "ILS",
        status:
          "active",
        notes:
          "أنشئ تلقائيًا لمسار تحويل العملات",
      })
      .returning();

  const account =
    rows[0];

  if (!account) {
    throw new Error(
      "FX_DIFFERENCE_ACCOUNT_CREATE_FAILED",
    );
  }

  return account;
}

async function openCashSession(
  tx: any,
  account: {
    code: string;
    currencyCode: string;
  },
) {
  if (!isCashAccount(account)) {
    return null;
  }

  const registerKey =
    registerKeyForCash(
      account,
    );

  const rows =
    await tx
      .select()
      .from(
        cashSessionsTable,
      )
      .where(
        and(
          eq(
            cashSessionsTable.registerKey,
            registerKey,
          ),
          eq(
            cashSessionsTable.status,
            "open",
          ),
        ),
      )
      .orderBy(
        desc(
          cashSessionsTable.openedAt,
        ),
      )
      .limit(1);

  const session =
    rows[0] ?? null;

  if (
    account.code ===
      "CASH_MAIN" &&
    !session
  ) {
    throw new FinanceTransferError(
      "يجب فتح جلسة الصندوق الرئيسي قبل تنفيذ التحويل",
      409,
    );
  }

  if (
    session &&
    session.currencyCode !==
      account.currencyCode
  ) {
    throw new FinanceTransferError(
      "عملة جلسة الصندوق لا تطابق عملة الحساب",
      409,
    );
  }

  return session;
}

async function availableMinor(
  tx: any,
  account: {
    id: number;
    code: string;
    currencyCode: string;
  },
  session:
    | typeof cashSessionsTable.$inferSelect
    | null,
) {
  if (session) {
    const expectedBalanceMinor =
      session.expectedBalanceMinor;

    if (
      expectedBalanceMinor ===
      null
    ) {
      throw new FinanceTransferError(
        "رصيد الصندوق المتوقع غير متاح",
        409,
      );
    }

    return expectedBalanceMinor;
  }

  return accountBalanceMinor(
    tx,
    account,
  );
}

async function updateCashSession(
  tx: any,
  session:
    typeof cashSessionsTable.$inferSelect,
  deltaMinor: number,
) {
  const expectedBefore =
    session.expectedBalanceMinor;

  if (
    expectedBefore ===
    null
  ) {
    throw new FinanceTransferError(
      "رصيد الصندوق المتوقع غير متاح",
      409,
    );
  }

  const next =
    expectedBefore +
    deltaMinor;

  if (
    !Number.isSafeInteger(next) ||
    next < 0 ||
    next > MAX_MINOR
  ) {
    throw new FinanceTransferError(
      "رصيد الصندوق المتوقع لا يسمح بهذه الحركة",
      409,
    );
  }

  const rows =
    await tx
      .update(
        cashSessionsTable,
      )
      .set({
        expectedBalanceMinor:
          next,
        updatedAt:
          new Date(),
      })
      .where(
        and(
          eq(
            cashSessionsTable.id,
            session.id,
          ),
          eq(
            cashSessionsTable.status,
            "open",
          ),
          eq(
            cashSessionsTable.expectedBalanceMinor,
            expectedBefore,
          ),
        ),
      )
      .returning({
        id:
          cashSessionsTable.id,
        expectedBalanceMinor:
          cashSessionsTable.expectedBalanceMinor,
      });

  if (!rows[0]) {
    throw new FinanceTransferError(
      "تغير رصيد الصندوق أثناء تنفيذ العملية، أعد المحاولة",
      409,
    );
  }

  return rows[0];
}

async function handleListCashAccounts(
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

  const accounts =
    await db
      .select()
      .from(
        financeAccountsTable,
      )
      .where(
        and(
          eq(
            financeAccountsTable.status,
            "active",
          ),
          eq(
            financeAccountsTable.accountType,
            "asset",
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
      );

  const results = [];

  for (const account of accounts) {
    const session =
      await openCashSession(
        db,
        account,
      ).catch((caught) => {
        if (
          caught instanceof
            FinanceTransferError &&
          account.code ===
            "CASH_MAIN"
        ) {
          return null;
        }

        throw caught;
      });

    const bookBalanceMinor =
      await accountBalanceMinor(
        db,
        account,
      );

    results.push({
      id: account.id,
      code: account.code,
      name: account.name,
      registerKey:
        registerKeyForCash(
          account,
        ),
      currencyCode:
        account.currencyCode,
      bookBalanceMinor,
      operationalBalanceMinor:
        session
          ? session
              .expectedBalanceMinor ??
            session
              .openingBalanceMinor
          : bookBalanceMinor,
      balanceSource:
        session
          ? "cash_session"
          : "ledger",
      cashSessionId:
        session?.id ?? null,
    });
  }

  return json({
    results,
  });
}

async function handleCreateCashAccount(
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

  const body =
    (await request
      .json()
      .catch(() => null)) as
      | Record<string, unknown>
      | null;

  if (!body) {
    return json(
      {
        error:
          "بيانات الصندوق غير صالحة",
      },
      400,
    );
  }

  try {
    const name =
      requiredText(
        body.name,
        "اسم الصندوق",
        160,
      );

    const currency =
      typeof body.currencyCode ===
        "string"
        ? body.currencyCode
            .trim()
            .toUpperCase()
        : "ILS";

    const notes =
      optionalText(
        body.notes,
        1000,
      );

    if (
      !/^[A-Z]{3}$/.test(
        currency,
      )
    ) {
      throw new FinanceTransferError(
        "رمز العملة غير صالح",
      );
    }

    const result =
      await db.transaction(
        async (tx) => {
          const currencyRows =
            await tx
              .select()
              .from(
                financeCurrenciesTable,
              )
              .where(
                and(
                  eq(
                    financeCurrenciesTable.code,
                    currency,
                  ),
                  eq(
                    financeCurrenciesTable.status,
                    "active",
                  ),
                ),
              )
              .limit(1);

          if (!currencyRows[0]) {
            throw new FinanceTransferError(
              "العملة غير موجودة أو غير فعالة",
              404,
            );
          }

          const suffix =
            randomUUID()
              .replaceAll("-", "")
              .slice(0, 8)
              .toUpperCase();

          const rows =
            await tx
              .insert(
                financeAccountsTable,
              )
              .values({
                code:
                  `CASH_SUB_${suffix}`,
                name,
                accountType:
                  "asset",
                currencyCode:
                  currency,
                status:
                  "active",
                notes,
              })
              .returning();

          const account =
            rows[0];

          if (!account) {
            throw new Error(
              "CASH_ACCOUNT_CREATE_FAILED",
            );
          }

          return account;
        },
      );

    return json(
      {
        account: result,
      },
      201,
    );
  } catch (caught) {
    if (
      caught instanceof
      FinanceTransferError
    ) {
      return json(
        {
          error:
            caught.message,
        },
        caught.status,
      );
    }

    console.error(
      "CASH_ACCOUNT_CREATE_FAILED",
      caught,
    );

    return json(
      {
        error:
          "تعذر إنشاء الصندوق",
      },
      500,
    );
  }
}

async function handleListCurrencyConversions(
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

  const rows =
    await db
      .select({
        transaction:
          financeTransactionsTable,
        line:
          financeTransactionLinesTable,
        account:
          financeAccountsTable,
      })
      .from(
        financeTransactionsTable,
      )
      .innerJoin(
        financeTransactionLinesTable,
        eq(
          financeTransactionLinesTable.transactionId,
          financeTransactionsTable.id,
        ),
      )
      .innerJoin(
        financeAccountsTable,
        eq(
          financeAccountsTable.id,
          financeTransactionLinesTable.accountId,
        ),
      )
      .where(
        and(
          eq(
            financeTransactionsTable.sourceType,
            "currency_conversion",
          ),
          eq(
            financeTransactionsTable.sourceEvent,
            "posted",
          ),
          eq(
            financeTransactionsTable.transactionType,
            "transfer",
          ),
        ),
      )
      .orderBy(
        desc(
          financeTransactionsTable.createdAt,
        ),
        asc(
          financeTransactionLinesTable.lineNumber,
        ),
      );

  const grouped =
    new Map<
      number,
      {
        transaction:
          typeof financeTransactionsTable.$inferSelect;
        source:
          | {
              id: number;
              code: string;
              name: string;
              currencyCode: string;
            }
          | null;
        destination:
          | {
              id: number;
              code: string;
              name: string;
              currencyCode: string;
            }
          | null;
        fromAmountMinor: number;
        toAmountMinor: number;
        sourceBookBaseMinor: number;
        destinationBaseMinor: number;
        fxDifferenceMinor: number;
        actualRateMicros: number;
      }
    >();

  for (const row of rows) {
    let item =
      grouped.get(
        row.transaction.id,
      );

    if (!item) {
      item = {
        transaction:
          row.transaction,
        source: null,
        destination: null,
        fromAmountMinor:
          0,
        toAmountMinor:
          0,
        sourceBookBaseMinor:
          0,
        destinationBaseMinor:
          0,
        fxDifferenceMinor:
          0,
        actualRateMicros:
          0,
      };

      grouped.set(
        row.transaction.id,
        item,
      );
    }

    if (
      row.account.code.startsWith(
        "CASH_",
      )
    ) {
      const account = {
        id:
          row.account.id,
        code:
          row.account.code,
        name:
          row.account.name,
        currencyCode:
          row.account.currencyCode,
      };

      if (
        row.line.creditMinor >
        0
      ) {
        item.source =
          account;
        item.fromAmountMinor =
          row.line
            .currencyAmountMinor ??
          row.line.creditMinor;
        item.sourceBookBaseMinor =
          row.line.creditMinor;
      }

      if (
        row.line.debitMinor >
        0
      ) {
        item.destination =
          account;
        item.toAmountMinor =
          row.line
            .currencyAmountMinor ??
          row.line.debitMinor;
        item.destinationBaseMinor =
          row.line.debitMinor;
      }
    }

    if (
      row.account.code ===
        "FX_GAIN_REALIZED"
    ) {
      item.fxDifferenceMinor =
        row.line.creditMinor;
    }

    if (
      row.account.code ===
        "FX_LOSS_REALIZED"
    ) {
      item.fxDifferenceMinor =
        -row.line.debitMinor;
    }
  }

  const results =
    Array.from(
      grouped.values(),
    ).map((item) => {
      let actualRateMicros =
        0;

      if (
        item.source &&
        item.destination
      ) {
        if (
          item.source.currencyCode ===
            "ILS" &&
          item.destination.currencyCode !==
            "ILS"
        ) {
          actualRateMicros =
            rateMicrosFromAmounts(
              item.sourceBookBaseMinor,
              item.toAmountMinor,
            );
        } else if (
          item.source.currencyCode !==
            "ILS" &&
          item.destination.currencyCode ===
            "ILS"
        ) {
          actualRateMicros =
            rateMicrosFromAmounts(
              item.destinationBaseMinor,
              item.fromAmountMinor,
            );
        }
      }

      return {
        ...item,
        actualRateMicros,
      };
    });

  return json({
    results,
  });
}

async function handleCreateCurrencyConversion(
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

  const body =
    (await request
      .json()
      .catch(() => null)) as
      | Record<string, unknown>
      | null;

  if (!body) {
    return json(
      {
        error:
          "بيانات تحويل العملة غير صالحة",
      },
      400,
    );
  }

  try {
    const idempotencyKey =
      requiredText(
        body.idempotencyKey,
        "مفتاح منع التكرار",
        160,
      );

    if (
      idempotencyKey.length < 8
    ) {
      throw new FinanceTransferError(
        "مفتاح منع التكرار قصير جدًا",
      );
    }

    const fromAccountId =
      positiveId(
        body.fromAccountId,
        "صندوق العملة المصدر",
      );

    const toAccountId =
      positiveId(
        body.toAccountId,
        "صندوق العملة الوجهة",
      );

    if (
      fromAccountId ===
      toAccountId
    ) {
      throw new FinanceTransferError(
        "صندوق المصدر والوجهة لا يمكن أن يكونا نفس الصندوق",
      );
    }

    const fromAmountMinor =
      moneyMinor(
        body.fromAmount,
      );

    const toAmountMinor =
      moneyMinor(
        body.toAmount,
      );

    const notes =
      optionalText(
        body.notes,
        1000,
      );

    const result =
      await db.transaction(
        async (tx) => {
          const duplicateRows =
            await tx
              .select()
              .from(
                financeTransactionsTable,
              )
              .where(
                eq(
                  financeTransactionsTable.idempotencyKey,
                  idempotencyKey,
                ),
              )
              .limit(1);

          const duplicate =
            duplicateRows[0];

          if (duplicate) {
            if (
              duplicate.sourceType !==
              "currency_conversion"
            ) {
              throw new FinanceTransferError(
                "مفتاح منع التكرار مستخدم في حركة مالية أخرى",
                409,
              );
            }

            return {
              alreadyCreated:
                true,
              transaction:
                duplicate,
            };
          }

          const fromAccount =
            await loadAccount(
              tx,
              fromAccountId,
            );

          const toAccount =
            await loadAccount(
              tx,
              toAccountId,
            );

          if (
            !isCashAccount(
              fromAccount,
            ) ||
            !isCashAccount(
              toAccount,
            )
          ) {
            throw new FinanceTransferError(
              "تحويل العملات في هذه المرحلة متاح بين الصناديق النقدية فقط",
              409,
            );
          }

          if (
            fromAccount.currencyCode ===
            toAccount.currencyCode
          ) {
            throw new FinanceTransferError(
              "استخدم التحويل العادي للحسابات التي تحمل نفس العملة",
              409,
            );
          }

          const hasIlsSide =
            fromAccount.currencyCode ===
              "ILS" ||
            toAccount.currencyCode ===
              "ILS";

          if (!hasIlsSide) {
            throw new FinanceTransferError(
              "التحويل المباشر بين عملتين أجنبيتين غير متاح حاليًا؛ حوّل عبر الشيكل",
              409,
            );
          }

          const businessDate =
            currentPalestineDate();

          const fromSession =
            await requireCurrencyCashSession(
              tx,
              fromAccount,
              businessDate,
            );

          const toSession =
            await requireCurrencyCashSession(
              tx,
              toAccount,
              businessDate,
            );

          const available =
            await availableMinor(
              tx,
              fromAccount,
              fromSession,
            );

          if (
            available <
            fromAmountMinor
          ) {
            throw new FinanceTransferError(
              `الرصيد المتاح في ${fromAccount.name} لا يكفي لتنفيذ تحويل العملة`,
              409,
            );
          }

          if (
            fromAccount.currencyCode ===
              "ILS"
          ) {
            const sourceGlBaseBalance =
              await accountBaseBalanceMinor(
                tx,
                fromAccount.id,
              );

            if (
              sourceGlBaseBalance <
              fromAmountMinor
            ) {
              throw new FinanceTransferError(
                `الرصيد الدفتري في GL لحساب ${fromAccount.name} لا يكفي لتنفيذ تحويل العملة`,
                409,
              );
            }
          }

          let sourceBookBaseMinor =
            fromAmountMinor;
          let destinationBaseMinor =
            fromAmountMinor;
          let sourceRateMicros =
            1_000_000;
          let destinationRateMicros =
            1_000_000;
          let actualRateMicros =
            1_000_000;
          let fxDifferenceMinor =
            0;

          if (
            fromAccount.currencyCode ===
              "ILS"
          ) {
            destinationBaseMinor =
              fromAmountMinor;

            destinationRateMicros =
              exactRateMicrosFromAmounts(
                destinationBaseMinor,
                toAmountMinor,
              );

            actualRateMicros =
              destinationRateMicros;
          } else {
            await assertForeignAccountBookHistoryComplete(
              tx,
              fromAccount,
            );

            const sourceNativeBookBalance =
              await accountBalanceMinor(
                tx,
                fromAccount,
              );

            const sourceBaseBookBalance =
              await accountBaseBalanceMinor(
                tx,
                fromAccount.id,
              );

            if (
              sourceNativeBookBalance <=
                0 ||
              sourceBaseBookBalance <=
                0 ||
              sourceNativeBookBalance <
                fromAmountMinor
            ) {
              throw new FinanceTransferError(
                "القيمة الدفترية لصندوق العملة الأجنبية غير مكتملة؛ لا يمكن احتساب فرق العملة بأمان",
                409,
              );
            }

            sourceBookBaseMinor =
              proportionalBaseMinor(
                sourceBaseBookBalance,
                fromAmountMinor,
                sourceNativeBookBalance,
              );

            sourceRateMicros =
              exactRateMicrosFromAmounts(
                sourceBookBaseMinor,
                fromAmountMinor,
              );

            destinationBaseMinor =
              toAmountMinor;

            actualRateMicros =
              rateMicrosFromAmounts(
                destinationBaseMinor,
                fromAmountMinor,
              );

            fxDifferenceMinor =
              destinationBaseMinor -
              sourceBookBaseMinor;
          }

          const publicId =
            `FXC-${businessDate.replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;

          const lines: Array<{
            accountId: number;
            currencyCode?: string;
            currencyAmountMinor?: number;
            exchangeRateMicros?: number;
            debitMinor?: number;
            creditMinor?: number;
            memo?: string;
          }> = [
            {
              accountId:
                toAccount.id,
              currencyCode:
                toAccount.currencyCode,
              currencyAmountMinor:
                toAmountMinor,
              exchangeRateMicros:
                destinationRateMicros,
              debitMinor:
                destinationBaseMinor,
              creditMinor:
                0,
              memo:
                `استلام ${toAmountMinor / 100} ${toAccount.currencyCode} في ${toAccount.name}`,
            },
            {
              accountId:
                fromAccount.id,
              currencyCode:
                fromAccount.currencyCode,
              currencyAmountMinor:
                fromAmountMinor,
              exchangeRateMicros:
                sourceRateMicros,
              debitMinor:
                0,
              creditMinor:
                sourceBookBaseMinor,
              memo:
                `صرف ${fromAmountMinor / 100} ${fromAccount.currencyCode} من ${fromAccount.name}`,
            },
          ];

          if (
            fxDifferenceMinor >
            0
          ) {
            const gainAccount =
              await ensureFxDifferenceAccount(
                tx,
                "gain",
              );

            lines.push({
              accountId:
                gainAccount.id,
              currencyCode:
                "ILS",
              currencyAmountMinor:
                fxDifferenceMinor,
              exchangeRateMicros:
                1_000_000,
              debitMinor:
                0,
              creditMinor:
                fxDifferenceMinor,
              memo:
                "ربح محقق من تحويل عملة",
            });
          } else if (
            fxDifferenceMinor <
            0
          ) {
            const lossMinor =
              Math.abs(
                fxDifferenceMinor,
              );

            const lossAccount =
              await ensureFxDifferenceAccount(
                tx,
                "loss",
              );

            lines.push({
              accountId:
                lossAccount.id,
              currencyCode:
                "ILS",
              currencyAmountMinor:
                lossMinor,
              exchangeRateMicros:
                1_000_000,
              debitMinor:
                lossMinor,
              creditMinor:
                0,
              memo:
                "خسارة محققة من تحويل عملة",
            });
          }

          const posting =
            await postFinanceTransaction(
              tx,
              {
                publicId,
                idempotencyKey,
                businessDate,
                transactionType:
                  "transfer",
                sourceType:
                  "currency_conversion",
                sourceId:
                  publicId,
                sourceEvent:
                  "posted",
                cashSessionId:
                  null,
                notes:
                  notes
                    ? `تحويل عملة من ${fromAccount.name} إلى ${toAccount.name}: ${notes}`
                    : `تحويل عملة من ${fromAccount.name} إلى ${toAccount.name}`,
                createdByUserId:
                  auth.user.id,
                lines,
              },
            );

          if (
            posting.alreadyPosted
          ) {
            return {
              alreadyCreated:
                true,
              transaction:
                posting.transaction,
            };
          }

          await updateCashSession(
            tx,
            fromSession,
            -fromAmountMinor,
          );

          await updateCashSession(
            tx,
            toSession,
            toAmountMinor,
          );

          return {
            alreadyCreated:
              false,
            transaction:
              posting.transaction,
            fromAccount,
            toAccount,
            fromAmountMinor,
            toAmountMinor,
            sourceBookBaseMinor,
            destinationBaseMinor,
            actualRateMicros,
            fxDifferenceMinor,
          };
        },
      );

    return json(
      result,
      result.alreadyCreated
        ? 200
        : 201,
    );
  } catch (caught) {
    if (
      caught instanceof
        FinanceTransferError
    ) {
      return json(
        {
          error:
            caught.message,
        },
        caught.status,
      );
    }

    console.error(
      "CURRENCY_CONVERSION_CREATE_FAILED",
      caught,
    );

    return json(
      {
        error:
          "تعذر تنفيذ تحويل العملة",
      },
      500,
    );
  }
}

async function handleReverseCurrencyConversion(
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

  const body =
    (await request
      .json()
      .catch(() => null)) as
      | Record<string, unknown>
      | null;

  if (!body) {
    return json(
      {
        error:
          "بيانات عكس تحويل العملة غير صالحة",
      },
      400,
    );
  }

  try {
    const publicId =
      requiredText(
        body.publicId,
        "رقم تحويل العملة",
        100,
      );

    const reason =
      requiredText(
        body.reason,
        "سبب العكس",
        500,
      );

    const result =
      await db.transaction(
        async (tx) => {
          const transactionRows =
            await tx
              .select()
              .from(
                financeTransactionsTable,
              )
              .where(
                and(
                  eq(
                    financeTransactionsTable.publicId,
                    publicId,
                  ),
                  eq(
                    financeTransactionsTable.sourceType,
                    "currency_conversion",
                  ),
                  eq(
                    financeTransactionsTable.sourceEvent,
                    "posted",
                  ),
                  eq(
                    financeTransactionsTable.transactionType,
                    "transfer",
                  ),
                ),
              )
              .limit(1)
              .for("update");

          const original =
            transactionRows[0];

          if (!original) {
            throw new FinanceTransferError(
              "تحويل العملة غير موجود",
              404,
            );
          }

          if (
            original.status ===
            "reversed"
          ) {
            return {
              alreadyReversed:
                true,
              transaction:
                original,
            };
          }

          const joinedLines =
            await tx
              .select({
                line:
                  financeTransactionLinesTable,
                account:
                  financeAccountsTable,
              })
              .from(
                financeTransactionLinesTable,
              )
              .innerJoin(
                financeAccountsTable,
                eq(
                  financeAccountsTable.id,
                  financeTransactionLinesTable.accountId,
                ),
              )
              .where(
                eq(
                  financeTransactionLinesTable.transactionId,
                  original.id,
                ),
              )
              .orderBy(
                asc(
                  financeTransactionLinesTable.lineNumber,
                ),
              );

          const sourceRow =
            joinedLines.find(
              (row) =>
                row.account.code.startsWith(
                  "CASH_",
                ) &&
                row.line.creditMinor >
                  0,
            );

          const destinationRow =
            joinedLines.find(
              (row) =>
                row.account.code.startsWith(
                  "CASH_",
                ) &&
                row.line.debitMinor >
                  0,
            );

          if (
            !sourceRow ||
            !destinationRow ||
            !sourceRow.line
              .currencyAmountMinor ||
            !destinationRow.line
              .currencyAmountMinor
          ) {
            throw new FinanceTransferError(
              "تفاصيل تحويل العملة المحاسبية غير مكتملة",
              409,
            );
          }

          const businessDate =
            currentPalestineDate();

          if (
            original.businessDate !==
            businessDate
          ) {
            throw new FinanceTransferError(
              "عكس تحويل العملة متاح في نفس يوم العمل فقط وقبل إغلاق الصناديق",
              409,
            );
          }

          const sourceSession =
            await requireCurrencyCashSession(
              tx,
              sourceRow.account,
              businessDate,
            );

          const destinationSession =
            await requireCurrencyCashSession(
              tx,
              destinationRow.account,
              businessDate,
            );

          if (
            sourceSession.openedAt.getTime() >
              original.createdAt.getTime() ||
            destinationSession.openedAt.getTime() >
              original.createdAt.getTime()
          ) {
            throw new FinanceTransferError(
              "جلسة أحد الصناديق الحالية ليست نفس الجلسة التي نُفذ فيها تحويل العملة",
              409,
            );
          }

          const fromAmountMinor =
            sourceRow.line
              .currencyAmountMinor;

          const toAmountMinor =
            destinationRow.line
              .currencyAmountMinor;

          const destinationAvailable =
            await availableMinor(
              tx,
              destinationRow.account,
              destinationSession,
            );

          if (
            destinationAvailable <
            toAmountMinor
          ) {
            throw new FinanceTransferError(
              `الرصيد المتاح في ${destinationRow.account.name} لا يكفي لعكس تحويل العملة`,
              409,
            );
          }

          const reversalPublicId =
            `REV-${original.publicId}-${randomUUID().slice(0, 4).toUpperCase()}`;

          const posting =
            await postFinanceTransaction(
              tx,
              {
                publicId:
                  reversalPublicId,
                idempotencyKey:
                  `currency-conversion:${original.id}:reverse`,
                businessDate,
                transactionType:
                  "reversal",
                sourceType:
                  "currency_conversion",
                sourceId:
                  original.sourceId,
                sourceEvent:
                  "reversed",
                cashSessionId:
                  null,
                notes:
                  `عكس ${original.publicId}: ${reason}`,
                createdByUserId:
                  auth.user.id,
                lines:
                  joinedLines.map(
                    (row) => ({
                      accountId:
                        row.line.accountId,
                      customerId:
                        row.line.customerId,
                      employeeId:
                        row.line.employeeId,
                      supplierId:
                        row.line.supplierId,
                      currencyCode:
                        row.line.currencyCode,
                      currencyAmountMinor:
                        row.line.currencyAmountMinor,
                      exchangeRateMicros:
                        row.line.exchangeRateMicros,
                      debitMinor:
                        row.line.creditMinor,
                      creditMinor:
                        row.line.debitMinor,
                      memo:
                        `عكس: ${row.line.memo ?? original.publicId}`,
                    }),
                  ),
              },
            );

          await tx
            .update(
              financeTransactionsTable,
            )
            .set({
              status:
                "reversed",
              updatedAt:
                new Date(),
            })
            .where(
              eq(
                financeTransactionsTable.id,
                original.id,
              ),
            );

          await updateCashSession(
            tx,
            sourceSession,
            fromAmountMinor,
          );

          await updateCashSession(
            tx,
            destinationSession,
            -toAmountMinor,
          );

          return {
            alreadyReversed:
              posting.alreadyPosted,
            transaction:
              original,
            reversal:
              posting.transaction,
          };
        },
      );

    return json(
      result,
    );
  } catch (caught) {
    if (
      caught instanceof
        FinanceTransferError
    ) {
      return json(
        {
          error:
            caught.message,
        },
        caught.status,
      );
    }

    console.error(
      "CURRENCY_CONVERSION_REVERSE_FAILED",
      caught,
    );

    return json(
      {
        error:
          "تعذر عكس تحويل العملة",
      },
      500,
    );
  }
}

async function handleListTransfers(
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

  const rows =
    await db
      .select({
        transaction:
          financeTransactionsTable,
        line:
          financeTransactionLinesTable,
        account:
          financeAccountsTable,
      })
      .from(
        financeTransactionsTable,
      )
      .innerJoin(
        financeTransactionLinesTable,
        eq(
          financeTransactionLinesTable.transactionId,
          financeTransactionsTable.id,
        ),
      )
      .innerJoin(
        financeAccountsTable,
        eq(
          financeAccountsTable.id,
          financeTransactionLinesTable.accountId,
        ),
      )
      .where(
        and(
          eq(
            financeTransactionsTable.sourceType,
            "finance_transfer",
          ),
          eq(
            financeTransactionsTable.sourceEvent,
            "posted",
          ),
          eq(
            financeTransactionsTable.transactionType,
            "transfer",
          ),
        ),
      )
      .orderBy(
        desc(
          financeTransactionsTable.createdAt,
        ),
        asc(
          financeTransactionLinesTable.lineNumber,
        ),
      );

  const grouped =
    new Map<
      number,
      {
        transaction:
          typeof financeTransactionsTable.$inferSelect;
        source:
          | {
              id: number;
              code: string;
              name: string;
              currencyCode: string;
            }
          | null;
        destination:
          | {
              id: number;
              code: string;
              name: string;
              currencyCode: string;
            }
          | null;
        amountMinor: number;
        baseAmountMinor: number;
        exchangeRateMicros: number;
      }
    >();

  for (const row of rows) {
    let item =
      grouped.get(
        row.transaction.id,
      );

    if (!item) {
      item = {
        transaction:
          row.transaction,
        source: null,
        destination: null,
        amountMinor: 0,
        baseAmountMinor: 0,
        exchangeRateMicros:
          1_000_000,
      };

      grouped.set(
        row.transaction.id,
        item,
      );
    }

    const account = {
      id:
        row.account.id,
      code:
        row.account.code,
      name:
        row.account.name,
      currencyCode:
        row.account.currencyCode,
    };

    if (
      row.line.creditMinor > 0
    ) {
      item.source =
        account;
      item.amountMinor =
        row.line
          .currencyAmountMinor ??
        row.line.creditMinor;
      item.baseAmountMinor =
        row.line.creditMinor;
      item.exchangeRateMicros =
        row.line
          .exchangeRateMicros ??
        1_000_000;
    }

    if (
      row.line.debitMinor > 0
    ) {
      item.destination =
        account;

      if (
        item.amountMinor === 0
      ) {
        item.amountMinor =
          row.line
            .currencyAmountMinor ??
          row.line.debitMinor;
        item.baseAmountMinor =
          row.line.debitMinor;
        item.exchangeRateMicros =
          row.line
            .exchangeRateMicros ??
          1_000_000;
      }
    }
  }

  return json({
    results:
      Array.from(
        grouped.values(),
      ),
  });
}

async function handleCreateTransfer(
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

  const body =
    (await request
      .json()
      .catch(() => null)) as
      | Record<string, unknown>
      | null;

  if (!body) {
    return json(
      {
        error:
          "بيانات التحويل غير صالحة",
      },
      400,
    );
  }

  try {
    const idempotencyKey =
      requiredText(
        body.idempotencyKey,
        "مفتاح منع التكرار",
        160,
      );

    if (
      idempotencyKey.length < 8
    ) {
      throw new FinanceTransferError(
        "مفتاح منع التكرار قصير جدًا",
      );
    }

    const fromAccountId =
      positiveId(
        body.fromAccountId,
        "الحساب المصدر",
      );

    const toAccountId =
      positiveId(
        body.toAccountId,
        "الحساب الوجهة",
      );

    if (
      fromAccountId ===
      toAccountId
    ) {
      throw new FinanceTransferError(
        "الحساب المصدر والوجهة لا يمكن أن يكونا نفس الحساب",
      );
    }

    const amountMinor =
      moneyMinor(
        body.amount,
      );

    const notes =
      optionalText(
        body.notes,
        1000,
      );

    const result =
      await db.transaction(
        async (tx) => {
          const duplicateRows =
            await tx
              .select()
              .from(
                financeTransactionsTable,
              )
              .where(
                eq(
                  financeTransactionsTable.idempotencyKey,
                  idempotencyKey,
                ),
              )
              .limit(1);

          const duplicate =
            duplicateRows[0];

          if (duplicate) {
            if (
              duplicate.sourceType !==
              "finance_transfer"
            ) {
              throw new FinanceTransferError(
                "مفتاح منع التكرار مستخدم في حركة مالية أخرى",
                409,
              );
            }

            return {
              alreadyCreated:
                true,
              transaction:
                duplicate,
            };
          }

          const fromAccount =
            await loadAccount(
              tx,
              fromAccountId,
            );

          const toAccount =
            await loadAccount(
              tx,
              toAccountId,
            );

          if (
            fromAccount.currencyCode !==
            toAccount.currencyCode
          ) {
            throw new FinanceTransferError(
              "التحويل المباشر متاح حاليًا بين حسابات بنفس العملة فقط",
            );
          }

          let exchangeRateMicros =
            1_000_000;

          let baseAmountMinor =
            amountMinor;

          if (
            fromAccount.currencyCode !==
            "ILS"
          ) {
            await assertForeignAccountBookHistoryComplete(
              tx,
              fromAccount,
            );

            const sourceNativeBookBalance =
              await accountBalanceMinor(
                tx,
                fromAccount,
              );

            const sourceBaseBookBalance =
              await accountBaseBalanceMinor(
                tx,
                fromAccount.id,
              );

            if (
              sourceNativeBookBalance <=
                0 ||
              sourceBaseBookBalance <=
                0 ||
              sourceNativeBookBalance <
                amountMinor
            ) {
              throw new FinanceTransferError(
                `القيمة الدفترية في ${fromAccount.name} لا تكفي لتنفيذ التحويل بأمان`,
                409,
              );
            }

            baseAmountMinor =
              proportionalBaseMinor(
                sourceBaseBookBalance,
                amountMinor,
                sourceNativeBookBalance,
              );

            exchangeRateMicros =
              exactRateMicrosFromAmounts(
                baseAmountMinor,
                amountMinor,
              );
          }

          const fromSession =
            await openCashSession(
              tx,
              fromAccount,
            );

          const toSession =
            await openCashSession(
              tx,
              toAccount,
            );

          const available =
            await availableMinor(
              tx,
              fromAccount,
              fromSession,
            );

          if (
            available <
            amountMinor
          ) {
            throw new FinanceTransferError(
              `الرصيد المتاح في ${fromAccount.name} لا يكفي لتنفيذ التحويل`,
              409,
            );
          }

          const businessDate =
            currentPalestineDate();

          const publicId =
            `TRF-${businessDate.replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;

          const sessionIds =
            [
              fromSession?.id,
              toSession?.id,
            ].filter(
              (
                value,
              ): value is number =>
                typeof value ===
                "number",
            );

          const posting =
            await postFinanceTransaction(
              tx,
              {
                publicId,
                idempotencyKey,
                businessDate,
                transactionType:
                  "transfer",
                sourceType:
                  "finance_transfer",
                sourceId:
                  publicId,
                sourceEvent:
                  "posted",
                cashSessionId:
                  sessionIds.length ===
                  1
                    ? sessionIds[0]
                    : null,
                notes:
                  notes
                    ? `تحويل من ${fromAccount.name} إلى ${toAccount.name}: ${notes}`
                    : `تحويل من ${fromAccount.name} إلى ${toAccount.name}`,
                createdByUserId:
                  auth.user.id,
                lines: [
                  {
                    accountId:
                      toAccount.id,
                    currencyCode:
                      toAccount.currencyCode,
                    currencyAmountMinor:
                      amountMinor,
                    exchangeRateMicros,
                    debitMinor:
                      baseAmountMinor,
                    creditMinor:
                      0,
                    memo:
                      `تحويل إلى ${toAccount.name}`,
                  },
                  {
                    accountId:
                      fromAccount.id,
                    currencyCode:
                      fromAccount.currencyCode,
                    currencyAmountMinor:
                      amountMinor,
                    exchangeRateMicros,
                    debitMinor:
                      0,
                    creditMinor:
                      baseAmountMinor,
                    memo:
                      `تحويل من ${fromAccount.name}`,
                  },
                ],
              },
            );

          if (
            posting.alreadyPosted
          ) {
            return {
              alreadyCreated:
                true,
              transaction:
                posting.transaction,
            };
          }

          if (fromSession) {
            await updateCashSession(
              tx,
              fromSession,
              -amountMinor,
            );
          }

          if (toSession) {
            await updateCashSession(
              tx,
              toSession,
              amountMinor,
            );
          }

          return {
            alreadyCreated:
              false,
            transaction:
              posting.transaction,
            fromAccount,
            toAccount,
            amountMinor,
            baseAmountMinor,
            exchangeRateMicros,
          };
        },
      );

    return json(
      result,
      result.alreadyCreated
        ? 200
        : 201,
    );
  } catch (caught) {
    if (
      caught instanceof
      FinanceTransferError
    ) {
      return json(
        {
          error:
            caught.message,
        },
        caught.status,
      );
    }

    console.error(
      "FINANCE_TRANSFER_CREATE_FAILED",
      caught,
    );

    return json(
      {
        error:
          "تعذر تنفيذ التحويل المالي",
      },
      500,
    );
  }
}

async function handleReverseTransfer(
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

  const body =
    (await request
      .json()
      .catch(() => null)) as
      | Record<string, unknown>
      | null;

  if (!body) {
    return json(
      {
        error:
          "بيانات عكس التحويل غير صالحة",
      },
      400,
    );
  }

  try {
    const publicId =
      requiredText(
        body.publicId,
        "رقم التحويل",
        100,
      );

    const reason =
      requiredText(
        body.reason,
        "سبب العكس",
        500,
      );

    const result =
      await db.transaction(
        async (tx) => {
          const transactionRows =
            await tx
              .select()
              .from(
                financeTransactionsTable,
              )
              .where(
                and(
                  eq(
                    financeTransactionsTable.publicId,
                    publicId,
                  ),
                  eq(
                    financeTransactionsTable.sourceType,
                    "finance_transfer",
                  ),
                  eq(
                    financeTransactionsTable.sourceEvent,
                    "posted",
                  ),
                  eq(
                    financeTransactionsTable.transactionType,
                    "transfer",
                  ),
                ),
              )
              .limit(1);

          const original =
            transactionRows[0];

          if (!original) {
            throw new FinanceTransferError(
              "التحويل غير موجود",
              404,
            );
          }

          if (
            original.status ===
            "reversed"
          ) {
            return {
              alreadyReversed:
                true,
              transaction:
                original,
            };
          }

          const lines =
            await tx
              .select()
              .from(
                financeTransactionLinesTable,
              )
              .where(
                eq(
                  financeTransactionLinesTable.transactionId,
                  original.id,
                ),
              )
              .orderBy(
                asc(
                  financeTransactionLinesTable.lineNumber,
                ),
              );

          const sourceLine =
            lines.find(
              (line) =>
                line.creditMinor >
                0,
            );

          const destinationLine =
            lines.find(
              (line) =>
                line.debitMinor >
                0,
            );

          if (
            !sourceLine ||
            !destinationLine
          ) {
            throw new FinanceTransferError(
              "تفاصيل التحويل المحاسبية غير مكتملة",
              409,
            );
          }

          const sourceAccount =
            await loadAccount(
              tx,
              sourceLine.accountId,
            );

          const destinationAccount =
            await loadAccount(
              tx,
              destinationLine.accountId,
            );

          const amountMinor =
            destinationLine
              .currencyAmountMinor ??
            sourceLine
              .currencyAmountMinor;

          if (
            !amountMinor ||
            amountMinor <= 0
          ) {
            throw new FinanceTransferError(
              "مبلغ التحويل الأصلي غير صالح",
              409,
            );
          }

          const sourceSession =
            await openCashSession(
              tx,
              sourceAccount,
            );

          const destinationSession =
            await openCashSession(
              tx,
              destinationAccount,
            );

          const reversalSourceAvailable =
            await availableMinor(
              tx,
              destinationAccount,
              destinationSession,
            );

          if (
            reversalSourceAvailable <
            amountMinor
          ) {
            throw new FinanceTransferError(
              `الرصيد المتاح في ${destinationAccount.name} لا يكفي لعكس التحويل`,
              409,
            );
          }

          const businessDate =
            currentPalestineDate();

          const reversalPublicId =
            `REV-${original.publicId}-${randomUUID().slice(0, 4).toUpperCase()}`;

          const sessionIds =
            [
              sourceSession?.id,
              destinationSession?.id,
            ].filter(
              (
                value,
              ): value is number =>
                typeof value ===
                "number",
            );

          const posting =
            await postFinanceTransaction(
              tx,
              {
                publicId:
                  reversalPublicId,
                idempotencyKey:
                  `finance-transfer:${original.id}:reverse`,
                businessDate,
                transactionType:
                  "reversal",
                sourceType:
                  "finance_transfer",
                sourceId:
                  original.sourceId,
                sourceEvent:
                  "reversed",
                cashSessionId:
                  sessionIds.length ===
                  1
                    ? sessionIds[0]
                    : null,
                notes:
                  `عكس ${original.publicId}: ${reason}`,
                createdByUserId:
                  auth.user.id,
                lines:
                  lines.map(
                    (line) => ({
                      accountId:
                        line.accountId,
                      customerId:
                        line.customerId,
                      employeeId:
                        line.employeeId,
                      supplierId:
                        line.supplierId,
                      currencyCode:
                        line.currencyCode,
                      currencyAmountMinor:
                        line.currencyAmountMinor,
                      exchangeRateMicros:
                        line.exchangeRateMicros,
                      debitMinor:
                        line.creditMinor,
                      creditMinor:
                        line.debitMinor,
                      memo:
                        `عكس: ${line.memo ?? original.publicId}`,
                    }),
                  ),
              },
            );

          await tx
            .update(
              financeTransactionsTable,
            )
            .set({
              status:
                "reversed",
              updatedAt:
                new Date(),
            })
            .where(
              eq(
                financeTransactionsTable.id,
                original.id,
              ),
            );

          if (sourceSession) {
            await updateCashSession(
              tx,
              sourceSession,
              amountMinor,
            );
          }

          if (destinationSession) {
            await updateCashSession(
              tx,
              destinationSession,
              -amountMinor,
            );
          }

          return {
            alreadyReversed:
              posting.alreadyPosted,
            transaction:
              original,
            reversal:
              posting.transaction,
          };
        },
      );

    return json(result);
  } catch (caught) {
    if (
      caught instanceof
      FinanceTransferError
    ) {
      return json(
        {
          error:
            caught.message,
        },
        caught.status,
      );
    }

    console.error(
      "FINANCE_TRANSFER_REVERSE_FAILED",
      caught,
    );

    return json(
      {
        error:
          "تعذر عكس التحويل المالي",
      },
      500,
    );
  }
}

export async function handleFinanceTransferRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path =
    new URL(
      request.url,
    ).pathname;

  if (
    request.method ===
      "GET" &&
    path ===
      "/api/pos/finance/cash-accounts"
  ) {
    return handleListCashAccounts(
      request,
      db,
      env,
    );
  }

  if (
    request.method ===
      "POST" &&
    path ===
      "/api/pos/finance/cash-accounts"
  ) {
    return handleCreateCashAccount(
      request,
      db,
      env,
    );
  }

  if (
    request.method ===
      "GET" &&
    path ===
      "/api/pos/finance/currency-conversions"
  ) {
    return handleListCurrencyConversions(
      request,
      db,
      env,
    );
  }

  if (
    request.method ===
      "POST" &&
    path ===
      "/api/pos/finance/currency-conversions"
  ) {
    return handleCreateCurrencyConversion(
      request,
      db,
      env,
    );
  }

  if (
    request.method ===
      "POST" &&
    path ===
      "/api/pos/finance/currency-conversions/reverse"
  ) {
    return handleReverseCurrencyConversion(
      request,
      db,
      env,
    );
  }

  if (
    request.method ===
      "GET" &&
    path ===
      "/api/pos/finance/transfers"
  ) {
    return handleListTransfers(
      request,
      db,
      env,
    );
  }

  if (
    request.method ===
      "POST" &&
    path ===
      "/api/pos/finance/transfers"
  ) {
    return handleCreateTransfer(
      request,
      db,
      env,
    );
  }

  if (
    request.method ===
      "POST" &&
    path ===
      "/api/pos/finance/transfers/reverse"
  ) {
    return handleReverseTransfer(
      request,
      db,
      env,
    );
  }

  return null;
}
