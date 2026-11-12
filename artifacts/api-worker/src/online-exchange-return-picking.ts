import {
  exchangeDocumentsTable,
  exchangeReturnItemsTable,
  exchangeReturnPickingSessionsTable,
  productBarcodesTable,
  productsTable,
  type ExchangeReturnPickingScan,
} from "@workspace/db/schema";
import { asc, eq } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { getCurrentUser } from "./auth";
import { userHasPermission } from "./staff-permissions";
import type { Env, openDb } from "./db";

type Db = Awaited<ReturnType<typeof openDb>>["db"];
type ReturnItem = typeof exchangeReturnItemsTable.$inferSelect;
type PickingSession = typeof exchangeReturnPickingSessionsTable.$inferSelect;
type Exchange = typeof exchangeDocumentsTable.$inferSelect;

const base = "/api/pos/exchanges/online/return-picking";
const norm = (value: string | null | undefined) => (value ?? "").trim().normalize("NFKC").toLowerCase();
const reply = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
});

class ReturnPickingError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

function validPublicId(value: unknown) {
  const id = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!id || id.length > 80 || !/^[A-Z0-9_-]+$/.test(id)) {
    throw new ReturnPickingError("رقم التبديل غير صالح", 400);
  }
  return id;
}

type Line = {
  key: string;
  productId: number;
  name: string;
  image: string | null;
  color: string | null;
  size: string | null;
  barcode: string | null;
  required: number;
  scanned: number;
};

export function exchangeReturnLines(items: ReturnItem[]): Line[] {
  if (!items.length) throw new ReturnPickingError("عملية التبديل لا تحتوي على قطع مرتجعة");
  return [...items].sort((a, b) => a.id - b.id).map(item => {
    if (!item.productId || !Number.isSafeInteger(item.quantity) || item.quantity <= 0)
      throw new ReturnPickingError("بيانات أحد الأصناف المرتجعة غير مكتملة");
    return {
      key: String(item.id), productId: item.productId, name: item.productNameAr,
      image: item.productImage, color: item.color, size: item.size,
      barcode: item.barcode, required: item.quantity, scanned: 0,
    };
  });
}

/** Includes line identity, variant, original barcode and quantity. Any edit invalidates scans. */
export function exchangeReturnSignature(items: ReturnItem[]): string {
  return createHash("sha256").update(JSON.stringify(exchangeReturnLines(items).map(l =>
    [l.key, l.productId, norm(l.color), norm(l.size), norm(l.barcode), l.required]
  ))).digest("hex");
}

/** Also called inside the existing receipt transaction, before any stock or accounting writes. */
export function isExchangeReturnPickingVerified(
  session: PickingSession | undefined,
  items: ReturnItem[],
): boolean {
  if (!session?.verifiedAt || session.itemsSignature !== exchangeReturnSignature(items)) return false;
  const lines = exchangeReturnLines(items);
  const expected = new Map(lines.map(line => [line.key, line.required]));
  const counts = new Map<string, number>();
  for (const scan of session.scans) {
    if (!expected.has(scan.lineKey)) return false;
    counts.set(scan.lineKey, (counts.get(scan.lineKey) ?? 0) + 1);
  }
  return lines.every(line => counts.get(line.key) === line.required);
}

function view(exchange: Exchange, items: ReturnItem[], session?: PickingSession) {
  const lines = exchangeReturnLines(items);
  const stale = !!session && session.itemsSignature !== exchangeReturnSignature(items);
  const scans = stale ? [] : (session?.scans ?? []);
  for (const line of lines) line.scanned = scans.filter(x => x.lineKey === line.key).length;
  const requiredCount = lines.reduce((total, l) => total + l.required, 0);
  const scannedCount = lines.reduce((total, l) => total + l.scanned, 0);
  const verified = !stale && isExchangeReturnPickingVerified(session, items);
  const canScan = exchange.sourceType === "online_order" &&
    exchange.status === "completed" && !!exchange.financialCompletedAt &&
    !exchange.returnReceivedAt;
  return {
    publicId: exchange.publicId, lines, scans,
    scannedCount, requiredCount, verified, stale, canScan,
    verifiedAt: verified ? session!.verifiedAt!.toISOString() : null,
    receivedAt: exchange.returnReceivedAt?.toISOString() ?? null,
  };
}

async function lookupLines(
  tx: Db,
  exchangeId: number,
) {
  return tx.select().from(exchangeReturnItemsTable)
    .where(eq(exchangeReturnItemsTable.exchangeId, exchangeId))
    .orderBy(asc(exchangeReturnItemsTable.lineNumber));
}

async function scanLine(
  tx: Db,
  lines: Line[],
  scans: ExchangeReturnPickingScan[],
  barcode: string,
): Promise<Line> {
  const matches = await tx.select({
    productId: productBarcodesTable.productId,
    color: productBarcodesTable.color,
    size: productBarcodesTable.size,
  }).from(productBarcodesTable)
    .where(eq(productBarcodesTable.barcode, barcode)).limit(2);

  if (matches.length > 1) throw new ReturnPickingError("الباركود مكرر في قاعدة المنتجات");
  let resolved = matches[0];

  if (!resolved) {
    const ordinary = await tx.select({ id: productsTable.id })
      .from(productsTable).where(eq(productsTable.barcode, barcode)).limit(2);
    if (ordinary.length > 1) throw new ReturnPickingError("باركود المنتج مكرر");
    if (ordinary.length) resolved = {
      productId: ordinary[0].id, color: null, size: null,
    };
  }

  let candidate: Line[];
  if (resolved) {
    candidate = lines.filter(line => line.productId === resolved!.productId &&
      norm(line.color) === norm(resolved!.color) && norm(line.size) === norm(resolved!.size));
    if (!candidate.length) {
      if (lines.some(line => line.productId === resolved!.productId)) {
        throw new ReturnPickingError("الموديل صحيح لكن اللون أو المقاس غير مطابق للمرتجع");
      }
      throw new ReturnPickingError("القطعة ليست ضمن أصناف الطرد المرتجع");
    }
  } else {
    // Historical exchange return lines may have an exact barcode snapshot
    // that was subsequently removed from the catalog.
    candidate = lines.filter(line => norm(line.barcode) === norm(barcode));
    if (!candidate.length) throw new ReturnPickingError("الباركود غير معروف ضمن أصناف المرتجع", 422);
    if (new Set(candidate.map(l => JSON.stringify([l.productId, norm(l.color), norm(l.size)]))).size !== 1) {
      throw new ReturnPickingError("الباركود التاريخي غير محدد اللون أو المقاس، راجع بطاقة الصنف");
    }
  }

  const line = candidate.find(item =>
    scans.filter(scan => scan.lineKey === item.key).length < item.required);
  if (!line) throw new ReturnPickingError("تم فحص العدد المطلوب من هذه النمرة؛ هذه القطعة زائدة");
  return line;
}

export async function handleOnlineExchangeReturnPicking(
  request: Request, db: Db, env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== base && ![base + "/scan", base + "/undo", base + "/reset"].includes(path)) return null;

  const user = await getCurrentUser(db, request, env);
  if (!user) return reply({ error: "يجب تسجيل الدخول" }, 401);
  if (!user.isOwner && !user.isAdmin &&
      !(await userHasPermission(db, user, "sales.exchange.online"))) {
    return reply({ error: "لا تملك صلاحية استلام مرتجعات التبديل" }, 403);
  }

  try {
    const isGet = request.method === "GET" && path === base;
    const isScan = request.method === "POST" && path === base + "/scan";
    const isUndo = request.method === "POST" && path === base + "/undo";
    const isReset = request.method === "POST" && path === base + "/reset";
    if (!isGet && !isScan && !isUndo && !isReset)
      return reply({ error: "طريقة غير مدعومة" }, 405);

    const raw: unknown = isGet ? null : await request.json().catch(() => null);
    const body = raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw as Record<string, unknown> : {};
    const publicId = validPublicId(isGet
      ? new URL(request.url).searchParams.get("publicId")
      : body.publicId);

    if (isGet) {
      const [exchange] = await db.select().from(exchangeDocumentsTable)
        .where(eq(exchangeDocumentsTable.publicId, publicId)).limit(1);
      if (!exchange || exchange.sourceType !== "online_order")
        throw new ReturnPickingError("عملية التبديل غير موجودة", 404);
      const items = await lookupLines(db, exchange.id);
      const [session] = await db.select().from(exchangeReturnPickingSessionsTable)
        .where(eq(exchangeReturnPickingSessionsTable.exchangeId, exchange.id)).limit(1);
      return reply(view(exchange, items, session));
    }

    if (isScan && (typeof body.barcode !== "string" || !body.barcode.trim() ||
        body.barcode.length > 160 || typeof body.requestId !== "string" ||
        !/^[a-zA-Z0-9-]{8,100}$/.test(body.requestId)))
      return reply({ error: "بيانات الباركود أو معرف المسح غير صالحة" }, 400);
    if (isUndo && (typeof body.scanId !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(body.scanId)))
      return reply({ error: "معرف المسحة غير صالح" }, 400);

    const state = await db.transaction(async tx => {
      // All picking changes and physical receipt serialize on the exchange document row.
      const [exchange] = await tx.select().from(exchangeDocumentsTable)
        .where(eq(exchangeDocumentsTable.publicId, publicId)).for("update");
      if (!exchange || exchange.sourceType !== "online_order")
        throw new ReturnPickingError("عملية التبديل غير موجودة", 404);
      const items = await lookupLines(tx as unknown as Db, exchange.id);
      const signature = exchangeReturnSignature(items);
      const [existing] = await tx.select().from(exchangeReturnPickingSessionsTable)
        .where(eq(exchangeReturnPickingSessionsTable.exchangeId, exchange.id)).limit(1);

      if (!exchange.financialCompletedAt || exchange.status !== "completed" ||
          exchange.returnReceivedAt) {
        throw new ReturnPickingError("لا يمكن تغيير الفحص قبل تسليم البديل أو بعد استلام المرتجع");
      }
      if (isReset) {
        if (existing) await tx.delete(exchangeReturnPickingSessionsTable)
          .where(eq(exchangeReturnPickingSessionsTable.exchangeId, exchange.id));
        return view(exchange, items);
      }
      if (existing && existing.itemsSignature !== signature)
        throw new ReturnPickingError("تغيّرت بيانات أصناف المرتجع. اختر بدء الفحص من جديد.");
      const scans = [...(existing?.scans ?? [])];
      if (isUndo) {
        const index = scans.findIndex(s => s.id === body.scanId);
        if (index < 0) throw new ReturnPickingError("المسحة غير موجودة", 404);
        scans.splice(index, 1);
      } else if (isScan) {
        const requestId = body.requestId as string;
        if (scans.some(x => x.requestId === requestId)) return view(exchange, items, existing);
        const barcode = (body.barcode as string).trim();
        const line = await scanLine(tx as unknown as Db, exchangeReturnLines(items), scans, barcode);
        scans.push({
          id: randomUUID(), requestId, lineKey: line.key, barcode,
          scannedAt: new Date().toISOString(), scannedByUserId: user.id,
        });
      }

      const counts = new Map<string, number>();
      scans.forEach(scan => counts.set(scan.lineKey, (counts.get(scan.lineKey) ?? 0) + 1));
      const completed = exchangeReturnLines(items).every(line =>
        counts.get(line.key) === line.required);
      const update = {
        itemsSignature: signature, scans, verifiedAt: completed ? existing?.verifiedAt ?? new Date() : null,
        verifiedByUserId: completed ? existing?.verifiedByUserId ?? user.id : null,
        updatedAt: new Date(),
      };
      let session: PickingSession;
      if (existing) {
        const [row] = await tx.update(exchangeReturnPickingSessionsTable).set(update)
          .where(eq(exchangeReturnPickingSessionsTable.exchangeId, exchange.id)).returning();
        session = row;
      } else {
        const [row] = await tx.insert(exchangeReturnPickingSessionsTable)
          .values({ exchangeId: exchange.id, ...update }).returning();
        session = row;
      }
      return view(exchange, items, session);
    });
    return reply(state);
  } catch (error) {
    if (error instanceof ReturnPickingError) return reply({ error: error.message }, error.status);
    console.error("ONLINE_EXCHANGE_RETURN_PICKING_FAILED", error);
    return reply({ error: "تعذر حفظ مسح المرتجع؛ أعد تحديث الصفحة قبل المحاولة." }, 500);
  }
}
