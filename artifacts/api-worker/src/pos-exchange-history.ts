import {
  exchangeDocumentsTable,
  exchangeReturnItemsTable,
  exchangeSaleItemsTable,
  financeTransactionsTable,
} from "@workspace/db/schema";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  or,
  sql,
} from "drizzle-orm";

import { getCurrentUser } from "./auth";
import {
  openDb,
  type Env,
} from "./db";

type Db =
  Awaited<
    ReturnType<typeof openDb>
  >["db"];

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

async function requirePosUser(
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
      ok: false as const,
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
    ok: true as const,
    user,
  };
}

function normalizeRegisterKey(
  value: string | null,
) {
  const registerKey =
    (value ?? "main")
      .trim()
      .toLowerCase();

  if (
    !/^[a-z0-9_-]{1,50}$/.test(
      registerKey,
    )
  ) {
    return null;
  }

  return registerKey;
}

function palestineBusinessDate() {
  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone: "Asia/Hebron",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      },
    ).formatToParts(new Date());

  const values =
    Object.fromEntries(
      parts.map((part) => [
        part.type,
        part.value,
      ]),
    );

  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeBusinessDate(
  value: string | null,
) {
  const date =
    value?.trim() ||
    palestineBusinessDate();

  return /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : null;
}

function normalizePublicId(
  value: string | null,
) {
  const publicId =
    (value ?? "")
      .trim()
      .toUpperCase();

  if (
    !publicId ||
    publicId.length > 80 ||
    !/^[A-Z0-9_-]+$/.test(
      publicId,
    )
  ) {
    return null;
  }

  return publicId;
}

export async function handleListPosExchanges(
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

  const registerKey =
    normalizeRegisterKey(
      url.searchParams.get(
        "register",
      ),
    );

  if (!registerKey) {
    return json(
      {
        error:
          "معرّف الصندوق غير صالح",
      },
      400,
    );
  }

  const businessDate =
    normalizeBusinessDate(
      url.searchParams.get(
        "date",
      ),
    );

  if (!businessDate) {
    return json(
      {
        error:
          "التاريخ غير صالح",
      },
      400,
    );
  }

  const exchanges =
    await db
      .select()
      .from(
        exchangeDocumentsTable,
      )
      .where(
        and(
          sql`(${exchangeDocumentsTable.createdAt} AT TIME ZONE 'Asia/Hebron')::date = ${businessDate}::date`,
          or(
            eq(
              exchangeDocumentsTable.registerKey,
              registerKey,
            ),
            eq(
              exchangeDocumentsTable.sourceType,
              "online_order",
            ),
          ),
        ),
      )
      .orderBy(
        desc(
          exchangeDocumentsTable.createdAt,
        ),
        desc(
          exchangeDocumentsTable.id,
        ),
      );

  const exchangeIds =
    exchanges.map(
      (exchange) =>
        String(
          exchange.id,
        ),
    );

  const cardFinanceRows =
    exchangeIds.length > 0
      ? await db
          .select({
            sourceId:
              financeTransactionsTable.sourceId,
            sourceEvent:
              financeTransactionsTable.sourceEvent,
          })
          .from(
            financeTransactionsTable,
          )
          .where(
            and(
              eq(
                financeTransactionsTable.sourceType,
                "exchange",
              ),
              inArray(
                financeTransactionsTable.sourceId,
                exchangeIds,
              ),
              inArray(
                financeTransactionsTable.sourceEvent,
                [
                  "card_settlement_arab",
                  "card_settlement_bop",
                ],
              ),
            ),
          )
      : [];

  const cardProcessorByExchangeId =
    new Map<
      number,
      "arab" | "bop"
    >();

  for (
    const row of
    cardFinanceRows
  ) {
    const exchangeId =
      Number(
        row.sourceId,
      );

    if (
      !Number.isSafeInteger(
        exchangeId,
      )
    ) {
      continue;
    }

    cardProcessorByExchangeId.set(
      exchangeId,
      row.sourceEvent ===
        "card_settlement_arab"
        ? "arab"
        : "bop",
    );
  }

  return json({
    session: null,
    businessDate,

    exchanges:
      exchanges.map(
        (exchange) => ({
          id: exchange.id,
          publicId:
            exchange.publicId,
          sourceType:
            exchange.sourceType,
          businessDate:
            exchange.businessDate,
          registerKey:
            exchange.registerKey,
          customerName:
            exchange.customerName,
          status:
            exchange.status,
          settlementType:
            exchange.settlementType,
          cardProcessor:
            cardProcessorByExchangeId.get(
              exchange.id,
            ) ?? null,
          returnNetMinor:
            exchange.returnNetMinor,
          newNetMinor:
            exchange.newNetMinor,
          differenceMinor:
            exchange.differenceMinor,
          settlementAmountMinor:
            exchange.settlementAmountMinor,
          reason:
            exchange.reason,
          notes:
            exchange.notes,
          voidedAt:
            exchange.voidedAt,
          voidReason:
            exchange.voidReason,
          createdAt:
            exchange.createdAt,
        }),
      ),
  });
}

export async function handleGetPosExchangeByPublicId(
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

  const publicId =
    normalizePublicId(
      url.searchParams.get(
        "publicId",
      ),
    );

  if (!publicId) {
    return json(
      {
        error:
          "رقم فاتورة التبديل غير صالح",
      },
      400,
    );
  }

  const exchangeRows =
    await db
      .select()
      .from(
        exchangeDocumentsTable,
      )
      .where(
        eq(
          exchangeDocumentsTable
            .publicId,
          publicId,
        ),
      )
      .limit(1);

  const exchange =
    exchangeRows[0];

  if (!exchange) {
    return json(
      {
        error:
          "فاتورة التبديل غير موجودة",
      },
      404,
    );
  }

  const [
    returnItems,
    saleItems,
  ] =
    await Promise.all([
      db
        .select()
        .from(
          exchangeReturnItemsTable,
        )
        .where(
          eq(
            exchangeReturnItemsTable
              .exchangeId,
            exchange.id,
          ),
        )
        .orderBy(
          asc(
            exchangeReturnItemsTable
              .lineNumber,
          ),
        ),

      db
        .select()
        .from(
          exchangeSaleItemsTable,
        )
        .where(
          eq(
            exchangeSaleItemsTable
              .exchangeId,
            exchange.id,
          ),
        )
        .orderBy(
          asc(
            exchangeSaleItemsTable
              .lineNumber,
          ),
        ),
    ]);

  const cardFinanceRows =
    exchange.settlementType ===
    "card"
      ? await db
          .select({
            sourceEvent:
              financeTransactionsTable.sourceEvent,
          })
          .from(
            financeTransactionsTable,
          )
          .where(
            and(
              eq(
                financeTransactionsTable.sourceType,
                "exchange",
              ),
              eq(
                financeTransactionsTable.sourceId,
                String(
                  exchange.id,
                ),
              ),
              inArray(
                financeTransactionsTable.sourceEvent,
                [
                  "card_settlement_arab",
                  "card_settlement_bop",
                ],
              ),
            ),
          )
          .limit(1)
      : [];

  const cardProcessor =
    cardFinanceRows[0]
      ?.sourceEvent ===
      "card_settlement_arab"
      ? "arab"
      : cardFinanceRows[0]
            ?.sourceEvent ===
          "card_settlement_bop"
        ? "bop"
        : null;

  return json({
    ok: true,
    validationOnly: false,
    alreadyCreated: true,
    quote: null,
    exchange: {
      ...exchange,
      cardProcessor,
    },
    returnItems,
    saleItems,
  });
}
