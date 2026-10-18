import {
  appSettingsTable,
  discountCodesTable,
  ordersTable,
} from "@workspace/db/schema";
import {
  and,
  desc,
  eq,
  ne,
  sql,
} from "drizzle-orm";

import {
  getCurrentUser,
} from "./auth";
import type {
  Env,
  openDb,
} from "./db";
import {
  discountCodesEnabled,
  findActiveDiscountCode,
  normalizeDiscountCode,
} from "./discount-code-service";

type Db = Awaited<
  ReturnType<typeof openDb>
>["db"];

const headers = {
  "Content-Type":
    "application/json",
  "Access-Control-Allow-Origin":
    "*",
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

async function requireAdmin(
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

  if (!user.isAdmin) {
    return {
      ok: false as const,
      response: json(
        {
          error:
            "غير مصرح",
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

function parseDateOnly(
  value: unknown,
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(
      value,
    )
  ) {
    return undefined;
  }

  const [
    year,
    month,
    day,
  ] =
    value
      .split("-")
      .map(Number);

  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day,
      ),
    );

  if (
    date.getUTCFullYear() !==
      year ||
    date.getUTCMonth() !==
      month - 1 ||
    date.getUTCDate() !==
      day
  ) {
    return undefined;
  }

  return value;
}

function parseCodeInput(
  raw: unknown,
) {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    return {
      ok: false as const,
      error:
        "بيانات كود الخصم غير صالحة",
    };
  }

  const body =
    raw as Record<
      string,
      unknown
    >;

  const campaignName =
    typeof body.campaignName ===
      "string"
      ? body.campaignName
          .trim()
      : "";

  const code =
    typeof body.code ===
      "string"
      ? body.code.trim()
      : "";

  const normalizedCode =
    normalizeDiscountCode(
      code,
    );

  const percent =
    Number(
      body.discountPercent,
    );

  const startDate =
    parseDateOnly(
      body.startDate,
    );

  const endDate =
    parseDateOnly(
      body.endDate,
    );

  if (
    !campaignName ||
    campaignName.length > 100
  ) {
    return {
      ok: false as const,
      error:
        "اسم الحملة مطلوب وبحد أقصى 100 حرف",
    };
  }

  if (
    !/^[A-Z0-9_-]{3,40}$/.test(
      normalizedCode,
    )
  ) {
    return {
      ok: false as const,
      error:
        "الكود يجب أن يكون من 3 إلى 40 حرفًا أو رقمًا ويمكن استخدام - و _",
    };
  }

  if (
    !Number.isSafeInteger(
      percent,
    ) ||
    percent < 1 ||
    percent > 100
  ) {
    return {
      ok: false as const,
      error:
        "نسبة الخصم يجب أن تكون رقمًا صحيحًا من 1 إلى 100",
    };
  }

  if (
    startDate === undefined ||
    endDate === undefined
  ) {
    return {
      ok: false as const,
      error:
        "تاريخ بداية أو نهاية الكود غير صالح",
    };
  }

  if (
    startDate &&
    endDate &&
    endDate < startDate
  ) {
    return {
      ok: false as const,
      error:
        "تاريخ نهاية الكود يجب ألا يسبق تاريخ البداية",
    };
  }

  return {
    ok: true as const,
    data: {
      campaignName,
      code:
        normalizedCode,
      normalizedCode,
      discountPercent:
        percent,
      isActive:
        body.isActive !==
        false,
      stackWithShippingPromotion:
        body.stackWithShippingPromotion ===
        true,
      startDate,
      endDate,
    },
  };
}

async function handleValidate(
  request: Request,
  db: Db,
) {
  const body =
    await request
      .json()
      .catch(
        () => null,
      ) as
        | {
            code?: unknown;
          }
        | null;

  const rawCode =
    typeof body?.code ===
      "string"
      ? body.code
      : "";

  if (!rawCode.trim()) {
    return json({
      valid: false,
      error:
        "أدخل كود الخصم",
    });
  }

  const settingsRows =
    await db
      .select({
        data:
          appSettingsTable.data,
      })
      .from(
        appSettingsTable,
      )
      .where(
        eq(
          appSettingsTable.id,
          1,
        ),
      )
      .limit(1);

  const settingsData =
    settingsRows[0]?.data;

  if (
    !discountCodesEnabled(
      settingsData,
    )
  ) {
    return json({
      valid: false,
      error:
        "أكواد الخصم غير مفعلة حاليًا",
    });
  }

  const code =
    await findActiveDiscountCode(
      db,
      settingsData,
      rawCode,
    );

  if (!code) {
    return json({
      valid: false,
      error:
        "كود الخصم غير صالح أو غير فعال",
    });
  }

  return json({
    valid: true,
    code: code.code,
    campaignName:
      code.campaignName,
    discountPercent:
      code.discountPercent,
    stackWithShippingPromotion:
      code.stackWithShippingPromotion,
  });
}

async function handleList(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth =
    await requireAdmin(
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
        discountCodesTable,
      )
      .orderBy(
        desc(
          discountCodesTable.createdAt,
        ),
      );

  const usageRows =
    await db
      .select({
        discountCodeId:
          ordersTable.discountCodeId,
        ordersCount:
          sql<number>`count(*)::int`,
        salesTotal:
          sql<number>`coalesce(sum(${ordersTable.totalPrice}), 0)::int`,
        discountTotal:
          sql<number>`coalesce(sum(${ordersTable.discountCodeAmount}), 0)::int`,
      })
      .from(
        ordersTable,
      )
      .where(
        ne(
          ordersTable.status,
          "cancelled",
        ),
      )
      .groupBy(
        ordersTable.discountCodeId,
      );

  const usageById =
    new Map(
      usageRows
        .filter(
          (row) =>
            row.discountCodeId !==
            null,
        )
        .map(
          (row) => [
            row.discountCodeId!,
            {
              ordersCount:
                Number(
                  row.ordersCount,
                ),
              salesTotal:
                Number(
                  row.salesTotal,
                ),
              discountTotal:
                Number(
                  row.discountTotal,
                ),
            },
          ],
        ),
    );

  return json(
    rows.map(
      (row) => ({
        ...row,
        stats:
          usageById.get(
            row.id,
          ) ?? {
            ordersCount: 0,
            salesTotal: 0,
            discountTotal: 0,
          },
      }),
    ),
  );
}

async function handleCreate(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth =
    await requireAdmin(
      request,
      db,
      env,
    );

  if (!auth.ok) {
    return auth.response;
  }

  const parsed =
    parseCodeInput(
      await request
        .json()
        .catch(
          () => null,
        ),
    );

  if (!parsed.ok) {
    return json(
      {
        error:
          parsed.error,
      },
      400,
    );
  }

  const duplicate =
    await db
      .select({
        id:
          discountCodesTable.id,
      })
      .from(
        discountCodesTable,
      )
      .where(
        eq(
          discountCodesTable.normalizedCode,
          parsed.data.normalizedCode,
        ),
      )
      .limit(1);

  if (duplicate[0]) {
    return json(
      {
        error:
          "هذا الكود موجود مسبقًا",
      },
      409,
    );
  }

  const rows =
    await db
      .insert(
        discountCodesTable,
      )
      .values(
        parsed.data,
      )
      .returning();

  return json(
    rows[0],
    201,
  );
}

async function handleUpdate(
  request: Request,
  db: Db,
  env: Env,
  id: number,
) {
  const auth =
    await requireAdmin(
      request,
      db,
      env,
    );

  if (!auth.ok) {
    return auth.response;
  }

  const currentRows =
    await db
      .select()
      .from(
        discountCodesTable,
      )
      .where(
        eq(
          discountCodesTable.id,
          id,
        ),
      )
      .limit(1);

  const current =
    currentRows[0];

  if (!current) {
    return json(
      {
        error:
          "كود الخصم غير موجود",
      },
      404,
    );
  }

  const raw =
    await request
      .json()
      .catch(
        () => null,
      );

  const body =
    raw &&
    typeof raw ===
      "object" &&
    !Array.isArray(raw)
      ? raw as Record<
          string,
          unknown
        >
      : {};

  const parsed =
    parseCodeInput({
      campaignName:
        body.campaignName ??
        current.campaignName,
      code:
        body.code ??
        current.code,
      discountPercent:
        body.discountPercent ??
        current.discountPercent,
      isActive:
        body.isActive ??
        current.isActive,
      stackWithShippingPromotion:
        body.stackWithShippingPromotion ??
        current.stackWithShippingPromotion,
      startDate:
        body.startDate ===
        undefined
          ? current.startDate
          : body.startDate,
      endDate:
        body.endDate ===
        undefined
          ? current.endDate
          : body.endDate,
    });

  if (!parsed.ok) {
    return json(
      {
        error:
          parsed.error,
      },
      400,
    );
  }

  const duplicate =
    await db
      .select({
        id:
          discountCodesTable.id,
      })
      .from(
        discountCodesTable,
      )
      .where(
        and(
          eq(
            discountCodesTable.normalizedCode,
            parsed.data.normalizedCode,
          ),
          ne(
            discountCodesTable.id,
            id,
          ),
        ),
      )
      .limit(1);

  if (duplicate[0]) {
    return json(
      {
        error:
          "هذا الكود موجود مسبقًا",
      },
      409,
    );
  }

  const rows =
    await db
      .update(
        discountCodesTable,
      )
      .set({
        ...parsed.data,
        updatedAt:
          new Date(),
      })
      .where(
        eq(
          discountCodesTable.id,
          id,
        ),
      )
      .returning();

  return json(
    rows[0],
  );
}

export async function handleDiscountCodeRequest(
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
      "POST" &&
    path ===
      "/api/discount-codes/validate"
  ) {
    return handleValidate(
      request,
      db,
    );
  }

  if (
    request.method ===
      "GET" &&
    path ===
      "/api/admin/discount-codes"
  ) {
    return handleList(
      request,
      db,
      env,
    );
  }

  if (
    request.method ===
      "POST" &&
    path ===
      "/api/admin/discount-codes"
  ) {
    return handleCreate(
      request,
      db,
      env,
    );
  }

  const updateMatch =
    path.match(
      /^\/api\/admin\/discount-codes\/(\d+)$/,
    );

  if (
    request.method ===
      "PATCH" &&
    updateMatch
  ) {
    return handleUpdate(
      request,
      db,
      env,
      Number(
        updateMatch[1],
      ),
    );
  }

  return null;
}
