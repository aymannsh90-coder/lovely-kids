import {
  bankAccountsTable,
  banksTable,
  financeAccountsTable,
  financeTransactionLinesTable,
  financeTransactionsTable,
} from "@workspace/db/schema";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getCurrentUser } from "./auth";
import { openDb, type Env } from "./db";
import { postFinanceTransaction } from "./finance-posting";

type Db =
  Awaited<ReturnType<typeof openDb>>["db"];

type CardProcessor =
  | "arab"
  | "bop";

const CARD_PROCESSORS: Record<
  CardProcessor,
  {
    code: string;
    name: string;
    label: string;
    sourceEvent: string;
  }
> = {
  arab: {
    code: "CARD_CLEARING_ARAB",
    name: "فيزا البنك العربي قيد التحصيل",
    label: "فيزا البنك العربي",
    sourceEvent: "card_terminal_settlement_arab",
  },
  bop: {
    code: "CARD_CLEARING_BOP",
    name: "فيزا بنك فلسطين قيد التحصيل",
    label: "فيزا بنك فلسطين",
    sourceEvent: "card_terminal_settlement_bop",
  },
};

const FEE_ACCOUNT_CODE =
  "CARD_PROCESSING_FEES";

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

class CardSettlementError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
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
        { error: "يجب تسجيل الدخول" },
        401,
      ),
    };
  }

  if (!user.isOwner) {
    return {
      ok: false as const,
      response: json(
        { error: "تسويات الفيزا متاحة للمالك فقط" },
        403,
      ),
    };
  }

  return {
    ok: true as const,
    user,
  };
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

function processorValue(
  value: unknown,
): CardProcessor {
  if (
    value === "arab" ||
    value === "bop"
  ) {
    return value;
  }

  throw new CardSettlementError(
    "اختر ماكينة الفيزا",
  );
}

function positiveId(
  value: unknown,
  label: string,
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
    throw new CardSettlementError(
      `${label} غير صالح`,
    );
  }

  return id;
}

function moneyMinor(
  value: unknown,
  label: string,
) {
  const normalized =
    typeof value === "number"
      ? String(value)
      : typeof value === "string"
        ? value
            .trim()
            .replace(",", ".")
        : "";

  const match =
    /^(\d+)(?:\.(\d{1,2}))?$/.exec(
      normalized,
    );

  if (!match) {
    throw new CardSettlementError(
      `${label} غير صالح`,
    );
  }

  const minor =
    Number(match[1]) * 100 +
    Number(
      (match[2] ?? "")
        .padEnd(2, "0"),
    );

  if (
    !Number.isSafeInteger(minor) ||
    minor <= 0 ||
    minor > 2_147_483_647
  ) {
    throw new CardSettlementError(
      `${label} خارج الحد المسموح`,
    );
  }

  return minor;
}

function optionalText(
  value: unknown,
  maxLength: number,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (typeof value !== "string") {
    throw new CardSettlementError(
      "الملاحظات غير صالحة",
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
    throw new CardSettlementError(
      "الملاحظات طويلة جدًا",
    );
  }

  return normalized;
}

function idempotencyKey(
  value: unknown,
) {
  if (
    typeof value !== "string"
  ) {
    throw new CardSettlementError(
      "مفتاح منع التكرار مطلوب",
    );
  }

  const normalized =
    value.trim();

  if (
    normalized.length < 8 ||
    normalized.length > 160
  ) {
    throw new CardSettlementError(
      "مفتاح منع التكرار غير صالح",
    );
  }

  return normalized;
}

async function findFinanceAccount(
  db: any,
  code: string,
) {
  const rows =
    await db
      .select()
      .from(
        financeAccountsTable,
      )
      .where(
        eq(
          financeAccountsTable.code,
          code,
        ),
      )
      .limit(1);

  return rows[0] ?? null;
}

async function ensureFeeAccount(
  tx: any,
) {
  const existing =
    await findFinanceAccount(
      tx,
      FEE_ACCOUNT_CODE,
    );

  if (existing) {
    if (
      existing.accountType !==
      "expense"
    ) {
      throw new Error(
        "CARD_FEE_ACCOUNT_TYPE_MISMATCH",
      );
    }

    return existing;
  }

  const inserted =
    await tx
      .insert(
        financeAccountsTable,
      )
      .values({
        code:
          FEE_ACCOUNT_CODE,
        name:
          "عمولات بطاقات الدفع",
        accountType:
          "expense",
        currencyCode:
          "ILS",
        status:
          "active",
      })
      .onConflictDoNothing()
      .returning();

  if (inserted[0]) {
    return inserted[0];
  }

  const retry =
    await findFinanceAccount(
      tx,
      FEE_ACCOUNT_CODE,
    );

  if (!retry) {
    throw new Error(
      "CARD_FEE_ACCOUNT_CREATE_FAILED",
    );
  }

  return retry;
}

async function clearingBalanceMinor(
  db: any,
  accountId: number,
) {
  const rows =
    await db
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

async function activeIlsBankAccount(
  db: any,
  id: number,
) {
  const rows =
    await db
      .select({
        account:
          bankAccountsTable,
        bank:
          banksTable,
        finance:
          financeAccountsTable,
      })
      .from(
        bankAccountsTable,
      )
      .innerJoin(
        banksTable,
        eq(
          banksTable.id,
          bankAccountsTable.bankId,
        ),
      )
      .innerJoin(
        financeAccountsTable,
        eq(
          financeAccountsTable.id,
          bankAccountsTable
            .financeAccountId,
        ),
      )
      .where(
        and(
          eq(
            bankAccountsTable.id,
            id,
          ),
          eq(
            bankAccountsTable.status,
            "active",
          ),
          eq(
            bankAccountsTable.currencyCode,
            "ILS",
          ),
          eq(
            financeAccountsTable.status,
            "active",
          ),
          eq(
            financeAccountsTable.currencyCode,
            "ILS",
          ),
        ),
      )
      .limit(1);

  const item =
    rows[0];

  if (!item) {
    throw new CardSettlementError(
      "اختر حسابًا بنكيًا فعالًا بالشيكل",
      404,
    );
  }

  return item;
}

async function settlementHistory(
  db: Db,
) {
  const transactions =
    await db
      .select()
      .from(
        financeTransactionsTable,
      )
      .where(
        eq(
          financeTransactionsTable.sourceType,
          "card_terminal_settlement",
        ),
      )
      .orderBy(
        desc(
          financeTransactionsTable.createdAt,
        ),
        desc(
          financeTransactionsTable.id,
        ),
      )
      .limit(100);

  const ids =
    transactions.map(
      (item) => item.id,
    );

  if (
    ids.length === 0
  ) {
    return [];
  }

  const lines =
    await db
      .select({
        transactionId:
          financeTransactionLinesTable
            .transactionId,
        accountId:
          financeTransactionLinesTable
            .accountId,
        debitMinor:
          financeTransactionLinesTable
            .debitMinor,
        creditMinor:
          financeTransactionLinesTable
            .creditMinor,
        accountCode:
          financeAccountsTable.code,
        accountName:
          financeAccountsTable.name,
      })
      .from(
        financeTransactionLinesTable,
      )
      .innerJoin(
        financeAccountsTable,
        eq(
          financeAccountsTable.id,
          financeTransactionLinesTable
            .accountId,
        ),
      )
      .where(
        inArray(
          financeTransactionLinesTable
            .transactionId,
          ids,
        ),
      )
      .orderBy(
        asc(
          financeTransactionLinesTable
            .lineNumber,
        ),
      );

  const byTransaction =
    new Map<
      number,
      typeof lines
    >();

  for (const line of lines) {
    const current =
      byTransaction.get(
        line.transactionId,
      ) ?? [];

    current.push(line);
    byTransaction.set(
      line.transactionId,
      current,
    );
  }

  return transactions.map(
    (transaction) => {
      const processor:
        CardProcessor | null =
        transaction.sourceEvent ===
          CARD_PROCESSORS.arab
            .sourceEvent
          ? "arab"
          : transaction.sourceEvent ===
              CARD_PROCESSORS.bop
                .sourceEvent
            ? "bop"
            : null;

      const txLines =
        byTransaction.get(
          transaction.id,
        ) ?? [];

      const clearingLine =
        txLines.find(
          (line) =>
            line.accountCode ===
              CARD_PROCESSORS.arab
                .code ||
            line.accountCode ===
              CARD_PROCESSORS.bop
                .code,
        );

      const feeLine =
        txLines.find(
          (line) =>
            line.accountCode ===
            FEE_ACCOUNT_CODE,
        );

      const bankLine =
        txLines.find(
          (line) =>
            line.accountCode !==
              CARD_PROCESSORS.arab
                .code &&
            line.accountCode !==
              CARD_PROCESSORS.bop
                .code &&
            line.accountCode !==
              FEE_ACCOUNT_CODE &&
            line.debitMinor > 0,
        );

      return {
        transaction,
        processor,
        grossMinor:
          clearingLine?.creditMinor ??
          0,
        netMinor:
          bankLine?.debitMinor ??
          0,
        feeMinor:
          feeLine?.debitMinor ??
          0,
        bankAccountName:
          bankLine?.accountName ??
          null,
      };
    },
  );
}

async function handleSummary(
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

  const clearingRows =
    await db
      .select()
      .from(
        financeAccountsTable,
      )
      .where(
        inArray(
          financeAccountsTable.code,
          [
            CARD_PROCESSORS.arab.code,
            CARD_PROCESSORS.bop.code,
          ],
        ),
      );

  const clearingByCode =
    new Map(
      clearingRows.map(
        (row) => [
          row.code,
          row,
        ],
      ),
    );

  const terminals =
    await Promise.all(
      (
        Object.entries(
          CARD_PROCESSORS,
        ) as Array<
          [
            CardProcessor,
            typeof CARD_PROCESSORS[
              CardProcessor
            ],
          ]
        >
      ).map(
        async (
          [
            processor,
            config,
          ],
        ) => {
          const account =
            clearingByCode.get(
              config.code,
            ) ?? null;

          return {
            processor,
            label:
              config.label,
            financeAccountId:
              account?.id ??
              null,
            balanceMinor:
              account
                ? await clearingBalanceMinor(
                    db,
                    account.id,
                  )
                : 0,
          };
        },
      ),
    );

  const bankRows =
    await db
      .select({
        account:
          bankAccountsTable,
        bank:
          banksTable,
        finance:
          financeAccountsTable,
      })
      .from(
        bankAccountsTable,
      )
      .innerJoin(
        banksTable,
        eq(
          banksTable.id,
          bankAccountsTable.bankId,
        ),
      )
      .innerJoin(
        financeAccountsTable,
        eq(
          financeAccountsTable.id,
          bankAccountsTable
            .financeAccountId,
        ),
      )
      .where(
        and(
          eq(
            bankAccountsTable.status,
            "active",
          ),
          eq(
            bankAccountsTable.currencyCode,
            "ILS",
          ),
          eq(
            financeAccountsTable.status,
            "active",
          ),
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

  return json({
    terminals,
    bankAccounts:
      bankRows.map(
        (item) => ({
          id:
            item.account.id,
          bankName:
            item.bank.nameAr,
          name:
            item.account.name,
          code:
            item.account.code,
          financeAccountId:
            item.finance.id,
        }),
      ),
    settlements:
      await settlementHistory(
        db,
      ),
  });
}

async function handleCreateSettlement(
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
      { error: "بيانات التسوية غير صالحة" },
      400,
    );
  }

  try {
    const processor =
      processorValue(
        body.processor,
      );

    const config =
      CARD_PROCESSORS[
        processor
      ];

    const bankAccountId =
      positiveId(
        body.bankAccountId,
        "الحساب البنكي",
      );

    const grossMinor =
      moneyMinor(
        body.grossAmount,
        "إجمالي التسوية",
      );

    const netMinor =
      moneyMinor(
        body.netAmount,
        "صافي المبلغ الواصل للبنك",
      );

    if (
      netMinor >
      grossMinor
    ) {
      throw new CardSettlementError(
        "صافي المبلغ الواصل للبنك لا يمكن أن يكون أكبر من إجمالي تسوية الفيزا",
      );
    }

    const feeMinor =
      grossMinor -
      netMinor;

    const notes =
      optionalText(
        body.notes,
        1000,
      );

    const key =
      idempotencyKey(
        body.idempotencyKey,
      );

    const existingRows =
      await db
        .select()
        .from(
          financeTransactionsTable,
        )
        .where(
          eq(
            financeTransactionsTable
              .idempotencyKey,
            key,
          ),
        )
        .limit(1);

    if (existingRows[0]) {
      if (
        existingRows[0]
          .sourceType !==
        "card_terminal_settlement"
      ) {
        throw new CardSettlementError(
          "مفتاح منع التكرار مستخدم لحركة أخرى",
          409,
        );
      }

      return json({
        alreadyCreated: true,
        transaction:
          existingRows[0],
      });
    }

    const result =
      await db.transaction(
        async (tx) => {
          const clearingRows =
            await tx
              .select()
              .from(
                financeAccountsTable,
              )
              .where(
                eq(
                  financeAccountsTable
                    .code,
                  config.code,
                ),
              )
              .limit(1)
              .for("update");

          const clearing =
            clearingRows[0];

          if (!clearing) {
            throw new CardSettlementError(
              `لا يوجد رصيد ${config.label} قيد التحصيل لتسويته`,
              409,
            );
          }

          if (
            clearing.accountType !==
            "asset" ||
            clearing.status !==
            "active"
          ) {
            throw new CardSettlementError(
              "حساب الفيزا الوسيط غير صالح",
              409,
            );
          }

          const balanceBefore =
            await clearingBalanceMinor(
              tx,
              clearing.id,
            );

          if (
            grossMinor >
            balanceBefore
          ) {
            throw new CardSettlementError(
              `قيمة التسوية أكبر من رصيد ${config.label} قيد التحصيل`,
              409,
            );
          }

          const bank =
            await activeIlsBankAccount(
              tx,
              bankAccountId,
            );

          const feeAccount =
            feeMinor > 0
              ? await ensureFeeAccount(
                  tx,
                )
              : null;

          const businessDate =
            currentPalestineDate();

          const publicId =
            "CARDSET-" +
            businessDate.replaceAll(
              "-",
              "",
            ) +
            "-" +
            randomUUID()
              .slice(0, 8)
              .toUpperCase();

          const lines = [
            {
              accountId:
                bank.finance.id,
              debitMinor:
                netMinor,
              creditMinor:
                0,
              memo:
                `صافي تسوية ${config.label}`,
            },
            ...(feeAccount &&
            feeMinor > 0
              ? [
                  {
                    accountId:
                      feeAccount.id,
                    debitMinor:
                      feeMinor,
                    creditMinor:
                      0,
                    memo:
                      `عمولة ${config.label}`,
                  },
                ]
              : []),
            {
              accountId:
                clearing.id,
              debitMinor:
                0,
              creditMinor:
                grossMinor,
              memo:
                `تسوية ${config.label} إلى ${bank.bank.nameAr}`,
            },
          ];

          const posting =
            await postFinanceTransaction(
              tx,
              {
                publicId,
                idempotencyKey:
                  key,
                businessDate,
                transactionType:
                  "transfer",
                sourceType:
                  "card_terminal_settlement",
                sourceId:
                  publicId,
                sourceEvent:
                  config.sourceEvent,
                cashSessionId:
                  null,
                notes:
                  notes ??
                  `تسوية ${config.label}`,
                createdByUserId:
                  auth.user.id,
                lines,
              },
            );

          return {
            transaction:
              posting.transaction,
            processor,
            grossMinor,
            netMinor,
            feeMinor,
            balanceBeforeMinor:
              balanceBefore,
            balanceAfterMinor:
              balanceBefore -
              grossMinor,
          };
        },
      );

    return json(
      {
        alreadyCreated: false,
        ...result,
      },
      201,
    );
  } catch (caught) {
    if (
      caught instanceof
      CardSettlementError
    ) {
      return json(
        { error: caught.message },
        caught.status,
      );
    }

    console.error(
      "CARD_TERMINAL_SETTLEMENT_CREATE_FAILED",
      caught,
    );

    return json(
      { error: "تعذر تسجيل تسوية الفيزا" },
      500,
    );
  }
}

async function handleReverseSettlement(
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

  try {
    const publicId =
      typeof body?.publicId ===
        "string"
        ? body.publicId
            .trim()
            .toUpperCase()
        : "";

    if (!publicId) {
      throw new CardSettlementError(
        "رقم التسوية مطلوب",
      );
    }

    const reason =
      optionalText(
        body?.reason,
        500,
      );

    if (!reason) {
      throw new CardSettlementError(
        "سبب الإلغاء مطلوب",
      );
    }

    const result =
      await db.transaction(
        async (tx) => {
          const rows =
            await tx
              .select()
              .from(
                financeTransactionsTable,
              )
              .where(
                and(
                  eq(
                    financeTransactionsTable
                      .publicId,
                    publicId,
                  ),
                  eq(
                    financeTransactionsTable
                      .sourceType,
                    "card_terminal_settlement",
                  ),
                ),
              )
              .limit(1)
              .for("update");

          const original =
            rows[0];

          if (!original) {
            throw new CardSettlementError(
              "تسوية الفيزا غير موجودة",
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
              reversal: null,
            };
          }

          const originalLines =
            await tx
              .select()
              .from(
                financeTransactionLinesTable,
              )
              .where(
                eq(
                  financeTransactionLinesTable
                    .transactionId,
                  original.id,
                ),
              )
              .orderBy(
                asc(
                  financeTransactionLinesTable
                    .lineNumber,
                ),
              );

          if (
            originalLines.length <
            2
          ) {
            throw new Error(
              "CARD_SETTLEMENT_LINES_MISSING",
            );
          }

          const reversal =
            await postFinanceTransaction(
              tx,
              {
                publicId:
                  `CARDSET-VOID-${original.publicId.replace("CARDSET-", "")}`,
                idempotencyKey:
                  `card-terminal-settlement:${original.id}:reverse`,
                businessDate:
                  currentPalestineDate(),
                transactionType:
                  "reversal",
                sourceType:
                  "card_terminal_settlement",
                sourceId:
                  String(
                    original.id,
                  ),
                sourceEvent:
                  "card_terminal_settlement_reverse",
                cashSessionId:
                  null,
                notes:
                  `عكس ${original.publicId}: ${reason}`,
                createdByUserId:
                  auth.user.id,
                lines:
                  originalLines.map(
                    (line) => ({
                      accountId:
                        line.accountId,
                      customerId:
                        line.customerId,
                      employeeId:
                        line.employeeId,
                      supplierId:
                        line.supplierId,
                      debitMinor:
                        line.creditMinor,
                      creditMinor:
                        line.debitMinor,
                      memo:
                        `عكس ${original.publicId}`,
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

          return {
            alreadyReversed:
              false,
            transaction: {
              ...original,
              status:
                "reversed",
            },
            reversal:
              reversal.transaction,
          };
        },
      );

    return json(result);
  } catch (caught) {
    if (
      caught instanceof
      CardSettlementError
    ) {
      return json(
        { error: caught.message },
        caught.status,
      );
    }

    console.error(
      "CARD_TERMINAL_SETTLEMENT_REVERSE_FAILED",
      caught,
    );

    return json(
      { error: "تعذر إلغاء تسوية الفيزا" },
      500,
    );
  }
}

export async function handleCardSettlementRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path =
    new URL(request.url)
      .pathname;

  if (
    path ===
      "/api/pos/finance/card-settlements" &&
    request.method ===
      "GET"
  ) {
    return handleSummary(
      request,
      db,
      env,
    );
  }

  if (
    path ===
      "/api/pos/finance/card-settlements" &&
    request.method ===
      "POST"
  ) {
    return handleCreateSettlement(
      request,
      db,
      env,
    );
  }

  if (
    path ===
      "/api/pos/finance/card-settlements/reverse" &&
    request.method ===
      "POST"
  ) {
    return handleReverseSettlement(
      request,
      db,
      env,
    );
  }

  return null;
}
