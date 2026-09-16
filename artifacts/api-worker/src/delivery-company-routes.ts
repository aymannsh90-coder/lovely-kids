import {
  deliveryCompaniesTable,
} from "@workspace/db/schema";
import { asc, eq } from "drizzle-orm";

import { getCurrentUser } from "./auth";
import { openDb, type Env } from "./db";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers,
  });

class DeliveryCompanyError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

async function requireAdmin(
  request: Request,
  db: Db,
  env: Env,
) {
  const user = await getCurrentUser(db, request, env);

  if (!user) {
    return {
      ok: false as const,
      response: json({ error: "يجب تسجيل الدخول" }, 401),
    };
  }

  if (!user.isAdmin && !user.isOwner) {
    return {
      ok: false as const,
      response: json(
        { error: "غير مصرح بإدارة شركات التوصيل" },
        403,
      ),
    };
  }

  return {
    ok: true as const,
    user,
  };
}

function requiredText(
  value: unknown,
  field: string,
  maxLength: number,
) {
  if (typeof value !== "string") {
    throw new DeliveryCompanyError(`${field} مطلوب`);
  }

  const text = value.trim();

  if (!text) {
    throw new DeliveryCompanyError(`${field} مطلوب`);
  }

  if (text.length > maxLength) {
    throw new DeliveryCompanyError(`${field} طويل جدًا`);
  }

  return text;
}

function optionalText(
  value: unknown,
  field: string,
  maxLength: number,
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (typeof value !== "string") {
    throw new DeliveryCompanyError(`${field} غير صالح`);
  }

  const text = value.trim();

  if (!text) {
    return null;
  }

  if (text.length > maxLength) {
    throw new DeliveryCompanyError(`${field} طويل جدًا`);
  }

  return text;
}

function normalizeCode(value: unknown) {
  const code = requiredText(
    value,
    "رمز شركة التوصيل",
    40,
  ).toUpperCase();

  if (!/^[A-Z0-9_-]{1,40}$/.test(code)) {
    throw new DeliveryCompanyError(
      "الرمز يقبل الأحرف الإنجليزية والأرقام والشرطة فقط",
    );
  }

  return code;
}

function toDeliveryCompany(
  row: typeof deliveryCompaniesTable.$inferSelect,
) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    phone: row.phone,
    notes: row.notes,
    status: row.status,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function handleList(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth = await requireAdmin(request, db, env);

  if (!auth.ok) {
    return auth.response;
  }

  const rows = await db
    .select()
    .from(deliveryCompaniesTable)
    .orderBy(
      asc(deliveryCompaniesTable.name),
      asc(deliveryCompaniesTable.id),
    );

  return json(rows.map(toDeliveryCompany));
}

async function handleCreate(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth = await requireAdmin(request, db, env);

  if (!auth.ok) {
    return auth.response;
  }

  const body = await request
    .json()
    .catch(() => null) as Record<string, unknown> | null;

  if (!body || Array.isArray(body)) {
    return json({ error: "البيانات غير صالحة" }, 400);
  }

  try {
    const code = normalizeCode(body.code);
    const name = requiredText(body.name, "اسم الشركة", 150);
    const phone = optionalText(body.phone, "الهاتف", 50);
    const notes = optionalText(body.notes, "الملاحظات", 1000);

    const rows = await db
      .insert(deliveryCompaniesTable)
      .values({
        code,
        name,
        phone,
        notes,
        status: "active",
        createdByUserId: auth.user.id,
      })
      .returning();

    return json(toDeliveryCompany(rows[0]), 201);
  } catch (error) {
    if (error instanceof DeliveryCompanyError) {
      return json(
        { error: error.message },
        error.status,
      );
    }

    const pgError = error as {
      code?: string;
      constraint?: string;
    };

    if (
      pgError.code === "23505" ||
      pgError.constraint ===
        "delivery_companies_code_idx"
    ) {
      return json(
        { error: "رمز شركة التوصيل مستخدم مسبقًا" },
        409,
      );
    }

    console.error("DELIVERY_COMPANY_CREATE_FAILED", error);

    return json(
      { error: "تعذر إضافة شركة التوصيل" },
      500,
    );
  }
}

async function handleUpdate(
  request: Request,
  db: Db,
  env: Env,
  id: number,
) {
  const auth = await requireAdmin(request, db, env);

  if (!auth.ok) {
    return auth.response;
  }

  const body = await request
    .json()
    .catch(() => null) as Record<string, unknown> | null;

  if (!body || Array.isArray(body)) {
    return json({ error: "البيانات غير صالحة" }, 400);
  }

  try {
    const currentRows = await db
      .select()
      .from(deliveryCompaniesTable)
      .where(eq(deliveryCompaniesTable.id, id))
      .limit(1);

    const current = currentRows[0];

    if (!current) {
      return json(
        { error: "شركة التوصيل غير موجودة" },
        404,
      );
    }

    const changes: Partial<
      typeof deliveryCompaniesTable.$inferInsert
    > = {
      updatedAt: new Date(),
    };

    if (body.code !== undefined) {
      changes.code = normalizeCode(body.code);
    }

    if (body.name !== undefined) {
      changes.name = requiredText(
        body.name,
        "اسم الشركة",
        150,
      );
    }

    if (body.phone !== undefined) {
      changes.phone = optionalText(
        body.phone,
        "الهاتف",
        50,
      );
    }

    if (body.notes !== undefined) {
      changes.notes = optionalText(
        body.notes,
        "الملاحظات",
        1000,
      );
    }

    if (body.status !== undefined) {
      if (
        body.status !== "active" &&
        body.status !== "inactive"
      ) {
        throw new DeliveryCompanyError(
          "حالة الشركة غير صالحة",
        );
      }

      changes.status = body.status;
    }

    const updatedRows = await db
      .update(deliveryCompaniesTable)
      .set(changes)
      .where(eq(deliveryCompaniesTable.id, id))
      .returning();

    return json(toDeliveryCompany(updatedRows[0]));
  } catch (error) {
    if (error instanceof DeliveryCompanyError) {
      return json(
        { error: error.message },
        error.status,
      );
    }

    const pgError = error as {
      code?: string;
      constraint?: string;
    };

    if (
      pgError.code === "23505" ||
      pgError.constraint ===
        "delivery_companies_code_idx"
    ) {
      return json(
        { error: "رمز شركة التوصيل مستخدم مسبقًا" },
        409,
      );
    }

    console.error("DELIVERY_COMPANY_UPDATE_FAILED", error);

    return json(
      { error: "تعذر تعديل شركة التوصيل" },
      500,
    );
  }
}

export async function handleDeliveryCompanyRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (
    request.method === "GET" &&
    path === "/api/delivery-companies"
  ) {
    return handleList(request, db, env);
  }

  if (
    request.method === "POST" &&
    path === "/api/delivery-companies"
  ) {
    return handleCreate(request, db, env);
  }

  const updateMatch = path.match(
    /^\/api\/delivery-companies\/(\d+)$/,
  );

  if (
    request.method === "PATCH" &&
    updateMatch
  ) {
    return handleUpdate(
      request,
      db,
      env,
      Number(updateMatch[1]),
    );
  }

  return null;
}
