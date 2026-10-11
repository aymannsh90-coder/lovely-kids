import {
  bankAccountsTable,
  banksTable,
  financeAccountsTable,
  financeCurrenciesTable,
  financeExchangeRatesTable,
  financeTransactionLinesTable,
} from "@workspace/db/schema";
import {
  and,
  asc,
  desc,
  eq,
  sql,
} from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getCurrentUser } from "./auth";
import { openDb, type Env } from "./db";

type Db =
  Awaited<ReturnType<typeof openDb>>["db"];

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

class FinanceBankingError extends Error {
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
  if (
    typeof value !== "string"
  ) {
    throw new FinanceBankingError(
      `${field} مطلوب`,
    );
  }

  const normalized =
    value.trim();

  if (!normalized) {
    throw new FinanceBankingError(
      `${field} مطلوب`,
    );
  }

  if (
    normalized.length >
    maxLength
  ) {
    throw new FinanceBankingError(
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

  if (
    typeof value !== "string"
  ) {
    throw new FinanceBankingError(
      "القيمة النصية غير صالحة",
    );
  }

  const normalized =
    value.trim();

  if (!normalized) {
    return null;
  }

  if (
    normalized.length >
    maxLength
  ) {
    throw new FinanceBankingError(
      "القيمة النصية طويلة جدًا",
    );
  }

  return normalized;
}

function positiveId(
  value: unknown,
  field: string,
) {
  const id =
    typeof value === "number"
      ? value
      : typeof value === "string" &&
          value.trim()
        ? Number(value)
        : NaN;

  if (
    !Number.isSafeInteger(id) ||
    id <= 0
  ) {
    throw new FinanceBankingError(
      `${field} غير صالح`,
    );
  }

  return id;
}

function currencyCode(
  value: unknown,
) {
  if (
    typeof value !== "string"
  ) {
    throw new FinanceBankingError(
      "العملة مطلوبة",
    );
  }

  const normalized =
    value.trim().toUpperCase();

  if (
    !/^[A-Z]{3}$/.test(
      normalized,
    )
  ) {
    throw new FinanceBankingError(
      "رمز العملة غير صالح",
    );
  }

  return normalized;
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

function rateToMicros(
  value: unknown,
) {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" &&
          value.trim()
        ? Number(
            value
              .trim()
              .replace(",", "."),
          )
        : NaN;

  if (
    !Number.isFinite(numeric) ||
    numeric <= 0
  ) {
    throw new FinanceBankingError(
      "سعر الصرف غير صالح",
    );
  }

  const micros =
    Math.round(
      numeric *
      1_000_000,
    );

  if (
    !Number.isSafeInteger(
      micros,
    ) ||
    micros <= 0 ||
    micros >
      2_147_483_647
  ) {
    throw new FinanceBankingError(
      "سعر الصرف خارج الحد المسموح",
    );
  }

  return micros;
}

type PosUser = NonNullable<
  Awaited<
    ReturnType<
      typeof getCurrentUser
    >
  >
>;

async function requirePosUser(
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

  if (
    !user.isAdmin &&
    !user.isOwner
  ) {
    return {
      ok: false,
      response: json(
        {
          error:
            "غير مصرح باستخدام نقطة البيع",
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

async function requireOwner(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth =
    await requirePosUser(
      request,
      db,
      env,
    );

  if (!auth.ok) {
    return auth;
  }

  if (!auth.user.isOwner) {
    return {
      ok: false as const,
      response: json(
        {
          error:
            "هذه العملية للمالك فقط",
        },
        403,
      ),
    };
  }

  return auth;
}

async function handleListReferenceData(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth =
    await requirePosUser(
      request,
      db,
      env,
    );

  if (!auth.ok) {
    return auth.response;
  }

  const [
    currencies,
    banks,
    rateRows,
  ] =
    await Promise.all([
      db
        .select()
        .from(
          financeCurrenciesTable,
        )
        .orderBy(
          desc(
            financeCurrenciesTable
              .isBase,
          ),
          asc(
            financeCurrenciesTable
              .code,
          ),
        ),
      db
        .select()
        .from(banksTable)
        .orderBy(
          asc(
            banksTable.nameAr,
          ),
        ),
      db
        .select()
        .from(
          financeExchangeRatesTable,
        )
        .orderBy(
          desc(
            financeExchangeRatesTable
              .rateDate,
          ),
          desc(
            financeExchangeRatesTable
              .id,
          ),
        ),
    ]);

  const latestRateByCurrency =
    new Map<
      string,
      typeof rateRows[number]
    >();

  for (
    const row of rateRows
  ) {
    if (
      !latestRateByCurrency.has(
        row.currencyCode,
      )
    ) {
      latestRateByCurrency.set(
        row.currencyCode,
        row,
      );
    }
  }

  return json({
    currencies:
      currencies.map(
        (currency) => ({
          ...currency,
          latestRate:
            currency.code ===
            "ILS"
              ? {
                  rateDate:
                    currentPalestineDate(),
                  ilsPerUnitMicros:
                    1_000_000,
                  ilsPerUnit:
                    1,
                  source:
                    "base",
                }
              : latestRateByCurrency.has(
                    currency.code,
                  )
                ? {
                    rateDate:
                      latestRateByCurrency.get(
                        currency.code,
                      )!
                        .rateDate,
                    ilsPerUnitMicros:
                      latestRateByCurrency.get(
                        currency.code,
                      )!
                        .ilsPerUnitMicros,
                    ilsPerUnit:
                      latestRateByCurrency.get(
                        currency.code,
                      )!
                        .ilsPerUnitMicros /
                      1_000_000,
                    source:
                      latestRateByCurrency.get(
                        currency.code,
                      )!
                        .source,
                  }
                : null,
        }),
      ),
    banks,
  });
}

async function handleListBankAccounts(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth =
    await requirePosUser(
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
        account:
          bankAccountsTable,
        bank:
          banksTable,
        financeAccount:
          financeAccountsTable,
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
      .innerJoin(
        financeAccountsTable,
        eq(
          bankAccountsTable
            .financeAccountId,
          financeAccountsTable.id,
        ),
      )
      .orderBy(
        asc(
          banksTable.nameAr,
        ),
        asc(
          bankAccountsTable.name,
        ),
      );

  const balanceRows =
    await db
      .select({
        accountId:
          financeTransactionLinesTable
            .accountId,
        baseBalanceMinor:
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
        currencyBalanceMinor:
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
      .groupBy(
        financeTransactionLinesTable
          .accountId,
      );

  const balanceByAccount =
    new Map(
      balanceRows.map(
        (row) => [
          row.accountId,
          row,
        ],
      ),
    );

  return json({
    results:
      rows.map(
        ({
          account,
          bank,
          financeAccount,
        }) => {
          const balance =
            balanceByAccount.get(
              financeAccount.id,
            );

          return {
            ...account,
            bank: {
              id: bank.id,
              code: bank.code,
              nameAr:
                bank.nameAr,
              nameEn:
                bank.nameEn,
            },
            financeAccount: {
              id:
                financeAccount.id,
              code:
                financeAccount.code,
              name:
                financeAccount.name,
              currencyCode:
                financeAccount
                  .currencyCode,
            },
            baseBalanceMinor:
              balance
                ?.baseBalanceMinor ??
              0,
            currencyBalanceMinor:
              balance
                ?.currencyBalanceMinor ??
              0,
          };
        },
      ),
  });
}

async function handleCreateBankAccount(
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
      | Record<
          string,
          unknown
        >
      | null;

  if (!body) {
    return json(
      {
        error:
          "بيانات الحساب البنكي غير صالحة",
      },
      400,
    );
  }

  try {
    const bankId =
      positiveId(
        body.bankId,
        "البنك",
      );

    const name =
      requiredText(
        body.name,
        "اسم الحساب",
        160,
      );

    const accountNumber =
      optionalText(
        body.accountNumber,
        120,
      );

    const iban =
      optionalText(
        body.iban,
        120,
      );

    const currency =
      currencyCode(
        body.currencyCode,
      );

    const notes =
      optionalText(
        body.notes,
        1000,
      );

    const result =
      await db.transaction(
        async (tx) => {
          const bankRows =
            await tx
              .select()
              .from(
                banksTable,
              )
              .where(
                and(
                  eq(
                    banksTable.id,
                    bankId,
                  ),
                  eq(
                    banksTable.status,
                    "active",
                  ),
                ),
              )
              .limit(1);

          const bank =
            bankRows[0];

          if (!bank) {
            throw new FinanceBankingError(
              "البنك غير موجود أو غير فعال",
              404,
            );
          }

          const currencyRows =
            await tx
              .select()
              .from(
                financeCurrenciesTable,
              )
              .where(
                and(
                  eq(
                    financeCurrenciesTable
                      .code,
                    currency,
                  ),
                  eq(
                    financeCurrenciesTable
                      .status,
                    "active",
                  ),
                ),
              )
              .limit(1);

          if (
            !currencyRows[0]
          ) {
            throw new FinanceBankingError(
              "العملة غير موجودة أو غير فعالة",
              404,
            );
          }

          const suffix =
            randomUUID()
              .replaceAll(
                "-",
                "",
              )
              .slice(0, 8)
              .toUpperCase();

          const accountCode =
            `BANK_${bank.code}_${currency}_${suffix}`;

          const financeRows =
            await tx
              .insert(
                financeAccountsTable,
              )
              .values({
                code:
                  accountCode,
                name:
                  `${bank.nameAr} - ${name} - ${currency}`,
                accountType:
                  "asset",
                currencyCode:
                  currency,
                status:
                  "active",
                notes:
                  `Bank account for ${bank.nameAr}`,
              })
              .returning();

          const financeAccount =
            financeRows[0];

          if (
            !financeAccount
          ) {
            throw new Error(
              "BANK_FINANCE_ACCOUNT_CREATE_FAILED",
            );
          }

          const accountRows =
            await tx
              .insert(
                bankAccountsTable,
              )
              .values({
                bankId:
                  bank.id,
                code:
                  `BA_${suffix}`,
                name,
                accountNumber,
                iban,
                currencyCode:
                  currency,
                financeAccountId:
                  financeAccount.id,
                status:
                  "active",
                notes,
                createdByUserId:
                  auth.user.id,
              })
              .returning();

          const account =
            accountRows[0];

          if (!account) {
            throw new Error(
              "BANK_ACCOUNT_CREATE_FAILED",
            );
          }

          await tx
            .update(
              financeAccountsTable,
            )
            .set({
              linkedEntityType:
                "bank_account",
              linkedEntityId:
                account.id,
              updatedAt:
                new Date(),
            })
            .where(
              eq(
                financeAccountsTable.id,
                financeAccount.id,
              ),
            );

          return {
            account,
            bank,
            financeAccount,
          };
        },
      );

    return json(
      result,
      201,
    );
  } catch (caught) {
    if (
      caught instanceof
      FinanceBankingError
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
      "BANK_ACCOUNT_CREATE_FAILED",
      caught,
    );

    return json(
      {
        error:
          "تعذر إضافة الحساب البنكي",
      },
      500,
    );
  }
}

async function handleCreateExchangeRate(
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
      | Record<
          string,
          unknown
        >
      | null;

  if (!body) {
    return json(
      {
        error:
          "بيانات سعر الصرف غير صالحة",
      },
      400,
    );
  }

  try {
    const currency =
      currencyCode(
        body.currencyCode,
      );

    if (
      currency === "ILS"
    ) {
      throw new FinanceBankingError(
        "الشيكل هو العملة الأساسية وسعره دائمًا 1",
      );
    }

    const rateDate =
      body.rateDate ===
        undefined ||
      body.rateDate ===
        null ||
      body.rateDate ===
        ""
        ? currentPalestineDate()
        : requiredText(
            body.rateDate,
            "تاريخ سعر الصرف",
            10,
          );

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(
        rateDate,
      )
    ) {
      throw new FinanceBankingError(
        "تاريخ سعر الصرف غير صالح",
      );
    }

    const rateMicros =
      rateToMicros(
        body.ilsPerUnit,
      );

    const source =
      optionalText(
        body.source,
        120,
      );

    const notes =
      optionalText(
        body.notes,
        1000,
      );

    const currencyRows =
      await db
        .select()
        .from(
          financeCurrenciesTable,
        )
        .where(
          and(
            eq(
              financeCurrenciesTable
                .code,
              currency,
            ),
            eq(
              financeCurrenciesTable
                .status,
              "active",
            ),
          ),
        )
        .limit(1);

    if (!currencyRows[0]) {
      throw new FinanceBankingError(
        "العملة غير موجودة أو غير فعالة",
        404,
      );
    }

    const rows =
      await db
        .insert(
          financeExchangeRatesTable,
        )
        .values({
          currencyCode:
            currency,
          rateDate,
          ilsPerUnitMicros:
            rateMicros,
          source,
          notes,
          createdByUserId:
            auth.user.id,
        })
        .onConflictDoUpdate({
          target: [
            financeExchangeRatesTable
              .currencyCode,
            financeExchangeRatesTable
              .rateDate,
          ],
          set: {
            ilsPerUnitMicros:
              rateMicros,
            source,
            notes,
            createdByUserId:
              auth.user.id,
          },
        })
        .returning();

    return json({
      rate: rows[0],
      ilsPerUnit:
        rateMicros /
        1_000_000,
    });
  } catch (caught) {
    if (
      caught instanceof
      FinanceBankingError
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
      "EXCHANGE_RATE_SAVE_FAILED",
      caught,
    );

    return json(
      {
        error:
          "تعذر حفظ سعر الصرف",
      },
      500,
    );
  }
}

export async function handleFinanceBankingRequest(
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
      "/api/pos/finance/banking/reference"
  ) {
    return handleListReferenceData(
      request,
      db,
      env,
    );
  }

  if (
    request.method ===
      "GET" &&
    path ===
      "/api/pos/finance/bank-accounts"
  ) {
    return handleListBankAccounts(
      request,
      db,
      env,
    );
  }

  if (
    request.method ===
      "POST" &&
    path ===
      "/api/pos/finance/bank-accounts"
  ) {
    return handleCreateBankAccount(
      request,
      db,
      env,
    );
  }

  if (
    request.method ===
      "POST" &&
    path ===
      "/api/pos/finance/exchange-rates"
  ) {
    return handleCreateExchangeRate(
      request,
      db,
      env,
    );
  }

  return null;
}
