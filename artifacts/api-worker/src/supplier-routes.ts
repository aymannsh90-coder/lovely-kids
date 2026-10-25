import {
  financeTransactionsTable,
  posPurchasesTable,
  suppliersTable,
} from "@workspace/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getCurrentUser } from "./auth";
import { openDb, type Env } from "./db";
import {
  supplierPayableBalances,
  supplierPayableLedgerLines,
} from "./finance-supplier-ledger";
import {
  isPurchaseApiEnabled,
  isPurchaseWriteEnabled,
  purchaseFeatureDisabledResponse,
  purchaseWritesDisabledResponse,
} from "./purchase-feature";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

type PosUser = NonNullable<
  Awaited<ReturnType<typeof getCurrentUser>>
>;

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers,
  });

class SupplierError extends Error {
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
  const user = await getCurrentUser(db, request, env);

  if (!user) {
    return {
      ok: false,
      response: json({ error: "يجب تسجيل الدخول" }, 401),
    };
  }

  if (!user.isAdmin && !user.isOwner) {
    return {
      ok: false,
      response: json(
        { error: "غير مصرح بإدارة الموردين" },
        403,
      ),
    };
  }

  return {
    ok: true,
    user,
  };
}

function requiredText(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new SupplierError(`${field} مطلوب`);
  }

  const text = value.trim();

  if (!text) {
    throw new SupplierError(`${field} مطلوب`);
  }

  if (text.length > maxLength) {
    throw new SupplierError(`${field} طويل جدًا`);
  }

  return text;
}

function optionalText(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new SupplierError(`${field} غير صالح`);
  }

  const text = value.trim();

  if (!text) {
    return null;
  }

  if (text.length > maxLength) {
    throw new SupplierError(`${field} طويل جدًا`);
  }

  return text;
}

function normalizeCode(value: unknown): string {
  const code = requiredText(value, "رمز المورد", 40)
    .toUpperCase();

  if (!/^[A-Z0-9_-]{1,40}$/.test(code)) {
    throw new SupplierError(
      "رمز المورد يقبل الأحرف الإنجليزية والأرقام والشرطة فقط",
    );
  }

  return code;
}

interface SupplierFinanceSummary {
  totalPurchasesMinor: number;
  paidMinor: number;
  dueMinor: number;
  supplierCreditMinor: number;
}

const EMPTY_SUPPLIER_FINANCE: SupplierFinanceSummary = {
  totalPurchasesMinor: 0,
  paidMinor: 0,
  dueMinor: 0,
  supplierCreditMinor: 0,
};

function toSupplier(
  supplier: typeof suppliersTable.$inferSelect,
  finance: SupplierFinanceSummary = EMPTY_SUPPLIER_FINANCE,
  includeFinance = false,
) {
  return {
    id: String(supplier.id),
    code: supplier.code,
    name: supplier.name,
    contactPerson: supplier.contactPerson,
    phone: supplier.phone,
    mobile: supplier.mobile,
    email: supplier.email,
    address: supplier.address,
    notes: supplier.notes,
    status: supplier.status,
    createdByUserId: String(supplier.createdByUserId),

    ...(includeFinance
      ? {
          totalPurchasesMinor: finance.totalPurchasesMinor,
          totalPurchases: finance.totalPurchasesMinor / 100,

          paidMinor: finance.paidMinor,
          paid: finance.paidMinor / 100,

          dueMinor: finance.dueMinor,
          due: finance.dueMinor / 100,

          supplierCreditMinor: finance.supplierCreditMinor,
          supplierCredit: finance.supplierCreditMinor / 100,
        }
      : {}),

    createdAt: supplier.createdAt.toISOString(),
    updatedAt: supplier.updatedAt.toISOString(),
  };
}

async function getSupplierFinanceSummaries(
  db: Db,
): Promise<Map<number, SupplierFinanceSummary>> {
  const purchaseRows = await db
    .select({
      id: posPurchasesTable.id,
      supplierId: posPurchasesTable.supplierId,
      totalMinor: posPurchasesTable.totalMinor,
      dueMinor: posPurchasesTable.dueMinor,
    })
    .from(posPurchasesTable)
    .where(eq(posPurchasesTable.status, "completed"));

  const coveredFinanceRows = await db
    .select({
      sourceId: financeTransactionsTable.sourceId,
    })
    .from(financeTransactionsTable)
    .where(
      and(
        eq(financeTransactionsTable.sourceType, "pos_purchase"),
        eq(financeTransactionsTable.sourceEvent, "completed"),
      ),
    );

  const financeCoveredPurchaseIds = new Set(
    coveredFinanceRows.map((row) => row.sourceId),
  );

  const financeBalanceBySupplier =
    await supplierPayableBalances(
      db,
    );

  const totalsBySupplier = new Map<
    number,
    {
      totalPurchasesMinor: number;
      legacyDueMinor: number;
    }
  >();

  for (const purchase of purchaseRows) {
    const current = totalsBySupplier.get(
      purchase.supplierId,
    ) ?? {
      totalPurchasesMinor: 0,
      legacyDueMinor: 0,
    };

    current.totalPurchasesMinor += purchase.totalMinor;

    // Purchases created before the finance ledger existed do
    // not have a finance transaction. Preserve their due amount
    // here so old supplier balances are not lost.
    if (
      !financeCoveredPurchaseIds.has(
        String(purchase.id),
      )
    ) {
      current.legacyDueMinor += purchase.dueMinor;
    }

    totalsBySupplier.set(
      purchase.supplierId,
      current,
    );
  }

  const supplierIds = new Set<number>([
    ...totalsBySupplier.keys(),
    ...financeBalanceBySupplier.keys(),
  ]);

  const result =
    new Map<number, SupplierFinanceSummary>();

  for (const supplierId of supplierIds) {
    const purchaseTotals =
      totalsBySupplier.get(supplierId) ?? {
        totalPurchasesMinor: 0,
        legacyDueMinor: 0,
      };

    const ledgerBalance =
      financeBalanceBySupplier.get(supplierId) ?? 0;

    const rawBalance =
      purchaseTotals.legacyDueMinor + ledgerBalance;

    const dueMinor = Math.max(0, rawBalance);
    const supplierCreditMinor = Math.max(
      0,
      -rawBalance,
    );

    const paidMinor = Math.max(
      0,
      purchaseTotals.totalPurchasesMinor - rawBalance,
    );

    result.set(supplierId, {
      totalPurchasesMinor:
        purchaseTotals.totalPurchasesMinor,
      paidMinor,
      dueMinor,
      supplierCreditMinor,
    });
  }

  return result;
}

async function handleListSuppliers(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth = await requirePosUser(request, db, env);

  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(request.url);
  const search = (url.searchParams.get("q") ?? "")
    .trim()
    .toLocaleLowerCase("ar");

  const requestedStatus = url.searchParams.get("status");

  const status =
    requestedStatus === "active" ||
    requestedStatus === "inactive"
      ? requestedStatus
      : null;

  const rows = await db
    .select()
    .from(suppliersTable)
    .orderBy(asc(suppliersTable.name))
    .limit(500);

  const financeBySupplier =
    auth.user.isOwner
      ? await getSupplierFinanceSummaries(db)
      : new Map<number, SupplierFinanceSummary>();

  const results = rows.filter((supplier) => {
    if (status && supplier.status !== status) {
      return false;
    }

    if (!search) {
      return true;
    }

    const values = [
      supplier.code,
      supplier.name,
      supplier.contactPerson,
      supplier.phone,
      supplier.mobile,
      supplier.email,
    ];

    return values.some((value) =>
      value
        ?.toLocaleLowerCase("ar")
        .includes(search),
    );
  });

  return json({
    results: results.map((supplier) =>
      toSupplier(
        supplier,
        financeBySupplier.get(supplier.id) ??
          EMPTY_SUPPLIER_FINANCE,
        auth.user.isOwner,
      ),
    ),
  });
}

async function handleSupplierLedger(
  request: Request,
  db: Db,
  env: Env,
  supplierId: number,
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

  if (!auth.user.isOwner) {
    return json(
      {
        error:
          "كشف حساب المورد متاح للمالك فقط",
      },
      403,
    );
  }

  const supplierRows =
    await db
      .select()
      .from(suppliersTable)
      .where(
        eq(
          suppliersTable.id,
          supplierId,
        ),
      )
      .limit(1);

  const supplier =
    supplierRows[0];

  if (!supplier) {
    return json(
      {
        error:
          "المورد غير موجود",
      },
      404,
    );
  }

  const [
    lines,
    financeSummaries,
  ] =
    await Promise.all([
      supplierPayableLedgerLines(
        db,
        supplierId,
      ),
      getSupplierFinanceSummaries(
        db,
      ),
    ]);

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
    txIds.length > 0
      ? await db
          .select()
          .from(
            financeTransactionsTable,
          )
          .where(
            inArray(
              financeTransactionsTable.id,
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

  const ledgerBalanceMinor =
    lines.reduce(
      (total, line) =>
        total +
        line.creditMinor -
        line.debitMinor,
      0,
    );

  const finance =
    financeSummaries.get(
      supplierId,
    ) ??
    EMPTY_SUPPLIER_FINANCE;

  const totalBalanceMinor =
    finance.dueMinor -
    finance.supplierCreditMinor;

  const baseOpeningBalanceMinor =
    totalBalanceMinor -
    ledgerBalanceMinor;

  let runningBalanceMinor =
    baseOpeningBalanceMinor;

  const entries =
    lines.map(
      (line) => {
        const transaction =
          txMap.get(
            line.transactionId,
          );

        const deltaMinor =
          line.creditMinor -
          line.debitMinor;

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
    supplier:
      toSupplier(
        supplier,
        finance,
        true,
      ),
    baseOpeningBalanceMinor,
    balanceMinor:
      runningBalanceMinor,
    balance:
      runningBalanceMinor /
      100,
    entries,
  });
}

async function handleCreateSupplier(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth = await requirePosUser(request, db, env);

  if (!auth.ok) {
    return auth.response;
  }

  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "بيانات المورد غير صالحة" }, 400);
  }

  const payload = body as Record<string, unknown>;

  try {
    const code = normalizeCode(payload.code);
    const name = requiredText(payload.name, "اسم المورد", 200);

    const status =
      payload.status === undefined
        ? "active"
        : payload.status;

    if (status !== "active" && status !== "inactive") {
      throw new SupplierError("حالة المورد غير صالحة");
    }

    const inserted = await db
      .insert(suppliersTable)
      .values({
        code,
        name,
        contactPerson: optionalText(
          payload.contactPerson,
          "اسم جهة الاتصال",
          200,
        ),
        phone: optionalText(payload.phone, "الهاتف", 50),
        mobile: optionalText(payload.mobile, "الجوال", 50),
        email: optionalText(payload.email, "البريد الإلكتروني", 254),
        address: optionalText(payload.address, "العنوان", 500),
        notes: optionalText(payload.notes, "الملاحظات", 2000),
        status,
        createdByUserId: auth.user.id,
      })
      .returning();

    const supplier = inserted[0];

    if (!supplier) {
      throw new Error("SUPPLIER_INSERT_FAILED");
    }

    return json(
      {
        supplier: toSupplier(
          supplier,
          EMPTY_SUPPLIER_FINANCE,
          auth.user.isOwner,
        ),
      },
      201,
    );
  } catch (error) {
    if (error instanceof SupplierError) {
      return json({ error: error.message }, error.status);
    }

    const pgError = error as {
      code?: string;
      constraint?: string;
    };

    if (
      pgError.code === "23505" ||
      pgError.constraint === "suppliers_code_idx"
    ) {
      return json(
        { error: "رمز المورد مستخدم مسبقًا" },
        409,
      );
    }

    console.error("SUPPLIER_CREATE_FAILED", error);

    return json(
      { error: "تعذر إضافة المورد" },
      500,
    );
  }
}

export async function handleSupplierRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (
    request.method === "GET" &&
    path === "/api/pos/suppliers"
  ) {
    if (!isPurchaseApiEnabled(env)) {
      return purchaseFeatureDisabledResponse();
    }

    return handleListSuppliers(request, db, env);
  }

  const supplierLedgerMatch =
    path.match(
      /^\/api\/pos\/suppliers\/(\d+)\/ledger$/,
    );

  if (
    request.method === "GET" &&
    supplierLedgerMatch
  ) {
    if (!isPurchaseApiEnabled(env)) {
      return purchaseFeatureDisabledResponse();
    }

    return handleSupplierLedger(
      request,
      db,
      env,
      Number(
        supplierLedgerMatch[1],
      ),
    );
  }

  if (
    request.method === "POST" &&
    path === "/api/pos/suppliers"
  ) {
    if (!isPurchaseWriteEnabled(env)) {
      return purchaseWritesDisabledResponse();
    }

    return handleCreateSupplier(request, db, env);
  }

  return null;
}
