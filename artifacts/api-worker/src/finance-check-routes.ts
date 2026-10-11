import {
  bankAccountsTable,
  banksTable,
  customersTable,
  employeesTable,
  financeAccountsTable,
  financeChecksTable,
  financeCurrenciesTable,
  financeTransactionsTable,
  suppliersTable,
} from "@workspace/db/schema";
import {
  and,
  asc,
  desc,
  eq,
} from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getCurrentUser } from "./auth";
import { openDb, type Env } from "./db";
import {
  ensureCustomerReceivableControlAccount,
} from "./finance-customer-ledger";
import {
  postFinanceTransaction,
  type FinancePostingLineInput,
} from "./finance-posting";
import {
  ensureSupplierPayableControlAccount,
  supplierPayableBalanceMinor,
} from "./finance-supplier-ledger";

type Db =
  Awaited<ReturnType<typeof openDb>>["db"];

const MAX_MINOR =
  2_147_483_647;

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

class FinanceCheckError extends Error {
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
    throw new FinanceCheckError(
      `${field} مطلوب`,
    );
  }

  const normalized =
    value.trim();

  if (!normalized) {
    throw new FinanceCheckError(
      `${field} مطلوب`,
    );
  }

  if (
    normalized.length >
    maxLength
  ) {
    throw new FinanceCheckError(
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

  return requiredText(
    value,
    "القيمة",
    maxLength,
  );
}

function positiveId(
  value: unknown,
  field: string,
) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" &&
          value.trim()
        ? Number(value)
        : NaN;

  if (
    !Number.isSafeInteger(
      parsed,
    ) ||
    parsed <= 0
  ) {
    throw new FinanceCheckError(
      `${field} غير صالح`,
    );
  }

  return parsed;
}

function parseAmountMinor(
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
    throw new FinanceCheckError(
      "مبلغ الشيك غير صالح",
    );
  }

  const minor =
    Math.round(
      numeric *
      100,
    );

  if (
    !Number.isSafeInteger(
      minor,
    ) ||
    minor <= 0 ||
    minor > MAX_MINOR
  ) {
    throw new FinanceCheckError(
      "مبلغ الشيك خارج الحد المسموح",
    );
  }

  return minor;
}

function normalizeCurrencyCode(
  value: unknown,
) {
  if (
    typeof value !== "string"
  ) {
    throw new FinanceCheckError(
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
    throw new FinanceCheckError(
      "العملة غير صالحة",
    );
  }

  return normalized;
}

function parseRateMicros(
  currencyCode: string,
  value: unknown,
) {
  if (
    currencyCode === "ILS"
  ) {
    return 1_000_000;
  }

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
    throw new FinanceCheckError(
      "سعر الصرف مطلوب للعملة الأجنبية",
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
    micros > MAX_MINOR
  ) {
    throw new FinanceCheckError(
      "سعر الصرف غير صالح",
    );
  }

  return micros;
}

function convertToBaseMinor(
  currencyAmountMinor: number,
  exchangeRateMicros: number,
) {
  const value =
    (
      BigInt(
        currencyAmountMinor,
      ) *
        BigInt(
          exchangeRateMicros,
        ) +
      500_000n
    ) /
    1_000_000n;

  if (
    value <= 0n ||
    value >
      BigInt(MAX_MINOR)
  ) {
    throw new FinanceCheckError(
      "قيمة الشيك بالشيكل خارج الحد المسموح",
    );
  }

  return Number(value);
}

function normalizeDate(
  value: unknown,
  field: string,
) {
  const date =
    requiredText(
      value,
      field,
      10,
    );

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      date,
    )
  ) {
    throw new FinanceCheckError(
      `${field} غير صالح`,
    );
  }

  return date;
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

async function ensureFinanceAccount(
  tx: any,
  input: {
    code: string;
    name: string;
    accountType:
      | "asset"
      | "liability"
      | "income"
      | "expense"
      | "equity";
  },
) {
  const existing =
    await tx
      .select()
      .from(
        financeAccountsTable,
      )
      .where(
        eq(
          financeAccountsTable.code,
          input.code,
        ),
      )
      .limit(1);

  if (existing[0]) {
    if (
      existing[0]
        .accountType !==
      input.accountType
    ) {
      throw new Error(
        "FINANCE_CHECK_ACCOUNT_TYPE_INVALID",
      );
    }

    return existing[0];
  }

  const inserted =
    await tx
      .insert(
        financeAccountsTable,
      )
      .values({
        code:
          input.code,
        name:
          input.name,
        accountType:
          input.accountType,
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
    await tx
      .select()
      .from(
        financeAccountsTable,
      )
      .where(
        eq(
          financeAccountsTable.code,
          input.code,
        ),
      )
      .limit(1);

  if (!retry[0]) {
    throw new Error(
      "FINANCE_CHECK_ACCOUNT_CREATE_FAILED",
    );
  }

  return retry[0];
}

async function ensureCheckReceivable(
  tx: any,
) {
  return ensureFinanceAccount(
    tx,
    {
      code:
        "CHECKS_RECEIVABLE_CONTROL",
      name:
        "شيكات برسم التحصيل",
      accountType:
        "asset",
    },
  );
}

async function ensureCheckPayable(
  tx: any,
) {
  return ensureFinanceAccount(
    tx,
    {
      code:
        "CHECKS_PAYABLE_CONTROL",
      name:
        "شيكات صادرة",
      accountType:
        "liability",
    },
  );
}

async function ensureFxGain(
  tx: any,
) {
  return ensureFinanceAccount(
    tx,
    {
      code:
        "FX_GAIN",
      name:
        "أرباح فروقات العملة",
      accountType:
        "income",
    },
  );
}

async function ensureFxLoss(
  tx: any,
) {
  return ensureFinanceAccount(
    tx,
    {
      code:
        "FX_LOSS",
      name:
        "خسائر فروقات العملة",
      accountType:
        "expense",
    },
  );
}

async function activeCurrency(
  db: any,
  code: string,
) {
  const rows =
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
            code,
          ),
          eq(
            financeCurrenciesTable
              .status,
            "active",
          ),
        ),
      )
      .limit(1);

  if (!rows[0]) {
    throw new FinanceCheckError(
      "العملة غير موجودة أو غير فعالة",
      404,
    );
  }

  return rows[0];
}

async function activeBank(
  db: any,
  bankId: number,
) {
  const rows =
    await db
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

  if (!rows[0]) {
    throw new FinanceCheckError(
      "البنك غير موجود أو غير فعال",
      404,
    );
  }

  return rows[0];
}

async function activeBankAccount(
  db: any,
  accountId: number,
) {
  const rows =
    await db
      .select()
      .from(
        bankAccountsTable,
      )
      .where(
        and(
          eq(
            bankAccountsTable.id,
            accountId,
          ),
          eq(
            bankAccountsTable.status,
            "active",
          ),
        ),
      )
      .limit(1);

  if (!rows[0]) {
    throw new FinanceCheckError(
      "الحساب البنكي غير موجود أو غير فعال",
      404,
    );
  }

  return rows[0];
}

async function handleListChecks(
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

  const url =
    new URL(request.url);

  const direction =
    url.searchParams
      .get("direction");

  const status =
    url.searchParams
      .get("status");

  const [
    checks,
    banks,
    bankAccounts,
    customers,
    suppliers,
    employees,
  ] =
    await Promise.all([
      db
        .select()
        .from(
          financeChecksTable,
        )
        .orderBy(
          desc(
            financeChecksTable
              .createdAt,
          ),
          desc(
            financeChecksTable.id,
          ),
        )
        .limit(500),
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
          bankAccountsTable,
        ),
      db
        .select()
        .from(customersTable),
      db
        .select()
        .from(suppliersTable),
      db
        .select()
        .from(employeesTable),
    ]);

  const bankMap =
    new Map(
      banks.map(
        (bank) => [
          bank.id,
          bank,
        ],
      ),
    );

  const bankAccountMap =
    new Map(
      bankAccounts.map(
        (account) => [
          account.id,
          account,
        ],
      ),
    );

  const customerMap =
    new Map(
      customers.map(
        (customer) => [
          customer.id,
          customer,
        ],
      ),
    );

  const supplierMap =
    new Map(
      suppliers.map(
        (supplier) => [
          supplier.id,
          supplier,
        ],
      ),
    );

  const employeeMap =
    new Map(
      employees.map(
        (employee) => [
          employee.id,
          employee,
        ],
      ),
    );

  return json({
    results:
      checks
        .filter(
          (check) =>
            (!direction ||
              check.direction ===
                direction) &&
            (!status ||
              check.status ===
                status),
        )
        .map(
          (check) => ({
            ...check,
            bank:
              bankMap.get(
                check.bankId,
              ) ?? null,
            bankAccount:
              check.bankAccountId
                ? bankAccountMap.get(
                    check.bankAccountId,
                  ) ?? null
                : null,
            depositedToBankAccount:
              check
                .depositedToBankAccountId
                ? bankAccountMap.get(
                    check
                      .depositedToBankAccountId,
                  ) ?? null
                : null,
            party:
              check.customerId
                ? {
                    type:
                      "customer",
                    id:
                      check.customerId,
                    name:
                      customerMap.get(
                        check.customerId,
                      )?.name ??
                      `زبون #${check.customerId}`,
                  }
                : check.supplierId
                  ? {
                      type:
                        "supplier",
                      id:
                        check.supplierId,
                      name:
                        supplierMap.get(
                          check.supplierId,
                        )?.name ??
                        `مورد #${check.supplierId}`,
                    }
                  : check.employeeId
                    ? {
                        type:
                          "employee",
                        id:
                          check.employeeId,
                        name:
                          employeeMap.get(
                            check.employeeId,
                          )?.name ??
                          `موظف #${check.employeeId}`,
                      }
                    : null,
          }),
        ),
  });
}

async function createReceivedCheck(
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
          "بيانات الشيك غير صالحة",
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
      idempotencyKey.length <
      8
    ) {
      throw new FinanceCheckError(
        "مفتاح منع التكرار قصير جدًا",
      );
    }

    const existing =
      await db
        .select()
        .from(
          financeChecksTable,
        )
        .where(
          eq(
            financeChecksTable
              .idempotencyKey,
            idempotencyKey,
          ),
        )
        .limit(1);

    if (existing[0]) {
      return json({
        alreadyCreated:
          true,
        check:
          existing[0],
      });
    }

    const checkNumber =
      requiredText(
        body.checkNumber,
        "رقم الشيك",
        100,
      );

    const bankId =
      positiveId(
        body.bankId,
        "البنك",
      );

    const customerId =
      positiveId(
        body.customerId,
        "الزبون",
      );

    const currencyCode =
      normalizeCurrencyCode(
        body.currencyCode,
      );

    const amountMinor =
      parseAmountMinor(
        body.amount,
      );

    const exchangeRateMicros =
      parseRateMicros(
        currencyCode,
        body.exchangeRate,
      );

    const baseAmountMinor =
      convertToBaseMinor(
        amountMinor,
        exchangeRateMicros,
      );

    const dueDate =
      normalizeDate(
        body.dueDate,
        "تاريخ الاستحقاق",
      );

    const drawerName =
      optionalText(
        body.drawerName,
        160,
      );

    const notes =
      optionalText(
        body.notes,
        1000,
      );

    const result =
      await db.transaction(
        async (tx) => {
          await activeCurrency(
            tx,
            currencyCode,
          );

          const bank =
            await activeBank(
              tx,
              bankId,
            );

          const customerRows =
            await tx
              .select()
              .from(
                customersTable,
              )
              .where(
                and(
                  eq(
                    customersTable.id,
                    customerId,
                  ),
                  eq(
                    customersTable
                      .status,
                    "active",
                  ),
                ),
              )
              .limit(1);

          const customer =
            customerRows[0];

          if (!customer) {
            throw new FinanceCheckError(
              "الزبون غير موجود أو غير فعال",
              404,
            );
          }

          const publicId =
            `CHK-IN-${currentPalestineDate().replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;

          const checkRows =
            await tx
              .insert(
                financeChecksTable,
              )
              .values({
                publicId,
                idempotencyKey,
                direction:
                  "received",
                checkNumber,
                bankId:
                  bank.id,
                currencyCode,
                amountMinor,
                exchangeRateMicros,
                baseAmountMinor,
                dueDate,
                customerId:
                  customer.id,
                drawerName:
                  drawerName ??
                  customer.name,
                status:
                  "on_hand",
                notes,
                createdByUserId:
                  auth.user.id,
              })
              .returning();

          const check =
            checkRows[0];

          if (!check) {
            throw new Error(
              "FINANCE_CHECK_CREATE_FAILED",
            );
          }

          const checkReceivable =
            await ensureCheckReceivable(
              tx,
            );

          const customerReceivable =
            await ensureCustomerReceivableControlAccount(
              tx,
            );

          const posting =
            await postFinanceTransaction(
              tx,
              {
                publicId:
                  `FIN-${publicId}`,
                idempotencyKey:
                  `check:${check.id}:received`,
                businessDate:
                  currentPalestineDate(),
                transactionType:
                  "receipt",
                sourceType:
                  "finance_check",
                sourceId:
                  String(
                    check.id,
                  ),
                sourceEvent:
                  "received",
                notes:
                  `استلام شيك ${check.checkNumber} من ${customer.name}`,
                createdByUserId:
                  auth.user.id,
                lines: [
                  {
                    accountId:
                      checkReceivable.id,
                    currencyCode,
                    currencyAmountMinor:
                      amountMinor,
                    exchangeRateMicros,
                    debitMinor:
                      baseAmountMinor,
                    creditMinor: 0,
                    memo:
                      `شيك مستلم ${check.checkNumber}`,
                  },
                  {
                    accountId:
                      customerReceivable.id,
                    customerId:
                      customer.id,
                    debitMinor: 0,
                    creditMinor:
                      baseAmountMinor,
                    memo:
                      `تخفيض ذمة الزبون بشيك ${check.checkNumber}`,
                  },
                ],
              },
            );

          const updated =
            await tx
              .update(
                financeChecksTable,
              )
              .set({
                initialFinanceTransactionId:
                  posting
                    .transaction
                    .id,
                updatedAt:
                  new Date(),
              })
              .where(
                eq(
                  financeChecksTable.id,
                  check.id,
                ),
              )
              .returning();

          return {
            check:
              updated[0] ??
              check,
            alreadyCreated:
              false,
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
      FinanceCheckError
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
      "FINANCE_RECEIVED_CHECK_CREATE_FAILED",
      caught,
    );

    return json(
      {
        error:
          "تعذر تسجيل الشيك المستلم",
      },
      500,
    );
  }
}

async function createIssuedCheck(
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
          "بيانات الشيك غير صالحة",
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
      idempotencyKey.length <
      8
    ) {
      throw new FinanceCheckError(
        "مفتاح منع التكرار قصير جدًا",
      );
    }

    const existing =
      await db
        .select()
        .from(
          financeChecksTable,
        )
        .where(
          eq(
            financeChecksTable
              .idempotencyKey,
            idempotencyKey,
          ),
        )
        .limit(1);

    if (existing[0]) {
      return json({
        alreadyCreated:
          true,
        check:
          existing[0],
      });
    }

    const checkNumber =
      requiredText(
        body.checkNumber,
        "رقم الشيك",
        100,
      );

    const bankAccountId =
      positiveId(
        body.bankAccountId,
        "الحساب البنكي",
      );

    const supplierId =
      positiveId(
        body.supplierId,
        "المورد",
      );

    const amountMinor =
      parseAmountMinor(
        body.amount,
      );

    const dueDate =
      normalizeDate(
        body.dueDate,
        "تاريخ الاستحقاق",
      );

    const payeeName =
      optionalText(
        body.payeeName,
        160,
      );

    const notes =
      optionalText(
        body.notes,
        1000,
      );

    const result =
      await db.transaction(
        async (tx) => {
          const bankAccount =
            await activeBankAccount(
              tx,
              bankAccountId,
            );

          const bank =
            await activeBank(
              tx,
              bankAccount.bankId,
            );

          const currencyCode =
            bankAccount
              .currencyCode;

          await activeCurrency(
            tx,
            currencyCode,
          );

          const exchangeRateMicros =
            parseRateMicros(
              currencyCode,
              body.exchangeRate,
            );

          const baseAmountMinor =
            convertToBaseMinor(
              amountMinor,
              exchangeRateMicros,
            );

          const supplierRows =
            await tx
              .select()
              .from(
                suppliersTable,
              )
              .where(
                and(
                  eq(
                    suppliersTable.id,
                    supplierId,
                  ),
                  eq(
                    suppliersTable
                      .status,
                    "active",
                  ),
                ),
              )
              .limit(1);

          const supplier =
            supplierRows[0];

          if (!supplier) {
            throw new FinanceCheckError(
              "المورد غير موجود أو غير فعال",
              404,
            );
          }

          const balance =
            await supplierPayableBalanceMinor(
              tx,
              supplier.id,
            );

          if (
            baseAmountMinor >
            balance
          ) {
            throw new FinanceCheckError(
              "قيمة الشيك أكبر من رصيد المورد المستحق",
              409,
            );
          }

          const publicId =
            `CHK-OUT-${currentPalestineDate().replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;

          const checkRows =
            await tx
              .insert(
                financeChecksTable,
              )
              .values({
                publicId,
                idempotencyKey,
                direction:
                  "issued",
                checkNumber,
                bankId:
                  bank.id,
                bankAccountId:
                  bankAccount.id,
                currencyCode,
                amountMinor,
                exchangeRateMicros,
                baseAmountMinor,
                dueDate,
                supplierId:
                  supplier.id,
                payeeName:
                  payeeName ??
                  supplier.name,
                status:
                  "issued",
                notes,
                createdByUserId:
                  auth.user.id,
              })
              .returning();

          const check =
            checkRows[0];

          if (!check) {
            throw new Error(
              "FINANCE_CHECK_CREATE_FAILED",
            );
          }

          const checkPayable =
            await ensureCheckPayable(
              tx,
            );

          const supplierPayable =
            await ensureSupplierPayableControlAccount(
              tx,
            );

          const posting =
            await postFinanceTransaction(
              tx,
              {
                publicId:
                  `FIN-${publicId}`,
                idempotencyKey:
                  `check:${check.id}:issued`,
                businessDate:
                  currentPalestineDate(),
                transactionType:
                  "payment",
                sourceType:
                  "finance_check",
                sourceId:
                  String(
                    check.id,
                  ),
                sourceEvent:
                  "issued",
                notes:
                  `إصدار شيك ${check.checkNumber} للمورد ${supplier.name}`,
                createdByUserId:
                  auth.user.id,
                lines: [
                  {
                    accountId:
                      supplierPayable.id,
                    supplierId:
                      supplier.id,
                    debitMinor:
                      baseAmountMinor,
                    creditMinor: 0,
                    memo:
                      `تخفيض ذمة المورد بشيك ${check.checkNumber}`,
                  },
                  {
                    accountId:
                      checkPayable.id,
                    currencyCode,
                    currencyAmountMinor:
                      amountMinor,
                    exchangeRateMicros,
                    debitMinor: 0,
                    creditMinor:
                      baseAmountMinor,
                    memo:
                      `شيك صادر ${check.checkNumber}`,
                  },
                ],
              },
            );

          const updated =
            await tx
              .update(
                financeChecksTable,
              )
              .set({
                initialFinanceTransactionId:
                  posting
                    .transaction
                    .id,
                updatedAt:
                  new Date(),
              })
              .where(
                eq(
                  financeChecksTable.id,
                  check.id,
                ),
              )
              .returning();

          return {
            check:
              updated[0] ??
              check,
            alreadyCreated:
              false,
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
      FinanceCheckError
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
      "FINANCE_ISSUED_CHECK_CREATE_FAILED",
      caught,
    );

    return json(
      {
        error:
          "تعذر تسجيل الشيك الصادر",
      },
      500,
    );
  }
}

async function depositReceivedCheck(
  request: Request,
  db: Db,
  env: Env,
  checkId: number,
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

  try {
    const bankAccountId =
      positiveId(
        body?.bankAccountId,
        "الحساب البنكي",
      );

    const result =
      await db.transaction(
        async (tx) => {
          const rows =
            await tx
              .select()
              .from(
                financeChecksTable,
              )
              .where(
                eq(
                  financeChecksTable.id,
                  checkId,
                ),
              )
              .limit(1)
              .for("update");

          const check =
            rows[0];

          if (!check) {
            throw new FinanceCheckError(
              "الشيك غير موجود",
              404,
            );
          }

          if (
            check.direction !==
            "received"
          ) {
            throw new FinanceCheckError(
              "الإيداع متاح للشيكات المستلمة فقط",
              409,
            );
          }

          if (
            check.status ===
            "deposited"
          ) {
            if (
              check
                .depositedToBankAccountId ===
              bankAccountId
            ) {
              return {
                check,
                alreadyDeposited:
                  true,
              };
            }

            throw new FinanceCheckError(
              "الشيك مودع مسبقًا في حساب آخر",
              409,
            );
          }

          if (
            check.status !==
            "on_hand"
          ) {
            throw new FinanceCheckError(
              "حالة الشيك لا تسمح بالإيداع",
              409,
            );
          }

          const account =
            await activeBankAccount(
              tx,
              bankAccountId,
            );

          if (
            account.currencyCode !==
            check.currencyCode
          ) {
            throw new FinanceCheckError(
              "عملة الحساب البنكي يجب أن تطابق عملة الشيك",
              409,
            );
          }

          const updated =
            await tx
              .update(
                financeChecksTable,
              )
              .set({
                status:
                  "deposited",
                depositedToBankAccountId:
                  account.id,
                depositedAt:
                  new Date(),
                updatedAt:
                  new Date(),
              })
              .where(
                eq(
                  financeChecksTable.id,
                  check.id,
                ),
              )
              .returning();

          return {
            check:
              updated[0],
            alreadyDeposited:
              false,
          };
        },
      );

    return json(result);
  } catch (caught) {
    if (
      caught instanceof
      FinanceCheckError
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
      "FINANCE_CHECK_DEPOSIT_FAILED",
      caught,
    );

    return json(
      {
        error:
          "تعذر إيداع الشيك",
      },
      500,
    );
  }
}

async function clearCheck(
  request: Request,
  db: Db,
  env: Env,
  checkId: number,
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

  try {
    const result =
      await db.transaction(
        async (tx) => {
          const rows =
            await tx
              .select()
              .from(
                financeChecksTable,
              )
              .where(
                eq(
                  financeChecksTable.id,
                  checkId,
                ),
              )
              .limit(1)
              .for("update");

          const check =
            rows[0];

          if (!check) {
            throw new FinanceCheckError(
              "الشيك غير موجود",
              404,
            );
          }

          if (
            check.status ===
            "cleared"
          ) {
            return {
              check,
              alreadyCleared:
                true,
            };
          }

          const allowed =
            check.direction ===
              "received"
              ? check.status ===
                  "on_hand" ||
                check.status ===
                  "deposited"
              : check.status ===
                  "issued";

          if (!allowed) {
            throw new FinanceCheckError(
              "حالة الشيك لا تسمح بالتحصيل",
              409,
            );
          }

          const bankAccountId =
            check.direction ===
            "received"
              ? check
                  .depositedToBankAccountId ??
                positiveId(
                  body?.bankAccountId,
                  "الحساب البنكي",
                )
              : check.bankAccountId;

          if (!bankAccountId) {
            throw new FinanceCheckError(
              "الحساب البنكي غير محدد",
              409,
            );
          }

          const account =
            await activeBankAccount(
              tx,
              bankAccountId,
            );

          if (
            account.currencyCode !==
            check.currencyCode
          ) {
            throw new FinanceCheckError(
              "عملة الحساب البنكي يجب أن تطابق عملة الشيك",
              409,
            );
          }

          const clearingRateMicros =
            parseRateMicros(
              check.currencyCode,
              body?.exchangeRate,
            );

          const bankBaseMinor =
            convertToBaseMinor(
              check.amountMinor,
              clearingRateMicros,
            );

          const checkControl =
            check.direction ===
            "received"
              ? await ensureCheckReceivable(
                  tx,
                )
              : await ensureCheckPayable(
                  tx,
                );

          const lines:
            FinancePostingLineInput[] = [];

          if (
            check.direction ===
            "received"
          ) {
            lines.push(
              {
                accountId:
                  account
                    .financeAccountId,
                currencyCode:
                  check.currencyCode,
                currencyAmountMinor:
                  check.amountMinor,
                exchangeRateMicros:
                  clearingRateMicros,
                debitMinor:
                  bankBaseMinor,
                creditMinor: 0,
                memo:
                  `تحصيل شيك ${check.checkNumber} في البنك`,
              },
              {
                accountId:
                  checkControl.id,
                debitMinor: 0,
                creditMinor:
                  check.baseAmountMinor,
                memo:
                  `إخراج الشيك ${check.checkNumber} من برسم التحصيل`,
              },
            );

            if (
              bankBaseMinor >
              check.baseAmountMinor
            ) {
              const gain =
                await ensureFxGain(
                  tx,
                );

              lines.push({
                accountId:
                  gain.id,
                debitMinor: 0,
                creditMinor:
                  bankBaseMinor -
                  check.baseAmountMinor,
                memo:
                  `ربح فرق عملة للشيك ${check.checkNumber}`,
              });
            } else if (
              bankBaseMinor <
              check.baseAmountMinor
            ) {
              const loss =
                await ensureFxLoss(
                  tx,
                );

              lines.push({
                accountId:
                  loss.id,
                debitMinor:
                  check.baseAmountMinor -
                  bankBaseMinor,
                creditMinor: 0,
                memo:
                  `خسارة فرق عملة للشيك ${check.checkNumber}`,
              });
            }
          } else {
            lines.push(
              {
                accountId:
                  checkControl.id,
                debitMinor:
                  check.baseAmountMinor,
                creditMinor: 0,
                memo:
                  `تسوية الشيك الصادر ${check.checkNumber}`,
              },
              {
                accountId:
                  account
                    .financeAccountId,
                currencyCode:
                  check.currencyCode,
                currencyAmountMinor:
                  check.amountMinor,
                exchangeRateMicros:
                  clearingRateMicros,
                debitMinor: 0,
                creditMinor:
                  bankBaseMinor,
                memo:
                  `خصم الشيك ${check.checkNumber} من البنك`,
              },
            );

            if (
              check.baseAmountMinor >
              bankBaseMinor
            ) {
              const gain =
                await ensureFxGain(
                  tx,
                );

              lines.push({
                accountId:
                  gain.id,
                debitMinor: 0,
                creditMinor:
                  check.baseAmountMinor -
                  bankBaseMinor,
                memo:
                  `ربح فرق عملة للشيك ${check.checkNumber}`,
              });
            } else if (
              check.baseAmountMinor <
              bankBaseMinor
            ) {
              const loss =
                await ensureFxLoss(
                  tx,
                );

              lines.push({
                accountId:
                  loss.id,
                debitMinor:
                  bankBaseMinor -
                  check.baseAmountMinor,
                creditMinor: 0,
                memo:
                  `خسارة فرق عملة للشيك ${check.checkNumber}`,
              });
            }
          }

          const posting =
            await postFinanceTransaction(
              tx,
              {
                publicId:
                  `FIN-CHK-CLR-${check.id}-${randomUUID().slice(0, 8).toUpperCase()}`,
                idempotencyKey:
                  `check:${check.id}:cleared`,
                businessDate:
                  currentPalestineDate(),
                transactionType:
                  "transfer",
                sourceType:
                  "finance_check",
                sourceId:
                  String(
                    check.id,
                  ),
                sourceEvent:
                  "cleared",
                notes:
                  `تحصيل الشيك ${check.checkNumber}`,
                createdByUserId:
                  auth.user.id,
                lines,
              },
            );

          const updated =
            await tx
              .update(
                financeChecksTable,
              )
              .set({
                status:
                  "cleared",
                depositedToBankAccountId:
                  check.direction ===
                  "received"
                    ? account.id
                    : check
                        .depositedToBankAccountId,
                depositedAt:
                  check.direction ===
                    "received" &&
                  !check.depositedAt
                    ? new Date()
                    : check.depositedAt,
                clearedAt:
                  new Date(),
                settlementFinanceTransactionId:
                  posting
                    .transaction
                    .id,
                updatedAt:
                  new Date(),
              })
              .where(
                eq(
                  financeChecksTable.id,
                  check.id,
                ),
              )
              .returning();

          return {
            check:
              updated[0],
            alreadyCleared:
              false,
            bankBaseMinor,
            clearingRateMicros,
          };
        },
      );

    return json(result);
  } catch (caught) {
    if (
      caught instanceof
      FinanceCheckError
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
      "FINANCE_CHECK_CLEAR_FAILED",
      caught,
    );

    return json(
      {
        error:
          "تعذر تحصيل الشيك",
      },
      500,
    );
  }
}

async function reverseCheckBeforeClear(
  request: Request,
  db: Db,
  env: Env,
  checkId: number,
  targetStatus:
    | "returned"
    | "cancelled",
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

  try {
    const reason =
      targetStatus ===
      "cancelled"
        ? requiredText(
            body?.reason,
            "سبب الإلغاء",
            500,
          )
        : optionalText(
            body?.reason,
            500,
          );

    const result =
      await db.transaction(
        async (tx) => {
          const rows =
            await tx
              .select()
              .from(
                financeChecksTable,
              )
              .where(
                eq(
                  financeChecksTable.id,
                  checkId,
                ),
              )
              .limit(1)
              .for("update");

          const check =
            rows[0];

          if (!check) {
            throw new FinanceCheckError(
              "الشيك غير موجود",
              404,
            );
          }

          if (
            check.status ===
            targetStatus
          ) {
            return {
              check,
              alreadyReversed:
                true,
            };
          }

          const reversible =
            check.direction ===
              "received"
              ? check.status ===
                  "on_hand" ||
                check.status ===
                  "deposited"
              : check.status ===
                  "issued";

          if (!reversible) {
            throw new FinanceCheckError(
              "حالة الشيك لا تسمح بالعكس",
              409,
            );
          }

          if (
            !check
              .initialFinanceTransactionId
          ) {
            throw new FinanceCheckError(
              "القيد الأصلي للشيك غير موجود",
              409,
            );
          }

          const lines:
            FinancePostingLineInput[] = [];

          if (
            check.direction ===
            "received"
          ) {
            if (
              !check.customerId
            ) {
              throw new FinanceCheckError(
                "الزبون المرتبط بالشيك غير موجود",
                409,
              );
            }

            const customerReceivable =
              await ensureCustomerReceivableControlAccount(
                tx,
              );

            const checkReceivable =
              await ensureCheckReceivable(
                tx,
              );

            lines.push(
              {
                accountId:
                  customerReceivable.id,
                customerId:
                  check.customerId,
                debitMinor:
                  check.baseAmountMinor,
                creditMinor: 0,
                memo:
                  `إعادة ذمة الزبون للشيك ${check.checkNumber}`,
              },
              {
                accountId:
                  checkReceivable.id,
                debitMinor: 0,
                creditMinor:
                  check.baseAmountMinor,
                memo:
                  `عكس الشيك المستلم ${check.checkNumber}`,
              },
            );
          } else {
            if (
              !check.supplierId
            ) {
              throw new FinanceCheckError(
                "المورد المرتبط بالشيك غير موجود",
                409,
              );
            }

            const checkPayable =
              await ensureCheckPayable(
                tx,
              );

            const supplierPayable =
              await ensureSupplierPayableControlAccount(
                tx,
              );

            lines.push(
              {
                accountId:
                  checkPayable.id,
                debitMinor:
                  check.baseAmountMinor,
                creditMinor: 0,
                memo:
                  `عكس الشيك الصادر ${check.checkNumber}`,
              },
              {
                accountId:
                  supplierPayable.id,
                supplierId:
                  check.supplierId,
                debitMinor: 0,
                creditMinor:
                  check.baseAmountMinor,
                memo:
                  `إعادة ذمة المورد للشيك ${check.checkNumber}`,
              },
            );
          }

          const posting =
            await postFinanceTransaction(
              tx,
              {
                publicId:
                  `FIN-CHK-${targetStatus.toUpperCase()}-${check.id}-${randomUUID().slice(0, 8).toUpperCase()}`,
                idempotencyKey:
                  `check:${check.id}:${targetStatus}`,
                businessDate:
                  currentPalestineDate(),
                transactionType:
                  "reversal",
                sourceType:
                  "finance_check",
                sourceId:
                  String(
                    check.id,
                  ),
                sourceEvent:
                  targetStatus,
                notes:
                  reason ??
                  `عكس الشيك ${check.checkNumber}`,
                createdByUserId:
                  auth.user.id,
                lines,
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
                check
                  .initialFinanceTransactionId,
              ),
            );

          const now =
            new Date();

          const updated =
            await tx
              .update(
                financeChecksTable,
              )
              .set(
                targetStatus ===
                "cancelled"
                  ? {
                      status:
                        "cancelled",
                      settlementFinanceTransactionId:
                        posting
                          .transaction
                          .id,
                      cancelledAt:
                        now,
                      cancelledByUserId:
                        auth.user.id,
                      cancelReason:
                        reason!,
                      updatedAt:
                        now,
                    }
                  : {
                      status:
                        "returned",
                      settlementFinanceTransactionId:
                        posting
                          .transaction
                          .id,
                      returnedAt:
                        now,
                      updatedAt:
                        now,
                    },
              )
              .where(
                eq(
                  financeChecksTable.id,
                  check.id,
                ),
              )
              .returning();

          return {
            check:
              updated[0],
            alreadyReversed:
              false,
          };
        },
      );

    return json(result);
  } catch (caught) {
    if (
      caught instanceof
      FinanceCheckError
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
      "FINANCE_CHECK_REVERSE_FAILED",
      caught,
    );

    return json(
      {
        error:
          "تعذر عكس الشيك",
      },
      500,
    );
  }
}

export async function handleFinanceCheckRequest(
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
      "/api/pos/finance/checks"
  ) {
    return handleListChecks(
      request,
      db,
      env,
    );
  }

  if (
    request.method ===
      "POST" &&
    path ===
      "/api/pos/finance/checks/received"
  ) {
    return createReceivedCheck(
      request,
      db,
      env,
    );
  }

  if (
    request.method ===
      "POST" &&
    path ===
      "/api/pos/finance/checks/issued"
  ) {
    return createIssuedCheck(
      request,
      db,
      env,
    );
  }

  const actionMatch =
    path.match(
      /^\/api\/pos\/finance\/checks\/(\d+)\/(deposit|clear|return|cancel)$/,
    );

  if (
    request.method ===
      "POST" &&
    actionMatch
  ) {
    const checkId =
      positiveId(
        actionMatch[1],
        "الشيك",
      );

    const action =
      actionMatch[2];

    if (
      action === "deposit"
    ) {
      return depositReceivedCheck(
        request,
        db,
        env,
        checkId,
      );
    }

    if (
      action === "clear"
    ) {
      return clearCheck(
        request,
        db,
        env,
        checkId,
      );
    }

    if (
      action === "return"
    ) {
      return reverseCheckBeforeClear(
        request,
        db,
        env,
        checkId,
        "returned",
      );
    }

    return reverseCheckBeforeClear(
      request,
      db,
      env,
      checkId,
      "cancelled",
    );
  }

  return null;
}
