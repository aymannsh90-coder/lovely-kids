import { suppliersTable } from "@workspace/db/schema";
import { asc } from "drizzle-orm";
import { getCurrentUser } from "./auth";
import { openDb, type Env } from "./db";
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

function toSupplier(
  supplier: typeof suppliersTable.$inferSelect,
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
    createdAt: supplier.createdAt.toISOString(),
    updatedAt: supplier.updatedAt.toISOString(),
  };
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
    results: results.map(toSupplier),
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
        supplier: toSupplier(supplier),
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
