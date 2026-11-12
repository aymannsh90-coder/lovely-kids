import {
  orderPickingSessionsTable,
  ordersTable,
  productBarcodesTable,
  productsTable,
  type OrderPickingScan,
} from "@workspace/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { getCurrentUser } from "./auth";
import { userHasAnyPermission, userHasPermission } from "./staff-permissions";
import type { Env, openDb } from "./db";

type Db = Awaited<ReturnType<typeof openDb>>["db"];
type StoredOrder = typeof ordersTable.$inferSelect;
type StoredSession = typeof orderPickingSessionsTable.$inferSelect;

type PickingLine = {
  key: string;
  productId: number;
  name: string;
  image: string | null;
  color: string | null;
  size: string | null;
  required: number;
  scanned: number;
};

class PickingError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

const reply = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      // Picking is called from the HTTPS storefront/POS embedded admin, which
      // lives on a different origin from api.lovelykids.net. Preflight alone
      // is insufficient: every actual GET/POST/DELETE response needs CORS.
      "Access-Control-Allow-Origin": "*",
    },
  });

const normalized = (value: unknown) =>
  typeof value === "string" ? value.trim().normalize("NFKC").toLowerCase() : "";

const display = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

function orderLines(order: StoredOrder): PickingLine[] {
  if (!Array.isArray(order.items)) throw new PickingError("أصناف الطلب غير صالحة للتحقق بالباركود");
  const map = new Map<string, PickingLine>();
  for (const raw of order.items) {
    if (typeof raw !== "object" || raw === null) {
      throw new PickingError("أحد أصناف الطلب لا يحتوي على بيانات كافية");
    }
    const item = raw as Record<string, unknown>;
    const productId = Number(item.id);
    const quantity = Number(item.quantity);
    if (!Number.isSafeInteger(productId) || productId <= 0 ||
        !Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new PickingError("لا يمكن فحص صنف دون رقم منتج وكمية صحيحين");
    }
    const key = JSON.stringify([productId, normalized(item.color), normalized(item.size)]);
    const existing = map.get(key);
    if (existing) {
      existing.required += quantity;
    } else {
      map.set(key, {
        key,
        productId,
        name: display(item.name) ?? `منتج #${productId}`,
        image: display(item.image),
        color: display(item.color),
        size: display(item.size),
        required: quantity,
        scanned: 0,
      });
    }
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function signature(lines: PickingLine[]) {
  return createHash("sha256")
    .update(JSON.stringify(lines.map((line) => [line.key, line.required])))
    .digest("hex");
}

function pickingView(order: StoredOrder, session: StoredSession | undefined, canScan: boolean) {
  const lines = orderLines(order);
  const itemsSignature = signature(lines);
  const stale = !!session && session.itemsSignature !== itemsSignature;
  const scans = stale ? [] : (session?.scans ?? []);
  const counts = new Map<string, number>();
  for (const scan of scans) counts.set(scan.lineKey, (counts.get(scan.lineKey) ?? 0) + 1);
  for (const line of lines) line.scanned = Math.min(counts.get(line.key) ?? 0, line.required);
  const scannedCount = lines.reduce((sum, line) => sum + line.scanned, 0);
  const requiredCount = lines.reduce((sum, line) => sum + line.required, 0);
  const complete = requiredCount > 0 && scannedCount === requiredCount;
  const verified = !!session?.verifiedAt && !stale && complete;
  return {
    orderId: order.id,
    status: order.status,
    lines,
    scans,
    scannedCount,
    requiredCount,
    stale,
    verified,
    verifiedAt: verified ? session!.verifiedAt!.toISOString() : null,
    verifiedByUserId: verified ? session!.verifiedByUserId : null,
    canScan: canScan && !order.mergedIntoOrderId && ["new", "confirmed"].includes(order.status),
  };
}

async function loadOrder(db: Db, orderId: number) {
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
  if (!order) throw new PickingError("الطلب غير موجود", 404);
  return order;
}

async function loadSession(db: Db, orderId: number) {
  const [session] = await db.select().from(orderPickingSessionsTable)
    .where(eq(orderPickingSessionsTable.orderId, orderId)).limit(1);
  return session;
}

/** GET and mutations are never available to the checkout/customer endpoints. */
export async function handleOrderPickingRequest(
  request: Request, db: Db, env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const summaryPath = path === "/api/orders/picking/summaries";
  const match = path.match(/^\/api\/orders\/(\d+)\/picking(?:\/(scan|reset|scans\/([0-9a-f-]+)))?$/i);
  if (!summaryPath && !match) return null;

  const user = await getCurrentUser(db, request, env);
  if (!user) return reply({ error: "يجب تسجيل الدخول" }, 401);
  const canScan = await userHasPermission(db, user, "orders.edit");
  const canRead = canScan || await userHasAnyPermission(db, user, ["orders.view"]);
  if (!canRead) return reply({ error: "غير مصرح بالاطلاع على تحضير الطلبات" }, 403);

  try {
    if (summaryPath) {
      if (request.method !== "GET") return reply({ error: "طريقة غير مدعومة" }, 405);
      const records = await db.select({
        orderId: orderPickingSessionsTable.orderId,
        itemsSignature: orderPickingSessionsTable.itemsSignature,
        items: ordersTable.items,
        status: ordersTable.status,
        mergedIntoOrderId: ordersTable.mergedIntoOrderId,
      }).from(orderPickingSessionsTable)
        .innerJoin(ordersTable, eq(ordersTable.id, orderPickingSessionsTable.orderId))
        .where(isNotNull(orderPickingSessionsTable.verifiedAt));
      const verifiedIds: number[] = [];
      for (const record of records) {
        try {
          const lines = orderLines({ items: record.items } as StoredOrder);
          if (!record.mergedIntoOrderId && record.itemsSignature === signature(lines) &&
              !["cancelled"].includes(record.status)) verifiedIds.push(record.orderId);
        } catch { /* Old malformed orders are never displayed as verified. */ }
      }
      return reply({ verifiedIds });
    }

    const orderId = Number(match![1]);
    const action = match![2] ?? "";
    if (!Number.isSafeInteger(orderId) || orderId <= 0) return reply({ error: "رقم الطلب غير صالح" }, 400);

    if (request.method === "GET" && !action) {
      const order = await loadOrder(db, orderId);
      const session = await loadSession(db, orderId);
      return reply(pickingView(order, session, canScan));
    }
    if (!canScan) return reply({ error: "لا تملك صلاحية تحضير الطلب" }, 403);

    const scan = request.method === "POST" && action === "scan";
    const reset = request.method === "DELETE" && (action === "reset" || !action);
    const undo = request.method === "DELETE" && action.startsWith("scans/");
    if (!scan && !reset && !undo) return reply({ error: "طريقة غير مدعومة" }, 405);

    let body: { barcode?: unknown; requestId?: unknown } | null = null;
    if (scan) {
      const parsed: unknown = await request.json().catch(() => null);
      body = parsed !== null && typeof parsed === "object"
        ? (parsed as { barcode?: unknown; requestId?: unknown }) : null;
      if (!body || typeof body.barcode !== "string" || typeof body.requestId !== "string" ||
          !body.barcode.trim() || body.barcode.length > 160 ||
          !/^[a-zA-Z0-9-]{8,100}$/.test(body.requestId)) {
        return reply({ error: "بيانات المسح غير صالحة" }, 400);
      }
    }

    const result = await db.transaction(async (tx) => {
      // Serialize all picking writes through the order lock, including initial session creation.
      const [order] = await tx.select().from(ordersTable)
        .where(eq(ordersTable.id, orderId)).for("update");
      if (!order) throw new PickingError("الطلب غير موجود", 404);
      if (order.mergedIntoOrderId) throw new PickingError("الطلب مدمج في طلب آخر");
      const lines = orderLines(order);
      if (!lines.length) throw new PickingError("لا توجد أصناف لتحضيرها");
      const newSignature = signature(lines);
      const [existing] = await tx.select().from(orderPickingSessionsTable)
        .where(eq(orderPickingSessionsTable.orderId, orderId)).limit(1);

      if (reset) {
        if (!["new", "confirmed"].includes(order.status)) {
          throw new PickingError("لا يمكن مسح سجل التحضير بعد إرسال الطلب أو إغلاقه");
        }
        if (existing) await tx.delete(orderPickingSessionsTable)
          .where(eq(orderPickingSessionsTable.orderId, orderId));
        return pickingView(order, undefined, canScan);
      }

      if (!["new", "confirmed"].includes(order.status)) {
        throw new PickingError("الطلب لم يعد في حالة تسمح بالتحضير؛ تغيير الحالة يدوي فقط");
      }
      if (existing && existing.itemsSignature !== newSignature) {
        throw new PickingError("تغيّرت أصناف الطلب أو النمر أو الكميات. اختر «بدء الفحص من جديد» أولًا.");
      }
      const scans: OrderPickingScan[] = [...(existing?.scans ?? [])];

      if (undo) {
        const scanId = match![3];
        const index = scans.findIndex((item) => item.id === scanId);
        if (index < 0) throw new PickingError("المسحة غير موجودة أو سبق حذفها", 404);
        scans.splice(index, 1);
      } else if (scan) {
        const barcode = (body!.barcode as string).trim();
        const requestId = body!.requestId as string;
        if (scans.some((entry) => entry.requestId === requestId)) {
          return pickingView(order, existing, canScan);
        }
        const variantRows = await tx.select({
          productId: productBarcodesTable.productId,
          color: productBarcodesTable.color,
          size: productBarcodesTable.size,
        }).from(productBarcodesTable)
          .where(eq(productBarcodesTable.barcode, barcode)).limit(2);
        if (variantRows.length > 1) throw new PickingError("الباركود مرتبط بأكثر من منتج؛ راجع بطاقة الصنف");
        let resolved: { productId: number; color: string | null; size: string | null } | undefined =
          variantRows[0];
        if (!resolved) {
          const standardRows = await tx.select({ id: productsTable.id })
            .from(productsTable).where(eq(productsTable.barcode, barcode)).limit(2);
          if (standardRows.length > 1) throw new PickingError("الباركود مكرر؛ راجع بيانات المنتجات");
          if (standardRows[0]) resolved = { productId: standardRows[0].id, color: null, size: null };
        }
        if (!resolved) throw new PickingError("الباركود غير معروف في المنتجات", 422);
        const lineKey = JSON.stringify([
          resolved.productId, normalized(resolved.color), normalized(resolved.size),
        ]);
        const line = lines.find((item) => item.key === lineKey);
        if (!line) {
          const sameProduct = lines.filter((item) => item.productId === resolved!.productId);
          if (sameProduct.length) {
            throw new PickingError("الموديل صحيح لكن اللون أو المقاس غير مطابق. امسح QR الخاص بالنمرة المطلوبة.");
          }
          throw new PickingError("هذه القطعة ليست من أصناف الطلب");
        }
        const count = scans.filter((entry) => entry.lineKey === line.key).length;
        if (count >= line.required) throw new PickingError("تم مسح العدد المطلوب من هذه النمرة؛ القطعة زائدة");
        scans.push({
          id: randomUUID(), requestId, lineKey, barcode,
          scannedAt: new Date().toISOString(), scannedByUserId: user.id,
        });
      }

      const completed = lines.every((line) =>
        scans.filter((entry) => entry.lineKey === line.key).length === line.required);
      const verifiedAt = completed ? (existing?.verifiedAt ?? new Date()) : null;
      const updated = {
        itemsSignature: newSignature,
        scans,
        verifiedAt,
        verifiedByUserId: completed ? (existing?.verifiedByUserId ?? user.id) : null,
        updatedAt: new Date(),
      };
      let session: StoredSession;
      if (existing) {
        const [row] = await tx.update(orderPickingSessionsTable).set(updated)
          .where(eq(orderPickingSessionsTable.orderId, orderId)).returning();
        session = row;
      } else {
        const [row] = await tx.insert(orderPickingSessionsTable)
          .values({ orderId, ...updated }).returning();
        session = row;
      }
      return pickingView(order, session, canScan);
    });
    return reply(result);
  } catch (error) {
    if (error instanceof PickingError) return reply({ error: error.message }, error.status);
    console.error("ORDER_PICKING_FAILED", { path, error });
    return reply({ error: "تعذر حفظ نتيجة الفحص. حدّث الشاشة قبل إعادة المسح." }, 500);
  }
}
