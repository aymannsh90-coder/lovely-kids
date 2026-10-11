import {
  financeTransactionLinesTable,
  financeTransactionsTable,
} from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";

const MAX_MINOR = 2_147_483_647;

export type FinanceTransactionType =
  | "sale"
  | "purchase"
  | "receipt"
  | "payment"
  | "expense"
  | "refund"
  | "reversal"
  | "adjustment"
  | "transfer";

export interface FinancePostingLineInput {
  accountId: number;
  customerId?: number | null;
  employeeId?: number | null;
  supplierId?: number | null;
  debitMinor?: number;
  creditMinor?: number;
  memo?: string | null;
}

export interface PostFinanceTransactionInput {
  publicId: string;
  idempotencyKey: string;
  businessDate: string;
  transactionType: FinanceTransactionType;
  sourceType: string;
  sourceId: string;
  sourceEvent: string;
  cashSessionId?: number | null;
  notes?: string | null;
  createdByUserId?: number | null;
  lines: FinancePostingLineInput[];
}

export type FinancePostingDuplicateReason =
  | "idempotency_key"
  | "source_event";

export interface PostFinanceTransactionResult {
  alreadyPosted: boolean;
  duplicateReason: FinancePostingDuplicateReason | null;
  transaction: typeof financeTransactionsTable.$inferSelect;
}

export class FinancePostingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function requiredText(
  value: string,
  field: string,
  maxLength: number,
) {
  const normalized = value.trim();

  if (!normalized) {
    throw new FinancePostingError(
      "FINANCE_POSTING_TEXT_REQUIRED",
      `${field} مطلوب`,
    );
  }

  if (normalized.length > maxLength) {
    throw new FinancePostingError(
      "FINANCE_POSTING_TEXT_TOO_LONG",
      `${field} طويل جدًا`,
    );
  }

  return normalized;
}

function positiveInteger(
  value: number,
  field: string,
) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new FinancePostingError(
      "FINANCE_POSTING_INVALID_INTEGER",
      `${field} غير صالح`,
    );
  }

  return value;
}

function optionalPositiveInteger(
  value: number | null | undefined,
  field: string,
) {
  if (value === null || value === undefined) {
    return null;
  }

  return positiveInteger(value, field);
}

function minorAmount(
  value: number | undefined,
  field: string,
) {
  const amount = value ?? 0;

  if (
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    amount > MAX_MINOR
  ) {
    throw new FinancePostingError(
      "FINANCE_POSTING_INVALID_AMOUNT",
      `${field} غير صالح`,
    );
  }

  return amount;
}

function businessDate(value: string) {
  const normalized = value.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new FinancePostingError(
      "FINANCE_POSTING_INVALID_BUSINESS_DATE",
      "تاريخ القيد غير صالح",
    );
  }

  return normalized;
}

export function normalizeFinancePostingLines(
  lines: FinancePostingLineInput[],
) {
  if (lines.length < 2) {
    throw new FinancePostingError(
      "FINANCE_POSTING_LINES_MISSING",
      "القيد المحاسبي يجب أن يحتوي على سطرين على الأقل",
    );
  }

  let debitTotal = 0;
  let creditTotal = 0;

  const normalized = lines.map((line, index) => {
    const accountId = positiveInteger(
      line.accountId,
      `رقم الحساب في السطر ${index + 1}`,
    );

    const customerId = optionalPositiveInteger(
      line.customerId,
      `رقم الزبون في السطر ${index + 1}`,
    );

    const employeeId = optionalPositiveInteger(
      line.employeeId,
      `رقم الموظف في السطر ${index + 1}`,
    );

    const supplierId = optionalPositiveInteger(
      line.supplierId,
      `رقم المورد في السطر ${index + 1}`,
    );

    const partyCount = [
      customerId,
      employeeId,
      supplierId,
    ].filter((partyId) => partyId !== null).length;

    if (partyCount > 1) {
      throw new FinancePostingError(
        "FINANCE_POSTING_LINE_MULTIPLE_PARTIES",
        `السطر ${index + 1} لا يمكن ربطه بأكثر من طرف مالي واحد`,
      );
    }

    const debitMinor = minorAmount(
      line.debitMinor,
      `المدين في السطر ${index + 1}`,
    );

    const creditMinor = minorAmount(
      line.creditMinor,
      `الدائن في السطر ${index + 1}`,
    );

    const validSide =
      (debitMinor > 0 && creditMinor === 0) ||
      (creditMinor > 0 && debitMinor === 0);

    if (!validSide) {
      throw new FinancePostingError(
        "FINANCE_POSTING_LINE_SIDE_INVALID",
        `السطر ${index + 1} يجب أن يكون مدينًا أو دائنًا فقط`,
      );
    }

    debitTotal += debitMinor;
    creditTotal += creditMinor;

    if (
      !Number.isSafeInteger(debitTotal) ||
      !Number.isSafeInteger(creditTotal) ||
      debitTotal > MAX_MINOR ||
      creditTotal > MAX_MINOR
    ) {
      throw new FinancePostingError(
        "FINANCE_POSTING_TOTAL_OVERFLOW",
        "إجمالي القيد المحاسبي أكبر من الحد المسموح",
      );
    }

    return {
      lineNumber: index + 1,
      accountId,
      customerId,
      employeeId,
      supplierId,
      debitMinor,
      creditMinor,
      memo: line.memo?.trim() || null,
    };
  });

  if (debitTotal !== creditTotal) {
    throw new FinancePostingError(
      "FINANCE_POSTING_NOT_BALANCED",
      `القيد غير متوازن: المدين ${debitTotal} والدائن ${creditTotal}`,
    );
  }

  if (debitTotal <= 0) {
    throw new FinancePostingError(
      "FINANCE_POSTING_ZERO_TOTAL",
      "إجمالي القيد يجب أن يكون أكبر من صفر",
    );
  }

  return {
    lines: normalized,
    debitTotal,
    creditTotal,
  };
}

async function findByIdempotencyKey(
  tx: any,
  idempotencyKey: string,
) {
  const rows = await tx
    .select()
    .from(financeTransactionsTable)
    .where(
      eq(
        financeTransactionsTable.idempotencyKey,
        idempotencyKey,
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

async function findActiveSourceEvent(
  tx: any,
  input: {
    sourceType: string;
    sourceId: string;
    sourceEvent: string;
  },
) {
  const rows = await tx
    .select()
    .from(financeTransactionsTable)
    .where(
      and(
        eq(
          financeTransactionsTable.sourceType,
          input.sourceType,
        ),
        eq(
          financeTransactionsTable.sourceId,
          input.sourceId,
        ),
        eq(
          financeTransactionsTable.sourceEvent,
          input.sourceEvent,
        ),
        eq(
          financeTransactionsTable.status,
          "posted",
        ),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function postFinanceTransaction(
  tx: any,
  input: PostFinanceTransactionInput,
): Promise<PostFinanceTransactionResult> {
  const publicId = requiredText(
    input.publicId,
    "رقم القيد",
    100,
  );

  const idempotencyKey = requiredText(
    input.idempotencyKey,
    "مفتاح منع التكرار",
    160,
  );

  if (idempotencyKey.length < 8) {
    throw new FinancePostingError(
      "FINANCE_POSTING_IDEMPOTENCY_TOO_SHORT",
      "مفتاح منع التكرار قصير جدًا",
    );
  }

  const sourceType = requiredText(
    input.sourceType,
    "نوع المصدر",
    120,
  );

  const sourceId = requiredText(
    input.sourceId,
    "رقم المصدر",
    160,
  );

  const sourceEvent = requiredText(
    input.sourceEvent,
    "حدث المصدر",
    120,
  );

  const normalizedDate = businessDate(
    input.businessDate,
  );

  const normalized = normalizeFinancePostingLines(
    input.lines,
  );

  const existingByKey = await findByIdempotencyKey(
    tx,
    idempotencyKey,
  );

  if (existingByKey) {
    return {
      alreadyPosted: true,
      duplicateReason: "idempotency_key",
      transaction: existingByKey,
    };
  }

  const existingBySource = await findActiveSourceEvent(
    tx,
    {
      sourceType,
      sourceId,
      sourceEvent,
    },
  );

  if (existingBySource) {
    return {
      alreadyPosted: true,
      duplicateReason: "source_event",
      transaction: existingBySource,
    };
  }

  const insertedRows = await tx
    .insert(financeTransactionsTable)
    .values({
      publicId,
      idempotencyKey,
      businessDate: normalizedDate,
      transactionType: input.transactionType,
      sourceType,
      sourceId,
      sourceEvent,
      cashSessionId: input.cashSessionId ?? null,
      status: "posted",
      notes: input.notes?.trim() || null,
      createdByUserId: input.createdByUserId ?? null,
    })
    .returning();

  const transaction = insertedRows[0];

  if (!transaction) {
    throw new FinancePostingError(
      "FINANCE_POSTING_TRANSACTION_INSERT_FAILED",
      "تعذر إنشاء رأس القيد المحاسبي",
    );
  }

  await tx
    .insert(financeTransactionLinesTable)
    .values(
      normalized.lines.map((line) => ({
        transactionId: transaction.id,
        lineNumber: line.lineNumber,
        accountId: line.accountId,
        customerId: line.customerId,
        employeeId: line.employeeId,
        supplierId: line.supplierId,
        debitMinor: line.debitMinor,
        creditMinor: line.creditMinor,
        memo: line.memo,
      })),
    );

  return {
    alreadyPosted: false,
    duplicateReason: null,
    transaction,
  };
}
