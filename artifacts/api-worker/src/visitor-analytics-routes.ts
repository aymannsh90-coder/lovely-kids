import { visitorDailyVisitsTable } from "@workspace/db/schema";
import {
  countDistinct,
  eq,
  gte,
} from "drizzle-orm";

import { getCurrentUser } from "./auth";
import type { Env, openDb } from "./db";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

type RequestWithCf = Request & {
  cf?: {
    country?: string | null;
  };
};

const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  });

function jerusalemDateParts() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(new Date());

  const year = Number(
    parts.find((part) => part.type === "year")?.value,
  );
  const month = Number(
    parts.find((part) => part.type === "month")?.value,
  );
  const day = Number(
    parts.find((part) => part.type === "day")?.value,
  );

  return { year, month, day };
}

function dateDaysAgo(days: number) {
  const { year, month, day } = jerusalemDateParts();

  const value =
    Date.UTC(year, month - 1, day) -
    days * 24 * 60 * 60 * 1000;

  return new Date(value).toISOString().slice(0, 10);
}

function getCountry(request: Request) {
  const value =
    (request as RequestWithCf).cf?.country
      ?.trim()
      .toUpperCase() ?? "";

  return /^[A-Z]{2}$/.test(value) ? value : "XX";
}

async function recordVisit(
  request: Request,
  db: Db,
) {
  const body = await request.json().catch(() => null) as
    | { visitorId?: string }
    | null;

  const visitorId = body?.visitorId?.trim() ?? "";

  if (
    visitorId.length < 12 ||
    visitorId.length > 100 ||
    !/^[A-Za-z0-9_-]+$/.test(visitorId)
  ) {
    return json({ error: "Invalid visitor id" }, 400);
  }

  await db
    .insert(visitorDailyVisitsTable)
    .values({
      visitorId,
      visitDate: dateDaysAgo(0),
      country: getCountry(request),
    })
    .onConflictDoNothing({
      target: [
        visitorDailyVisitsTable.visitorId,
        visitorDailyVisitsTable.visitDate,
      ],
    });

  return json({ ok: true });
}

async function getAnalyticsSummary(
  request: Request,
  db: Db,
  env: Env,
) {
  const owner = await getCurrentUser(
    db,
    request,
    env,
  );

  if (!owner?.isOwner) {
    return json(
      { error: "هذه البيانات متاحة للمالك فقط" },
      403,
    );
  }

  const today = dateDaysAgo(0);
  const last7Start = dateDaysAgo(6);
  const last30Start = dateDaysAgo(29);

  const [
    todayRows,
    last7Rows,
    last30Rows,
    totalRows,
    countryRows,
  ] = await Promise.all([
    db
      .select({
        value: countDistinct(
          visitorDailyVisitsTable.visitorId,
        ),
      })
      .from(visitorDailyVisitsTable)
      .where(eq(visitorDailyVisitsTable.visitDate, today)),

    db
      .select({
        value: countDistinct(
          visitorDailyVisitsTable.visitorId,
        ),
      })
      .from(visitorDailyVisitsTable)
      .where(
        gte(
          visitorDailyVisitsTable.visitDate,
          last7Start,
        ),
      ),

    db
      .select({
        value: countDistinct(
          visitorDailyVisitsTable.visitorId,
        ),
      })
      .from(visitorDailyVisitsTable)
      .where(
        gte(
          visitorDailyVisitsTable.visitDate,
          last30Start,
        ),
      ),

    db
      .select({
        value: countDistinct(
          visitorDailyVisitsTable.visitorId,
        ),
      })
      .from(visitorDailyVisitsTable),

    db
      .select({
        country: visitorDailyVisitsTable.country,
        visitors: countDistinct(
          visitorDailyVisitsTable.visitorId,
        ),
      })
      .from(visitorDailyVisitsTable)
      .where(
        gte(
          visitorDailyVisitsTable.visitDate,
          last30Start,
        ),
      )
      .groupBy(visitorDailyVisitsTable.country),
  ]);

  const countries = countryRows
    .map((row) => ({
      country: row.country,
      visitors: Number(row.visitors ?? 0),
    }))
    .sort((a, b) => b.visitors - a.visitors)
    .slice(0, 12);

  return json({
    today: Number(todayRows[0]?.value ?? 0),
    last7Days: Number(last7Rows[0]?.value ?? 0),
    last30Days: Number(last30Rows[0]?.value ?? 0),
    total: Number(totalRows[0]?.value ?? 0),
    countries,
  });
}

export async function handleVisitorAnalyticsRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (
    request.method === "POST" &&
    path === "/api/analytics/visit"
  ) {
    return recordVisit(request, db);
  }

  if (
    request.method === "GET" &&
    path === "/api/analytics/summary"
  ) {
    return getAnalyticsSummary(
      request,
      db,
      env,
    );
  }

  return null;
}
