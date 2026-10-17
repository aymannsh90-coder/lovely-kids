import {
  bankAccountsTable,
  cashSessionsTable,
  customersTable,
  deliveryCompaniesTable,
  employeesTable,
  expenseCategoriesTable,
  financeAccountsTable,
  financeTransactionLinesTable,
  financeTransactionsTable,
  financeVouchersTable,
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
  customerReceivableBalanceMinor,
  ensureCustomerReceivableControlAccount,
} from "./finance-customer-ledger";
import {
  employeeAdvanceBalanceMinor,
  employeePayableBalanceMinor,
  ensureEmployeeAdvanceControlAccount,
  ensureEmployeePayableControlAccount,
} from "./finance-employee-ledger";
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

class VoucherError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

type PosUser = NonNullable<
  Awaited<
    ReturnType<typeof getCurrentUser>
  >
>;

type PartyType =
  | "customer"
  | "employee"
  | "supplier"
  | "delivery_company";

type SettlementMethod =
  | "cash"
  | "bank";

type AccountRef =
  | {
      kind: "cash";
      registerKey: string;
    }
  | {
      kind: "bank";
      bankAccountId: number;
    }
  | {
      kind: "customer";
      customerId: number;
    }
  | {
      kind:
        | "employee_advance"
        | "employee_payable";
      employeeId: number;
    }
  | {
      kind: "supplier";
      supplierId: number;
    }
  | {
      kind: "delivery_company";
      deliveryCompanyId: number;
    }
  | {
      kind: "expense";
      expenseCategoryId: number;
    }
  | {
      kind: "finance_account";
      financeAccountId: number;
    };

type ResolvedAccount = {
  account: typeof financeAccountsTable.$inferSelect;
  lineDimensions: Pick<
    FinancePostingLineInput,
    | "customerId"
    | "employeeId"
    | "supplierId"
  >;
  label: string;
  cashSession:
    | typeof cashSessionsTable.$inferSelect
    | null;
  bankAccountId: number | null;
  settlementKind:
    | "cash"
    | "bank"
    | null;
};

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
            "إنشاء السندات العامة متاح للمالك فقط",
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

function textValue(
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
    throw new VoucherError(
      "قيمة نصية غير صالحة",
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
    throw new VoucherError(
      "القيمة النصية طويلة جدًا",
    );
  }

  return normalized;
}

function positiveId(
  value: unknown,
  label: string,
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
    throw new VoucherError(
      `${label} غير صالح`,
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
        ? value
            .trim()
            .replace(",", ".")
        : "";

  const match =
    /^(\d+)(?:\.(\d{1,2}))?$/.exec(
      normalized,
    );

  if (!match) {
    throw new VoucherError(
      "المبلغ غير صالح",
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
    minor > MAX_MINOR
  ) {
    throw new VoucherError(
      "المبلغ خارج الحد المسموح",
    );
  }

  return minor;
}

function exchangeRateMicros(
  value: unknown,
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
    /^(\d+)(?:\.(\d{1,6}))?$/.exec(
      normalized,
    );

  if (!match) {
    throw new VoucherError(
      "سعر الصرف غير صالح",
    );
  }

  const whole =
    Number(match[1]);
  const fraction =
    Number(
      (match[2] ?? "")
        .padEnd(6, "0"),
    );

  const micros =
    whole * 1_000_000 +
    fraction;

  if (
    !Number.isSafeInteger(
      micros,
    ) ||
    micros <= 0 ||
    micros > MAX_MINOR
  ) {
    throw new VoucherError(
      "سعر الصرف خارج الحد المسموح",
    );
  }

  return micros;
}

function convertedBaseMinor(
  currencyAmountMinor: number,
  rateMicros: number,
) {
  const rounded =
    (
      BigInt(
        currencyAmountMinor,
      ) *
        BigInt(
          rateMicros,
        ) +
      500_000n
    ) /
    1_000_000n;

  if (
    rounded <= 0n ||
    rounded >
      BigInt(
        MAX_MINOR,
      )
  ) {
    throw new VoucherError(
      "قيمة العملة بعد التحويل خارج الحد المسموح",
    );
  }

  return Number(
    rounded,
  );
}

function registerKey(
  value: unknown,
) {
  const normalized =
    typeof value === "string" &&
    value.trim()
      ? value.trim().toLowerCase()
      : "main";

  if (
    !/^[a-z0-9_-]{1,50}$/.test(
      normalized,
    )
  ) {
    throw new VoucherError(
      "رمز الصندوق غير صالح",
    );
  }

  return normalized;
}

function idempotencyKey(
  value: unknown,
) {
  const normalized =
    textValue(
      value,
      160,
    ) ??
    `voucher:${randomUUID()}`;

  if (
    normalized.length < 8
  ) {
    throw new VoucherError(
      "مفتاح منع التكرار غير صالح",
    );
  }

  return normalized;
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
      existing[0].accountType !==
      input.accountType
    ) {
      throw new Error(
        "FINANCE_ACCOUNT_TYPE_MISMATCH",
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
      "FINANCE_ACCOUNT_CREATE_FAILED",
    );
  }

  return retry[0];
}

async function loadCashSession(
  tx: any,
  register: string,
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
      .orderBy(
        desc(
          cashSessionsTable.openedAt,
        ),
      )
      .limit(1)
      .for("update");

  const session =
    rows[0] ?? null;

  if (!session) {
    throw new VoucherError(
      "يجب فتح الصندوق أولًا للحركة النقدية",
      409,
    );
  }

  if (
    session.currencyCode !==
    "ILS"
  ) {
    throw new VoucherError(
      "السندات العامة تدعم حاليًا صندوق الشيكل فقط",
      409,
    );
  }

  return session;
}

async function cashAccount(
  tx: any,
  register: string,
) {
  return ensureFinanceAccount(
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

function registerKeyFromCashCode(
  code: string,
) {
  if (
    !code.startsWith(
      "CASH_",
    )
  ) {
    throw new VoucherError(
      "الحساب المختار ليس صندوقًا نقديًا",
      409,
    );
  }

  return registerKey(
    code
      .slice(
        "CASH_".length,
      )
      .toLowerCase(),
  );
}

async function foreignCashAccount(
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
            financeAccountsTable.accountType,
            "asset",
          ),
          eq(
            financeAccountsTable.status,
            "active",
          ),
        ),
      )
      .limit(1);

  const account =
    rows[0];

  if (
    !account ||
    !account.code.startsWith(
      "CASH_",
    )
  ) {
    throw new VoucherError(
      "صندوق العملة غير موجود أو غير فعال",
      404,
    );
  }

  if (
    account.currencyCode ===
      "ILS"
  ) {
    throw new VoucherError(
      "اختر صندوقًا بعملة أجنبية",
      409,
    );
  }

  return account;
}

async function loadOpenCashSessionForAccount(
  tx: any,
  account: typeof financeAccountsTable.$inferSelect,
) {
  const register =
    registerKeyFromCashCode(
      account.code,
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
            register,
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

  const session =
    rows[0] ?? null;

  if (!session) {
    throw new VoucherError(
      `يجب فتح جلسة ${account.name} أولًا`,
      409,
    );
  }

  if (
    session.currencyCode !==
      account.currencyCode
  ) {
    throw new VoucherError(
      "عملة جلسة الصندوق لا تطابق عملة الحساب",
      409,
    );
  }

  const today =
    currentPalestineDate();

  if (
    session.businessDate !==
      today
  ) {
    throw new VoucherError(
      `جلسة ${account.name} مفتوحة بتاريخ ${session.businessDate}. أغلقها وافتح جلسة اليوم ${today}.`,
      409,
    );
  }

  return {
    register,
    session,
  };
}

async function bankAccount(
  tx: any,
  bankAccountId: number,
) {
  const rows =
    await tx
      .select({
        bank:
          bankAccountsTable,
        finance:
          financeAccountsTable,
      })
      .from(
        bankAccountsTable,
      )
      .innerJoin(
        financeAccountsTable,
        eq(
          financeAccountsTable.id,
          bankAccountsTable.financeAccountId,
        ),
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
          eq(
            financeAccountsTable.status,
            "active",
          ),
        ),
      )
      .limit(1);

  const item =
    rows[0];

  if (!item) {
    throw new VoucherError(
      "الحساب البنكي غير موجود أو غير فعال",
      404,
    );
  }

  if (
    item.bank.currencyCode !==
    "ILS" ||
    item.finance.currencyCode !==
    "ILS"
  ) {
    throw new VoucherError(
      "السندات العامة تدعم حاليًا الحسابات البنكية بالشيكل فقط",
      409,
    );
  }

  return item;
}

async function settlementAccount(
  tx: any,
  input: {
    method: SettlementMethod;
    register: string;
    bankAccountId:
      | number
      | null;
  },
): Promise<ResolvedAccount> {
  if (
    input.method === "cash"
  ) {
    const session =
      await loadCashSession(
        tx,
        input.register,
      );

    const account =
      await cashAccount(
        tx,
        input.register,
      );

    return {
      account,
      lineDimensions: {},
      label: account.name,
      cashSession: session,
      bankAccountId: null,
      settlementKind:
        "cash",
    };
  }

  if (!input.bankAccountId) {
    throw new VoucherError(
      "اختر الحساب البنكي",
    );
  }

  const item =
    await bankAccount(
      tx,
      input.bankAccountId,
    );

  return {
    account:
      item.finance,
    lineDimensions: {},
    label:
      item.finance.name,
    cashSession: null,
    bankAccountId:
      item.bank.id,
    settlementKind:
      "bank",
  };
}

async function loadActiveCustomer(
  tx: any,
  id: number,
) {
  const rows =
    await tx
      .select()
      .from(customersTable)
      .where(
        and(
          eq(
            customersTable.id,
            id,
          ),
          eq(
            customersTable.status,
            "active",
          ),
        ),
      )
      .limit(1);

  if (!rows[0]) {
    throw new VoucherError(
      "الزبون غير موجود أو غير فعال",
      404,
    );
  }

  return rows[0];
}

async function loadActiveEmployee(
  tx: any,
  id: number,
) {
  const rows =
    await tx
      .select()
      .from(employeesTable)
      .where(
        and(
          eq(
            employeesTable.id,
            id,
          ),
          eq(
            employeesTable.status,
            "active",
          ),
        ),
      )
      .limit(1);

  if (!rows[0]) {
    throw new VoucherError(
      "الموظف غير موجود أو غير فعال",
      404,
    );
  }

  return rows[0];
}

async function loadActiveSupplier(
  tx: any,
  id: number,
) {
  const rows =
    await tx
      .select()
      .from(suppliersTable)
      .where(
        and(
          eq(
            suppliersTable.id,
            id,
          ),
          eq(
            suppliersTable.status,
            "active",
          ),
        ),
      )
      .limit(1);

  if (!rows[0]) {
    throw new VoucherError(
      "المورد غير موجود أو غير فعال",
      404,
    );
  }

  return rows[0];
}

async function loadActiveDeliveryCompany(
  tx: any,
  id: number,
) {
  const rows =
    await tx
      .select()
      .from(
        deliveryCompaniesTable,
      )
      .where(
        and(
          eq(
            deliveryCompaniesTable.id,
            id,
          ),
          eq(
            deliveryCompaniesTable.status,
            "active",
          ),
        ),
      )
      .limit(1);

  if (!rows[0]) {
    throw new VoucherError(
      "شركة التوصيل غير موجودة أو غير فعالة",
      404,
    );
  }

  return rows[0];
}

async function deliveryAccount(
  tx: any,
  companyId: number,
) {
  await loadActiveDeliveryCompany(
    tx,
    companyId,
  );

  const rows =
    await tx
      .select()
      .from(
        financeAccountsTable,
      )
      .where(
        and(
          eq(
            financeAccountsTable.linkedEntityType,
            "delivery_company_receivable",
          ),
          eq(
            financeAccountsTable.linkedEntityId,
            companyId,
          ),
          eq(
            financeAccountsTable.status,
            "active",
          ),
        ),
      )
      .limit(1);

  if (!rows[0]) {
    throw new VoucherError(
      "لا يوجد حساب ذمة مالي فعال لشركة التوصيل",
      409,
    );
  }

  return rows[0];
}

async function resolveAccountRef(
  tx: any,
  ref: AccountRef,
): Promise<ResolvedAccount> {
  if (
    ref.kind === "cash"
  ) {
    const register =
      registerKey(
        ref.registerKey,
      );

    return settlementAccount(
      tx,
      {
        method: "cash",
        register,
        bankAccountId:
          null,
      },
    );
  }

  if (
    ref.kind === "bank"
  ) {
    return settlementAccount(
      tx,
      {
        method: "bank",
        register: "main",
        bankAccountId:
          ref.bankAccountId,
      },
    );
  }

  if (
    ref.kind === "customer"
  ) {
    const customer =
      await loadActiveCustomer(
        tx,
        ref.customerId,
      );

    const account =
      await ensureCustomerReceivableControlAccount(
        tx,
      );

    return {
      account,
      lineDimensions: {
        customerId:
          customer.id,
      },
      label:
        `ذمة الزبون ${customer.name}`,
      cashSession: null,
      bankAccountId: null,
      settlementKind: null,
    };
  }

  if (
    ref.kind ===
      "employee_advance"
  ) {
    const employee =
      await loadActiveEmployee(
        tx,
        ref.employeeId,
      );

    const account =
      await ensureEmployeeAdvanceControlAccount(
        tx,
      );

    return {
      account,
      lineDimensions: {
        employeeId:
          employee.id,
      },
      label:
        `سلفة الموظف ${employee.name}`,
      cashSession: null,
      bankAccountId: null,
      settlementKind: null,
    };
  }

  if (
    ref.kind ===
      "employee_payable"
  ) {
    const employee =
      await loadActiveEmployee(
        tx,
        ref.employeeId,
      );

    const account =
      await ensureEmployeePayableControlAccount(
        tx,
      );

    return {
      account,
      lineDimensions: {
        employeeId:
          employee.id,
      },
      label:
        `مستحقات الموظف ${employee.name}`,
      cashSession: null,
      bankAccountId: null,
      settlementKind: null,
    };
  }

  if (
    ref.kind === "supplier"
  ) {
    const supplier =
      await loadActiveSupplier(
        tx,
        ref.supplierId,
      );

    const account =
      await ensureSupplierPayableControlAccount(
        tx,
      );

    return {
      account,
      lineDimensions: {
        supplierId:
          supplier.id,
      },
      label:
        `ذمة المورد ${supplier.name}`,
      cashSession: null,
      bankAccountId: null,
      settlementKind: null,
    };
  }

  if (
    ref.kind ===
      "delivery_company"
  ) {
    const company =
      await loadActiveDeliveryCompany(
        tx,
        ref.deliveryCompanyId,
      );

    const account =
      await deliveryAccount(
        tx,
        company.id,
      );

    return {
      account,
      lineDimensions: {},
      label:
        `ذمة شركة التوصيل ${company.name}`,
      cashSession: null,
      bankAccountId: null,
      settlementKind: null,
    };
  }

  if (
    ref.kind === "expense"
  ) {
    const rows =
      await tx
        .select({
          category:
            expenseCategoriesTable,
          account:
            financeAccountsTable,
        })
        .from(
          expenseCategoriesTable,
        )
        .innerJoin(
          financeAccountsTable,
          eq(
            financeAccountsTable.id,
            expenseCategoriesTable.financeAccountId,
          ),
        )
        .where(
          and(
            eq(
              expenseCategoriesTable.id,
              ref.expenseCategoryId,
            ),
            eq(
              expenseCategoriesTable.status,
              "active",
            ),
            eq(
              financeAccountsTable.status,
              "active",
            ),
          ),
        )
        .limit(1);

    const item =
      rows[0];

    if (!item) {
      throw new VoucherError(
        "تصنيف المصروف غير موجود أو غير فعال",
        404,
      );
    }

    return {
      account:
        item.account,
      lineDimensions: {},
      label:
        `مصروف ${item.category.name}`,
      cashSession: null,
      bankAccountId: null,
      settlementKind: null,
    };
  }

  if (
    ref.kind !==
      "finance_account"
  ) {
    throw new VoucherError(
      "نوع الحساب المحاسبي غير مدعوم",
      400,
    );
  }

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
            ref.financeAccountId,
          ),
          eq(
            financeAccountsTable.status,
            "active",
          ),
        ),
      )
      .limit(1);

  const account =
    rows[0];

  if (!account) {
    throw new VoucherError(
      "الحساب المحاسبي غير موجود أو غير فعال",
      404,
    );
  }

  if (
    account.currencyCode !==
    "ILS"
  ) {
    throw new VoucherError(
      "سند القيد العام يدعم حاليًا حسابات الشيكل فقط",
      409,
    );
  }

  return {
    account,
    lineDimensions: {},
    label: account.name,
    cashSession: null,
    bankAccountId: null,
    settlementKind: null,
  };
}

function parseAccountRef(
  value: unknown,
  label: string,
): AccountRef {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new VoucherError(
      `${label} غير صالح`,
    );
  }

  const raw =
    value as Record<
      string,
      unknown
    >;

  const kind =
    typeof raw.kind ===
      "string"
      ? raw.kind
      : "";

  if (
    kind === "cash"
  ) {
    return {
      kind,
      registerKey:
        registerKey(
          raw.registerKey,
        ),
    };
  }

  if (
    kind === "bank"
  ) {
    return {
      kind,
      bankAccountId:
        positiveId(
          raw.bankAccountId,
          "الحساب البنكي",
        ),
    };
  }

  if (
    kind === "customer"
  ) {
    return {
      kind,
      customerId:
        positiveId(
          raw.customerId,
          "الزبون",
        ),
    };
  }

  if (
    kind ===
      "employee_advance" ||
    kind ===
      "employee_payable"
  ) {
    return {
      kind,
      employeeId:
        positiveId(
          raw.employeeId,
          "الموظف",
        ),
    };
  }

  if (
    kind === "supplier"
  ) {
    return {
      kind,
      supplierId:
        positiveId(
          raw.supplierId,
          "المورد",
        ),
    };
  }

  if (
    kind ===
      "delivery_company"
  ) {
    return {
      kind,
      deliveryCompanyId:
        positiveId(
          raw.deliveryCompanyId,
          "شركة التوصيل",
        ),
    };
  }

  if (
    kind === "expense"
  ) {
    return {
      kind,
      expenseCategoryId:
        positiveId(
          raw.expenseCategoryId,
          "تصنيف المصروف",
        ),
    };
  }

  if (
    kind ===
      "finance_account"
  ) {
    return {
      kind,
      financeAccountId:
        positiveId(
          raw.financeAccountId,
          "الحساب المحاسبي",
        ),
    };
  }

  throw new VoucherError(
    `${label} غير مدعوم`,
  );
}

async function updateCashExpected(
  tx: any,
  session:
    typeof cashSessionsTable.$inferSelect,
  deltaMinor: number,
) {
  const expectedBefore =
    session.expectedBalanceMinor ??
    session.openingBalanceMinor;

  const expectedAfter =
    expectedBefore +
    deltaMinor;

  if (
    !Number.isSafeInteger(
      expectedAfter,
    ) ||
    expectedAfter < 0 ||
    expectedAfter > MAX_MINOR
  ) {
    throw new VoucherError(
      "رصيد الصندوق لا يسمح بهذه الحركة",
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
      .returning();

  if (!rows[0]) {
    throw new VoucherError(
      "تغيرت حالة الصندوق أثناء حفظ السند، أعد المحاولة",
      409,
    );
  }

  return {
    before:
      expectedBefore,
    after:
      expectedAfter,
  };
}

async function existingVoucher(
  tx: any,
  key: string,
) {
  const rows =
    await tx
      .select()
      .from(
        financeVouchersTable,
      )
      .where(
        eq(
          financeVouchersTable.idempotencyKey,
          key,
        ),
      )
      .limit(1);

  return rows[0] ?? null;
}

async function insertVoucher(
  tx: any,
  input: {
    publicPrefix:
      | "REC"
      | "PAY"
      | "JRN";
    key: string;
    voucherType:
      | "receipt"
      | "payment"
      | "journal";
    voucherPurpose:
      | "customer_receipt"
      | "employee_repayment"
      | "supplier_refund"
      | "delivery_company_settlement"
      | "customer_cash_loan"
      | "employee_advance"
      | "employee_payment"
      | "supplier_payment"
      | "account_transfer";
    partyType:
      | PartyType
      | null;
    partyId:
      | number
      | null;
    paymentMethod:
      | "cash"
      | "bank"
      | "non_cash";
    amountMinor: number;
    currencyCode?: string;
    transactionAmountMinor?: number;
    exchangeRateMicros?: number;
    bankAccountId:
      | number
      | null;
    cashSessionId:
      | number
      | null;
    notes:
      | string
      | null;
    userId: number;
    businessDate: string;
  },
) {
  const publicId =
    `${input.publicPrefix}-${input.businessDate.replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;

  const rows =
    await tx
      .insert(
        financeVouchersTable,
      )
      .values({
        publicId,
        idempotencyKey:
          input.key,
        voucherType:
          input.voucherType,
        voucherPurpose:
          input.voucherPurpose,
        partyType:
          input.partyType,
        partyId:
          input.partyId,
        expenseCategoryId:
          null,
        paymentMethod:
          input.paymentMethod,
        amountMinor:
          input.amountMinor,
        currencyCode:
          input.currencyCode ??
          "ILS",
        transactionAmountMinor:
          input.transactionAmountMinor ??
          input.amountMinor,
        exchangeRateMicros:
          input.exchangeRateMicros ??
          1_000_000,
        bankAccountId:
          input.bankAccountId,
        businessDate:
          input.businessDate,
        referencePeriod:
          null,
        cashSessionId:
          input.cashSessionId,
        financeTransactionId:
          null,
        status:
          "posted",
        notes:
          input.notes,
        createdByUserId:
          input.userId,
      })
      .returning();

  if (!rows[0]) {
    throw new Error(
      "UNIFIED_VOUCHER_INSERT_FAILED",
    );
  }

  return rows[0];
}

async function handleForeignCurrencyCustomerReceipt(
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
          "بيانات سند القبض بالعملة الأجنبية غير صالحة",
      },
      400,
    );
  }

  try {
    const customerId =
      positiveId(
        body.customerId,
        "الزبون",
      );

    const settlementMinor =
      moneyMinor(
        body.amount,
      );

    const foreignAmountMinor =
      moneyMinor(
        body.foreignAmount,
      );

    const rateMicros =
      exchangeRateMicros(
        body.exchangeRate,
      );

    const foreignCashAccountId =
      positiveId(
        body.foreignCashAccountId,
        "صندوق العملة",
      );

    const key =
      idempotencyKey(
        body.idempotencyKey,
      );

    const notes =
      textValue(
        body.notes,
        1000,
      );

    const businessDate =
      currentPalestineDate();

    const receivedBaseMinor =
      convertedBaseMinor(
        foreignAmountMinor,
        rateMicros,
      );

    if (
      receivedBaseMinor <
      settlementMinor
    ) {
      throw new VoucherError(
        "قيمة العملة المستلمة بالشيكل أقل من المبلغ المراد تسديده",
        409,
      );
    }

    const changeMinor =
      receivedBaseMinor -
      settlementMinor;

    const result =
      await db.transaction(
        async (tx) => {
          const duplicate =
            await existingVoucher(
              tx,
              key,
            );

          if (duplicate) {
            return {
              alreadyCreated: true,
              voucher:
                duplicate,
              financeTransaction:
                null,
              receivedBaseMinor,
              changeMinor,
              foreignCashBeforeMinor:
                null,
              foreignCashAfterMinor:
                null,
              ilsCashBeforeMinor:
                null,
              ilsCashAfterMinor:
                null,
            };
          }

          await loadActiveCustomer(
            tx,
            customerId,
          );

          const customerBalanceMinor =
            await customerReceivableBalanceMinor(
              tx,
              customerId,
            );

          if (
            customerBalanceMinor <=
            0
          ) {
            throw new VoucherError(
              "لا توجد ذمة مدينة على الزبون لتسجيل قبض عليها",
              409,
            );
          }

          if (
            settlementMinor >
            customerBalanceMinor
          ) {
            throw new VoucherError(
              "المبلغ المسدد أكبر من ذمة الزبون الحالية",
              409,
            );
          }

          const foreignAccount =
            await foreignCashAccount(
              tx,
              foreignCashAccountId,
            );

          const foreignSessionInfo =
            await loadOpenCashSessionForAccount(
              tx,
              foreignAccount,
            );

          const foreignCashState =
            await updateCashExpected(
              tx,
              foreignSessionInfo.session,
              foreignAmountMinor,
            );

          let ilsSession:
            | typeof cashSessionsTable.$inferSelect
            | null =
            null;

          let ilsCashState:
            | {
                before: number;
                after: number;
              }
            | null =
            null;

          let mainCash:
            | typeof financeAccountsTable.$inferSelect
            | null =
            null;

          if (
            changeMinor >
            0
          ) {
            ilsSession =
              await loadCashSession(
                tx,
                "main",
              );

            if (
              ilsSession.businessDate !==
              businessDate
            ) {
              throw new VoucherError(
                `جلسة الصندوق الرئيسي مفتوحة بتاريخ ${ilsSession.businessDate}. أغلقها وافتح جلسة اليوم ${businessDate}.`,
                409,
              );
            }

            mainCash =
              await cashAccount(
                tx,
                "main",
              );

            ilsCashState =
              await updateCashExpected(
                tx,
                ilsSession,
                -changeMinor,
              );
          }

          const customerAccount =
            await ensureCustomerReceivableControlAccount(
              tx,
            );

          const voucher =
            await insertVoucher(
              tx,
              {
                publicPrefix:
                  "REC",
                key,
                voucherType:
                  "receipt",
                voucherPurpose:
                  "customer_receipt",
                partyType:
                  "customer",
                partyId:
                  customerId,
                paymentMethod:
                  "cash",
                amountMinor:
                  settlementMinor,
                currencyCode:
                  foreignAccount.currencyCode,
                transactionAmountMinor:
                  foreignAmountMinor,
                exchangeRateMicros:
                  rateMicros,
                bankAccountId:
                  null,
                cashSessionId:
                  foreignSessionInfo.session.id,
                notes:
                  notes ??
                  `قبض ${foreignAmountMinor / 100} ${foreignAccount.currencyCode} بسعر ${rateMicros / 1_000_000}؛ تسديد ${settlementMinor / 100} ₪${changeMinor > 0 ? `؛ باقي ${changeMinor / 100} ₪` : ""}`,
                userId:
                  Number(
                    auth.user.id,
                  ),
                businessDate,
              },
            );

          const lines:
            FinancePostingLineInput[] =
            [
              {
                accountId:
                  foreignAccount.id,
                currencyCode:
                  foreignAccount.currencyCode,
                currencyAmountMinor:
                  foreignAmountMinor,
                exchangeRateMicros:
                  rateMicros,
                debitMinor:
                  receivedBaseMinor,
                memo:
                  `قبض ${foreignAmountMinor / 100} ${foreignAccount.currencyCode} إلى ${foreignAccount.name}`,
              },
              {
                accountId:
                  customerAccount.id,
                customerId,
                currencyCode:
                  "ILS",
                currencyAmountMinor:
                  settlementMinor,
                exchangeRateMicros:
                  1_000_000,
                creditMinor:
                  settlementMinor,
                memo:
                  "تسديد ذمة الزبون",
              },
            ];

          if (
            changeMinor >
              0 &&
            mainCash
          ) {
            lines.push({
              accountId:
                mainCash.id,
              currencyCode:
                "ILS",
              currencyAmountMinor:
                changeMinor,
              exchangeRateMicros:
                1_000_000,
              creditMinor:
                changeMinor,
              memo:
                "باقي للزبون من صندوق الشيكل",
            });
          }

          const posting =
            await postFinanceTransaction(
              tx,
              {
                publicId:
                  `FIN-${businessDate.replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
                idempotencyKey:
                  `voucher:${voucher.id}:posted`,
                businessDate,
                transactionType:
                  "receipt",
                sourceType:
                  "finance_voucher",
                sourceId:
                  String(
                    voucher.id,
                  ),
                sourceEvent:
                  "receipt",
                cashSessionId:
                  foreignSessionInfo.session.id,
                notes:
                  voucher.notes ??
                  voucher.publicId,
                createdByUserId:
                  Number(
                    auth.user.id,
                  ),
                lines,
              },
            );

          const updatedRows =
            await tx
              .update(
                financeVouchersTable,
              )
              .set({
                financeTransactionId:
                  posting.transaction.id,
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

          return {
            alreadyCreated: false,
            voucher:
              updatedRows[0] ??
              voucher,
            financeTransaction:
              posting.transaction,
            receivedBaseMinor,
            changeMinor,
            foreignCashBeforeMinor:
              foreignCashState.before,
            foreignCashAfterMinor:
              foreignCashState.after,
            ilsCashBeforeMinor:
              ilsCashState?.before ??
              null,
            ilsCashAfterMinor:
              ilsCashState?.after ??
              null,
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
        VoucherError
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
      "FOREIGN_CURRENCY_CUSTOMER_RECEIPT_FAILED",
      caught,
    );

    return json(
      {
        error:
          "تعذر حفظ قبض الزبون بالعملة الأجنبية",
      },
      500,
    );
  }
}

async function handlePartyVoucher(
  request: Request,
  db: Db,
  env: Env,
  voucherType:
    | "receipt"
    | "payment",
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
          "بيانات السند غير صالحة",
      },
      400,
    );
  }

  try {
    const amountMinor =
      moneyMinor(
        body.amount,
      );

    const key =
      idempotencyKey(
        body.idempotencyKey,
      );

    const partyType =
      body.partyType as
        | PartyType
        | undefined;

    if (
      partyType !== "customer" &&
      partyType !== "employee" &&
      partyType !== "supplier" &&
      partyType !==
        "delivery_company"
    ) {
      throw new VoucherError(
        "نوع الطرف غير صالح",
      );
    }

    const partyId =
      positiveId(
        body.partyId,
        "الطرف",
      );

    const method =
      body.paymentMethod;

    if (
      method !== "cash" &&
      method !== "bank"
    ) {
      throw new VoucherError(
        "طريقة الحركة يجب أن تكون صندوق أو بنك",
      );
    }

    const register =
      registerKey(
        body.registerKey,
      );

    const requestedBankId =
      method === "bank"
        ? positiveId(
            body.bankAccountId,
            "الحساب البنكي",
          )
        : null;

    const notes =
      textValue(
        body.notes,
        1000,
      );

    const businessDate =
      currentPalestineDate();

    const result =
      await db.transaction(
        async (tx) => {
          const duplicate =
            await existingVoucher(
              tx,
              key,
            );

          if (duplicate) {
            return {
              alreadyCreated: true,
              voucher:
                duplicate,
              financeTransaction:
                null,
            };
          }

          const settlement =
            await settlementAccount(
              tx,
              {
                method,
                register,
                bankAccountId:
                  requestedBankId,
              },
            );

          let party:
            ResolvedAccount;

          if (
            partyType ===
              "customer"
          ) {
            party =
              await resolveAccountRef(
                tx,
                {
                  kind:
                    "customer",
                  customerId:
                    partyId,
                },
              );
          } else if (
            partyType ===
              "employee"
          ) {
            if (
              voucherType ===
                "receipt"
            ) {
              const balance =
                await employeeAdvanceBalanceMinor(
                  tx,
                  partyId,
                );

              if (
                amountMinor >
                balance
              ) {
                throw new VoucherError(
                  "المبلغ أكبر من رصيد السلفة على الموظف",
                  409,
                );
              }

              party =
                await resolveAccountRef(
                  tx,
                  {
                    kind:
                      "employee_advance",
                    employeeId:
                      partyId,
                  },
                );
            } else {
              const employeePaymentType =
                body.employeePaymentType ===
                  "payable"
                  ? "payable"
                  : "advance";

              if (
                employeePaymentType ===
                  "payable"
              ) {
                const balance =
                  await employeePayableBalanceMinor(
                    tx,
                    partyId,
                  );

                if (
                  amountMinor >
                  balance
                ) {
                  throw new VoucherError(
                    "المبلغ أكبر من مستحقات الموظف",
                    409,
                  );
                }

                party =
                  await resolveAccountRef(
                    tx,
                    {
                      kind:
                        "employee_payable",
                      employeeId:
                        partyId,
                    },
                  );
              } else {
                party =
                  await resolveAccountRef(
                    tx,
                    {
                      kind:
                        "employee_advance",
                      employeeId:
                        partyId,
                    },
                  );
              }
            }
          } else if (
            partyType ===
              "supplier"
          ) {
            if (
              voucherType ===
                "receipt"
            ) {
              const balance =
                await supplierPayableBalanceMinor(
                  tx,
                  partyId,
                );

              if (
                balance >= 0
              ) {
                throw new VoucherError(
                  "لا يوجد رصيد دائن لنا على هذا المورد لتسجيل قبض منه",
                  409,
                );
              }

              if (
                amountMinor >
                -balance
              ) {
                throw new VoucherError(
                  "مبلغ القبض أكبر من الرصيد الدائن لنا على المورد",
                  409,
                );
              }
            }

            party =
              await resolveAccountRef(
                tx,
                {
                  kind:
                    "supplier",
                  supplierId:
                    partyId,
                },
              );
          } else {
            if (
              voucherType ===
                "receipt"
            ) {
              throw new VoucherError(
                "قبض شركة التوصيل يجب أن يتم من شاشة تسوية شركة التوصيل حتى تُربط الطلبات بالحركة",
                409,
              );
            }

            throw new VoucherError(
              "الصرف لشركة التوصيل غير متاح من سند الصرف العام حاليًا",
              409,
            );
          }

          const voucherPurpose =
            voucherType === "receipt"
              ? partyType === "customer"
                ? "customer_receipt"
                : partyType === "employee"
                  ? "employee_repayment"
                  : "supplier_refund"
              : partyType === "customer"
                ? "customer_cash_loan"
                : partyType === "employee"
                  ? body.employeePaymentType === "payable"
                    ? "employee_payment"
                    : "employee_advance"
                  : "supplier_payment";

          const cashSession =
            settlement.cashSession;

          const cashState =
            cashSession
              ? await updateCashExpected(
                  tx,
                  cashSession,
                  voucherType ===
                    "receipt"
                    ? amountMinor
                    : -amountMinor,
                )
              : null;

          const voucher =
            await insertVoucher(
              tx,
              {
                publicPrefix:
                  voucherType ===
                    "receipt"
                    ? "REC"
                    : "PAY",
                key,
                voucherType,
                voucherPurpose,
                partyType,
                partyId,
                paymentMethod:
                  method,
                amountMinor,
                bankAccountId:
                  settlement.bankAccountId,
                cashSessionId:
                  cashSession?.id ??
                  null,
                notes,
                userId:
                  Number(
                    auth.user.id,
                  ),
                businessDate,
              },
            );

          const settlementLine:
            FinancePostingLineInput =
            {
              accountId:
                settlement.account.id,
              memo:
                voucherType ===
                  "receipt"
                  ? `قبض إلى ${settlement.label}`
                  : `صرف من ${settlement.label}`,
              ...(voucherType ===
              "receipt"
                ? {
                    debitMinor:
                      amountMinor,
                  }
                : {
                    creditMinor:
                      amountMinor,
                  }),
            };

          const partyLine:
            FinancePostingLineInput =
            {
              accountId:
                party.account.id,
              ...party.lineDimensions,
              memo:
                voucherType ===
                  "receipt"
                  ? `قبض من ${party.label}`
                  : `صرف إلى ${party.label}`,
              ...(voucherType ===
              "receipt"
                ? {
                    creditMinor:
                      amountMinor,
                  }
                : {
                    debitMinor:
                      amountMinor,
                  }),
            };

          const posting =
            await postFinanceTransaction(
              tx,
              {
                publicId:
                  `FIN-${businessDate.replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
                idempotencyKey:
                  `voucher:${voucher.id}:posted`,
                businessDate,
                transactionType:
                  voucherType,
                sourceType:
                  "finance_voucher",
                sourceId:
                  String(
                    voucher.id,
                  ),
                sourceEvent:
                  voucherType,
                cashSessionId:
                  cashSession?.id ??
                  null,
                notes:
                  notes ??
                  voucher.publicId,
                createdByUserId:
                  Number(
                    auth.user.id,
                  ),
                lines: [
                  settlementLine,
                  partyLine,
                ],
              },
            );

          const updatedRows =
            await tx
              .update(
                financeVouchersTable,
              )
              .set({
                financeTransactionId:
                  posting.transaction.id,
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

          return {
            alreadyCreated: false,
            voucher:
              updatedRows[0],
            financeTransaction:
              posting.transaction,
            expectedCashBeforeMinor:
              cashState?.before ??
              null,
            expectedCashAfterMinor:
              cashState?.after ??
              null,
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
      VoucherError
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
      "UNIFIED_PARTY_VOUCHER_FAILED",
      caught,
    );

    return json(
      {
        error:
          "تعذر حفظ السند",
      },
      500,
    );
  }
}

async function handleJournalVoucher(
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
          "بيانات سند القيد غير صالحة",
      },
      400,
    );
  }

  try {
    const amountMinor =
      moneyMinor(
        body.amount,
      );

    const key =
      idempotencyKey(
        body.idempotencyKey,
      );

    const fromRef =
      parseAccountRef(
        body.from,
        "الحساب المصدر",
      );

    const toRef =
      parseAccountRef(
        body.to,
        "الحساب المستفيد",
      );

    const notes =
      textValue(
        body.notes,
        1000,
      );

    const businessDate =
      currentPalestineDate();

    const result =
      await db.transaction(
        async (tx) => {
          const duplicate =
            await existingVoucher(
              tx,
              key,
            );

          if (duplicate) {
            return {
              alreadyCreated: true,
              voucher:
                duplicate,
              financeTransaction:
                null,
            };
          }

          const from =
            await resolveAccountRef(
              tx,
              fromRef,
            );

          const to =
            await resolveAccountRef(
              tx,
              toRef,
            );

          const sameDimensions =
            JSON.stringify(
              from.lineDimensions,
            ) ===
            JSON.stringify(
              to.lineDimensions,
            );

          if (
            from.account.id ===
              to.account.id &&
            sameDimensions
          ) {
            throw new VoucherError(
              "لا يمكن إنشاء قيد من الحساب إلى نفسه",
            );
          }

          if (
            from.settlementKind &&
            to.settlementKind
          ) {
            throw new VoucherError(
              "التحويل بين صندوق وبنك أو بين حسابين نقديين يتم من شاشة التحويلات المالية",
              409,
            );
          }

          const cashSide =
            from.settlementKind ===
              "cash"
              ? {
                  account:
                    from,
                  delta:
                    -amountMinor,
                }
              : to.settlementKind ===
                    "cash"
                ? {
                    account:
                      to,
                    delta:
                      amountMinor,
                  }
                : null;

          const cashState =
            cashSide?.account
              .cashSession
              ? await updateCashExpected(
                  tx,
                  cashSide.account
                    .cashSession,
                  cashSide.delta,
                )
              : null;

          const bankSide =
            from.settlementKind ===
              "bank"
              ? from
              : to.settlementKind ===
                    "bank"
                ? to
                : null;

          const paymentMethod =
            cashSide
              ? "cash"
              : bankSide
                ? "bank"
                : "non_cash";

          const voucher =
            await insertVoucher(
              tx,
              {
                publicPrefix:
                  "JRN",
                key,
                voucherType:
                  "journal",
                voucherPurpose:
                  "account_transfer",
                partyType:
                  null,
                partyId:
                  null,
                paymentMethod,
                amountMinor,
                bankAccountId:
                  bankSide
                    ?.bankAccountId ??
                  null,
                cashSessionId:
                  cashSide?.account
                    .cashSession?.id ??
                  null,
                notes:
                  notes ??
                  `من ${from.label} إلى ${to.label}`,
                userId:
                  Number(
                    auth.user.id,
                  ),
                businessDate,
              },
            );

          const posting =
            await postFinanceTransaction(
              tx,
              {
                publicId:
                  `FIN-${businessDate.replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
                idempotencyKey:
                  `voucher:${voucher.id}:posted`,
                businessDate,
                transactionType:
                  "adjustment",
                sourceType:
                  "finance_voucher",
                sourceId:
                  String(
                    voucher.id,
                  ),
                sourceEvent:
                  "journal",
                cashSessionId:
                  cashSide?.account
                    .cashSession?.id ??
                  null,
                notes:
                  voucher.notes ??
                  voucher.publicId,
                createdByUserId:
                  Number(
                    auth.user.id,
                  ),
                lines: [
                  {
                    accountId:
                      to.account.id,
                    ...to.lineDimensions,
                    debitMinor:
                      amountMinor,
                    memo:
                      `إلى: ${to.label}`,
                  },
                  {
                    accountId:
                      from.account.id,
                    ...from.lineDimensions,
                    creditMinor:
                      amountMinor,
                    memo:
                      `من: ${from.label}`,
                  },
                ],
              },
            );

          const updatedRows =
            await tx
              .update(
                financeVouchersTable,
              )
              .set({
                financeTransactionId:
                  posting.transaction.id,
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

          return {
            alreadyCreated: false,
            voucher:
              updatedRows[0],
            financeTransaction:
              posting.transaction,
            expectedCashBeforeMinor:
              cashState?.before ??
              null,
            expectedCashAfterMinor:
              cashState?.after ??
              null,
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
      VoucherError
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
      "UNIFIED_JOURNAL_VOUCHER_FAILED",
      caught,
    );

    return json(
      {
        error:
          "تعذر حفظ سند القيد",
      },
      500,
    );
  }
}

async function handleReplaceUnifiedVoucher(
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
      | Record<string, unknown>
      | null;

  if (!body) {
    return json(
      {
        error:
          "بيانات تعديل السند غير صالحة",
      },
      400,
    );
  }

  try {
    const amountMinor =
      moneyMinor(
        body.amount,
      );

    const key =
      idempotencyKey(
        body.idempotencyKey,
      );

    const replacementNotes =
      body.notes === undefined
        ? undefined
        : textValue(
            body.notes,
            1000,
          );

    const businessDate =
      currentPalestineDate();

    const result =
      await db.transaction(
        async (tx) => {
          const duplicate =
            await existingVoucher(
              tx,
              key,
            );

          if (duplicate) {
            if (
              duplicate.replacesVoucherId !==
              voucherId
            ) {
              throw new VoucherError(
                "مفتاح التعديل مستخدم لسند آخر",
                409,
              );
            }

            return {
              alreadyReplaced: true,
              originalVoucher:
                null,
              replacementVoucher:
                duplicate,
              reversalTransaction:
                null,
              financeTransaction:
                null,
              expectedCashBeforeMinor:
                null,
              expectedCashAfterMinor:
                null,
            };
          }

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
            throw new VoucherError(
              "السند غير موجود",
              404,
            );
          }

          if (
            voucher.status !==
              "posted"
          ) {
            throw new VoucherError(
              "لا يمكن تعديل سند ملغى",
              409,
            );
          }

          if (
            voucher.currencyCode !==
            "ILS"
          ) {
            throw new VoucherError(
              "تعديل سند القبض بعملة أجنبية يحتاج مسار العكس متعدد الصناديق؛ ألغِ التعديل حتى Stage 3.",
              409,
            );
          }

          if (
            voucher.voucherType !==
              "receipt" &&
            voucher.voucherType !==
              "payment" &&
            voucher.voucherType !==
              "journal"
          ) {
            throw new VoucherError(
              "التعديل الذري متاح للسندات الجديدة فقط",
              409,
            );
          }

          if (
            !voucher.financeTransactionId
          ) {
            throw new VoucherError(
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
            throw new VoucherError(
              "القيد المحاسبي للسند غير متاح للتعديل",
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
                  financeTransactionLinesTable.transactionId,
                  originalFinance.id,
                ),
              )
              .orderBy(
                asc(
                  financeTransactionLinesTable.lineNumber,
                ),
              );

          if (
            originalLines.length !==
              2
          ) {
            throw new VoucherError(
              "هذا السند لا يطابق بنية التعديل الآمن",
              409,
            );
          }

          for (
            const line of
              originalLines
          ) {
            const lineAmount =
              line.debitMinor >
              0
                ? line.debitMinor
                : line.creditMinor;

            if (
              lineAmount !==
              voucher.amountMinor
            ) {
              throw new VoucherError(
                "مبلغ السند لا يطابق قيده المحاسبي",
                409,
              );
            }
          }

          let cashSession:
            | typeof cashSessionsTable.$inferSelect
            | null =
            null;

          let expectedBefore:
            | number
            | null =
            null;

          let expectedAfterReverse:
            | number
            | null =
            null;

          let replacementCashDelta =
            0;

          if (
            voucher.paymentMethod ===
              "cash"
          ) {
            if (
              !voucher.cashSessionId
            ) {
              throw new Error(
                "UNIFIED_REPLACE_CASH_SESSION_MISSING",
              );
            }

            const sessionRows =
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

            cashSession =
              sessionRows[0] ??
              null;

            if (!cashSession) {
              throw new VoucherError(
                "لا يمكن تعديل حركة نقدية بعد إغلاق جلسة الصندوق",
                409,
              );
            }

            expectedBefore =
              cashSession.expectedBalanceMinor ??
              cashSession.openingBalanceMinor;

            const cashCode =
              `CASH_${cashSession.registerKey.toUpperCase()}`;

            const cashRows =
              await tx
                .select()
                .from(
                  financeAccountsTable,
                )
                .where(
                  eq(
                    financeAccountsTable.code,
                    cashCode,
                  ),
                )
                .limit(1);

            const cashAccount =
              cashRows[0];

            if (!cashAccount) {
              throw new Error(
                "UNIFIED_REPLACE_CASH_ACCOUNT_MISSING",
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
                "UNIFIED_REPLACE_CASH_LINE_MISSING",
              );
            }

            const originalCashDelta =
              cashLine.debitMinor -
              cashLine.creditMinor;

            if (
              originalCashDelta !==
                voucher.amountMinor &&
              originalCashDelta !==
                -voucher.amountMinor
            ) {
              throw new Error(
                "UNIFIED_REPLACE_CASH_LINE_INVALID",
              );
            }

            expectedAfterReverse =
              expectedBefore -
              originalCashDelta;

            replacementCashDelta =
              originalCashDelta >
              0
                ? amountMinor
                : -amountMinor;

            const finalExpected =
              expectedAfterReverse +
              replacementCashDelta;

            if (
              !Number.isSafeInteger(
                finalExpected,
              ) ||
              finalExpected <
                0 ||
              finalExpected >
                MAX_MINOR
            ) {
              throw new VoucherError(
                "رصيد الصندوق لا يسمح بتعديل السند لهذه القيمة",
                409,
              );
            }
          }

          const reversalPosting =
            await postFinanceTransaction(
              tx,
              {
                publicId:
                  `FIN-${businessDate.replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
                idempotencyKey:
                  `voucher:${voucher.id}:replace:void`,
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
                  "replaced",
                cashSessionId:
                  cashSession?.id ??
                  null,
                notes:
                  `عكس للتعديل: ${voucher.publicId}`,
                createdByUserId:
                  Number(
                    auth.user.id,
                  ),
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
                        `عكس للتعديل: ${line.memo ?? voucher.publicId}`,
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

          if (
            voucher.voucherPurpose ===
              "employee_repayment" &&
            voucher.partyId
          ) {
            const balance =
              await employeeAdvanceBalanceMinor(
                tx,
                voucher.partyId,
              );

            if (
              amountMinor >
              balance
            ) {
              throw new VoucherError(
                "المبلغ الجديد أكبر من رصيد السلفة على الموظف",
                409,
              );
            }
          }

          if (
            voucher.voucherPurpose ===
              "employee_payment" &&
            voucher.partyId
          ) {
            const balance =
              await employeePayableBalanceMinor(
                tx,
                voucher.partyId,
              );

            if (
              amountMinor >
              balance
            ) {
              throw new VoucherError(
                "المبلغ الجديد أكبر من مستحقات الموظف",
                409,
              );
            }
          }

          if (
            voucher.voucherPurpose ===
              "supplier_refund" &&
            voucher.partyId
          ) {
            const balance =
              await supplierPayableBalanceMinor(
                tx,
                voucher.partyId,
              );

            if (
              balance >= 0 ||
              amountMinor >
                -balance
            ) {
              throw new VoucherError(
                "المبلغ الجديد أكبر من الرصيد الدائن لنا على المورد",
                409,
              );
            }
          }

          const prefix =
            voucher.voucherType ===
              "receipt"
              ? "REC"
              : voucher.voucherType ===
                    "payment"
                ? "PAY"
                : "JRN";

          const replacementRows =
            await tx
              .insert(
                financeVouchersTable,
              )
              .values({
                publicId:
                  `${prefix}-${businessDate.replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
                idempotencyKey:
                  key,
                voucherType:
                  voucher.voucherType,
                voucherPurpose:
                  voucher.voucherPurpose,
                partyType:
                  voucher.partyType,
                partyId:
                  voucher.partyId,
                expenseCategoryId:
                  voucher.expenseCategoryId,
                paymentMethod:
                  voucher.paymentMethod,
                amountMinor,
                currencyCode:
                  voucher.currencyCode,
                transactionAmountMinor:
                  amountMinor,
                exchangeRateMicros:
                  voucher.exchangeRateMicros,
                bankAccountId:
                  voucher.bankAccountId,
                businessDate,
                referencePeriod:
                  voucher.referencePeriod,
                cashSessionId:
                  cashSession?.id ??
                  null,
                financeTransactionId:
                  null,
                replacesVoucherId:
                  voucher.id,
                status:
                  "posted",
                notes:
                  replacementNotes ===
                    undefined
                    ? voucher.notes
                    : replacementNotes,
                createdByUserId:
                  Number(
                    auth.user.id,
                  ),
              })
              .returning();

          const replacement =
            replacementRows[0];

          if (!replacement) {
            throw new Error(
              "UNIFIED_REPLACEMENT_INSERT_FAILED",
            );
          }

          const replacementPosting =
            await postFinanceTransaction(
              tx,
              {
                publicId:
                  `FIN-${businessDate.replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
                idempotencyKey:
                  `voucher:${replacement.id}:posted`,
                businessDate,
                transactionType:
                  voucher.voucherType ===
                    "receipt"
                    ? "receipt"
                    : voucher.voucherType ===
                          "payment"
                      ? "payment"
                      : "adjustment",
                sourceType:
                  "finance_voucher",
                sourceId:
                  String(
                    replacement.id,
                  ),
                sourceEvent:
                  voucher.voucherType,
                cashSessionId:
                  cashSession?.id ??
                  null,
                notes:
                  replacement.notes ??
                  replacement.publicId,
                createdByUserId:
                  Number(
                    auth.user.id,
                  ),
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
                        line.debitMinor >
                        0
                          ? amountMinor
                          : 0,
                      creditMinor:
                        line.creditMinor >
                        0
                          ? amountMinor
                          : 0,
                      memo:
                        `بديل ${voucher.publicId}: ${line.memo ?? replacement.publicId}`,
                    }),
                  ),
              },
            );

          const updatedReplacementRows =
            await tx
              .update(
                financeVouchersTable,
              )
              .set({
                financeTransactionId:
                  replacementPosting.transaction.id,
                updatedAt:
                  new Date(),
              })
              .where(
                eq(
                  financeVouchersTable.id,
                  replacement.id,
                ),
              )
              .returning();

          const updatedOriginalRows =
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
                  Number(
                    auth.user.id,
                  ),
                voidReason:
                  `تم تعديله بالسند ${replacement.publicId}`,
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

          let expectedAfter:
            | number
            | null =
            null;

          if (
            cashSession &&
            expectedAfterReverse !==
              null
          ) {
            expectedAfter =
              expectedAfterReverse +
              replacementCashDelta;

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
                    cashSession.id,
                  ),
                  eq(
                    cashSessionsTable.status,
                    "open",
                  ),
                ),
              );
          }

          return {
            alreadyReplaced: false,
            originalVoucher:
              updatedOriginalRows[0],
            replacementVoucher:
              updatedReplacementRows[0],
            reversalTransaction:
              reversalPosting.transaction,
            financeTransaction:
              replacementPosting.transaction,
            expectedCashBeforeMinor:
              expectedBefore,
            expectedCashAfterMinor:
              expectedAfter,
          };
        },
      );

    return json(result);
  } catch (caught) {
    if (
      caught instanceof
      VoucherError
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
      "UNIFIED_VOUCHER_REPLACE_FAILED",
      caught,
    );

    return json(
      {
        error:
          "تعذر تعديل السند بأمان",
      },
      500,
    );
  }
}

export async function handleUnifiedVoucherRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path =
    new URL(
      request.url,
    ).pathname;

  if (
    request.method === "POST" &&
    path ===
      "/api/pos/finance/vouchers/foreign-currency-customer-receipt"
  ) {
    return handleForeignCurrencyCustomerReceipt(
      request,
      db,
      env,
    );
  }

  if (
    request.method === "POST" &&
    path ===
      "/api/pos/finance/vouchers/receipt"
  ) {
    return handlePartyVoucher(
      request,
      db,
      env,
      "receipt",
    );
  }

  if (
    request.method === "POST" &&
    path ===
      "/api/pos/finance/vouchers/payment"
  ) {
    return handlePartyVoucher(
      request,
      db,
      env,
      "payment",
    );
  }

  if (
    request.method === "POST" &&
    path ===
      "/api/pos/finance/vouchers/journal"
  ) {
    return handleJournalVoucher(
      request,
      db,
      env,
    );
  }

  const replaceMatch =
    path.match(
      /^\/api\/pos\/finance\/vouchers\/(\d+)\/replace$/,
    );

  if (
    request.method === "POST" &&
    replaceMatch
  ) {
    return handleReplaceUnifiedVoucher(
      request,
      db,
      env,
      positiveId(
        replaceMatch[1],
        "السند",
      ),
    );
  }

  return null;
}
