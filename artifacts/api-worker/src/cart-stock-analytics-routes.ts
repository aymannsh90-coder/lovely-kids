import { cartStockAnalyticsEventsTable, productsTable } from "@workspace/db/schema";
import { and, eq, gte, inArray, desc, sql } from "drizzle-orm";
import { getCurrentUser } from "./auth";
import { toPublicMediaUrl } from "./media-url";
import type { Env, openDb } from "./db";

type Db = Awaited<ReturnType<typeof openDb>>["db"];
const t = cartStockAnalyticsEventsTable;
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Access-Control-Allow-Origin": "*" } });

const eventTypes = ["issue_seen", "checkout_blocked", "item_corrected", "item_removed"] as const;
const issueKinds = ["product_unavailable", "selection_unavailable", "quantity_exceeds_stock"] as const;
type EventType = (typeof eventTypes)[number];
type IssueKind = (typeof issueKinds)[number];

function validAnalyticsId(value: unknown, minLength: number): value is string {
  return typeof value === "string" &&
    value.length >= minLength && value.length <= 100 &&
    /^[A-Za-z0-9_-]+$/.test(value);
}

function automatedRequest(request: Request) {
  const agent = request.headers.get("user-agent") ?? "";
  const purpose = [request.headers.get("purpose"), request.headers.get("sec-purpose")].join(" ").toLowerCase();
  return /(?:facebookexternalhit|facebot|googlebot|bingbot|crawler|spider|headlesschrome|lighthouse|postmanruntime|python-requests)/i.test(agent) ||
    /(?:prefetch|preview)/.test(purpose);
}

async function recordStockEvent(request: Request, db: Db) {
  if (automatedRequest(request)) return json({ ok: true, ignored: "automated" });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Invalid event" }, 400);
  }
  const p = body as Record<string, unknown>;
  const eventType = p.eventType as EventType;
  const issueKind = p.issueKind as IssueKind;
  const quantity = p.requestedQuantity;
  const available = p.availableQuantity;
  const productId = p.productId;
  const color = p.selectedColor;
  const size = p.selectedSize;
  if (!validAnalyticsId(p.eventId, 16) || !validAnalyticsId(p.visitorId, 12) ||
      (typeof productId !== "number" || !Number.isSafeInteger(productId) || productId <= 0) ||
      !eventTypes.includes(eventType) || !issueKinds.includes(issueKind) ||
      (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) ||
      (available !== null && available !== undefined &&
        (typeof available !== "number" || !Number.isInteger(available) || available < 0 || available > 999999)) ||
      (color !== null && color !== undefined && (typeof color !== "string" || color.length > 100)) ||
      (size !== null && size !== undefined && (typeof size !== "string" || size.length > 100))) {
    return json({ error: "Invalid cart stock analytics data" }, 400);
  }
  await db.insert(t).values({
    eventId: p.eventId as string,
    visitorId: p.visitorId as string,
    productId: productId as number,
    eventType,
    issueKind,
    selectedColor: typeof color === "string" ? color : null,
    selectedSize: typeof size === "string" ? size : null,
    requestedQuantity: quantity as number,
    availableQuantity: typeof available === "number" ? available : null,
  }).onConflictDoNothing({ target: t.eventId });
  return json({ ok: true });
}

async function getStockReport(request: Request, db: Db, env: Env) {
  const owner = await getCurrentUser(db, request, env);
  if (!owner?.isOwner) return json({ error: "هذه البيانات متاحة للمالك فقط" }, 403);
  const days = new URL(request.url).searchParams.get("days") === "30" ? 30 : 7;
  const since = new Date(Date.now() - days * 86400000);
  const [metrics] = await db.select({
    seenEvents: sql<number>`cast(count(*) filter (where ${t.eventType} = 'issue_seen') as integer)`,
    seenVisitors: sql<number>`cast(count(distinct ${t.visitorId}) filter (where ${t.eventType} = 'issue_seen') as integer)`,
    blockedAttempts: sql<number>`cast(count(*) filter (where ${t.eventType} = 'checkout_blocked') as integer)`,
    blockedVisitors: sql<number>`cast(count(distinct ${t.visitorId}) filter (where ${t.eventType} = 'checkout_blocked') as integer)`,
    corrected: sql<number>`cast(count(*) filter (where ${t.eventType} = 'item_corrected') as integer)`,
    removed: sql<number>`cast(count(*) filter (where ${t.eventType} = 'item_removed') as integer)`,
  }).from(t).where(gte(t.createdAt, since));

  const blockedCount = sql<number>`cast(count(*) filter (where ${t.eventType} = 'checkout_blocked') as integer)`;
  const seenCount = sql<number>`cast(count(*) filter (where ${t.eventType} = 'issue_seen') as integer)`;
  const topIssues = await db.select({
    productId: t.productId,
    productName: productsTable.nameAr,
    issueKind: t.issueKind,
    color: t.selectedColor,
    size: t.selectedSize,
    seen: seenCount,
    blocked: blockedCount,
    visitors: sql<number>`cast(count(distinct ${t.visitorId}) as integer)`,
  })
    .from(t)
    .leftJoin(productsTable, eq(t.productId, productsTable.id))
    .where(and(gte(t.createdAt, since), inArray(t.eventType, ["issue_seen", "checkout_blocked"])))
    .groupBy(t.productId, productsTable.nameAr, t.issueKind, t.selectedColor, t.selectedSize)
    .orderBy(desc(blockedCount), desc(seenCount))
    .limit(12);

  // Images are fetched separately so we do not group or aggregate large
  // JSONB color-variant payloads in the report query.
  const productIds = [...new Set(topIssues.map((row) => row.productId))];
  const imageRows = productIds.length
    ? await db.select({
        id: productsTable.id,
        image: productsTable.image,
        colorVariants: productsTable.colorVariants,
      }).from(productsTable).where(inArray(productsTable.id, productIds))
    : [];
  const imagesByProductId = new Map(imageRows.map((row) => [row.id, row]));

  const numberOrZero = (x: unknown) => Number(x ?? 0);
  return json({
    days,
    summary: {
      seenEvents: numberOrZero(metrics?.seenEvents),
      seenVisitors: numberOrZero(metrics?.seenVisitors),
      blockedAttempts: numberOrZero(metrics?.blockedAttempts),
      blockedVisitors: numberOrZero(metrics?.blockedVisitors),
      corrected: numberOrZero(metrics?.corrected),
      removed: numberOrZero(metrics?.removed),
    },
    topIssues: topIssues.map((row) => {
      const product = imagesByProductId.get(row.productId);
      const color = row.color?.trim();
      const colorVariant = color
        ? product?.colorVariants?.find((variant) => variant.color.trim() === color)
        : undefined;
      const colorImage = colorVariant?.image?.trim() || null;
      const mainImage = product?.image?.trim() || null;
      return {
        ...row,
        imageUrl: colorImage || mainImage ? toPublicMediaUrl(colorImage || mainImage!) : null,
        fallbackImageUrl: mainImage ? toPublicMediaUrl(mainImage) : null,
        imageMatchesColor: Boolean(colorImage),
        seen: numberOrZero(row.seen),
        blocked: numberOrZero(row.blocked),
        visitors: numberOrZero(row.visitors),
      };
    }),
  });
}

export async function handleCartStockAnalyticsRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (request.method === "POST" && path === "/api/analytics/cart-stock-event") {
    return recordStockEvent(request, db);
  }
  if (request.method === "GET" && path === "/api/owner/reports/cart-stock-analytics") {
    return getStockReport(request, db, env);
  }
  return null;
}
