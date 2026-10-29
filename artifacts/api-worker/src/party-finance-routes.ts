import {
  bankAccountsTable,
  cashSessionsTable,
  customersTable,
  employeesTable,
  expenseCategoriesTable,
  financeAccountsTable,
  financeTransactionLinesTable,
  financeTransactionsTable,
  financeVouchersTable,
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
import { userHasPermission } from "./staff-permissions";
import { handleEmployeeMonthClose, MONTH_CLOSE_SOURCE_TYPE, MONTH_CLOSE_EVENT, salaryMonthRange } from "./employee-month-close";
import { openDb, type Env } from "./db";
import {
  customerReceivableBalances,
  customerReceivableLedgerLines,
  ensureCustomerReceivableControlAccount,
} from "./finance-customer-ledger";
import {
  employeeAdvanceBalanceMinor,
  employeeBalancesAll,
  employeeLedgerLines,
  employeePayableBalanceMinor,
  ensureEmployeeAdvanceControlAccount,
  ensureEmployeePayableControlAccount,
} from "./finance-employee-ledger";
import {
  postFinanceTransaction,
  type FinanceTransactionType,
} from "./finance-posting";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

type PosUser =
  NonNullable<
    Awaited<ReturnType<typeof getCurrentUser>>
  >;

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

class PartyFinanceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

type AuthResult =
  | {
      ok: true;
      user: PosUser;
    }
  | {
      ok: false;
      response: Response;
    };

async function requirePosUser(
  request: Request,
  db: Db,
  env: Env,
): Promise<AuthResult> {
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
): Promise<AuthResult> {
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
      ok: false,
      response: json(
        {
          error:
            "هذه العملية متاحة للمالك فقط",
        },
        403,
      ),
    };
  }

  return auth;
}

function textValue(
  value: unknown,
  maxLength = 300,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (typeof value !== "string") {
    throw new PartyFinanceError(
      "قيمة نصية غير صالحة",
    );
  }

  const result =
    value.trim();

  if (!result) {
    return null;
  }

  if (
    result.length >
    maxLength
  ) {
    throw new PartyFinanceError(
      "القيمة النصية طويلة جدًا",
    );
  }

  return result;
}

function requiredText(
  value: unknown,
  label: string,
  maxLength = 200,
) {
  const result =
    textValue(
      value,
      maxLength,
    );

  if (!result) {
    throw new PartyFinanceError(
      `يجب إدخال ${label}`,
    );
  }

  return result;
}

function positiveId(
  value: unknown,
  label = "المعرّف",
) {
  const result =
    Number(value);

  if (
    !Number.isSafeInteger(
      result,
    ) ||
    result <= 0
  ) {
    throw new PartyFinanceError(
      `${label} غير صالح`,
    );
  }

  return result;
}

function moneyMinor(
  value: unknown,
  label = "المبلغ",
  allowZero = false,
) {
  const amount =
    typeof value === "number"
      ? value
      : Number(value);

  if (
    !Number.isFinite(amount)
  ) {
    throw new PartyFinanceError(
      `${label} غير صالح`,
    );
  }

  const minor =
    Math.round(
      amount * 100,
    );

  if (
    !Number.isSafeInteger(
      minor,
    ) ||
    minor < 0 ||
    (!allowZero &&
      minor === 0) ||
    minor > MAX_MINOR
  ) {
    throw new PartyFinanceError(
      `${label} غير صالح`,
    );
  }

  return minor;
}

function nullableMoneyMinor(
  value: unknown,
  label: string,
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  return moneyMinor(
    value,
    label,
    true,
  );
}

function normalizeStatus(
  value: unknown,
) {
  if (
    value === undefined
  ) {
    return undefined;
  }

  if (
    value !== "active" &&
    value !== "inactive"
  ) {
    throw new PartyFinanceError(
      "الحالة غير صالحة",
    );
  }

  return value;
}

function exchangeRateMicros(
  value: unknown,
  currencyCode: string,
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
    throw new PartyFinanceError(
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
    throw new PartyFinanceError(
      "سعر الصرف غير صالح",
    );
  }

  return micros;
}

function convertedBaseMinor(
  transactionAmountMinor: number,
  rateMicros: number,
) {
  const result =
    (
      BigInt(
        transactionAmountMinor,
      ) *
        BigInt(rateMicros) +
      500_000n
    ) /
    1_000_000n;

  if (
    result <= 0n ||
    result >
      BigInt(MAX_MINOR)
  ) {
    throw new PartyFinanceError(
      "القيمة بعد تحويل العملة خارج الحد المسموح",
    );
  }

  return Number(result);
}

type IncomingCardProcessor =
  | "arab"
  | "bop";

const INCOMING_CARD_PROCESSORS: Record<
  IncomingCardProcessor,
  {
    code: string;
    name: string;
  }
> = {
  arab: {
    code:
      "CARD_CLEARING_ARAB",
    name:
      "فيزا البنك العربي قيد التحصيل",
  },
  bop: {
    code:
      "CARD_CLEARING_BOP",
    name:
      "فيزا بنك فلسطين قيد التحصيل",
  },
};

function incomingCardProcessor(
  value: unknown,
): IncomingCardProcessor | null {
  return value === "arab" ||
    value === "bop"
    ? value
    : null;
}

function paymentMethod(
  value: unknown,
  defaultValue:
    | "cash"
    | "card"
    | "bank"
    | "non_cash" =
      "cash",
) {
  const result =
    value === undefined
      ? defaultValue
      : value;

  if (
    result !== "cash" &&
    result !== "card" &&
    result !== "bank" &&
    result !== "non_cash"
  ) {
    throw new PartyFinanceError(
      "طريقة الدفع غير صالحة",
    );
  }

  return result;
}

function registerKey(
  value: unknown,
) {
  const result =
    typeof value === "string"
      ? value
          .trim()
          .toLowerCase()
      : "main";

  if (
    !/^[a-z0-9_-]{1,50}$/.test(
      result,
    )
  ) {
    throw new PartyFinanceError(
      "معرّف الصندوق غير صالح",
    );
  }

  return result;
}

function currentPalestineDate() {
  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Asia/Hebron",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      },
    ).formatToParts(
      new Date(),
    );

  const values =
    Object.fromEntries(
      parts.map(
        (part) => [
          part.type,
          part.value,
        ],
      ),
    );

  return (
    `${values.year}-` +
    `${values.month}-` +
    `${values.day}`
  );
}

function randomCode(
  prefix: string,
) {
  return (
    `${prefix}_` +
    randomUUID()
      .slice(0, 8)
      .toUpperCase()
  );
}

async function ensureAccount(
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
    linkedEntityType?: string;
    linkedEntityId?: number;
  },
) {
  if (
    input.linkedEntityType &&
    input.linkedEntityId !==
      undefined
  ) {
    const linkedRows =
      await tx
        .select()
        .from(
          financeAccountsTable,
        )
        .where(
          and(
            eq(
              financeAccountsTable
                .linkedEntityType,
              input.linkedEntityType,
            ),
            eq(
              financeAccountsTable
                .linkedEntityId,
              input.linkedEntityId,
            ),
          ),
        )
        .limit(1);

    if (linkedRows[0]) {
      return linkedRows[0];
    }
  }

  const byCode =
    await tx
      .select()
      .from(
        financeAccountsTable,
      )
      .where(
        eq(
          financeAccountsTable
            .code,
          input.code,
        ),
      )
      .limit(1);

  if (byCode[0]) {
    return byCode[0];
  }

  const inserted =
    await tx
      .insert(
        financeAccountsTable,
      )
      .values({
        code: input.code,
        name: input.name,
        accountType:
          input.accountType,
        linkedEntityType:
          input.linkedEntityType ??
          null,
        linkedEntityId:
          input.linkedEntityId ??
          null,
        currencyCode: "ILS",
        status: "active",
      })
      .onConflictDoNothing()
      .returning();

  if (inserted[0]) {
    return inserted[0];
  }

  if (
    input.linkedEntityType &&
    input.linkedEntityId !==
      undefined
  ) {
    const retryLinked =
      await tx
        .select()
        .from(
          financeAccountsTable,
        )
        .where(
          and(
            eq(
              financeAccountsTable
                .linkedEntityType,
              input.linkedEntityType,
            ),
            eq(
              financeAccountsTable
                .linkedEntityId,
              input.linkedEntityId,
            ),
          ),
        )
        .limit(1);

    if (retryLinked[0]) {
      return retryLinked[0];
    }
  }

  const retryCode =
    await tx
      .select()
      .from(
        financeAccountsTable,
      )
      .where(
        eq(
          financeAccountsTable
            .code,
          input.code,
        ),
      )
      .limit(1);

  if (!retryCode[0]) {
    throw new Error(
      "FINANCE_ACCOUNT_CREATE_FAILED",
    );
  }

  return retryCode[0];
}

async function settlementAccount(
  tx: any,
  method:
    | "cash"
    | "card"
    | "bank",
  register: string,
  bankAccountId:
    number | null,
  cardProcessor:
    IncomingCardProcessor | null =
      null,
) {
  if (method === "cash") {
    return ensureAccount(
      tx,
      {
        code:
          `CASH_${register.toUpperCase()}`,
        name:
          register === "main"
            ? "الصندوق الرئيسي"
            : `الصندوق ${register}`,
        accountType:
          "asset",
      },
    );
  }

  if (method === "card") {
    if (cardProcessor) {
      const processor =
        INCOMING_CARD_PROCESSORS[
          cardProcessor
        ];

      return ensureAccount(
        tx,
        {
          code:
            processor.code,
          name:
            processor.name,
          accountType:
            "asset",
        },
      );
    }

    // Generic business-card settlement account remains for outgoing
    // expenses/employee payments. Incoming Visa receipts must always
    // choose one of the two POS terminals.
    return ensureAccount(
      tx,
      {
        code: "CARD_POS",
        name:
          "بطاقات / نقاط البيع",
        accountType:
          "asset",
      },
    );
  }

  if (!bankAccountId) {
    throw new PartyFinanceError(
      "اختر الحساب البنكي",
    );
  }

  const accountRows =
    await tx
      .select()
      .from(
        bankAccountsTable,
      )
      .where(
        and(
          eq(
            bankAccountsTable.id,
            bankAccountId,
          ),
          eq(
            bankAccountsTable.status,
            "active",
          ),
        ),
      )
      .limit(1);

  const bankAccount =
    accountRows[0];

  if (!bankAccount) {
    throw new PartyFinanceError(
      "الحساب البنكي غير موجود أو غير فعال",
      404,
    );
  }

  const financeRows =
    await tx
      .select()
      .from(
        financeAccountsTable,
      )
      .where(
        eq(
          financeAccountsTable.id,
          bankAccount.financeAccountId,
        ),
      )
      .limit(1);

  const financeAccount =
    financeRows[0];

  if (!financeAccount) {
    throw new PartyFinanceError(
      "الحساب المحاسبي للبنك غير موجود",
      409,
    );
  }

  return financeAccount;
}

async function customerBalances(
  db: Db,
) {
  return customerReceivableBalances(
    db,
  );
}

async function employeeBalances(
  db: Db,
) {
  return employeeBalancesAll(
    db,
  );
}

async function handleListCustomers(
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
    // The cashier exchange form needs a customer picker; allow read-only
    // customer lookups, never customer writes or ledger mutations.
    const user = await getCurrentUser(db, request, env);
    if (!user || !(await userHasPermission(db, user, "sales.exchange"))) {
      return auth.response;
    }
  }

  const url =
    new URL(request.url);

  const query =
    (
      url.searchParams
        .get("query") ??
      ""
    )
      .trim()
      .toLowerCase();

  const status =
    url.searchParams
      .get("status");

  const [
    rows,
    balances,
  ] =
    await Promise.all([
      db
        .select()
        .from(
          customersTable,
        )
        .orderBy(
          asc(
            customersTable.name,
          ),
        ),
      customerBalances(db),
    ]);

  const filtered =
    rows.filter(
      (customer) => {
        if (
          status &&
          customer.status !==
            status
        ) {
          return false;
        }

        if (!query) {
          return true;
        }

        return [
          customer.code,
          customer.name,
          customer.phone ?? "",
          customer.address ?? "",
        ].some(
          (value) =>
            value
              .toLowerCase()
              .includes(query),
        );
      },
    );

  return json({
    results:
      filtered.map(
        (customer) => ({
          ...customer,
          balanceMinor:
            balances.get(
              customer.id,
            ) ?? 0,
          balance:
            (
              balances.get(
                customer.id,
              ) ?? 0
            ) / 100,
        }),
      ),
  });
}

async function handleCreateCustomer(
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
          "بيانات الزبون غير صالحة",
      },
      400,
    );
  }

  try {
    const name =
      requiredText(
        body.name,
        "اسم الزبون",
        160,
      );

    const phone =
      textValue(
        body.phone,
        40,
      );

    const address =
      textValue(
        body.address,
        300,
      );

    const notes =
      textValue(
        body.notes,
        1000,
      );

    const creditLimitMinor =
      nullableMoneyMinor(
        body.creditLimit,
        "الحد الائتماني",
      );

    const result =
      await db.transaction(
        async (tx) => {
          const inserted =
            await tx
              .insert(
                customersTable,
              )
              .values({
                code:
                  randomCode(
                    "CUS",
                  ),
                name,
                phone,
                address,
                notes,
                creditLimitMinor,
                status:
                  "active",
                createdByUserId:
                  auth.user.id,
              })
              .returning();

          const customer =
            inserted[0];

          if (!customer) {
            throw new Error(
              "CUSTOMER_CREATE_FAILED",
            );
          }

          return customer;
        },
      );

    return json(
      {
        customer: result,
        balanceMinor: 0,
      },
      201,
    );
  } catch (caught) {
    if (
      caught instanceof
      PartyFinanceError
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
      "CUSTOMER_CREATE_FAILED",
      caught,
    );

    return json(
      {
        error:
          "تعذر إضافة الزبون",
      },
      500,
    );
  }
}

async function handleUpdateCustomer(
  request: Request,
  db: Db,
  env: Env,
  customerId: number,
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
          "بيانات الزبون غير صالحة",
      },
      400,
    );
  }

  try {
    const currentRows =
      await db
        .select()
        .from(
          customersTable,
        )
        .where(
          eq(
            customersTable.id,
            customerId,
          ),
        )
        .limit(1);

    const current =
      currentRows[0];

    if (!current) {
      throw new PartyFinanceError(
        "الزبون غير موجود",
        404,
      );
    }

    const name =
      body.name ===
      undefined
        ? current.name
        : requiredText(
            body.name,
            "اسم الزبون",
            160,
          );

    const phone =
      body.phone ===
      undefined
        ? current.phone
        : textValue(
            body.phone,
            40,
          );

    const address =
      body.address ===
      undefined
        ? current.address
        : textValue(
            body.address,
            300,
          );

    const notes =
      body.notes ===
      undefined
        ? current.notes
        : textValue(
            body.notes,
            1000,
          );

    const creditLimitMinor =
      body.creditLimit ===
      undefined
        ? current.creditLimitMinor
        : nullableMoneyMinor(
            body.creditLimit,
            "الحد الائتماني",
          );

    const status =
      normalizeStatus(
        body.status,
      ) ??
      current.status;

    const updated =
      await db.transaction(
        async (tx) => {
          const rows =
            await tx
              .update(
                customersTable,
              )
              .set({
                name,
                phone,
                address,
                notes,
                creditLimitMinor,
                status,
                updatedAt:
                  new Date(),
              })
              .where(
                eq(
                  customersTable.id,
                  customerId,
                ),
              )
              .returning();

          await tx
            .update(
              financeAccountsTable,
            )
            .set({
              name:
                `ذمم الزبون: ${name}`,
              updatedAt:
                new Date(),
            })
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

          return rows[0];
        },
      );

    return json({
      customer: updated,
    });
  } catch (caught) {
    if (
      caught instanceof
      PartyFinanceError
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
      "CUSTOMER_UPDATE_FAILED",
      caught,
    );

    return json(
      {
        error:
          "تعذر تعديل الزبون",
      },
      500,
    );
  }
}

async function handleCustomerLedger(
  request: Request,
  db: Db,
  env: Env,
  customerId: number,
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

  const customerRows =
    await db
      .select()
      .from(
        customersTable,
      )
      .where(
        eq(
          customersTable.id,
          customerId,
        ),
      )
      .limit(1);

  const customer =
    customerRows[0];

  if (!customer) {
    return json(
      {
        error:
          "الزبون غير موجود",
      },
      404,
    );
  }

  const lines =
    await customerReceivableLedgerLines(
      db,
      customerId,
    );

  const txIds =
    [
      ...new Set(
        lines.map(
          (line) =>
            line.transactionId,
        ),
      ),
    ];

  const transactions =
    txIds.length
      ? await db
          .select()
          .from(
            financeTransactionsTable,
          )
          .where(
            inArray(
              financeTransactionsTable
                .id,
              txIds,
            ),
          )
      : [];

  const txMap =
    new Map(
      transactions.map(
        (transaction) => [
          transaction.id,
          transaction,
        ],
      ),
    );

  let runningBalanceMinor =
    0;

  const entries =
    lines.map(
      (line) => {
        const transaction =
          txMap.get(
            line.transactionId,
          );

        const deltaMinor =
          line.debitMinor -
          line.creditMinor;

        runningBalanceMinor +=
          deltaMinor;

        return {
          lineId:
            line.id,
          transactionId:
            line.transactionId,
          publicId:
            transaction
              ?.publicId ??
            null,
          transactionType:
            transaction
              ?.transactionType ??
            null,
          sourceType:
            transaction
              ?.sourceType ??
            null,
          sourceId:
            transaction
              ?.sourceId ??
            null,
          sourceEvent:
            transaction
              ?.sourceEvent ??
            null,
          status:
            transaction
              ?.status ??
            null,
          businessDate:
            transaction
              ?.businessDate ??
            null,
          createdAt:
            transaction
              ?.createdAt ??
            line.createdAt,
          debitMinor:
            line.debitMinor,
          creditMinor:
            line.creditMinor,
          deltaMinor,
          runningBalanceMinor,
          memo:
            line.memo,
        };
      },
    );

  return json({
    customer,
    balanceMinor:
      runningBalanceMinor,
    balance:
      runningBalanceMinor /
      100,
    entries,
  });
}

async function handleListEmployees(
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

  const query =
    (
      url.searchParams
        .get("query") ??
      ""
    )
      .trim()
      .toLowerCase();

  const status =
    url.searchParams
      .get("status");

  const [
    rows,
    balances,
  ] =
    await Promise.all([
      db
        .select()
        .from(
          employeesTable,
        )
        .orderBy(
          asc(
            employeesTable.name,
          ),
        ),
      employeeBalances(db),
    ]);

  return json({
    results:
      rows
        .filter(
          (employee) => {
            if (
              status &&
              employee.status !==
                status
            ) {
              return false;
            }

            if (!query) {
              return true;
            }

            return [
              employee.code,
              employee.name,
              employee.phone ??
                "",
            ].some(
              (value) =>
                value
                  .toLowerCase()
                  .includes(
                    query,
                  ),
            );
          },
        )
        .map(
          (employee) => {
            const balance =
              balances.get(
                employee.id,
              ) ?? {
                advanceMinor:
                  0,
                payableMinor:
                  0,
              };

            return {
              ...employee,
              ...balance,
              netDueToEmployeeMinor:
                balance.payableMinor -
                balance.advanceMinor,
            };
          },
        ),
  });
}

async function handleCreateEmployee(
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
          "بيانات الموظف غير صالحة",
      },
      400,
    );
  }

  try {
    const name =
      requiredText(
        body.name,
        "اسم الموظف",
        160,
      );

    const phone =
      textValue(
        body.phone,
        40,
      );

    const baseSalaryMinor =
      body.baseSalary ===
      undefined
        ? 0
        : moneyMinor(
            body.baseSalary,
            "الراتب",
            true,
          );

    const hireDate =
      textValue(
        body.hireDate,
        20,
      );

    if (
      hireDate &&
      !/^\d{4}-\d{2}-\d{2}$/.test(
        hireDate,
      )
    ) {
      throw new PartyFinanceError(
        "تاريخ التعيين غير صالح",
      );
    }

    const userId =
      body.userId ===
        null ||
      body.userId ===
        undefined ||
      body.userId === ""
        ? null
        : positiveId(
            body.userId,
            "معرّف المستخدم",
          );

    const notes =
      textValue(
        body.notes,
        1000,
      );

    const employee =
      await db.transaction(
        async (tx) => {
          const rows =
            await tx
              .insert(
                employeesTable,
              )
              .values({
                code:
                  randomCode(
                    "EMP",
                  ),
                name,
                phone,
                userId,
                baseSalaryMinor,
                hireDate,
                status:
                  "active",
                notes,
                createdByUserId:
                  auth.user.id,
              })
              .returning();

          const inserted =
            rows[0];

          if (!inserted) {
            throw new Error(
              "EMPLOYEE_CREATE_FAILED",
            );
          }

          return inserted;
        },
      );

    return json(
      {
        employee,
        advanceMinor: 0,
        payableMinor: 0,
        netDueToEmployeeMinor:
          0,
      },
      201,
    );
  } catch (caught) {
    if (
      caught instanceof
      PartyFinanceError
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
      "EMPLOYEE_CREATE_FAILED",
      caught,
    );

    return json(
      {
        error:
          "تعذر إضافة الموظف",
      },
      500,
    );
  }
}

async function handleUpdateEmployee(
  request: Request,
  db: Db,
  env: Env,
  employeeId: number,
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
          "بيانات الموظف غير صالحة",
      },
      400,
    );
  }

  try {
    const currentRows =
      await db
        .select()
        .from(
          employeesTable,
        )
        .where(
          eq(
            employeesTable.id,
            employeeId,
          ),
        )
        .limit(1);

    const current =
      currentRows[0];

    if (!current) {
      throw new PartyFinanceError(
        "الموظف غير موجود",
        404,
      );
    }

    const name =
      body.name ===
      undefined
        ? current.name
        : requiredText(
            body.name,
            "اسم الموظف",
            160,
          );

    const phone =
      body.phone ===
      undefined
        ? current.phone
        : textValue(
            body.phone,
            40,
          );

    const baseSalaryMinor =
      body.baseSalary ===
      undefined
        ? current.baseSalaryMinor
        : moneyMinor(
            body.baseSalary,
            "الراتب",
            true,
          );

    const hireDate =
      body.hireDate ===
      undefined
        ? current.hireDate
        : textValue(
            body.hireDate,
            20,
          );

    if (
      hireDate &&
      !/^\d{4}-\d{2}-\d{2}$/.test(
        hireDate,
      )
    ) {
      throw new PartyFinanceError(
        "تاريخ التعيين غير صالح",
      );
    }

    const status =
      normalizeStatus(
        body.status,
      ) ??
      current.status;

    const notes =
      body.notes ===
      undefined
        ? current.notes
        : textValue(
            body.notes,
            1000,
          );

    const userId =
      body.userId ===
      undefined
        ? current.userId
        : body.userId ===
              null ||
            body.userId ===
              ""
          ? null
          : positiveId(
              body.userId,
              "معرّف المستخدم",
            );

    const updated =
      await db.transaction(
        async (tx) => {
          const rows =
            await tx
              .update(
                employeesTable,
              )
              .set({
                name,
                phone,
                userId,
                baseSalaryMinor,
                hireDate,
                status,
                notes,
                updatedAt:
                  new Date(),
              })
              .where(
                eq(
                  employeesTable.id,
                  employeeId,
                ),
              )
              .returning();

          await tx
            .update(
              financeAccountsTable,
            )
            .set({
              name:
                `سلف ومسحوبات الموظف: ${name}`,
              updatedAt:
                new Date(),
            })
            .where(
              and(
                eq(
                  financeAccountsTable
                    .linkedEntityType,
                  "employee_advance",
                ),
                eq(
                  financeAccountsTable
                    .linkedEntityId,
                  employeeId,
                ),
              ),
            );

          await tx
            .update(
              financeAccountsTable,
            )
            .set({
              name:
                `مستحقات الموظف: ${name}`,
              updatedAt:
                new Date(),
            })
            .where(
              and(
                eq(
                  financeAccountsTable
                    .linkedEntityType,
                  "employee_payable",
                ),
                eq(
                  financeAccountsTable
                    .linkedEntityId,
                  employeeId,
                ),
              ),
            );

          return rows[0];
        },
      );

    return json({
      employee: updated,
    });
  } catch (caught) {
    if (
      caught instanceof
      PartyFinanceError
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
      "EMPLOYEE_UPDATE_FAILED",
      caught,
    );

    return json(
      {
        error:
          "تعذر تعديل الموظف",
      },
      500,
    );
  }
}

async function handleEmployeeLedger(
  request: Request,
  db: Db,
  env: Env,
  employeeId: number,
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

  const employeeRows =
    await db
      .select()
      .from(
        employeesTable,
      )
      .where(
        eq(
          employeesTable.id,
          employeeId,
        ),
      )
      .limit(1);

  const employee =
    employeeRows[0];

  if (!employee) {
    return json(
      {
        error:
          "الموظف غير موجود",
      },
      404,
    );
  }

  const ledgerEntries =
    await employeeLedgerLines(
      db,
      employeeId,
    );

  const lines =
    ledgerEntries.map(
      (entry) =>
        entry.line,
    );

  const accountTypeByLineId =
    new Map(
      ledgerEntries.map(
        (entry) => [
          entry.line.id,
          entry.kind,
        ],
      ),
    );

  const txIds =
    [
      ...new Set(
        lines.map(
          (line) =>
            line.transactionId,
        ),
      ),
    ];

  const transactions =
    txIds.length
      ? await db
          .select()
          .from(
            financeTransactionsTable,
          )
          .where(
            inArray(
              financeTransactionsTable
                .id,
              txIds,
            ),
          )
      : [];

  const txMap =
    new Map(
      transactions.map(
        (transaction) => [
          transaction.id,
          transaction,
        ],
      ),
    );

  const voucherPeriods =
    txIds.length
      ? await db
          .select({
            financeTransactionId:
              financeVouchersTable.financeTransactionId,
            referencePeriod:
              financeVouchersTable.referencePeriod,
          })
          .from(
            financeVouchersTable,
          )
          .where(
            inArray(
              financeVouchersTable.financeTransactionId,
              txIds,
            ),
          )
      : [];

  const referencePeriodByTransactionId =
    new Map(
      voucherPeriods
        .filter(
          (
            voucher,
          ): voucher is {
            financeTransactionId: number;
            referencePeriod:
              | string
              | null;
          } =>
            voucher.financeTransactionId !==
            null,
        )
        .map(
          (voucher) => [
            voucher.financeTransactionId,
            voucher.referencePeriod,
          ],
        ),
    );

  let advanceMinor = 0;
  let payableMinor = 0;

  const entries =
    lines.map(
      (line) => {
        const kind =
          accountTypeByLineId.get(
            line.id,
          );

        const transaction =
          txMap.get(
            line.transactionId,
          );

        if (
          kind ===
          "employee_advance"
        ) {
          advanceMinor +=
            line.debitMinor -
            line.creditMinor;
        } else {
          payableMinor +=
            line.creditMinor -
            line.debitMinor;
        }

        return {
          lineId:
            line.id,
          accountKind:
            kind,
          publicId:
            transaction
              ?.publicId ??
            null,
          transactionType:
            transaction
              ?.transactionType ??
            null,
          sourceEvent:
            transaction
              ?.sourceEvent ??
            null,
          status:
            transaction
              ?.status ??
            null,
          businessDate:
            transaction
              ?.businessDate ??
            null,
          referencePeriod:
            referencePeriodByTransactionId.get(line.transactionId) ??
            (transaction?.sourceType === MONTH_CLOSE_SOURCE_TYPE
              ? transaction.sourceId : null),
          createdAt:
            transaction
              ?.createdAt ??
            line.createdAt,
          debitMinor:
            line.debitMinor,
          creditMinor:
            line.creditMinor,
          memo:
            line.memo,
        };
      },
    );

  return json({
    employee,
    advanceMinor,
    payableMinor,
    netDueToEmployeeMinor:
      payableMinor -
      advanceMinor,
    entries,
  });
}

type VoucherType =
  | "customer_receipt"
  | "expense"
  | "employee_advance"
  | "employee_repayment"
  | "salary_accrual"
  | "employee_payment"
  | "owner_withdrawal";

function isIncomingCash(
  voucherType:
    VoucherType,
) {
  return (
    voucherType ===
      "customer_receipt" ||
    voucherType ===
      "employee_repayment"
  );
}

function financeTransactionType(
  voucherType:
    VoucherType,
) {
  if (
    voucherType ===
      "customer_receipt" ||
    voucherType ===
      "employee_repayment"
  ) {
    return "receipt";
  }

  if (
    voucherType ===
      "expense" ||
    voucherType ===
      "salary_accrual"
  ) {
    return "expense";
  }

  return "payment";
}

async function createVoucher(
  request: Request,
  db: Db,
  env: Env,
  input: {
    voucherType:
      VoucherType;
    partyType?:
      | "customer"
      | "employee"
      | "owner";
    partyId?: number;
    ownerOnly?: boolean;
  },
) {
  const auth =
    input.ownerOnly
      ? await requireOwner(
          request,
          db,
          env,
        )
      : await requirePosUser(
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
          "بيانات السند غير صالحة",
      },
      400,
    );
  }

  try {
    const transactionAmountMinor =
      moneyMinor(
        body.amount,
        "المبلغ",
      );

    const method =
      input.voucherType ===
      "salary_accrual"
        ? "non_cash"
        : paymentMethod(
            body.paymentMethod,
          );

    if (
      method ===
        "non_cash" &&
      input.voucherType !==
        "salary_accrual"
    ) {
      throw new PartyFinanceError(
        "طريقة الدفع غير صالحة لهذه الحركة",
      );
    }

    const cardProcessor =
      incomingCardProcessor(
        body.cardProcessor,
      );

    const incomingCard =
      method === "card" &&
      (
        input.voucherType ===
          "customer_receipt" ||
        input.voucherType ===
          "employee_repayment"
      );

    if (
      incomingCard &&
      !cardProcessor
    ) {
      throw new PartyFinanceError(
        "اختر ماكينة الفيزا: البنك العربي أو بنك فلسطين",
      );
    }

    if (
      method !== "card" &&
      body.cardProcessor !==
        undefined &&
      body.cardProcessor !==
        null &&
      body.cardProcessor !==
        ""
    ) {
      throw new PartyFinanceError(
        "ماكينة الفيزا متاحة فقط عند الدفع بالفيزا",
      );
    }

    let bankAccountId:
      number | null =
      null;

    let currencyCode =
      "ILS";

    if (
      method === "bank"
    ) {
      bankAccountId =
        positiveId(
          body.bankAccountId,
          "الحساب البنكي",
        );

      const bankRows =
        await db
          .select()
          .from(
            bankAccountsTable,
          )
          .where(
            and(
              eq(
                bankAccountsTable.id,
                bankAccountId,
              ),
              eq(
                bankAccountsTable.status,
                "active",
              ),
            ),
          )
          .limit(1);

      const bankAccount =
        bankRows[0];

      if (!bankAccount) {
        throw new PartyFinanceError(
          "الحساب البنكي غير موجود أو غير فعال",
          404,
        );
      }

      currencyCode =
        bankAccount.currencyCode;
    } else if (
      body.currencyCode !==
        undefined &&
      body.currencyCode !==
        null &&
      String(
        body.currencyCode,
      )
        .trim()
        .toUpperCase() !==
        "ILS"
    ) {
      throw new PartyFinanceError(
        "العملة الأجنبية مدعومة حاليًا للحركات البنكية فقط",
      );
    }

    const rateMicros =
      exchangeRateMicros(
        body.exchangeRate,
        currencyCode,
      );

    const amountMinor =
      convertedBaseMinor(
        transactionAmountMinor,
        rateMicros,
      );

    const register =
      registerKey(
        body.registerKey,
      );

    const notes =
      textValue(
        body.notes,
        1000,
      );

    const referencePeriod =
      textValue(
        body.referencePeriod,
        30,
      );

    if (input.voucherType === "salary_accrual" &&
        (!referencePeriod || !salaryMonthRange(referencePeriod))) {
      throw new PartyFinanceError("اختر شهر استحقاق الراتب بصيغة سنة-شهر");
    }
    if (input.voucherType === "salary_accrual" &&
        referencePeriod! > currentPalestineDate().slice(0, 7)) {
      throw new PartyFinanceError("لا يمكن تسجيل استحقاق راتب لشهر مستقبلي");
    }

    const idempotencyKey =
      textValue(
        body.idempotencyKey,
        160,
      ) ??
      `voucher:${randomUUID()}`;

    if (
      idempotencyKey.length <
      8
    ) {
      throw new PartyFinanceError(
        "مفتاح منع التكرار غير صالح",
      );
    }

    const existingRows =
      await db
        .select()
        .from(
          financeVouchersTable,
        )
        .where(
          eq(
            financeVouchersTable
              .idempotencyKey,
            idempotencyKey,
          ),
        )
        .limit(1);

    if (existingRows[0]) {
      return json({
        alreadyCreated: true,
        voucher:
          existingRows[0],
      });
    }

    const effectivePartyId =
      input.partyType === "owner" && input.partyId === authOwnerSentinel
        ? auth.user.id
        : input.partyId;

    const result =
      await db.transaction(
        async (tx) => {
          let party:
            | {
                id: number;
                name: string;
                status?:
                  string;
              }
            | null =
            null;

          if (
            input.partyType ===
              "customer"
          ) {
            const rows =
              await tx
                .select({
                  id:
                    customersTable.id,
                  name:
                    customersTable.name,
                })
                .from(
                  customersTable,
                )
                .where(
                  eq(
                    customersTable.id,
                    input.partyId!,
                  ),
                )
                .limit(1);

            party =
              rows[0] ??
              null;

            if (!party) {
              throw new PartyFinanceError(
                "الزبون غير موجود",
                404,
              );
            }
          }

          if (
            input.partyType ===
              "employee"
          ) {
            const rows =
              await tx
                .select({
                  id:
                    employeesTable.id,
                  name:
                    employeesTable.name,
                  status:
                    employeesTable.status,
                })
                .from(
                  employeesTable,
                )
                .where(
                  eq(
                    employeesTable.id,
                    input.partyId!,
                  ),
                )
                .limit(1)
                .for("update");

            party =
              rows[0] ??
              null;

            if (!party) {
              throw new PartyFinanceError(
                "الموظف غير موجود",
                404,
              );
            }

            if (
              party.status !==
                "active" &&
              (
                input.voucherType ===
                  "employee_advance" ||
                input.voucherType ===
                  "salary_accrual"
              )
            ) {
              throw new PartyFinanceError(
                input.voucherType ===
                  "salary_accrual"
                  ? "لا يمكن تسجيل استحقاق راتب جديد لموظف غير فعال"
                  : "لا يمكن تسجيل سلفة جديدة لموظف غير فعال",
                409,
              );
            }

            if (
              input.voucherType ===
              "salary_accrual"
            ) {
              // Serialize salary creation against the month closing action.
              await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"salary_month_close:" + referencePeriod!}))`);
              const closedRows = await tx.select({ id: financeTransactionsTable.id })
                .from(financeTransactionsTable)
                .where(and(
                  eq(financeTransactionsTable.sourceType, MONTH_CLOSE_SOURCE_TYPE),
                  eq(financeTransactionsTable.sourceId, referencePeriod!),
                  eq(financeTransactionsTable.sourceEvent, MONTH_CLOSE_EVENT),
                  eq(financeTransactionsTable.status, "posted"),
                )).limit(1);
              if (closedRows.length > 0) {
                throw new PartyFinanceError("شهر الرواتب مغلق؛ لا يمكن إنشاء استحقاق جديد بعد المقاصة", 409);
              }
              const salaryLockKey =
                `employee_salary:${party.id}:${referencePeriod}`;

              await tx.execute(
                sql`select pg_advisory_xact_lock(hashtext(${salaryLockKey}))`,
              );

              const existingSalaryRows =
                await tx
                  .select({
                    id:
                      financeVouchersTable.id,
                    publicId:
                      financeVouchersTable.publicId,
                  })
                  .from(
                    financeVouchersTable,
                  )
                  .where(
                    and(
                      eq(
                        financeVouchersTable.voucherType,
                        "salary_accrual",
                      ),
                      eq(
                        financeVouchersTable.partyType,
                        "employee",
                      ),
                      eq(
                        financeVouchersTable.partyId,
                        party.id,
                      ),
                      eq(
                        financeVouchersTable.referencePeriod,
                        referencePeriod!,
                      ),
                      eq(
                        financeVouchersTable.status,
                        "posted",
                      ),
                    ),
                  )
                  .limit(1);

              const existingSalary =
                existingSalaryRows[0];

              if (
                existingSalary
              ) {
                throw new PartyFinanceError(
                  `تم تسجيل استحقاق راتب ${referencePeriod} لهذا الموظف مسبقًا (${existingSalary.publicId}). اعكس الحركة السابقة أولًا إذا كانت بحاجة لتصحيح.`,
                  409,
                );
              }
            }
          }

          let category:
            | typeof expenseCategoriesTable.$inferSelect
            | null =
            null;

          if (
            input.voucherType ===
              "expense"
          ) {
            const categoryId =
              positiveId(
                body.expenseCategoryId,
                "تصنيف المصروف",
              );

            const rows =
              await tx
                .select()
                .from(
                  expenseCategoriesTable,
                )
                .where(
                  and(
                    eq(
                      expenseCategoriesTable.id,
                      categoryId,
                    ),
                    eq(
                      expenseCategoriesTable.status,
                      "active",
                    ),
                  ),
                )
                .limit(1);

            category =
              rows[0] ??
              null;

            if (!category) {
              throw new PartyFinanceError(
                "تصنيف المصروف غير موجود أو غير فعال",
                404,
              );
            }
          }


          let session:
            | typeof cashSessionsTable.$inferSelect
            | null =
            null;

          let expectedBefore:
            | number
            | null =
            null;

          let expectedAfter:
            | number
            | null =
            null;

          if (
            method === "cash"
          ) {
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
                      register,
                    ),
                    eq(
                      cashSessionsTable.status,
                      "open",
                    ),
                  ),
                )
                .limit(1)
                .for("update");

            session =
              rows[0] ??
              null;

            if (!session) {
              throw new PartyFinanceError(
                "يجب فتح الصندوق أولًا للحركة النقدية",
                409,
              );
            }

            expectedBefore =
              session.expectedBalanceMinor ??
              session.openingBalanceMinor;

            const incoming =
              isIncomingCash(
                input.voucherType,
              );

            if (
              !incoming &&
              expectedBefore <
                amountMinor
            ) {
              throw new PartyFinanceError(
                "رصيد الصندوق لا يكفي لهذه الحركة",
                409,
              );
            }

            expectedAfter =
              incoming
                ? expectedBefore +
                  amountMinor
                : expectedBefore -
                  amountMinor;

            if (
              !Number.isSafeInteger(
                expectedAfter,
              ) ||
              expectedAfter <
                0 ||
              expectedAfter >
                MAX_MINOR
            ) {
              throw new PartyFinanceError(
                "رصيد الصندوق المتوقع غير صالح",
              );
            }
          }

          // A salary accrual belongs to its reference month, even when
          // the owner closes that month later. No cash session is involved.
          const businessDate = input.voucherType === "salary_accrual"
            ? salaryMonthRange(referencePeriod!)!.end
            : currentPalestineDate();

          const voucherPublicId =
            (
              input.voucherType ===
                "customer_receipt"
                ? "REC"
                : input.voucherType ===
                    "expense"
                  ? "EXP"
                  : input.voucherType ===
                      "owner_withdrawal"
                    ? "OWN"
                    : "EMP"
            ) +
            "-" +
            businessDate.replaceAll(
              "-",
              "",
            ) +
            "-" +
            randomUUID()
              .slice(0, 8)
              .toUpperCase();

          const voucherRows =
            await tx
              .insert(
                financeVouchersTable,
              )
              .values({
                publicId:
                  voucherPublicId,
                idempotencyKey,
                voucherType:
                  input.voucherType,
                partyType:
                  input.partyType ??
                  null,
                partyId:
                  effectivePartyId ??
                  null,
                expenseCategoryId:
                  category?.id ??
                  null,
                paymentMethod:
                  method,
                amountMinor,
                currencyCode,
                transactionAmountMinor,
                exchangeRateMicros:
                  rateMicros,
                bankAccountId,
                businessDate,
                referencePeriod,
                cashSessionId:
                  session?.id ??
                  null,
                financeTransactionId:
                  null,
                status:
                  "posted",
                notes,
                createdByUserId:
                  auth.user.id,
              })
              .returning();

          const voucher =
            voucherRows[0];

          if (!voucher) {
            throw new Error(
              "VOUCHER_CREATE_FAILED",
            );
          }

          let debitAccountId:
            number;
          let creditAccountId:
            number;
          let debitMemo:
            string;
          let creditMemo:
            string;
          let debitCustomerId:
            number | null =
            null;
          let creditCustomerId:
            number | null =
            null;
          let debitEmployeeId:
            number | null =
            null;
          let creditEmployeeId:
            number | null =
            null;
          let debitCurrencyCode:
            string | null =
            null;
          let debitCurrencyAmountMinor:
            number | null =
            null;
          let debitExchangeRateMicros:
            number | null =
            null;
          let creditCurrencyCode:
            string | null =
            null;
          let creditCurrencyAmountMinor:
            number | null =
            null;
          let creditExchangeRateMicros:
            number | null =
            null;

          const markDebitSettlement =
            () => {
              if (
                method ===
                "bank"
              ) {
                debitCurrencyCode =
                  currencyCode;
                debitCurrencyAmountMinor =
                  transactionAmountMinor;
                debitExchangeRateMicros =
                  rateMicros;
              }
            };

          const markCreditSettlement =
            () => {
              if (
                method ===
                "bank"
              ) {
                creditCurrencyCode =
                  currencyCode;
                creditCurrencyAmountMinor =
                  transactionAmountMinor;
                creditExchangeRateMicros =
                  rateMicros;
              }
            };

          if (
            input.voucherType ===
              "customer_receipt"
          ) {
            const destination =
              await settlementAccount(
                tx,
                method as
                  | "cash"
                  | "card"
                  | "bank",
                register,
                bankAccountId,
                cardProcessor,
              );

            const customerAccount =
              await ensureCustomerReceivableControlAccount(
                tx,
              );

            debitAccountId =
              destination.id;
            markDebitSettlement();

            creditAccountId =
              customerAccount.id;
            creditCustomerId =
              party!.id;

            debitMemo =
              `قبض من الزبون ${party!.name}`;

            creditMemo =
              `تخفيض ذمة الزبون ${party!.name}`;
          } else if (
            input.voucherType ===
              "expense"
          ) {
            const destination =
              await settlementAccount(
                tx,
                method as
                  | "cash"
                  | "card"
                  | "bank",
                register,
                bankAccountId,
              );

            debitAccountId =
              category!
                .financeAccountId;

            creditAccountId =
              destination.id;
            markCreditSettlement();

            debitMemo =
              `مصروف: ${category!.name}`;

            creditMemo =
              `دفع مصروف: ${category!.name}`;
          } else if (
            input.voucherType ===
              "employee_advance"
          ) {
            const employeeAdvance =
              await ensureEmployeeAdvanceControlAccount(
                tx,
              );

            const destination =
              await settlementAccount(
                tx,
                method as
                  | "cash"
                  | "card"
                  | "bank",
                register,
                bankAccountId,
              );

            debitAccountId =
              employeeAdvance.id;
            debitEmployeeId =
              party!.id;

            creditAccountId =
              destination.id;
            markCreditSettlement();

            debitMemo =
              `سلفة / مسحوب للموظف ${party!.name}`;

            creditMemo =
              `دفع سلفة للموظف ${party!.name}`;
          } else if (
            input.voucherType ===
              "employee_repayment"
          ) {
            const employeeAdvance =
              await ensureEmployeeAdvanceControlAccount(
                tx,
              );

            const advanceBalance =
              await employeeAdvanceBalanceMinor(
                tx,
                party!.id,
              );

            if (
              amountMinor >
              advanceBalance
            ) {
              throw new PartyFinanceError(
                "المبلغ أكبر من رصيد السلفة على الموظف",
                409,
              );
            }

            const destination =
              await settlementAccount(
                tx,
                method as
                  | "cash"
                  | "card"
                  | "bank",
                register,
                bankAccountId,
                cardProcessor,
              );

            debitAccountId =
              destination.id;
            markDebitSettlement();

            creditAccountId =
              employeeAdvance.id;
            creditEmployeeId =
              party!.id;

            debitMemo =
              `تسديد من الموظف ${party!.name}`;

            creditMemo =
              `تخفيض سلفة الموظف ${party!.name}`;
          } else if (
            input.voucherType ===
              "salary_accrual"
          ) {
            const salaryExpense =
              await ensureAccount(
                tx,
                {
                  code:
                    "EXPENSE_SALARY",
                  name:
                    "مصروف الرواتب",
                  accountType:
                    "expense",
                },
              );

            const employeePayable =
              await ensureEmployeePayableControlAccount(
                tx,
              );

            debitAccountId =
              salaryExpense.id;

            creditAccountId =
              employeePayable.id;
            creditEmployeeId =
              party!.id;

            debitMemo =
              `استحقاق راتب ${party!.name}`;

            creditMemo =
              `راتب مستحق للموظف ${party!.name}`;
          } else if (
            input.voucherType ===
              "employee_payment"
          ) {
            const employeePayable =
              await ensureEmployeePayableControlAccount(
                tx,
              );

            const payableBalance =
              await employeePayableBalanceMinor(
                tx,
                party!.id,
              );

            if (
              amountMinor >
              payableBalance
            ) {
              throw new PartyFinanceError(
                "المبلغ أكبر من مستحقات الموظف",
                409,
              );
            }

            const destination =
              await settlementAccount(
                tx,
                method as
                  | "cash"
                  | "card"
                  | "bank",
                register,
                bankAccountId,
              );

            debitAccountId =
              employeePayable.id;
            debitEmployeeId =
              party!.id;

            creditAccountId =
              destination.id;
            markCreditSettlement();

            debitMemo =
              `دفع مستحقات الموظف ${party!.name}`;

            creditMemo =
              `دفعة للموظف ${party!.name}`;
          } else {
            const ownerDrawings =
              await ensureAccount(
                tx,
                {
                  code:
                    "OWNER_DRAWINGS",
                  name:
                    "مسحوبات المالك الشخصية",
                  accountType:
                    "equity",
                },
              );

            const destination =
              await settlementAccount(
                tx,
                method as
                  | "cash"
                  | "card"
                  | "bank",
                register,
                bankAccountId,
              );

            debitAccountId =
              ownerDrawings.id;

            creditAccountId =
              destination.id;
            markCreditSettlement();

            debitMemo =
              "مسحوبات شخصية للمالك";

            creditMemo =
              "دفع مسحوبات شخصية للمالك";
          }

          const financePosting =
            await postFinanceTransaction(
              tx,
              {
                publicId:
                  `FIN-${businessDate.replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
                idempotencyKey:
                  `voucher:${voucher.id}:posted`,
                businessDate,
                transactionType:
                  financeTransactionType(
                    input.voucherType,
                  ) as FinanceTransactionType,
                sourceType:
                  "finance_voucher",
                sourceId:
                  String(
                    voucher.id,
                  ),
                sourceEvent:
                  input.voucherType,
                cashSessionId:
                  session?.id ??
                  null,
                notes:
                  notes ??
                  voucher.publicId,
                createdByUserId:
                  auth.user.id,
                lines: [
                  {
                    accountId:
                      debitAccountId,
                    customerId:
                      debitCustomerId,
                    employeeId:
                      debitEmployeeId,
                    currencyCode:
                      debitCurrencyCode,
                    currencyAmountMinor:
                      debitCurrencyAmountMinor,
                    exchangeRateMicros:
                      debitExchangeRateMicros,
                    debitMinor:
                      amountMinor,
                    creditMinor: 0,
                    memo:
                      debitMemo,
                  },
                  {
                    accountId:
                      creditAccountId,
                    customerId:
                      creditCustomerId,
                    employeeId:
                      creditEmployeeId,
                    currencyCode:
                      creditCurrencyCode,
                    currencyAmountMinor:
                      creditCurrencyAmountMinor,
                    exchangeRateMicros:
                      creditExchangeRateMicros,
                    debitMinor: 0,
                    creditMinor:
                      amountMinor,
                    memo:
                      creditMemo,
                  },
                ],
              },
            );

          const financeTransaction =
            financePosting.transaction;

          const updatedVoucherRows =
            await tx
              .update(
                financeVouchersTable,
              )
              .set({
                financeTransactionId:
                  financeTransaction.id,
                updatedAt:
                  new Date(),
              })
              .where(
                eq(
                  financeVouchersTable.id,
                  voucher.id,
                ),
              )
              .returning();

          if (
            session &&
            expectedAfter !==
              null
          ) {
            const sessionRows =
              await tx
                .update(
                  cashSessionsTable,
                )
                .set({
                  expectedBalanceMinor:
                    expectedAfter,
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
                  ),
                )
                .returning({
                  id:
                    cashSessionsTable.id,
                });

            if (
              !sessionRows[0]
            ) {
              throw new PartyFinanceError(
                "تم إغلاق الصندوق قبل إتمام الحركة",
                409,
              );
            }
          }

          return {
            voucher:
              updatedVoucherRows[0] ??
              voucher,
            financeTransaction,
            expectedCashBeforeMinor:
              expectedBefore,
            expectedCashAfterMinor:
              expectedAfter,
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
      PartyFinanceError
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
      "FINANCE_VOUCHER_CREATE_FAILED",
      caught,
    );

    return json(
      {
        error:
          "تعذر تسجيل الحركة المالية",
      },
      500,
    );
  }
}

async function handleExpenseCategories(
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
      .select()
      .from(
        expenseCategoriesTable,
      )
      .orderBy(
        asc(
          expenseCategoriesTable.name,
        ),
      );

  return json({
    results: rows,
  });
}

async function handleCreateExpenseCategory(
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
          "بيانات التصنيف غير صالحة",
      },
      400,
    );
  }

  try {
    const name =
      requiredText(
        body.name,
        "اسم التصنيف",
        120,
      );

    const generated =
      randomUUID()
        .slice(0, 8)
        .toUpperCase();

    const result =
      await db.transaction(
        async (tx) => {
          const account =
            await ensureAccount(
              tx,
              {
                code:
                  `EXPENSE_CUSTOM_${generated}`,
                name:
                  `مصروف: ${name}`,
                accountType:
                  "expense",
              },
            );

          const rows =
            await tx
              .insert(
                expenseCategoriesTable,
              )
              .values({
                code:
                  `custom_${generated}`,
                name,
                financeAccountId:
                  account.id,
                status:
                  "active",
                createdByUserId:
                  auth.user.id,
              })
              .returning();

          return rows[0];
        },
      );

    return json(
      {
        category:
          result,
      },
      201,
    );
  } catch (caught) {
    if (
      caught instanceof
      PartyFinanceError
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
      "EXPENSE_CATEGORY_CREATE_FAILED",
      caught,
    );

    return json(
      {
        error:
          "تعذر إضافة تصنيف المصروف",
      },
      500,
    );
  }
}

async function handleListVouchers(
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

  const type =
    url.searchParams
      .get("type");

  const date =
    url.searchParams
      .get("date");

  const rows =
    await db
      .select()
      .from(
        financeVouchersTable,
      )
      .orderBy(
        desc(
          financeVouchersTable
            .createdAt,
        ),
        desc(
          financeVouchersTable.id,
        ),
      )
      .limit(500);

  const filtered =
    rows.filter(
      (row) =>
        (!type ||
          row.voucherType ===
            type) &&
        (!date ||
          row.businessDate ===
            date),
    );

  const financeTransactionIds =
    filtered
      .filter(
        (row) =>
          row.paymentMethod ===
            "card" &&
          row.financeTransactionId !==
            null,
      )
      .map(
        (row) =>
          row.financeTransactionId!,
      );

  const terminalLines =
    financeTransactionIds.length >
    0
      ? await db
          .select({
            transactionId:
              financeTransactionLinesTable
                .transactionId,
            accountCode:
              financeAccountsTable.code,
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
              financeTransactionIds,
            ),
          )
      : [];

  const cardProcessorByTransactionId =
    new Map<
      number,
      IncomingCardProcessor
    >();

  for (
    const line of terminalLines
  ) {
    if (
      line.accountCode ===
      "CARD_CLEARING_ARAB"
    ) {
      cardProcessorByTransactionId.set(
        line.transactionId,
        "arab",
      );
    } else if (
      line.accountCode ===
      "CARD_CLEARING_BOP"
    ) {
      cardProcessorByTransactionId.set(
        line.transactionId,
        "bop",
      );
    }
  }

  return json({
    results:
      filtered.map(
        (row) => ({
          ...row,
          cardProcessor:
            row.financeTransactionId ===
            null
              ? null
              : cardProcessorByTransactionId.get(
                  row.financeTransactionId,
                ) ?? null,
        }),
      ),
  });
}

async function handleVoidVoucher(
  request: Request,
  db: Db,
  env: Env,
  voucherId: number,
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
      requiredText(
        body?.reason,
        "سبب الإلغاء",
        500,
      );

    const result =
      await db.transaction(
        async (tx) => {
          const voucherRows =
            await tx
              .select()
              .from(
                financeVouchersTable,
              )
              .where(
                eq(
                  financeVouchersTable.id,
                  voucherId,
                ),
              )
              .limit(1)
              .for("update");

          const voucher =
            voucherRows[0];

          if (!voucher) {
            throw new PartyFinanceError(
              "السند غير موجود",
              404,
            );
          }

          if (
            voucher.status !==
            "posted"
          ) {
            throw new PartyFinanceError(
              "السند ملغى مسبقًا",
              409,
            );
          }

          if (voucher.partyType === "employee" &&
              (voucher.voucherType === "salary_accrual" ||
               voucher.voucherType === "employee_advance" ||
               voucher.voucherType === "employee_repayment")) {
              const affectedPeriod = voucher.voucherType === "salary_accrual"
                ? voucher.referencePeriod : voucher.businessDate.slice(0, 7);
              if (affectedPeriod) {
                await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"salary_month_close:" + affectedPeriod}))`);
                const closed = await tx.select({ id: financeTransactionsTable.id })
                  .from(financeTransactionsTable)
                  .where(and(
                    eq(financeTransactionsTable.sourceType, MONTH_CLOSE_SOURCE_TYPE),
                    eq(financeTransactionsTable.sourceId, affectedPeriod),
                    eq(financeTransactionsTable.sourceEvent, MONTH_CLOSE_EVENT),
                    eq(financeTransactionsTable.status, "posted"),
                  )).limit(1);
                if (closed.length > 0) {
                  throw new PartyFinanceError("هذا الشهر مغلق؛ لا يمكن إلغاء حركة سلف أو استحقاق بعد المقاصة", 409);
                }
              }
          }

          const isForeignCustomerReceipt =
            voucher.currencyCode !==
              "ILS" &&
            voucher.voucherType ===
              "receipt" &&
            voucher.voucherPurpose ===
              "customer_receipt" &&
            voucher.partyType ===
              "customer" &&
            voucher.paymentMethod ===
              "cash";

          if (
            voucher.currencyCode !==
              "ILS" &&
            !isForeignCustomerReceipt
          ) {
            throw new PartyFinanceError(
              "إلغاء هذا السند متعدد العملات غير مدعوم من هذا المسار.",
              409,
            );
          }

          if (
            !voucher.financeTransactionId
          ) {
            throw new PartyFinanceError(
              "السند لا يحتوي على قيد محاسبي",
              409,
            );
          }

          const financeRows =
            await tx
              .select()
              .from(
                financeTransactionsTable,
              )
              .where(
                eq(
                  financeTransactionsTable.id,
                  voucher.financeTransactionId,
                ),
              )
              .limit(1)
              .for("update");

          const originalFinance =
            financeRows[0];

          if (
            !originalFinance ||
            originalFinance.status !==
              "posted"
          ) {
            throw new PartyFinanceError(
              "القيد المحاسبي للسند غير متاح للإلغاء",
              409,
            );
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
                  originalFinance.id,
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
              "VOUCHER_FINANCE_LINES_MISSING",
            );
          }

          if (
            isForeignCustomerReceipt
          ) {
            if (
              !voucher.cashSessionId ||
              !voucher.partyId
            ) {
              throw new Error(
                "FX_RECEIPT_VOID_METADATA_MISSING",
              );
            }

            if (
              originalLines.length !==
                2 &&
              originalLines.length !==
                3
            ) {
              throw new PartyFinanceError(
                "قيد سند العملة الأجنبية لا يطابق البنية الآمنة للعكس.",
                409,
              );
            }

            const businessDate =
              currentPalestineDate();

            if (
              voucher.businessDate !==
              businessDate
            ) {
              throw new PartyFinanceError(
                "إلغاء قبض العملة الأجنبية متاح في نفس يوم العمل فقط وقبل إغلاق الصناديق.",
                409,
              );
            }

            const foreignSessionRows =
              await tx
                .select()
                .from(
                  cashSessionsTable,
                )
                .where(
                  and(
                    eq(
                      cashSessionsTable.id,
                      voucher.cashSessionId,
                    ),
                    eq(
                      cashSessionsTable.status,
                      "open",
                    ),
                  ),
                )
                .limit(1)
                .for("update");

            const foreignSession =
              foreignSessionRows[0] ??
              null;

            if (!foreignSession) {
              throw new PartyFinanceError(
                "لا يمكن إلغاء قبض العملة بعد إغلاق جلسة صندوق العملة.",
                409,
              );
            }

            if (
              foreignSession.businessDate !==
                voucher.businessDate ||
              foreignSession.currencyCode !==
                voucher.currencyCode
            ) {
              throw new PartyFinanceError(
                "جلسة صندوق العملة لا تطابق السند الأصلي.",
                409,
              );
            }

            const foreignCashCode =
              `CASH_${foreignSession.registerKey.toUpperCase()}`;

            const foreignAccountRows =
              await tx
                .select()
                .from(
                  financeAccountsTable,
                )
                .where(
                  and(
                    eq(
                      financeAccountsTable.code,
                      foreignCashCode,
                    ),
                    eq(
                      financeAccountsTable.status,
                      "active",
                    ),
                  ),
                )
                .limit(1);

            const foreignAccount =
              foreignAccountRows[0];

            if (
              !foreignAccount ||
              foreignAccount.currencyCode !==
                voucher.currencyCode
            ) {
              throw new Error(
                "FX_RECEIPT_VOID_FOREIGN_ACCOUNT_INVALID",
              );
            }

            const foreignLine =
              originalLines.find(
                (line) =>
                  line.accountId ===
                  foreignAccount.id,
              );

            if (
              !foreignLine ||
              foreignLine.debitMinor <=
                0 ||
              foreignLine.creditMinor !==
                0 ||
              foreignLine.currencyCode !==
                voucher.currencyCode ||
              !foreignLine.currencyAmountMinor ||
              foreignLine.currencyAmountMinor <=
                0
            ) {
              throw new PartyFinanceError(
                "سطر صندوق العملة في القيد الأصلي غير صالح للعكس.",
                409,
              );
            }

            if (
              voucher.transactionAmountMinor !==
                null &&
              voucher.transactionAmountMinor !==
                foreignLine.currencyAmountMinor
            ) {
              throw new PartyFinanceError(
                "مبلغ العملة في السند لا يطابق القيد الأصلي.",
                409,
              );
            }

            const customerLine =
              originalLines.find(
                (line) =>
                  line.customerId ===
                    voucher.partyId &&
                  line.creditMinor >
                    0,
              );

            if (
              !customerLine ||
              customerLine.creditMinor !==
                voucher.amountMinor ||
              customerLine.debitMinor !==
                0
            ) {
              throw new PartyFinanceError(
                "سطر ذمة الزبون في القيد الأصلي غير صالح للعكس.",
                409,
              );
            }

            const mainAccountRows =
              await tx
                .select()
                .from(
                  financeAccountsTable,
                )
                .where(
                  eq(
                    financeAccountsTable.code,
                    "CASH_MAIN",
                  ),
                )
                .limit(1);

            const mainAccount =
              mainAccountRows[0] ??
              null;

            const mainCashLine =
              mainAccount
                ? originalLines.find(
                    (line) =>
                      line.accountId ===
                      mainAccount.id,
                  ) ?? null
                : null;

            const changeMinor =
              mainCashLine
                ? mainCashLine.creditMinor
                : 0;

            if (
              mainCashLine &&
              (
                mainCashLine.creditMinor <=
                  0 ||
                mainCashLine.debitMinor !==
                  0 ||
                mainCashLine.currencyCode !==
                  "ILS"
              )
            ) {
              throw new PartyFinanceError(
                "سطر باقي الشيكل في القيد الأصلي غير صالح للعكس.",
                409,
              );
            }

            if (
              foreignLine.debitMinor !==
              customerLine.creditMinor +
                changeMinor
            ) {
              throw new PartyFinanceError(
                "قيد قبض العملة الأجنبية الأصلي غير متوازن مع الذمة والباقي.",
                409,
              );
            }

            const foreignAmountMinor =
              foreignLine.currencyAmountMinor;

            const foreignBefore =
              foreignSession.expectedBalanceMinor ??
              foreignSession.openingBalanceMinor;

            if (
              foreignBefore <
              foreignAmountMinor
            ) {
              throw new PartyFinanceError(
                "رصيد صندوق العملة لا يكفي لعكس القبض.",
                409,
              );
            }

            const foreignAfter =
              foreignBefore -
              foreignAmountMinor;

            let ilsSession:
              | typeof cashSessionsTable.$inferSelect
              | null =
              null;

            let ilsBefore:
              | number
              | null =
              null;

            let ilsAfter:
              | number
              | null =
              null;

            if (
              changeMinor >
              0
            ) {
              if (!mainAccount) {
                throw new Error(
                  "FX_RECEIPT_VOID_MAIN_CASH_MISSING",
                );
              }

              const ilsSessionRows =
                await tx
                  .select()
                  .from(
                    cashSessionsTable,
                  )
                  .where(
                    and(
                      eq(
                        cashSessionsTable.registerKey,
                        "main",
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
                  .limit(1)
                  .for("update");

              ilsSession =
                ilsSessionRows[0] ??
                null;

              if (!ilsSession) {
                throw new PartyFinanceError(
                  "لا يمكن إلغاء السند بعد إغلاق صندوق الشيكل الذي خرج منه الباقي.",
                  409,
                );
              }

              if (
                ilsSession.currencyCode !==
                  "ILS" ||
                ilsSession.businessDate !==
                  voucher.businessDate ||
                ilsSession.openedAt.getTime() >
                  voucher.createdAt.getTime()
              ) {
                throw new PartyFinanceError(
                  "جلسة صندوق الشيكل الحالية ليست نفس الجلسة التي خرج منها الباقي.",
                  409,
                );
              }

              ilsBefore =
                ilsSession.expectedBalanceMinor ??
                ilsSession.openingBalanceMinor;

              const nextIlsAfter =
                ilsBefore +
                changeMinor;

              if (
                !Number.isSafeInteger(
                  nextIlsAfter,
                ) ||
                nextIlsAfter >
                  MAX_MINOR
              ) {
                throw new PartyFinanceError(
                  "رصيد صندوق الشيكل بعد العكس غير صالح.",
                  409,
                );
              }

              ilsAfter =
                nextIlsAfter;
            }

            const reversalPosting =
              await postFinanceTransaction(
                tx,
                {
                  publicId:
                    `FIN-${businessDate.replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
                  idempotencyKey:
                    `voucher:${voucher.id}:void`,
                  businessDate,
                  transactionType:
                    "reversal",
                  sourceType:
                    "finance_voucher",
                  sourceId:
                    String(
                      voucher.id,
                    ),
                  sourceEvent:
                    "voided",
                  cashSessionId:
                    foreignSession.id,
                  notes:
                    `عكس ${voucher.publicId}: ${reason}`,
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
                          `عكس: ${line.memo ?? voucher.publicId}`,
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
                  originalFinance.id,
                ),
              );

            const updatedVoucherRows =
              await tx
                .update(
                  financeVouchersTable,
                )
                .set({
                  status:
                    "voided",
                  voidedAt:
                    new Date(),
                  voidedByUserId:
                    auth.user.id,
                  voidReason:
                    reason,
                  updatedAt:
                    new Date(),
                })
                .where(
                  eq(
                    financeVouchersTable.id,
                    voucher.id,
                  ),
                )
                .returning();

            await tx
              .update(
                cashSessionsTable,
              )
              .set({
                expectedBalanceMinor:
                  foreignAfter,
                updatedAt:
                  new Date(),
              })
              .where(
                and(
                  eq(
                    cashSessionsTable.id,
                    foreignSession.id,
                  ),
                  eq(
                    cashSessionsTable.status,
                    "open",
                  ),
                ),
              );

            if (
              ilsSession &&
              ilsAfter !== null
            ) {
              await tx
                .update(
                  cashSessionsTable,
                )
                .set({
                  expectedBalanceMinor:
                    ilsAfter,
                  updatedAt:
                    new Date(),
                })
                .where(
                  and(
                    eq(
                      cashSessionsTable.id,
                      ilsSession.id,
                    ),
                    eq(
                      cashSessionsTable.status,
                      "open",
                    ),
                  ),
                );
            }

            return {
              voucher:
                updatedVoucherRows[0],
              reversal:
                reversalPosting.transaction,
              expectedCashBeforeMinor:
                foreignBefore,
              expectedCashAfterMinor:
                foreignAfter,
              foreignCashBeforeMinor:
                foreignBefore,
              foreignCashAfterMinor:
                foreignAfter,
              ilsCashBeforeMinor:
                ilsBefore,
              ilsCashAfterMinor:
                ilsAfter,
            };
          }


          let session:
            | typeof cashSessionsTable.$inferSelect
            | null =
            null;

          let expectedBefore:
            | number
            | null =
            null;

          let expectedAfter:
            | number
            | null =
            null;

          if (
            voucher.paymentMethod ===
            "cash"
          ) {
            if (
              !voucher.cashSessionId
            ) {
              throw new Error(
                "VOUCHER_CASH_SESSION_MISSING",
              );
            }

            // Preserve historical cash-session closures; reverse cash
            // in the active ILS session of the same register instead.
            const originalSessionRows = await tx
              .select()
              .from(cashSessionsTable)
              .where(eq(cashSessionsTable.id, voucher.cashSessionId))
              .limit(1);

            const originalSession = originalSessionRows[0] ?? null;
            if (!originalSession || originalSession.currencyCode !== "ILS") {
              throw new PartyFinanceError(
                "جلسة الصندوق الأصلية غير موجودة أو عملتها لا تطابق السند",
                409,
              );
            }

            const sessionRows = await tx
              .select()
              .from(cashSessionsTable)
              .where(
                and(
                  eq(cashSessionsTable.id, voucher.cashSessionId),
                  eq(cashSessionsTable.status, "open"),
                ),
              )
              .limit(1)
              .for("update");

            session = sessionRows[0] ?? null;

            if (!session && originalSession.status === "closed") {
              const currentSessionRows = await tx
                .select()
                .from(cashSessionsTable)
                .where(
                  and(
                    eq(cashSessionsTable.registerKey, originalSession.registerKey),
                    eq(cashSessionsTable.currencyCode, "ILS"),
                    eq(cashSessionsTable.status, "open"),
                  ),
                )
                .orderBy(desc(cashSessionsTable.openedAt))
                .limit(1)
                .for("update");

              session = currentSessionRows[0] ?? null;
            }

            if (!session) {
              throw new PartyFinanceError(
                "لا يمكن عكس الحركة: افتح جلسة صندوق حالية بالشيكل لنفس الصندوق الأصلي",
                409,
              );
            }

            expectedBefore =
              session.expectedBalanceMinor ??
              session.openingBalanceMinor;

            const cashAccountCode =
              `CASH_${session.registerKey.toUpperCase()}`;

            const cashAccountRows =
              await tx
                .select()
                .from(
                  financeAccountsTable,
                )
                .where(
                  eq(
                    financeAccountsTable.code,
                    cashAccountCode,
                  ),
                )
                .limit(1);

            const cashAccount =
              cashAccountRows[0];

            if (!cashAccount) {
              throw new Error(
                "VOUCHER_CASH_ACCOUNT_MISSING",
              );
            }

            const cashLine =
              originalLines.find(
                (line) =>
                  line.accountId ===
                  cashAccount.id,
              );

            if (!cashLine) {
              throw new Error(
                "VOUCHER_CASH_LINE_MISSING",
              );
            }

            const originalCashDelta =
              cashLine.debitMinor -
              cashLine.creditMinor;

            if (
              originalCashDelta === 0
            ) {
              throw new Error(
                "VOUCHER_CASH_LINE_INVALID",
              );
            }

            if (
              originalCashDelta > 0 &&
              expectedBefore <
                originalCashDelta
            ) {
              throw new PartyFinanceError(
                "رصيد الصندوق لا يكفي لعكس سند القبض",
                409,
              );
            }

            expectedAfter =
              expectedBefore -
              originalCashDelta;

            if (
              !Number.isSafeInteger(
                expectedAfter,
              ) ||
              expectedAfter <
                0 ||
              expectedAfter >
                MAX_MINOR
            ) {
              throw new PartyFinanceError(
                "رصيد الصندوق المتوقع غير صالح",
              );
            }
          }

          const businessDate =
            currentPalestineDate();

          const reversalPosting =
            await postFinanceTransaction(
              tx,
              {
                publicId:
                  `FIN-${businessDate.replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
                idempotencyKey:
                  `voucher:${voucher.id}:void`,
                businessDate,
                transactionType:
                  "reversal",
                sourceType:
                  "finance_voucher",
                sourceId:
                  String(
                    voucher.id,
                  ),
                sourceEvent:
                  "voided",
                cashSessionId:
                  session?.id ??
                  null,
                notes:
                  `عكس ${voucher.publicId}: ${reason}${
                    session && session.id !== voucher.cashSessionId
                      ? ` (إلغاء بعد إغلاق الجلسة ${voucher.cashSessionId}؛ قيد عكسي في الجلسة ${session.id})`
                      : ""
                  }`,
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
                        `عكس: ${line.memo ?? voucher.publicId}`,
                    }),
                  ),
              },
            );

          const reversal =
            reversalPosting.transaction;

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
                originalFinance.id,
              ),
            );

          const updatedVoucherRows =
            await tx
              .update(
                financeVouchersTable,
              )
              .set({
                status:
                  "voided",
                voidedAt:
                  new Date(),
                voidedByUserId:
                  auth.user.id,
                voidReason:
                  reason,
                updatedAt:
                  new Date(),
              })
              .where(
                eq(
                  financeVouchersTable.id,
                  voucher.id,
                ),
              )
              .returning();

          if (
            session &&
            expectedAfter !==
              null
          ) {
            const updatedSessionRows = await tx
              .update(cashSessionsTable)
              .set({
                expectedBalanceMinor: expectedAfter,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(cashSessionsTable.id, session.id),
                  eq(cashSessionsTable.status, "open"),
                ),
              )
              .returning({ id: cashSessionsTable.id });

            if (!updatedSessionRows[0]) {
              throw new PartyFinanceError(
                "أُغلقت جلسة الصندوق قبل تسجيل القيد العكسي",
                409,
              );
            }
          }

          return {
            voucher:
              updatedVoucherRows[0],
            reversal,
            expectedCashBeforeMinor:
              expectedBefore,
            expectedCashAfterMinor:
              expectedAfter,
            reversalCashSessionId: session?.id ?? null,
            reversedAfterSessionClose:
              Boolean(session && session.id !== voucher.cashSessionId),
          };
        },
      );

    return json(result);
  } catch (caught) {
    if (
      caught instanceof
      PartyFinanceError
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
      "FINANCE_VOUCHER_VOID_FAILED",
      caught,
    );

    return json(
      {
        error:
          "تعذر إلغاء السند",
      },
      500,
    );
  }
}

export async function handlePartyFinanceRequest(
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
      "/api/pos/customers"
  ) {
    return handleListCustomers(
      request,
      db,
      env,
    );
  }

  if (
    request.method ===
      "POST" &&
    path ===
      "/api/pos/customers"
  ) {
    return handleCreateCustomer(
      request,
      db,
      env,
    );
  }

  const customerMatch =
    path.match(
      /^\/api\/pos\/customers\/(\d+)$/,
    );

  if (
    request.method ===
      "PATCH" &&
    customerMatch
  ) {
    return handleUpdateCustomer(
      request,
      db,
      env,
      positiveId(
        customerMatch[1],
      ),
    );
  }

  const customerLedgerMatch =
    path.match(
      /^\/api\/pos\/customers\/(\d+)\/ledger$/,
    );

  if (
    request.method ===
      "GET" &&
    customerLedgerMatch
  ) {
    return handleCustomerLedger(
      request,
      db,
      env,
      positiveId(
        customerLedgerMatch[1],
      ),
    );
  }

  const customerReceiptMatch =
    path.match(
      /^\/api\/pos\/customers\/(\d+)\/receipts$/,
    );

  if (
    request.method ===
      "POST" &&
    customerReceiptMatch
  ) {
    return createVoucher(
      request,
      db,
      env,
      {
        voucherType:
          "customer_receipt",
        partyType:
          "customer",
        partyId:
          positiveId(
            customerReceiptMatch[1],
          ),
      },
    );
  }

  if (path === "/api/pos/employees/month-close" &&
      (request.method === "GET" || request.method === "POST")) {
    return handleEmployeeMonthClose(request, db, env);
  }

  if (
    request.method ===
      "GET" &&
    path ===
      "/api/pos/employees"
  ) {
    return handleListEmployees(
      request,
      db,
      env,
    );
  }

  if (
    request.method ===
      "POST" &&
    path ===
      "/api/pos/employees"
  ) {
    return handleCreateEmployee(
      request,
      db,
      env,
    );
  }

  const employeeMatch =
    path.match(
      /^\/api\/pos\/employees\/(\d+)$/,
    );

  if (
    request.method ===
      "PATCH" &&
    employeeMatch
  ) {
    return handleUpdateEmployee(
      request,
      db,
      env,
      positiveId(
        employeeMatch[1],
      ),
    );
  }

  const employeeLedgerMatch =
    path.match(
      /^\/api\/pos\/employees\/(\d+)\/ledger$/,
    );

  if (
    request.method ===
      "GET" &&
    employeeLedgerMatch
  ) {
    return handleEmployeeLedger(
      request,
      db,
      env,
      positiveId(
        employeeLedgerMatch[1],
      ),
    );
  }

  const employeeAdvanceMatch =
    path.match(
      /^\/api\/pos\/employees\/(\d+)\/advance$/,
    );

  if (
    request.method ===
      "POST" &&
    employeeAdvanceMatch
  ) {
    return createVoucher(
      request,
      db,
      env,
      {
        voucherType:
          "employee_advance",
        partyType:
          "employee",
        partyId:
          positiveId(
            employeeAdvanceMatch[1],
          ),
        ownerOnly: true,
      },
    );
  }

  const employeeRepaymentMatch =
    path.match(
      /^\/api\/pos\/employees\/(\d+)\/repayment$/,
    );

  if (
    request.method ===
      "POST" &&
    employeeRepaymentMatch
  ) {
    return createVoucher(
      request,
      db,
      env,
      {
        voucherType:
          "employee_repayment",
        partyType:
          "employee",
        partyId:
          positiveId(
            employeeRepaymentMatch[1],
          ),
        ownerOnly: true,
      },
    );
  }

  const employeeSalaryMatch =
    path.match(
      /^\/api\/pos\/employees\/(\d+)\/salary$/,
    );

  if (
    request.method ===
      "POST" &&
    employeeSalaryMatch
  ) {
    return createVoucher(
      request,
      db,
      env,
      {
        voucherType:
          "salary_accrual",
        partyType:
          "employee",
        partyId:
          positiveId(
            employeeSalaryMatch[1],
          ),
        ownerOnly: true,
      },
    );
  }

  const employeePaymentMatch =
    path.match(
      /^\/api\/pos\/employees\/(\d+)\/payment$/,
    );

  if (
    request.method ===
      "POST" &&
    employeePaymentMatch
  ) {
    return createVoucher(
      request,
      db,
      env,
      {
        voucherType:
          "employee_payment",
        partyType:
          "employee",
        partyId:
          positiveId(
            employeePaymentMatch[1],
          ),
        ownerOnly: true,
      },
    );
  }

  if (
    request.method ===
      "GET" &&
    path ===
      "/api/pos/finance/expense-categories"
  ) {
    return handleExpenseCategories(
      request,
      db,
      env,
    );
  }

  if (
    request.method ===
      "POST" &&
    path ===
      "/api/pos/finance/expense-categories"
  ) {
    return handleCreateExpenseCategory(
      request,
      db,
      env,
    );
  }

  if (
    request.method ===
      "POST" &&
    path ===
      "/api/pos/finance/expenses"
  ) {
    return createVoucher(
      request,
      db,
      env,
      {
        voucherType:
          "expense",
      },
    );
  }

  if (
    request.method ===
      "POST" &&
    path ===
      "/api/pos/finance/owner-withdrawals"
  ) {
    return createVoucher(
      request,
      db,
      env,
      {
        voucherType:
          "owner_withdrawal",
        partyType:
          "owner",
        partyId:
          authOwnerSentinel,
        ownerOnly: true,
      },
    );
  }

  if (
    request.method ===
      "GET" &&
    path ===
      "/api/pos/finance/vouchers"
  ) {
    return handleListVouchers(
      request,
      db,
      env,
    );
  }

  const voucherVoidMatch =
    path.match(
      /^\/api\/pos\/finance\/vouchers\/(\d+)\/void$/,
    );

  if (
    request.method ===
      "POST" &&
    voucherVoidMatch
  ) {
    return handleVoidVoucher(
      request,
      db,
      env,
      positiveId(
        voucherVoidMatch[1],
      ),
    );
  }

  return null;
}

/*
 * party_id for owner withdrawals is polymorphic and only used
 * as an audit reference. createVoucher replaces this sentinel
 * with the authenticated owner user id before insert.
 */
const authOwnerSentinel = -1;
