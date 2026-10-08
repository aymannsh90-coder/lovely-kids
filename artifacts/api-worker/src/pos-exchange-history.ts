import {
  exchangeDocumentsTable,
  exchangeReturnItemsTable,
  exchangeSaleItemsTable,
} from "@workspace/db/schema";
import {
  and,
  asc,
  desc,
  eq,
  or,
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
          eq(
            exchangeDocumentsTable.businessDate,
            businessDate,
          ),
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

  return json({
    ok: true,
    validationOnly: false,
    alreadyCreated: true,
    quote: null,
    exchange,
    returnItems,
    saleItems,
  });
}
