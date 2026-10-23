import {
  orderPromotionsTable,
  posSalePromotionsTable,
  productsTable,
  promotionProductsTable,
  promotionsTable,
} from "@workspace/db/schema";
import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  or,
} from "drizzle-orm";

import { getCurrentUser } from "./auth";
import type { Env, openDb } from "./db";
import {
  calculatePromotions,
  type PromotionCartLine,
  type PromotionDefinition,
} from "./promotion-engine";
import {
  loadActivePromotions,
} from "./promotion-service";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json; charset=utf-8",
    },
  });

type AdminInput = {
  name: string;
  publicLabel: string;
  description: string | null;
  kind: "buy_x_get_y" | "percent_off" | "bundle_price";
  scope: "all_products" | "selected_products";
  channel: "web" | "pos" | "both";
  status: "draft" | "active" | "archived";

  buyQuantity: number | null;
  rewardQuantity: number | null;
  rewardMode: "free" | "percent_off" | "fixed_price" | null;
  rewardPercent: number | null;
  rewardPriceMinor: number | null;
  rewardSelectionMode: "cheapest" | "customer_choice";

  percentOff: number | null;

  bundleQuantity: number | null;
  bundlePriceMinor: number | null;

  repeatable: boolean;
  maxApplicationsPerOrder: number | null;

  stackWithOtherPromotions: boolean;
  stackWithDiscountCodes: boolean;
  stackWithShippingPromotion: boolean;

  priority: number;

  startsAt: Date | null;
  endsAt: Date | null;

  qualifyingProductIds: number[];
  rewardProductIds: number[];
  excludedProductIds: number[];
};

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function textValue(
  value: unknown,
  maxLength: number,
) {
  if (typeof value !== "string") return null;

  const result = value.trim();

  if (!result || result.length > maxLength) {
    return null;
  }

  return result;
}

function optionalText(
  value: unknown,
  maxLength: number,
) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value !== "string") return undefined;

  const result = value.trim();

  if (result.length > maxLength) {
    return undefined;
  }

  return result || null;
}

function integerValue(
  value: unknown,
  min: number,
  max: number,
) {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < min ||
    Number(value) > max
  ) {
    return null;
  }

  return Number(value);
}

function optionalInteger(
  value: unknown,
  min: number,
  max: number,
) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return integerValue(value, min, max);
}

function booleanValue(
  value: unknown,
  fallback: boolean,
) {
  return typeof value === "boolean" ? value : fallback;
}

function parseDateTime(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value !== "string") return undefined;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date;
}

function parseIdList(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as number[];
  }

  const ids = value
    .map(Number)
    .filter(
      (id) =>
        Number.isSafeInteger(id) &&
        id > 0,
    );

  return [...new Set(ids)];
}

function parseAdminInput(value: unknown):
  | { ok: true; data: AdminInput }
  | { ok: false; error: string } {
  const body = asObject(value);

  if (!body) {
    return { ok: false, error: "بيانات العرض غير صالحة" };
  }

  const name = textValue(body.name, 120);
  const publicLabel = textValue(body.publicLabel, 120);

  if (!name || !publicLabel) {
    return {
      ok: false,
      error: "اسم العرض والنص الظاهر للزبون مطلوبان",
    };
  }

  const kind =
    body.kind === "buy_x_get_y" ||
    body.kind === "percent_off" ||
    body.kind === "bundle_price"
      ? body.kind
      : null;

  const scope =
    body.scope === "all_products" ||
    body.scope === "selected_products"
      ? body.scope
      : null;

  const channel =
    body.channel === "web" ||
    body.channel === "pos" ||
    body.channel === "both"
      ? body.channel
      : null;

  const status =
    body.status === "draft" ||
    body.status === "active" ||
    body.status === "archived"
      ? body.status
      : null;

  if (!kind || !scope || !channel || !status) {
    return {
      ok: false,
      error: "نوع العرض أو نطاقه أو حالته غير صالحة",
    };
  }

  const startsAt = parseDateTime(body.startsAt);
  const endsAt = parseDateTime(body.endsAt);

  if (startsAt === undefined || endsAt === undefined) {
    return { ok: false, error: "تاريخ العرض غير صالح" };
  }

  if (
    startsAt &&
    endsAt &&
    endsAt.getTime() < startsAt.getTime()
  ) {
    return {
      ok: false,
      error: "تاريخ نهاية العرض يجب أن يكون بعد البداية",
    };
  }

  const qualifyingProductIds = parseIdList(
    body.qualifyingProductIds,
  );
  const rewardProductIds = parseIdList(
    body.rewardProductIds,
  );
  const excludedProductIds = parseIdList(
    body.excludedProductIds,
  );

  if (
    scope === "selected_products" &&
    qualifyingProductIds.length === 0
  ) {
    return {
      ok: false,
      error: "اختر صنفًا واحدًا على الأقل للعرض",
    };
  }

  const priority = integerValue(
    body.priority ?? 100,
    0,
    100000,
  );

  if (priority === null) {
    return { ok: false, error: "أولوية العرض غير صالحة" };
  }

  const maxApplicationsPerOrder = optionalInteger(
    body.maxApplicationsPerOrder,
    1,
    1000,
  );

  if (
    body.maxApplicationsPerOrder !== undefined &&
    body.maxApplicationsPerOrder !== null &&
    body.maxApplicationsPerOrder !== "" &&
    maxApplicationsPerOrder === null
  ) {
    return {
      ok: false,
      error: "الحد الأقصى لتكرار العرض غير صالح",
    };
  }

  let buyQuantity: number | null = null;
  let rewardQuantity: number | null = null;
  let rewardMode: AdminInput["rewardMode"] = null;
  let rewardPercent: number | null = null;
  let rewardPriceMinor: number | null = null;
  let percentOff: number | null = null;
  let bundleQuantity: number | null = null;
  let bundlePriceMinor: number | null = null;

  if (kind === "buy_x_get_y") {
    buyQuantity = integerValue(body.buyQuantity, 1, 100);
    rewardQuantity = integerValue(body.rewardQuantity, 1, 100);

    rewardMode =
      body.rewardMode === "free" ||
      body.rewardMode === "percent_off" ||
      body.rewardMode === "fixed_price"
        ? body.rewardMode
        : null;

    if (
      buyQuantity === null ||
      rewardQuantity === null ||
      rewardMode === null
    ) {
      return {
        ok: false,
        error: "إعدادات اشتري X واحصل على Y غير مكتملة",
      };
    }

    if (rewardMode === "percent_off") {
      rewardPercent = integerValue(body.rewardPercent, 1, 100);

      if (rewardPercent === null) {
        return { ok: false, error: "نسبة خصم المكافأة غير صالحة" };
      }
    }

    if (rewardMode === "fixed_price") {
      rewardPriceMinor = integerValue(
        body.rewardPriceMinor,
        0,
        100000000,
      );

      if (rewardPriceMinor === null) {
        return { ok: false, error: "سعر المكافأة غير صالح" };
      }
    }
  }

  if (kind === "percent_off") {
    percentOff = integerValue(body.percentOff, 1, 100);

    if (percentOff === null) {
      return { ok: false, error: "نسبة الخصم العام غير صالحة" };
    }
  }

  if (kind === "bundle_price") {
    bundleQuantity = integerValue(body.bundleQuantity, 2, 100);
    bundlePriceMinor = integerValue(
      body.bundlePriceMinor,
      0,
      100000000,
    );

    if (
      bundleQuantity === null ||
      bundlePriceMinor === null
    ) {
      return { ok: false, error: "إعدادات سعر الباكج غير صالحة" };
    }
  }

  const rewardSelectionMode =
    body.rewardSelectionMode === "customer_choice"
      ? "customer_choice"
      : "cheapest";

  const description = optionalText(
    body.description,
    500,
  );

  if (description === undefined) {
    return { ok: false, error: "وصف العرض أطول من المسموح" };
  }

  return {
    ok: true,
    data: {
      name,
      publicLabel,
      description,
      kind,
      scope,
      channel,
      status,

      buyQuantity,
      rewardQuantity,
      rewardMode,
      rewardPercent,
      rewardPriceMinor,
      rewardSelectionMode,

      percentOff,

      bundleQuantity,
      bundlePriceMinor,

      repeatable: booleanValue(body.repeatable, true),
      maxApplicationsPerOrder,

      stackWithOtherPromotions:
        booleanValue(body.stackWithOtherPromotions, false),
      stackWithDiscountCodes:
        booleanValue(body.stackWithDiscountCodes, false),
      stackWithShippingPromotion:
        booleanValue(body.stackWithShippingPromotion, true),

      priority,

      startsAt,
      endsAt,

      qualifyingProductIds,
      rewardProductIds,
      excludedProductIds,
    },
  };
}

function channelsOverlap(
  left: string,
  right: string,
) {
  return left === "both" ||
    right === "both" ||
    left === right;
}

function windowsOverlap(
  leftStart: Date | null,
  leftEnd: Date | null,
  rightStart: Date | null,
  rightEnd: Date | null,
) {
  const leftStartMs =
    leftStart?.getTime() ?? Number.NEGATIVE_INFINITY;
  const leftEndMs =
    leftEnd?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightStartMs =
    rightStart?.getTime() ?? Number.NEGATIVE_INFINITY;
  const rightEndMs =
    rightEnd?.getTime() ?? Number.POSITIVE_INFINITY;

  return leftStartMs <= rightEndMs &&
    rightStartMs <= leftEndMs;
}

async function requireAdmin(
  request: Request,
  db: Db,
  env: Env,
) {
  const user = await getCurrentUser(
    db,
    request,
    env,
  );

  if (!user || !user.isAdmin) {
    return {
      ok: false as const,
      response: json(
        { error: "هذه العملية متاحة للإدارة فقط" },
        403,
      ),
    };
  }

  return {
    ok: true as const,
    user,
  };
}

async function validateProducts(
  db: Db,
  input: AdminInput,
) {
  const ids = [
    ...input.qualifyingProductIds,
    ...input.rewardProductIds,
    ...input.excludedProductIds,
  ];

  if (ids.length === 0) {
    return null;
  }

  const rows = await db
    .select({
      id: productsTable.id,
      nameAr: productsTable.nameAr,
      isHidden: productsTable.isHidden,
      deletedAt: productsTable.deletedAt,
    })
    .from(productsTable)
    .where(inArray(productsTable.id, [...new Set(ids)]));

  const found = new Set(rows.map((row) => row.id));

  const missing = [...new Set(ids)].filter((id) => !found.has(id));

  if (missing.length > 0) {
    return "أحد الأصناف المختارة لم يعد موجودًا";
  }

  const unavailable = rows.find(
    (row) => row.isHidden || row.deletedAt !== null,
  );

  if (unavailable) {
    return `الصنف ${unavailable.nameAr} غير متاح لإضافته إلى عرض جديد`;
  }

  return null;
}

async function findConflict(
  db: Db,
  input: AdminInput,
  excludePromotionId?: number,
) {
  if (
    input.scope !== "selected_products" ||
    input.status === "archived"
  ) {
    return null;
  }

  const selectedIds = [
    ...new Set([
      ...input.qualifyingProductIds,
      ...input.rewardProductIds,
    ]),
  ];

  if (selectedIds.length === 0) {
    return null;
  }

  const membership = await db
    .select({
      promotionId: promotionProductsTable.promotionId,
      productId: promotionProductsTable.productId,
      role: promotionProductsTable.role,
    })
    .from(promotionProductsTable)
    .where(
      and(
        inArray(
          promotionProductsTable.productId,
          selectedIds,
        ),
        inArray(
          promotionProductsTable.role,
          ["qualifying", "reward"],
        ),
      ),
    );

  const candidatePromotionIds = [
    ...new Set(
      membership
        .map((row) => row.promotionId)
        .filter((id) => id !== excludePromotionId),
    ),
  ];

  if (candidatePromotionIds.length === 0) {
    return null;
  }

  const existing = await db
    .select()
    .from(promotionsTable)
    .where(
      and(
        inArray(promotionsTable.id, candidatePromotionIds),
        ne(promotionsTable.status, "archived"),
      ),
    );

  for (const promotion of existing) {
    if (
      !channelsOverlap(input.channel, promotion.channel) ||
      !windowsOverlap(
        input.startsAt,
        input.endsAt,
        promotion.startsAt,
        promotion.endsAt,
      )
    ) {
      continue;
    }

    const conflictRow = membership.find(
      (row) => row.promotionId === promotion.id,
    );

    if (!conflictRow) continue;

    const product = await db
      .select({
        id: productsTable.id,
        nameAr: productsTable.nameAr,
      })
      .from(productsTable)
      .where(eq(productsTable.id, conflictRow.productId))
      .limit(1);

    return {
      productId: conflictRow.productId,
      productName:
        product[0]?.nameAr ?? `#${conflictRow.productId}`,
      promotionId: promotion.id,
      promotionName: promotion.name,
      startsAt: promotion.startsAt?.toISOString() ?? null,
      endsAt: promotion.endsAt?.toISOString() ?? null,
      channel: promotion.channel,
    };
  }

  return null;
}

async function insertMembership(
  tx: Db,
  promotionId: number,
  input: AdminInput,
) {
  const rows = [
    ...input.qualifyingProductIds.map((productId) => ({
      promotionId,
      productId,
      role: "qualifying",
    })),
    ...input.rewardProductIds.map((productId) => ({
      promotionId,
      productId,
      role: "reward",
    })),
    ...input.excludedProductIds.map((productId) => ({
      promotionId,
      productId,
      role: "excluded",
    })),
  ];

  if (rows.length > 0) {
    await tx
      .insert(promotionProductsTable)
      .values(rows)
      .onConflictDoNothing();
  }
}

function promotionValues(input: AdminInput) {
  return {
    name: input.name,
    publicLabel: input.publicLabel,
    description: input.description,
    kind: input.kind,
    scope: input.scope,
    channel: input.channel,
    status: input.status,

    buyQuantity: input.buyQuantity,
    rewardQuantity: input.rewardQuantity,
    rewardMode: input.rewardMode,
    rewardPercent: input.rewardPercent,
    rewardPriceMinor: input.rewardPriceMinor,
    rewardSelectionMode: input.rewardSelectionMode,

    percentOff: input.percentOff,

    bundleQuantity: input.bundleQuantity,
    bundlePriceMinor: input.bundlePriceMinor,

    repeatable: input.repeatable,
    maxApplicationsPerOrder: input.maxApplicationsPerOrder,

    stackWithOtherPromotions: input.stackWithOtherPromotions,
    stackWithDiscountCodes: input.stackWithDiscountCodes,
    stackWithShippingPromotion: input.stackWithShippingPromotion,

    priority: input.priority,

    startsAt: input.startsAt,
    endsAt: input.endsAt,

    archivedAt:
      input.status === "archived"
        ? new Date()
        : null,

    updatedAt: new Date(),
  };
}

async function listAdminPromotions(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth = await requireAdmin(request, db, env);

  if (!auth.ok) return auth.response;

  const rows = await db
    .select()
    .from(promotionsTable)
    .orderBy(
      desc(promotionsTable.createdAt),
    );

  if (rows.length === 0) {
    return json([]);
  }

  const ids = rows.map((row) => row.id);

  const products = await db
    .select({
      promotionId: promotionProductsTable.promotionId,
      productId: promotionProductsTable.productId,
      role: promotionProductsTable.role,
    })
    .from(promotionProductsTable)
    .where(inArray(promotionProductsTable.promotionId, ids));

  return json(
    rows.map((row) => ({
      ...row,
      qualifyingProductIds: products
        .filter(
          (item) =>
            item.promotionId === row.id &&
            item.role === "qualifying",
        )
        .map((item) => item.productId),
      rewardProductIds: products
        .filter(
          (item) =>
            item.promotionId === row.id &&
            item.role === "reward",
        )
        .map((item) => item.productId),
      excludedProductIds: products
        .filter(
          (item) =>
            item.promotionId === row.id &&
            item.role === "excluded",
        )
        .map((item) => item.productId),
    })),
  );
}

async function createPromotion(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth = await requireAdmin(request, db, env);

  if (!auth.ok) return auth.response;

  const parsed = parseAdminInput(
    await request.json().catch(() => null),
  );

  if (!parsed.ok) {
    return json({ error: parsed.error }, 400);
  }

  const productError = await validateProducts(
    db,
    parsed.data,
  );

  if (productError) {
    return json({ error: productError }, 400);
  }

  const conflict = await findConflict(
    db,
    parsed.data,
  );

  if (conflict) {
    return json(
      {
        error:
          `الصنف ${conflict.productName} موجود ضمن العرض "${conflict.promotionName}" خلال فترة متداخلة`,
        conflict,
      },
      409,
    );
  }

  const result = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(promotionsTable)
      .values(promotionValues(parsed.data))
      .returning();

    const promotion = rows[0];

    if (!promotion) {
      throw new Error("PROMOTION_INSERT_FAILED");
    }

    await insertMembership(
      tx as Db,
      promotion.id,
      parsed.data,
    );

    return promotion;
  });

  return json(result, 201);
}

async function updatePromotion(
  request: Request,
  db: Db,
  env: Env,
  id: number,
) {
  const auth = await requireAdmin(request, db, env);

  if (!auth.ok) return auth.response;

  const current = await db
    .select()
    .from(promotionsTable)
    .where(eq(promotionsTable.id, id))
    .limit(1);

  if (!current[0]) {
    return json({ error: "العرض غير موجود" }, 404);
  }

  const parsed = parseAdminInput(
    await request.json().catch(() => null),
  );

  if (!parsed.ok) {
    return json({ error: parsed.error }, 400);
  }

  const productError = await validateProducts(
    db,
    parsed.data,
  );

  if (productError) {
    return json({ error: productError }, 400);
  }

  const conflict = await findConflict(
    db,
    parsed.data,
    id,
  );

  if (conflict) {
    return json(
      {
        error:
          `الصنف ${conflict.productName} موجود ضمن العرض "${conflict.promotionName}" خلال فترة متداخلة`,
        conflict,
      },
      409,
    );
  }

  const result = await db.transaction(async (tx) => {
    const rows = await tx
      .update(promotionsTable)
      .set(promotionValues(parsed.data))
      .where(eq(promotionsTable.id, id))
      .returning();

    const promotion = rows[0];

    if (!promotion) {
      throw new Error("PROMOTION_UPDATE_FAILED");
    }

    await tx
      .delete(promotionProductsTable)
      .where(eq(promotionProductsTable.promotionId, id));

    await insertMembership(
      tx as Db,
      id,
      parsed.data,
    );

    return promotion;
  });

  return json(result);
}

async function deletePromotion(
  request: Request,
  db: Db,
  env: Env,
  id: number,
) {
  const auth = await requireAdmin(request, db, env);

  if (!auth.ok) return auth.response;

  const [orderUse, posUse] = await Promise.all([
    db
      .select({ id: orderPromotionsTable.id })
      .from(orderPromotionsTable)
      .where(eq(orderPromotionsTable.promotionId, id))
      .limit(1),
    db
      .select({ id: posSalePromotionsTable.id })
      .from(posSalePromotionsTable)
      .where(eq(posSalePromotionsTable.promotionId, id))
      .limit(1),
  ]);

  if (orderUse[0] || posUse[0]) {
    return json(
      {
        error:
          "هذا العرض استُخدم في فاتورة سابقة. قم بأرشفته بدل الحذف حتى تبقى السجلات التاريخية صحيحة.",
      },
      409,
    );
  }

  const removed = await db
    .delete(promotionsTable)
    .where(eq(promotionsTable.id, id))
    .returning({ id: promotionsTable.id });

  if (!removed[0]) {
    return json({ error: "العرض غير موجود" }, 404);
  }

  return json({ ok: true, id });
}

async function activePromotions(
  request: Request,
  db: Db,
) {
  const url = new URL(request.url);

  const channel =
    url.searchParams.get("channel") === "pos"
      ? "pos"
      : "web";

  const promotions = await loadActivePromotions(
    db,
    channel,
  );

  return json(promotions);
}

async function previewPromotions(
  request: Request,
  db: Db,
) {
  const body = asObject(
    await request.json().catch(() => null),
  );

  if (!body || !Array.isArray(body.items)) {
    return json({ error: "السلة غير صالحة" }, 400);
  }

  const items = body.items
    .map((raw, index) => {
      const item = asObject(raw);

      if (!item) return null;

      const productId = Number(item.productId);
      const quantity = Number(item.quantity);

      if (
        !Number.isSafeInteger(productId) ||
        productId <= 0 ||
        !Number.isSafeInteger(quantity) ||
        quantity <= 0 ||
        quantity > 99
      ) {
        return null;
      }

      return {
        key:
          typeof item.key === "string" && item.key.trim()
            ? item.key.trim()
            : `${productId}:${index}`,
        productId,
        quantity,
        rewardForPromotionId:
          Number.isSafeInteger(item.rewardForPromotionId) &&
          Number(item.rewardForPromotionId) > 0
            ? Number(item.rewardForPromotionId)
            : null,
      };
    })
    .filter(
      (item): item is NonNullable<typeof item> =>
        item !== null,
    );

  if (items.length !== body.items.length || items.length === 0) {
    return json({ error: "أحد أصناف السلة غير صالح" }, 400);
  }

  const ids = [...new Set(items.map((item) => item.productId))];

  const products = await db
    .select({
      id: productsTable.id,
      price: productsTable.price,
      isHidden: productsTable.isHidden,
      deletedAt: productsTable.deletedAt,
    })
    .from(productsTable)
    .where(inArray(productsTable.id, ids));

  const productMap = new Map(
    products.map((product) => [product.id, product]),
  );

  const lines: PromotionCartLine[] = [];

  for (const item of items) {
    const product = productMap.get(item.productId);

    if (
      !product ||
      product.isHidden ||
      product.deletedAt !== null ||
      !Number.isSafeInteger(product.price) ||
      product.price < 0
    ) {
      return json(
        { error: "أحد الأصناف لم يعد متاحًا" },
        409,
      );
    }

    lines.push({
      key: item.key,
      productId: item.productId,
      quantity: item.quantity,
      unitPriceMinor: product.price * 100,
      rewardForPromotionId:
        item.rewardForPromotionId,
    });
  }

  const promotions = await loadActivePromotions(
    db,
    "web",
  );

  const calculation = calculatePromotions({
    lines,
    promotions,
    channel: "web",

    // Online order totals currently use whole ILS.
    // Keeping promotion allocations on the same boundary prevents a
    // half-shekel difference between checkout and historical accounting.
    roundingIncrementMinor: 100,
  });

  const originalTotalMinor = lines.reduce(
    (total, line) =>
      total +
      line.unitPriceMinor *
        line.quantity,
    0,
  );

  return json({
    originalTotalMinor,
    totalDiscountMinor: calculation.totalDiscountMinor,
    netTotalMinor:
      originalTotalMinor -
      calculation.totalDiscountMinor,
    ...calculation,
  });
}

export async function handlePromotionRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (
    request.method === "GET" &&
    path === "/api/promotions/active"
  ) {
    return activePromotions(request, db);
  }

  if (
    request.method === "POST" &&
    path === "/api/promotions/preview"
  ) {
    return previewPromotions(request, db);
  }

  if (
    request.method === "GET" &&
    path === "/api/admin/promotions"
  ) {
    return listAdminPromotions(
      request,
      db,
      env,
    );
  }

  if (
    request.method === "POST" &&
    path === "/api/admin/promotions"
  ) {
    return createPromotion(
      request,
      db,
      env,
    );
  }

  const match =
    path.match(/^\/api\/admin\/promotions\/(\d+)$/);

  if (
    match &&
    request.method === "PATCH"
  ) {
    return updatePromotion(
      request,
      db,
      env,
      Number(match[1]),
    );
  }

  if (
    match &&
    request.method === "DELETE"
  ) {
    return deletePromotion(
      request,
      db,
      env,
      Number(match[1]),
    );
  }

  return null;
}
