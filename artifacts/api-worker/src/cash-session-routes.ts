import { cashSessionsTable } from "@workspace/db/schema";
import { and, desc, eq } from "drizzle-orm";
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

function normalizeRegisterKey(
  value: unknown,
): string | null {
  const key =
    typeof value === "string"
      ? value.trim().toLowerCase()
      : "main";

  if (!/^[a-z0-9_-]{1,50}$/.test(key)) {
    return null;
  }

  return key;
}

function parseMoneyToMinor(
  value: unknown,
): number | null {
  if (
    typeof value !== "number" &&
    typeof value !== "string"
  ) {
    return null;
  }

  const normalized =
    typeof value === "string"
      ? value.trim().replace(",", ".")
      : value;

  const amount =
    typeof normalized === "number"
      ? normalized
      : Number(normalized);

  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount > 10_000_000
  ) {
    return null;
  }

  const minor = Math.round(amount * 100);

  if (
    Math.abs(minor / 100 - amount) >
    0.000001
  ) {
    return null;
  }

  return minor;
}

function getBusinessDate(): string {
  const formatter = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: "Asia/Hebron",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    },
  );

  const parts = formatter.formatToParts(
    new Date(),
  );

  const values = Object.fromEntries(
    parts.map((part) => [
      part.type,
      part.value,
    ]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function toCashSession(
  row: typeof cashSessionsTable.$inferSelect,
) {
  return {
    id: String(row.id),

    registerKey: row.registerKey,
    businessDate: row.businessDate,

    openedByUserId: String(
      row.openedByUserId,
    ),

    closedByUserId:
      row.closedByUserId === null
        ? null
        : String(row.closedByUserId),

    openingBalanceMinor:
      row.openingBalanceMinor,

    openingBalance:
      row.openingBalanceMinor / 100,

    closingBalanceMinor:
      row.closingBalanceMinor,

    closingBalance:
      row.closingBalanceMinor === null
        ? null
        : row.closingBalanceMinor / 100,

    expectedBalanceMinor:
      row.expectedBalanceMinor,

    expectedBalance:
      row.expectedBalanceMinor === null
        ? null
        : row.expectedBalanceMinor / 100,

    currencyCode: row.currencyCode,
    status: row.status,

    openingNote: row.openingNote,
    closingNote: row.closingNote,

    openedAt: row.openedAt.toISOString(),

    closedAt:
      row.closedAt?.toISOString() ?? null,

    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type PosUser = NonNullable<
  Awaited<ReturnType<typeof getCurrentUser>>
>;

type PosAuthResult =
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
): Promise<PosAuthResult> {
  const user = await getCurrentUser(
    db,
    request,
    env,
  );

  if (!user) {
    return {
      ok: false,
      response: json(
        { error: "يجب تسجيل الدخول" },
        401,
      ),
    };
  }

  if (!user.isAdmin && !user.isOwner) {
    return {
      ok: false,
      response: json(
        { error: "غير مصرح باستخدام نقطة البيع" },
        403,
      ),
    };
  }

  return {
    ok: true,
    user,
  };
}

async function findOpenSession(
  db: Db,
  registerKey: string,
) {
  const rows = await db
    .select()
    .from(cashSessionsTable)
    .where(
      and(
        eq(
          cashSessionsTable.registerKey,
          registerKey,
        ),
        eq(
          cashSessionsTable.status,
          "open",
        ),
      ),
    )
    .orderBy(
      desc(cashSessionsTable.openedAt),
    )
    .limit(1);

  return rows[0] ?? null;
}

async function handleCurrentSession(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth = await requirePosUser(
    request,
    db,
    env,
  );

  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(request.url);

  const registerKey = normalizeRegisterKey(
    url.searchParams.get("register") ??
      "main",
  );

  if (!registerKey) {
    return json(
      { error: "معرف صندوق غير صالح" },
      400,
    );
  }

  const session = await findOpenSession(
    db,
    registerKey,
  );

  return json({
    session: session
      ? toCashSession(session)
      : null,
  });
}

async function handleOpenSession(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth = await requirePosUser(
    request,
    db,
    env,
  );

  if (!auth.ok) {
    return auth.response;
  }

  const body = await request
    .json()
    .catch(() => null);

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return json(
      { error: "بيانات غير صالحة" },
      400,
    );
  }

  const payload =
    body as Record<string, unknown>;

  const openingBalanceMinor =
    parseMoneyToMinor(
      payload.openingBalance,
    );

  if (openingBalanceMinor === null) {
    return json(
      {
        error:
          "رصيد بداية الصندوق غير صالح",
      },
      400,
    );
  }

  const registerKey =
    normalizeRegisterKey(
      payload.registerKey ?? "main",
    );

  if (!registerKey) {
    return json(
      { error: "معرف صندوق غير صالح" },
      400,
    );
  }

  let openingNote: string | null = null;

  if (
    payload.openingNote !== undefined &&
    payload.openingNote !== null
  ) {
    if (
      typeof payload.openingNote !==
      "string"
    ) {
      return json(
        { error: "الملاحظات غير صالحة" },
        400,
      );
    }

    const note =
      payload.openingNote.trim();

    if (note.length > 500) {
      return json(
        {
          error:
            "الملاحظات طويلة جدًا",
        },
        400,
      );
    }

    openingNote = note || null;
  }

  const existing = await findOpenSession(
    db,
    registerKey,
  );

  if (existing) {
    return json({
      session: toCashSession(existing),
      alreadyOpen: true,
    });
  }

  try {
    const created =
      await db.transaction(async (tx) => {
        const rows = await tx
          .insert(cashSessionsTable)
          .values({
            registerKey,
            businessDate:
              getBusinessDate(),

            openedByUserId:
              auth.user.id,

            openingBalanceMinor,
            currencyCode: "ILS",
            status: "open",
            openingNote,
          })
          .returning();

        const session = rows[0];

        if (!session) {
          throw new Error(
            "CASH_SESSION_CREATE_FAILED",
          );
        }

        return session;
      });

    return json(
      {
        session: toCashSession(created),
        alreadyOpen: false,
      },
      201,
    );
  } catch (error) {
    const code = (
      error as { code?: string }
    ).code;

    if (code === "23505") {
      const current =
        await findOpenSession(
          db,
          registerKey,
        );

      if (current) {
        return json({
          session:
            toCashSession(current),
          alreadyOpen: true,
        });
      }
    }

    throw error;
  }
}

export async function handleCashSessionRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path =
    new URL(request.url).pathname;

  if (
    request.method === "GET" &&
    path ===
      "/api/pos/cash-sessions/current"
  ) {
    return handleCurrentSession(
      request,
      db,
      env,
    );
  }

  if (
    request.method === "POST" &&
    path ===
      "/api/pos/cash-sessions/open"
  ) {
    return handleOpenSession(
      request,
      db,
      env,
    );
  }

  return null;
}
