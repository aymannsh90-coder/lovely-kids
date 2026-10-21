import {
  inventoryMovementsTable,
  insertProductSchema,
  productCostLedgerTable,
  productCostStateTable,
  ordersTable,
  productBarcodesTable,
  productBarcodeInputSchema,
  type ColorVariant,
  productsTable,
} from "@workspace/db/schema";
import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { getCurrentUser } from "./auth";
import type { Env, openDb } from "./db";
import { deleteProductImageObjects, getProductImageObjectPath } from "./image-routes";
import { rewriteMediaUrlsForPublic } from "./media-url";
import { rewriteMediaUrlsForStorage } from "./media-url";
import { syncManualProductCostQuantity } from "./inventory-cost-engine";
import { getProductQuantity } from "./product-quantity";
import {
  appendProductToSupplierDraft,
  PurchaseDraftServiceError,
} from "./purchase-draft-service";
import {
  isPurchaseWriteEnabled,
  purchaseWritesDisabledResponse,
} from "./purchase-feature";
import {
  getHistoricalPurchasePreview,
  HistoricalPurchasePreviewError,
} from "./historical-purchase-preview";

type Db = Awaited<
  ReturnType<typeof openDb>
>["db"];

const json = (data: unknown, status = 200) =>
  Response.json(rewriteMediaUrlsForPublic(data), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  });

const createProductRequestSchema = insertProductSchema.extend({
  additionalBarcodes: productBarcodeInputSchema.array().optional(),
});

const updateProductRequestSchema = createProductRequestSchema.partial();

type AdditionalBarcode = {
  barcode: string;
  color: string | null;
  size: string | null;
};

function normalizeAdditionalBarcodes(
  items: Array<{ barcode: string; color?: string | null; size?: string | null }>,
): AdditionalBarcode[] {
  return items.map((item) => ({
    barcode: item.barcode.trim(),
    color: item.color?.trim() || null,
    size: item.size?.trim() || null,
  }));
}

async function findBarcodeConflict(
  db: Db,
  barcodes: string[],
  excludeProductId?: number,
) {
  if (barcodes.length === 0) return null;

  const primaryRows = await db
    .select({
      id: productsTable.id,
      barcode: productsTable.barcode,
    })
    .from(productsTable)
    .where(inArray(productsTable.barcode, barcodes));

  const primaryConflict = primaryRows.find(
    (row) => row.id !== excludeProductId,
  );

  if (primaryConflict?.barcode) return primaryConflict.barcode;

  const extraRows = await db
    .select({
      productId: productBarcodesTable.productId,
      barcode: productBarcodesTable.barcode,
    })
    .from(productBarcodesTable)
    .where(inArray(productBarcodesTable.barcode, barcodes));

  const extraConflict = extraRows.find(
    (row) => row.productId !== excludeProductId,
  );

  return extraConflict?.barcode ?? null;
}

function findDuplicateBarcode(barcodes: string[]) {
  const seen = new Set<string>();

  for (const barcode of barcodes) {
    if (seen.has(barcode)) return barcode;
    seen.add(barcode);
  }

  return null;
}

async function getAdditionalBarcodes(
  db: Db,
  productId: number,
): Promise<AdditionalBarcode[]> {
  const rows = await db
    .select({
      barcode: productBarcodesTable.barcode,
      color: productBarcodesTable.color,
      size: productBarcodesTable.size,
    })
    .from(productBarcodesTable)
    .where(eq(productBarcodesTable.productId, productId));

  return rows.map((row) => ({
    barcode: row.barcode,
    color: row.color ?? null,
    size: row.size ?? null,
  }));
}

type ManualStockCostInput = {
  costMode?: "same" | "new";
  unitCostMinor?: number;
};

function validateManualStockCostInput(
  input: ManualStockCostInput | null,
  isOwner: boolean,
): Response | null {
  const hasCostMode =
    input?.costMode !== undefined;

  const hasUnitCost =
    input?.unitCostMinor !== undefined;

  if (
    !isOwner &&
    (hasCostMode || hasUnitCost)
  ) {
    return json(
      {
        error:
          "تعديل تكلفة المخزون متاح للمالك فقط",
      },
      403,
    );
  }

  if (
    input?.costMode !== undefined &&
    input.costMode !== "same" &&
    input.costMode !== "new"
  ) {
    return json(
      { error: "costMode غير صالح" },
      400,
    );
  }

  if (
    hasUnitCost &&
    (
      !Number.isSafeInteger(
        input?.unitCostMinor,
      ) ||
      (input?.unitCostMinor ?? -1) < 0 ||
      (input?.unitCostMinor ?? 0) >
        2_147_483_647
    )
  ) {
    return json(
      {
        error:
          "تكلفة القطعة غير صالحة",
      },
      400,
    );
  }

  if (
    input?.costMode === "new" &&
    !hasUnitCost
  ) {
    return json(
      {
        error:
          "تكلفة الدفعة الجديدة مطلوبة",
      },
      400,
    );
  }

  if (
    input?.costMode !== "new" &&
    hasUnitCost
  ) {
    return json(
      {
        error:
          "لا ترسل تكلفة جديدة إلا عند اختيار تغيرت التكلفة",
      },
      400,
    );
  }

  return null;
}

async function requireAdminActor(
  request: Request,
  db: Db,
  env: Env,
) {
  const user = await getCurrentUser(
    db,
    request,
    env,
  );

  if (!user) {
    return {
      ok: false as const,
      response: json(
        { error: "يجب تسجيل الدخول" },
        401,
      ),
    };
  }

  if (!user.isAdmin) {
    return {
      ok: false as const,
      response: json(
        { error: "غير مصرح" },
        403,
      ),
    };
  }

  return {
    ok: true as const,
    user,
  };
}

async function requireAdmin(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth =
    await requireAdminActor(
      request,
      db,
      env,
    );

  return auth.ok
    ? null
    : auth.response;
}


function toProduct(
  row: typeof productsTable.$inferSelect,
  additionalBarcodes: AdditionalBarcode[] = [],
) {
  return {
    id: String(row.id),
    name: row.name,
    nameAr: row.nameAr,
    productCode: row.productCode ?? null,
    barcode: row.barcode ?? null,
    additionalBarcodes,
    price: row.price,
    originalPrice:
      row.originalPrice ?? undefined,
    image: row.image,
    images: (row.images as string[]) ?? [],
    category: row.category,
    ageGroup: row.ageGroup,
    gender: row.gender ?? null,
    season: row.season ?? null,
    sizes: (row.sizes as string[]) ?? [],
    colorVariants:
      (row.colorVariants as unknown[]) ?? [],
    rating: row.rating / 10,
    reviews: row.reviews,
    isPinned: !!row.isPinned,
    showInOffers: !!row.showInOffers,
    isHidden: !!row.isHidden,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    facebookUrl: row.facebookUrl ?? null,
    instagramUrl: row.instagramUrl ?? null,
    tiktokUrl: row.tiktokUrl ?? null,
    isNew:
      !!row.isNew &&
      !!row.newUntil &&
      row.newUntil.getTime() > Date.now(),
    newUntil: row.newUntil?.toISOString() ?? null,
    discount: row.discount ?? undefined,
    description: row.description,
    stock: row.stock ?? null,
  };
}


function collectProductImageUrls(
  product: Pick<
    typeof productsTable.$inferSelect,
    "image" | "images" | "colorVariants"
  >,
): Set<string> {
  const urls = new Set<string>();

  if (product.image) {
    urls.add(product.image);
  }

  for (const url of (product.images as string[]) ?? []) {
    if (url) urls.add(url);
  }

  for (
    const variant of
      (product.colorVariants as ColorVariant[]) ?? []
  ) {
    if (variant.image) urls.add(variant.image);
  }

  return urls;
}

async function cleanupRemovedProductImages(
  db: Db,
  env: Env,
  previousProduct: Pick<
    typeof productsTable.$inferSelect,
    "image" | "images" | "colorVariants"
  >,
  updatedProduct: Pick<
    typeof productsTable.$inferSelect,
    "image" | "images" | "colorVariants"
  >,
): Promise<void> {
  const previousUrls =
    collectProductImageUrls(previousProduct);

  const updatedUrls =
    collectProductImageUrls(updatedProduct);

  const removedUrls = [...previousUrls].filter(
    (url) => !updatedUrls.has(url),
  );

  if (removedUrls.length === 0) return;

  // Read current products AFTER the update.
  // This protects images that are still used by this product
  // or by any other product.
  const products = await db
    .select({
      image: productsTable.image,
      images: productsTable.images,
      colorVariants: productsTable.colorVariants,
    })
    .from(productsTable);

  const usedImageUrls = new Set<string>();

  for (const product of products) {
    for (const url of collectProductImageUrls(product)) {
      usedImageUrls.add(url);
    }
  }

  // Keep historical order images available as well.
  const existingOrders = await db
    .select({ items: ordersTable.items })
    .from(ordersTable);

  for (const order of existingOrders) {
    const items =
      (order.items as Array<{ image?: string }>) ?? [];

    for (const item of items) {
      if (item.image) {
        usedImageUrls.add(item.image);
      }
    }
  }

  const objectPaths = removedUrls
    .filter((url) => !usedImageUrls.has(url))
    .map((url) => getProductImageObjectPath(url, env))
    .filter((path): path is string => !!path);

  if (objectPaths.length === 0) return;

  await deleteProductImageObjects(
    env,
    objectPaths,
  );
}

async function handleCreateProduct(
  request: Request,
  db: Db,
  env: Env,
) {
  const auth =
    await requireAdminActor(
      request,
      db,
      env,
    );

  if (!auth.ok) {
    return auth.response;
  }

  const actor = auth.user;

  const body =
    await request
      .json()
      .catch(() => null);

  const bodyRecord =
    body &&
    typeof body === "object" &&
    !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;

  const rawOpeningUnitCostMinor =
    bodyRecord?.openingUnitCostMinor;

  const rawPurchaseSupplierId =
    bodyRecord?.purchaseSupplierId;

  const rawPurchaseUnitCostMinor =
    bodyRecord?.purchaseUnitCostMinor;

  const rawPurchaseBusinessDate =
    bodyRecord?.purchaseBusinessDate;

  const rawPurchaseEntryMode =
    bodyRecord?.purchaseEntryMode;

  const rawPurchaseQuantity =
    bodyRecord?.purchaseQuantity;

  const rawPurchaseHistoricalSourceKey =
    bodyRecord?.purchaseHistoricalSourceKey;

  const hasPurchaseDraftMetadata =
    rawPurchaseSupplierId !== undefined ||
    rawPurchaseUnitCostMinor !== undefined ||
    rawPurchaseBusinessDate !== undefined ||
    rawPurchaseEntryMode !== undefined ||
    rawPurchaseQuantity !== undefined ||
    rawPurchaseHistoricalSourceKey !== undefined;

  if (
    hasPurchaseDraftMetadata &&
    !isPurchaseWriteEnabled(env)
  ) {
    return purchaseWritesDisabledResponse();
  }

  if (
    rawOpeningUnitCostMinor !== undefined &&
    !actor.isOwner
  ) {
    return json(
      { error: "إدخال تكلفة الصنف متاح للمالك فقط" },
      403,
    );
  }

  let openingUnitCostMinor: number | null = null;

  if (rawOpeningUnitCostMinor !== undefined) {
    if (
      !Number.isSafeInteger(rawOpeningUnitCostMinor) ||
      Number(rawOpeningUnitCostMinor) < 0 ||
      Number(rawOpeningUnitCostMinor) > 2_147_483_647
    ) {
      return json(
        { error: "التكلفة الافتتاحية للصنف غير صالحة" },
        400,
      );
    }

    openingUnitCostMinor =
      Number(rawOpeningUnitCostMinor);
  }

  if (
    hasPurchaseDraftMetadata &&
    !actor.isOwner
  ) {
    return json(
      { error: "ربط المنتج بالمورد متاح للمالك فقط" },
      403,
    );
  }

  let purchaseSupplierId: number | null = null;

  if (
    rawPurchaseSupplierId !== undefined &&
    rawPurchaseSupplierId !== null &&
    rawPurchaseSupplierId !== ""
  ) {
    const parsedSupplierId =
      typeof rawPurchaseSupplierId === "string"
        ? Number(rawPurchaseSupplierId)
        : rawPurchaseSupplierId;

    if (
      typeof parsedSupplierId !== "number" ||
      !Number.isSafeInteger(parsedSupplierId) ||
      parsedSupplierId <= 0
    ) {
      return json(
        { error: "المورد المحدد غير صالح" },
        400,
      );
    }

    purchaseSupplierId =
      parsedSupplierId;
  }

  let purchaseUnitCostMinor: number | null = null;

  if (
    rawPurchaseUnitCostMinor !== undefined &&
    rawPurchaseUnitCostMinor !== null &&
    rawPurchaseUnitCostMinor !== ""
  ) {
    const parsedCost =
      typeof rawPurchaseUnitCostMinor === "string"
        ? Number(rawPurchaseUnitCostMinor)
        : rawPurchaseUnitCostMinor;

    if (
      typeof parsedCost !== "number" ||
      !Number.isSafeInteger(parsedCost) ||
      parsedCost < 0 ||
      parsedCost > 2_147_483_647
    ) {
      return json(
        { error: "تكلفة الشراء غير صالحة" },
        400,
      );
    }

    purchaseUnitCostMinor =
      parsedCost;
  }

  const purchaseEntryMode =
    rawPurchaseEntryMode === undefined
      ? "stock_receipt"
      : rawPurchaseEntryMode;

  if (
    purchaseEntryMode !== "stock_receipt" &&
    purchaseEntryMode !== "historical"
  ) {
    return json(
      { error: "نوع تسجيل الشراء غير صالح" },
      400,
    );
  }

  let purchaseQuantity:
    number | null = null;

  if (
    rawPurchaseQuantity !== undefined &&
    rawPurchaseQuantity !== null &&
    rawPurchaseQuantity !== ""
  ) {
    const parsedQuantity =
      typeof rawPurchaseQuantity === "string"
        ? Number(rawPurchaseQuantity)
        : rawPurchaseQuantity;

    if (
      typeof parsedQuantity !== "number" ||
      !Number.isSafeInteger(parsedQuantity) ||
      parsedQuantity <= 0 ||
      parsedQuantity > 99_999
    ) {
      return json(
        { error: "كمية الشراء السابق غير صالحة" },
        400,
      );
    }

    purchaseQuantity =
      parsedQuantity;
  }

  const purchaseHistoricalSourceKey =
    typeof rawPurchaseHistoricalSourceKey === "string" &&
    rawPurchaseHistoricalSourceKey.trim()
      ? rawPurchaseHistoricalSourceKey.trim()
      : null;

  if (
    purchaseHistoricalSourceKey !== null &&
    (
      purchaseHistoricalSourceKey.length < 8 ||
      purchaseHistoricalSourceKey.length > 160
    )
  ) {
    return json(
      { error: "مرجع دفعة الشراء السابق غير صالح" },
      400,
    );
  }

  const purchaseBusinessDate =
    typeof rawPurchaseBusinessDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(rawPurchaseBusinessDate)
      ? rawPurchaseBusinessDate
      : new Date().toISOString().slice(0, 10);

  if (
    purchaseSupplierId === null &&
    (
      rawPurchaseUnitCostMinor !== undefined ||
      rawPurchaseEntryMode !== undefined ||
      rawPurchaseQuantity !== undefined ||
      rawPurchaseHistoricalSourceKey !== undefined
    )
  ) {
    return json(
      { error: "لا يمكن تسجيل بيانات شراء بدون اختيار مورد" },
      400,
    );
  }

  if (
    purchaseSupplierId !== null &&
    purchaseEntryMode === "historical" &&
    purchaseQuantity === null &&
    purchaseHistoricalSourceKey === null
  ) {
    return json(
      {
        error:
          "اختر دفعة الشراء السابق المحسوبة تلقائيًا",
      },
      400,
    );
  }

  if (
    purchaseSupplierId !== null &&
    purchaseEntryMode === "stock_receipt" &&
    (
      purchaseQuantity !== null ||
      purchaseHistoricalSourceKey !== null
    )
  ) {
    return json(
      { error: "مرجع أو كمية الشراء السابق متاحان فقط للشراء السابق" },
      400,
    );
  }

  if (
    purchaseSupplierId !== null &&
    purchaseUnitCostMinor === null
  ) {
    return json(
      {
        error:
          "أدخل تكلفة الشراء لأن المنتج لا يملك تكلفة مسجلة مسبقًا",
      },
      400,
    );
  }

  if (
    purchaseSupplierId !== null &&
    openingUnitCostMinor !== null
  ) {
    return json(
      {
        error:
          "الكمية المرتبطة بمورد تُسجل في مسودة المشتريات، ولا تُسجل كبضاعة افتتاحية في نفس الوقت",
      },
      400,
    );
  }

  const productBody =
    body &&
    typeof body === "object" &&
    !Array.isArray(body)
      ? { ...(body as Record<string, unknown>) }
      : body;

  if (
    productBody &&
    typeof productBody === "object" &&
    !Array.isArray(productBody)
  ) {
    const cleanProductBody =
      productBody as Record<string, unknown>;

    delete cleanProductBody.openingUnitCostMinor;
    delete cleanProductBody.purchaseSupplierId;
    delete cleanProductBody.purchaseUnitCostMinor;
    delete cleanProductBody.purchaseBusinessDate;
    delete cleanProductBody.purchaseEntryMode;
    delete cleanProductBody.purchaseQuantity;
    delete cleanProductBody.purchaseHistoricalSourceKey;
  }

  const parsed =
    createProductRequestSchema.safeParse(
      productBody,
    );

  if (!parsed.success) {
    return json(
      {
        error: "بيانات غير صالحة",
        details: parsed.error.issues,
      },
      400,
    );
  }

  const {
    additionalBarcodes: rawAdditionalBarcodes = [],
    ...productData
  } = parsed.data;

  const additionalBarcodes =
    normalizeAdditionalBarcodes(rawAdditionalBarcodes);

  const storageProductData =
    rewriteMediaUrlsForStorage(productData, env);

  const openingQuantity =
    getProductQuantity({
      stock:
        typeof storageProductData.stock === "number"
          ? storageProductData.stock
          : null,
      colorVariants:
        storageProductData.colorVariants ?? [],
    });

  if (
    openingUnitCostMinor !== null &&
    (openingQuantity === null || openingQuantity <= 0)
  ) {
    return json(
      { error: "لا يمكن تسجيل تكلفة افتتاحية بدون كمية مخزون" },
      400,
    );
  }

  if (
    purchaseSupplierId !== null &&
    purchaseEntryMode === "stock_receipt" &&
    (
      openingQuantity === null ||
      openingQuantity <= 0
    )
  ) {
    return json(
      { error: "الاستلام الجديد يتطلب إدخال كمية للصنف" },
      400,
    );
  }

  const openingInventoryValueMinor =
    openingUnitCostMinor !== null &&
    openingQuantity !== null
      ? openingUnitCostMinor * openingQuantity
      : null;

  if (
    openingInventoryValueMinor !== null &&
    (
      !Number.isSafeInteger(openingInventoryValueMinor) ||
      openingInventoryValueMinor > 2_147_483_647
    )
  ) {
    return json(
      { error: "قيمة المخزون الافتتاحية أكبر من الحد المسموح" },
      400,
    );
  }

  const allBarcodes = [
    productData.barcode?.trim() || null,
    ...additionalBarcodes.map((item) => item.barcode),
  ].filter((value): value is string => !!value);

  const duplicateBarcode = findDuplicateBarcode(allBarcodes);

  if (duplicateBarcode) {
    return json(
      { error: `الباركود ${duplicateBarcode} مكرر داخل نفس المنتج` },
      409,
    );
  }

  const conflictBarcode = await findBarcodeConflict(
    db,
    allBarcodes,
  );

  if (conflictBarcode) {
    return json(
      { error: `الباركود ${conflictBarcode} مستخدم لمنتج آخر` },
      409,
    );
  }

  let product: typeof productsTable.$inferSelect;

  try {
    product = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(productsTable)
      .values({
        ...storageProductData,
        barcode: storageProductData.barcode?.trim() || null,
      })
      .returning();

    const created = rows[0];

    if (!created) {
      throw new Error("PRODUCT_CREATE_FAILED");
    }

    if (additionalBarcodes.length > 0) {
      await tx.insert(productBarcodesTable).values(
        additionalBarcodes.map((item) => ({
          productId: created.id,
          barcode: item.barcode,
          color: item.color,
          size: item.size,
        })),
      );
    }

    // stock-card:product-created-opening
    const openingMovements: Array<
      typeof inventoryMovementsTable.$inferInsert
    > = [];

    if (
      typeof created.stock === "number" &&
      created.stock > 0
    ) {
      openingMovements.push({
        productId: created.id,
        barcode: created.barcode ?? null,
        productCode: created.productCode ?? null,
        productNameAr: created.nameAr,

        color: null,
        size: null,

        movementType: "adjustment",
        quantityDelta: created.stock,

        generalStockBefore: 0,
        generalStockAfter: created.stock,

        variantStockBefore: null,
        variantStockAfter: null,

        sourceType: "manual",
        sourceId: created.id,
        sourceItemId: null,
        sourcePublicId: String(created.id),

        eventKey:
          `product:${created.id}:created-opening:general`,

        occurredAt: created.createdAt,
      });
    }

    const createdVariants =
      (created.colorVariants as
        | ColorVariant[]
        | null) ?? [];

    let openingVariantIndex = 0;

    for (const variant of createdVariants) {
      for (const sizeEntry of variant.sizes ?? []) {
        if (
          typeof sizeEntry.stock !== "number" ||
          sizeEntry.stock <= 0
        ) {
          continue;
        }

        openingVariantIndex += 1;

        const mappedBarcode =
          additionalBarcodes.find(
            (entry) =>
              entry.color === variant.color &&
              entry.size === sizeEntry.size,
          )?.barcode ??
          created.barcode ??
          null;

        openingMovements.push({
          productId: created.id,
          barcode: mappedBarcode,
          productCode:
            created.productCode ?? null,
          productNameAr:
            created.nameAr,

          color: variant.color,
          size: sizeEntry.size,

          movementType: "adjustment",
          quantityDelta:
            sizeEntry.stock,

          generalStockBefore: null,
          generalStockAfter: null,

          variantStockBefore: 0,
          variantStockAfter:
            sizeEntry.stock,

          sourceType: "manual",
          sourceId: created.id,
          sourceItemId: null,
          sourcePublicId:
            String(created.id),

          eventKey:
            `product:${created.id}:created-opening:variant:${openingVariantIndex}`,

          occurredAt:
            created.createdAt,
        });
      }
    }

    if (openingMovements.length > 0) {
      await tx
        .insert(inventoryMovementsTable)
        .values(openingMovements);
    }

    if (
      actor.isOwner &&
      purchaseSupplierId !== null
    ) {
      const linkedPurchaseQuantity =
        purchaseEntryMode === "historical"
          ? purchaseQuantity
          : openingQuantity;

      if (
        linkedPurchaseQuantity === null ||
        linkedPurchaseQuantity <= 0
      ) {
        throw new PurchaseDraftServiceError(
          "كمية الشراء المرتبطة بالمورد غير صالحة",
          400,
        );
      }

      await appendProductToSupplierDraft(
        tx,
        {
          userId: actor.id,
          supplierId:
            purchaseSupplierId,
          productId:
            created.id,
          quantity:
            linkedPurchaseQuantity,
          unitCostMinor:
            purchaseUnitCostMinor,
          entryMode:
            purchaseEntryMode,
          historicalSourceKey:
            purchaseHistoricalSourceKey,
          historicalDocumentationOnly:
            false,
          businessDate:
            purchaseBusinessDate,
          warehouseKey:
            "main",
          currencyCode:
            "ILS",
        },
      );
    }

    if (
      actor.isOwner &&
      openingQuantity !== null &&
      openingQuantity > 0 &&
      openingUnitCostMinor !== null &&
      openingInventoryValueMinor !== null
    ) {
      await tx
        .insert(productCostStateTable)
        .values({
          productId: created.id,
          quantityOnHand: openingQuantity,
          inventoryValueMinor: openingInventoryValueMinor,
          referenceUnitCostMinor: openingUnitCostMinor,
          costQuality: "confirmed",
        });

      await tx
        .insert(productCostLedgerTable)
        .values({
          productId: created.id,
          eventType: "opening",
          sourceType: "manual_opening",
          sourceRef: String(created.id),
          sourceItemRef: "initial",
          quantityDelta: openingQuantity,
          inventoryValueDeltaMinor: openingInventoryValueMinor,
          quantityAfter: openingQuantity,
          inventoryValueAfterMinor: openingInventoryValueMinor,
          costQuality: "confirmed",
          note: "Opening inventory cost at product creation",
          createdByUserId: actor.id,
        });
    }

    return created;
    });
  } catch (error) {
    if (error instanceof PurchaseDraftServiceError) {
      return json(
        { error: error.message },
        error.status,
      );
    }

    throw error;
  }

  return json(
    toProduct(product, additionalBarcodes),
    201,
  );
}

async function handleUpdateProduct(
  request: Request,
  db: Db,
  env: Env,
  id: number,
) {
  const auth =
    await requireAdminActor(
      request,
      db,
      env,
    );

  if (!auth.ok) {
    return auth.response;
  }

  const actor =
    auth.user;

  const body =
    await request.json().catch(() => null);

  const bodyRecord =
    body &&
    typeof body === "object" &&
    !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;

  const rawPurchaseSupplierId =
    bodyRecord?.purchaseSupplierId;

  const rawPurchaseUnitCostMinor =
    bodyRecord?.purchaseUnitCostMinor;

  const rawPurchaseBusinessDate =
    bodyRecord?.purchaseBusinessDate;

  const rawPurchaseEntryMode =
    bodyRecord?.purchaseEntryMode;

  const rawPurchaseQuantity =
    bodyRecord?.purchaseQuantity;

  const rawPurchaseHistoricalSourceKey =
    bodyRecord?.purchaseHistoricalSourceKey;

  const hasPurchaseDraftMetadata =
    rawPurchaseSupplierId !== undefined ||
    rawPurchaseUnitCostMinor !== undefined ||
    rawPurchaseBusinessDate !== undefined ||
    rawPurchaseEntryMode !== undefined ||
    rawPurchaseQuantity !== undefined ||
    rawPurchaseHistoricalSourceKey !== undefined;

  if (
    hasPurchaseDraftMetadata &&
    !isPurchaseWriteEnabled(env)
  ) {
    return purchaseWritesDisabledResponse();
  }

  if (
    hasPurchaseDraftMetadata &&
    !actor.isOwner
  ) {
    return json(
      { error: "ربط الكمية الجديدة بالمورد متاح للمالك فقط" },
      403,
    );
  }

  let purchaseSupplierId: number | null = null;

  if (
    rawPurchaseSupplierId !== undefined &&
    rawPurchaseSupplierId !== null &&
    rawPurchaseSupplierId !== ""
  ) {
    const parsedSupplierId =
      typeof rawPurchaseSupplierId === "string"
        ? Number(rawPurchaseSupplierId)
        : rawPurchaseSupplierId;

    if (
      typeof parsedSupplierId !== "number" ||
      !Number.isSafeInteger(parsedSupplierId) ||
      parsedSupplierId <= 0
    ) {
      return json(
        { error: "المورد المحدد غير صالح" },
        400,
      );
    }

    purchaseSupplierId =
      parsedSupplierId;
  }

  let purchaseUnitCostMinor: number | null = null;

  if (
    rawPurchaseUnitCostMinor !== undefined &&
    rawPurchaseUnitCostMinor !== null &&
    rawPurchaseUnitCostMinor !== ""
  ) {
    const parsedCost =
      typeof rawPurchaseUnitCostMinor === "string"
        ? Number(rawPurchaseUnitCostMinor)
        : rawPurchaseUnitCostMinor;

    if (
      typeof parsedCost !== "number" ||
      !Number.isSafeInteger(parsedCost) ||
      parsedCost < 0 ||
      parsedCost > 2_147_483_647
    ) {
      return json(
        { error: "تكلفة الشراء غير صالحة" },
        400,
      );
    }

    purchaseUnitCostMinor =
      parsedCost;
  }

  const purchaseEntryMode =
    rawPurchaseEntryMode === undefined
      ? "stock_receipt"
      : rawPurchaseEntryMode;

  if (
    purchaseEntryMode !== "stock_receipt" &&
    purchaseEntryMode !== "historical"
  ) {
    return json(
      { error: "نوع تسجيل الشراء غير صالح" },
      400,
    );
  }

  let purchaseQuantity:
    number | null = null;

  if (
    rawPurchaseQuantity !== undefined &&
    rawPurchaseQuantity !== null &&
    rawPurchaseQuantity !== ""
  ) {
    const parsedQuantity =
      typeof rawPurchaseQuantity === "string"
        ? Number(rawPurchaseQuantity)
        : rawPurchaseQuantity;

    if (
      typeof parsedQuantity !== "number" ||
      !Number.isSafeInteger(parsedQuantity) ||
      parsedQuantity <= 0 ||
      parsedQuantity > 99_999
    ) {
      return json(
        { error: "كمية الشراء السابق غير صالحة" },
        400,
      );
    }

    purchaseQuantity =
      parsedQuantity;
  }

  const purchaseHistoricalSourceKey =
    typeof rawPurchaseHistoricalSourceKey === "string" &&
    rawPurchaseHistoricalSourceKey.trim()
      ? rawPurchaseHistoricalSourceKey.trim()
      : null;

  if (
    purchaseHistoricalSourceKey !== null &&
    (
      purchaseHistoricalSourceKey.length < 8 ||
      purchaseHistoricalSourceKey.length > 160
    )
  ) {
    return json(
      { error: "مرجع دفعة الشراء السابق غير صالح" },
      400,
    );
  }

  const purchaseBusinessDate =
    typeof rawPurchaseBusinessDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(rawPurchaseBusinessDate)
      ? rawPurchaseBusinessDate
      : new Date().toISOString().slice(0, 10);

  if (
    purchaseSupplierId === null &&
    (
      rawPurchaseUnitCostMinor !== undefined ||
      rawPurchaseEntryMode !== undefined ||
      rawPurchaseQuantity !== undefined ||
      rawPurchaseHistoricalSourceKey !== undefined
    )
  ) {
    return json(
      { error: "لا يمكن تسجيل بيانات شراء بدون اختيار مورد" },
      400,
    );
  }

  if (
    purchaseSupplierId !== null &&
    purchaseEntryMode === "historical" &&
    purchaseQuantity === null &&
    purchaseHistoricalSourceKey === null
  ) {
    return json(
      {
        error:
          "اختر دفعة الشراء السابق المحسوبة تلقائيًا",
      },
      400,
    );
  }

  if (
    purchaseSupplierId !== null &&
    purchaseEntryMode === "stock_receipt" &&
    (
      purchaseQuantity !== null ||
      purchaseHistoricalSourceKey !== null
    )
  ) {
    return json(
      { error: "مرجع أو كمية الشراء السابق متاحان فقط للشراء السابق" },
      400,
    );
  }

  const costInput =
    body &&
    typeof body === "object" &&
    !Array.isArray(body)
      ? (body as ManualStockCostInput)
      : null;

  const costInputError =
    validateManualStockCostInput(
      costInput,
      actor.isOwner,
    );

  if (costInputError) {
    return costInputError;
  }

  if (
    purchaseSupplierId !== null &&
    costInput?.costMode !== undefined
  ) {
    return json(
      {
        error:
          "عند اختيار مورد، تُسجل تكلفة الكمية الجديدة على مسودة المشتريات وليس كتعديل تكلفة يدوي",
      },
      400,
    );
  }

  const productBody =
    bodyRecord
      ? { ...bodyRecord }
      : body;

  if (
    productBody &&
    typeof productBody === "object" &&
    !Array.isArray(productBody)
  ) {
    const cleanProductBody =
      productBody as Record<string, unknown>;

    delete cleanProductBody.purchaseSupplierId;
    delete cleanProductBody.purchaseUnitCostMinor;
    delete cleanProductBody.purchaseBusinessDate;
    delete cleanProductBody.purchaseEntryMode;
    delete cleanProductBody.purchaseQuantity;
    delete cleanProductBody.purchaseHistoricalSourceKey;
  }

  const parsed =
    updateProductRequestSchema.safeParse(
      productBody,
    );

  if (!parsed.success) {
    return json(
      {
        error: "بيانات غير صالحة",
        details: parsed.error.issues,
      },
      400,
    );
  }

  const currentRows = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.id, id))
    .limit(1);

  const currentProduct = currentRows[0];

  if (!currentProduct) {
    return json(
      { error: "المنتج غير موجود" },
      404,
    );
  }

  const currentAdditionalBarcodes =
    await getAdditionalBarcodes(db, id);

  const {
    additionalBarcodes: rawAdditionalBarcodes,
    ...productData
  } = parsed.data;

  const additionalBarcodes =
    rawAdditionalBarcodes === undefined
      ? currentAdditionalBarcodes
      : normalizeAdditionalBarcodes(rawAdditionalBarcodes);

  const storageProductData =
    rewriteMediaUrlsForStorage(productData, env);

  const primaryBarcode =
    productData.barcode === undefined
      ? currentProduct.barcode?.trim() || null
      : productData.barcode?.trim() || null;

  const allBarcodes = [
    primaryBarcode,
    ...additionalBarcodes.map((item) => item.barcode),
  ].filter((value): value is string => !!value);

  const duplicateBarcode = findDuplicateBarcode(allBarcodes);

  if (duplicateBarcode) {
    return json(
      { error: `الباركود ${duplicateBarcode} مكرر داخل نفس المنتج` },
      409,
    );
  }

  const conflictBarcode = await findBarcodeConflict(
    db,
    allBarcodes,
    id,
  );

  if (conflictBarcode) {
    return json(
      { error: `الباركود ${conflictBarcode} مستخدم لمنتج آخر` },
      409,
    );
  }

  let updateResult:
    | { kind: "not_found" }
    | {
        kind: "cost_error";
        reason: string;
      }
    | {
        kind: "purchase_link_error";
        reason: string;
      }
    | {
        kind: "updated";
        product:
          typeof productsTable.$inferSelect;
        previousProduct:
          typeof productsTable.$inferSelect;
      };

  try {
    updateResult =
      await db.transaction(
        async (tx) => {
        const lockedRows =
          await tx
            .select()
            .from(productsTable)
            .where(
              eq(
                productsTable.id,
                id,
              ),
            )
            .limit(1)
            .for("update");

        const lockedCurrent =
          lockedRows[0];

        if (!lockedCurrent) {
          return {
            kind: "not_found",
          } as const;
        }

        let updated =
          lockedCurrent;

        if (
          Object.keys(productData)
            .length > 0
        ) {
          const effectiveQuantityBefore =
            getProductQuantity(
              lockedCurrent,
            );

          const predictedProduct = {
            ...lockedCurrent,
            ...storageProductData,

            ...(storageProductData.barcode !==
            undefined
              ? {
                  barcode:
                    storageProductData.barcode
                      ?.trim() ||
                    null,
                }
              : {}),
          };

          const effectiveQuantityAfter =
            getProductQuantity(
              predictedProduct,
            );

          const purchaseQuantityDelta =
            effectiveQuantityBefore !== null &&
            effectiveQuantityAfter !== null
              ? effectiveQuantityAfter -
                effectiveQuantityBefore
              : null;

          if (
            purchaseSupplierId !== null &&
            purchaseEntryMode === "stock_receipt" &&
            (
              purchaseQuantityDelta === null ||
              purchaseQuantityDelta <= 0
            )
          ) {
            return {
              kind:
                "purchase_link_error",
              reason:
                "supplier_requires_increase",
            } as const;
          }

          if (
            purchaseSupplierId !== null &&
            purchaseEntryMode === "historical" &&
            (
              purchaseQuantityDelta === null ||
              purchaseQuantityDelta !== 0
            )
          ) {
            return {
              kind:
                "purchase_link_error",
              reason:
                "historical_requires_unchanged_stock",
            } as const;
          }

          const costSync =
            purchaseSupplierId === null
              ? await syncManualProductCostQuantity(
                  tx,
                  {
                    productId:
                      lockedCurrent.id,

                    quantityBefore:
                      effectiveQuantityBefore,

                    quantityAfter:
                      effectiveQuantityAfter,

                    explicitUnitCostMinor:
                      actor.isOwner &&
                      costInput?.costMode ===
                        "new"
                        ? costInput.unitCostMinor
                        : null,

                    sameCostConfirmed:
                      actor.isOwner &&
                      costInput?.costMode ===
                        "same",

                    requireExplicitIncreaseCost:
                      actor.isOwner,

                    sourceType:
                      "manual_stock",

                    sourceRef:
                      String(
                        lockedCurrent.id,
                      ),

                    sourceItemRef:
                      "product-edit",

                    note:
                      "Manual full product stock adjustment",

                    createdByUserId:
                      actor.id,
                  },
                )
              : null;

          if (
            costSync &&
            !costSync.tracked
          ) {
            if (
              costSync.reason ===
                "uninitialized" &&
              !(
                actor.isOwner &&
                costInput?.costMode !==
                  undefined
              )
            ) {
              // Cost tracking is not initialized yet.
              // Normal product editing may continue untracked.
            } else {
              return {
                kind: "cost_error",
                reason:
                  costSync.reason ===
                    "uninitialized"
                    ? "opening_cost_required"
                    : costSync.reason,
              } as const;
            }
          }

          const rows = await tx
            .update(productsTable)
        .set({
          ...storageProductData,
          ...(storageProductData.barcode !== undefined
            ? { barcode: storageProductData.barcode?.trim() || null }
            : {}),
        })
        .where(eq(productsTable.id, id))
        .returning();

      if (!rows[0]) {
        throw new Error("PRODUCT_UPDATE_FAILED");
      }

      updated = rows[0];

      // stock-card:product-update-adjustment
      const adjustmentMovements: Array<
        typeof inventoryMovementsTable.$inferInsert
      > = [];

      const oldGeneralStock =
        lockedCurrent.stock ?? 0;

      const newGeneralStock =
        updated.stock ?? 0;

      const generalDelta =
        newGeneralStock - oldGeneralStock;

      const adjustmentOccurredAt =
        new Date();

      const adjustmentOperationId =
        crypto.randomUUID();

      if (generalDelta !== 0) {
        adjustmentMovements.push({
          productId: updated.id,

          barcode:
            updated.barcode ?? null,

          productCode:
            updated.productCode ?? null,

          productNameAr:
            updated.nameAr,

          color: null,
          size: null,

          movementType:
            "adjustment",

          quantityDelta:
            generalDelta,

          generalStockBefore:
            oldGeneralStock,

          generalStockAfter:
            newGeneralStock,

          variantStockBefore: null,
          variantStockAfter: null,

          sourceType: "manual",
          sourceId: updated.id,
          sourceItemId: null,
          sourcePublicId:
            String(updated.id),

          eventKey:
            `product:${updated.id}:update:${adjustmentOperationId}:general`,

          occurredAt:
            adjustmentOccurredAt,
        });
      }

      const oldVariants =
        (lockedCurrent.colorVariants as
          | ColorVariant[]
          | null) ?? [];

      const newVariants =
        (updated.colorVariants as
          | ColorVariant[]
          | null) ?? [];

      const variantKeys = new Set<string>();

      for (const variant of oldVariants) {
        for (const sizeEntry of variant.sizes ?? []) {
          variantKeys.add(
            JSON.stringify([
              variant.color,
              sizeEntry.size,
            ]),
          );
        }
      }

      for (const variant of newVariants) {
        for (const sizeEntry of variant.sizes ?? []) {
          variantKeys.add(
            JSON.stringify([
              variant.color,
              sizeEntry.size,
            ]),
          );
        }
      }

      let adjustmentIndex = 0;

      for (const key of [...variantKeys].sort()) {
        const [color, size] =
          JSON.parse(key) as [string, string];

        const oldVariant =
          oldVariants.find(
            (entry) =>
              entry.color === color,
          );

        const newVariant =
          newVariants.find(
            (entry) =>
              entry.color === color,
          );

        const oldStock =
          oldVariant?.sizes?.find(
            (entry) =>
              entry.size === size,
          )?.stock ?? 0;

        const newStock =
          newVariant?.sizes?.find(
            (entry) =>
              entry.size === size,
          )?.stock ?? 0;

        const delta =
          newStock - oldStock;

        if (delta === 0) {
          continue;
        }

        adjustmentIndex += 1;

        const variantBarcode =
          additionalBarcodes.find(
            (entry) =>
              entry.color === color &&
              entry.size === size,
          )?.barcode ??
          updated.barcode ??
          null;

        adjustmentMovements.push({
          productId:
            updated.id,

          barcode:
            variantBarcode,

          productCode:
            updated.productCode ??
            null,

          productNameAr:
            updated.nameAr,

          color,
          size,

          movementType:
            "adjustment",

          quantityDelta:
            delta,

          generalStockBefore: null,
          generalStockAfter: null,

          variantStockBefore:
            oldStock,

          variantStockAfter:
            newStock,

          sourceType:
            "manual",

          sourceId:
            updated.id,

          sourceItemId: null,

          sourcePublicId:
            String(updated.id),

          eventKey:
            `product:${updated.id}:update:${adjustmentOperationId}:variant:${adjustmentIndex}`,

          occurredAt:
            adjustmentOccurredAt,
        });
      }

      if (adjustmentMovements.length > 0) {
        await tx
          .insert(inventoryMovementsTable)
          .values(adjustmentMovements);
      }

      if (
        purchaseSupplierId !== null
      ) {
        const linkedPurchaseQuantity =
          purchaseEntryMode === "historical"
            ? purchaseQuantity
            : purchaseQuantityDelta;

        if (
          linkedPurchaseQuantity === null ||
          linkedPurchaseQuantity <= 0
        ) {
          throw new PurchaseDraftServiceError(
            "كمية الشراء المرتبطة بالمورد غير صالحة",
            400,
          );
        }

        await appendProductToSupplierDraft(
          tx,
          {
            userId:
              actor.id,
            supplierId:
              purchaseSupplierId,
            productId:
              updated.id,
            quantity:
              linkedPurchaseQuantity,
            unitCostMinor:
              purchaseUnitCostMinor,
            entryMode:
              purchaseEntryMode,
            businessDate:
              purchaseBusinessDate,
            warehouseKey:
              "main",
            currencyCode:
              "ILS",
          },
        );
      }
    }

    if (rawAdditionalBarcodes !== undefined) {
      await tx
        .delete(productBarcodesTable)
        .where(eq(productBarcodesTable.productId, id));

      if (additionalBarcodes.length > 0) {
        await tx.insert(productBarcodesTable).values(
          additionalBarcodes.map((item) => ({
            productId: id,
            barcode: item.barcode,
            color: item.color,
            size: item.size,
          })),
        );
      }
    }

        return {
          kind: "updated",
          product: updated,
          previousProduct:
            lockedCurrent,
        } as const;
        },
      );
  } catch (error) {
    if (error instanceof PurchaseDraftServiceError) {
      return json(
        { error: error.message },
        error.status,
      );
    }

    throw error;
  }

  if (
    updateResult.kind ===
    "not_found"
  ) {
    return json(
      { error: "المنتج غير موجود" },
      404,
    );
  }

  if (
    updateResult.kind ===
    "purchase_link_error"
  ) {
    return json(
      {
        error:
          updateResult.reason ===
            "historical_requires_unchanged_stock"
            ? "الشراء السابق يجب تسجيله بدون تعديل كمية المخزون الحالية."
            : "الاستلام الجديد مع مورد يتطلب زيادة كمية المخزون فعليًا.",
      },
      400,
    );
  }

  if (
    updateResult.kind ===
    "cost_error"
  ) {
    const message =
      updateResult.reason ===
        "opening_cost_required"
        ? "يجب إدخال التكلفة الافتتاحية للصنف أولاً"
        : updateResult.reason ===
            "owner_cost_confirmation_required"
          ? "زادت كمية المخزون. حدد هل تكلفة الكمية الجديدة نفس التكلفة الحالية أم تغيرت."
          : updateResult.reason ===
              "unknown_effective_quantity"
            ? "تعذر حساب الكمية الفعلية للصنف. يجب ضبط المخزون قبل مزامنة التكلفة."
            : updateResult.reason ===
                "cost_input_not_applicable"
              ? "اختيار تكلفة الكمية الجديدة مسموح فقط عند زيادة المخزون."
              : updateResult.reason ===
                  "accounting_quantity_mismatch"
                ? "كمية التكلفة المحاسبية لا تطابق المخزون الحالي. يجب تصحيح المزامنة قبل تعديل الكمية."
                : "تعذر مزامنة تكلفة المخزون";

    return json(
      { error: message },
      409,
    );
  }

  const product =
    updateResult.product;

  const previousProduct =
    updateResult.previousProduct;

  try {
    await cleanupRemovedProductImages(
      db,
      env,
      previousProduct,
      product,
    );
  } catch (error) {
    // Product update must remain successful even if storage cleanup
    // temporarily fails. The orphan can be cleaned later.
    console.error(
      "UPDATE_PRODUCT_STORAGE_CLEANUP_FAILED",
      {
        productId: id,
        error,
      },
    );
  }

  return json(
    toProduct(product, additionalBarcodes),
  );
}

async function handleStock(
  request: Request,
  db: Db,
  env: Env,
  id: number,
) {
  const auth =
    await requireAdminActor(
      request,
      db,
      env,
    );

  if (!auth.ok) {
    return auth.response;
  }

  const actor =
    auth.user;

  const body = await request.json().catch(() => null) as {
    action?: "set" | "add" | "subtract";
    amount?: number;
  } | null;

  const costInput =
    body as
      | (typeof body &
          ManualStockCostInput)
      | null;

  const costInputError =
    validateManualStockCostInput(
      costInput,
      actor.isOwner,
    );

  if (costInputError) {
    return costInputError;
  }

  if (
    !body?.action ||
    typeof body.amount !== "number" ||
    body.amount < 0
  ) {
    return json(
      { error: "action و amount مطلوبان" },
      400,
    );
  }

  const amount = Math.round(body.amount);

  const result = await db.transaction(
    async (tx) => {
      const currentRows = await tx
        .select()
        .from(productsTable)
        .where(eq(productsTable.id, id))
        .for("update");

      const current = currentRows[0];

      if (!current) {
        return {
          kind: "not_found",
        } as const;
      }

      const effectiveQuantityBefore =
        getProductQuantity(
          current,
        );

      const oldStock =
        current.stock ?? 0;

      let newStock: number;

      if (body.action === "set") {
        newStock =
          Math.max(0, amount);
      } else if (body.action === "add") {
        newStock =
          oldStock + amount;
      } else {
        newStock =
          Math.max(
            0,
            oldStock - amount,
          );
      }

      const effectiveQuantityAfter =
        getProductQuantity({
          ...current,
          stock: newStock,
        });

      const costSync =
        await syncManualProductCostQuantity(
          tx,
          {
            productId:
              current.id,

            quantityBefore:
              effectiveQuantityBefore,

            quantityAfter:
              effectiveQuantityAfter,

            explicitUnitCostMinor:
              actor.isOwner &&
              costInput?.costMode === "new"
                ? costInput.unitCostMinor
                : null,

            sameCostConfirmed:
              actor.isOwner &&
              costInput?.costMode === "same",

            requireExplicitIncreaseCost:
              actor.isOwner,

            sourceType:
              "manual_stock",

            sourceRef:
              String(current.id),

            sourceItemRef:
              "general",

            note:
              "Manual general stock adjustment",

            createdByUserId:
              actor.id,
          },
        );

      if (
        costSync &&
        !costSync.tracked
      ) {
        if (
          costSync.reason ===
            "uninitialized" &&
          !(
            actor.isOwner &&
            costInput?.costMode !==
              undefined
          )
        ) {
          // Cost tracking has not been initialized.
          // Ordinary stock adjustment may continue.
        } else {
          return {
            kind: "cost_error",
            reason:
              costSync.reason ===
                "uninitialized"
                ? "opening_cost_required"
                : costSync.reason,
          } as const;
        }
      }

      const rows = await tx
        .update(productsTable)
        .set({
          stock: newStock,
        })
        .where(eq(productsTable.id, id))
        .returning();

      const updated = rows[0];

      if (!updated) {
        throw new Error(
          "MANUAL_GENERAL_STOCK_UPDATE_FAILED",
        );
      }

      const delta =
        newStock - oldStock;

      // stock-card:manual-general-stock
      if (delta !== 0) {
        const occurredAt =
          new Date();

        await tx
          .insert(inventoryMovementsTable)
          .values({
            productId:
              updated.id,

            barcode:
              updated.barcode ?? null,

            productCode:
              updated.productCode ?? null,

            productNameAr:
              updated.nameAr,

            color: null,
            size: null,

            movementType:
              "adjustment",

            quantityDelta:
              delta,

            generalStockBefore:
              oldStock,

            generalStockAfter:
              newStock,

            variantStockBefore: null,
            variantStockAfter: null,

            sourceType:
              "manual",

            sourceId:
              updated.id,

            sourceItemId: null,

            sourcePublicId:
              String(updated.id),

            eventKey:
              `product:${updated.id}:manual-general:${crypto.randomUUID()}`,

            occurredAt,
          });
      }

      return {
        kind: "updated",
        product: updated,
      } as const;
    },
  );

  if (
    result.kind ===
    "not_found"
  ) {
    return json(
      { error: "المنتج غير موجود" },
      404,
    );
  }

  if (
    result.kind ===
    "cost_error"
  ) {
    const message =
      result.reason ===
        "opening_cost_required"
        ? "يجب إدخال التكلفة الافتتاحية للصنف أولاً"
        : result.reason ===
            "owner_cost_confirmation_required"
          ? "زادت كمية المخزون. حدد هل تكلفة الكمية الجديدة نفس التكلفة الحالية أم تغيرت."
          : result.reason ===
              "unknown_effective_quantity"
            ? "تعذر حساب الكمية الفعلية للصنف. يجب ضبط المخزون قبل مزامنة التكلفة."
            : result.reason ===
                "cost_input_not_applicable"
              ? "اختيار تكلفة الكمية الجديدة مسموح فقط عند زيادة المخزون."
              : result.reason ===
                  "accounting_quantity_mismatch"
                ? "كمية التكلفة المحاسبية لا تطابق المخزون الحالي. يجب تصحيح المزامنة قبل تعديل الكمية."
                : "تعذر مزامنة تكلفة المخزون";

    return json(
      { error: message },
      409,
    );
  }

  const product =
    result.product;

  const additionalBarcodes =
    await getAdditionalBarcodes(db, id);

  return json(
    toProduct(
      product,
      additionalBarcodes,
    ),
  );
}

export async function handleProductRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (
    request.method === "GET" &&
    path === "/api/products/admin"
  ) {
    const authError = await requireAdmin(request, db, env);
    if (authError) return authError;

    const rows = await db
      .select()
      .from(productsTable)
      .orderBy(desc(productsTable.createdAt));

    return json(rows.map((row) => toProduct(row)));
  }

  if (
    request.method === "GET" &&
    path === "/api/products/barcodes"
  ) {
    const authError = await requireAdmin(
      request,
      db,
      env,
    );

    if (authError) return authError;

    const rows = await db
      .select({
        productId: productBarcodesTable.productId,
        barcode: productBarcodesTable.barcode,
        color: productBarcodesTable.color,
        size: productBarcodesTable.size,
      })
      .from(productBarcodesTable);

    return json(
      rows.map((row) => ({
        productId: String(row.productId),
        barcode: row.barcode,
        color: row.color ?? null,
        size: row.size ?? null,
      })),
    );
  }

  const purchaseHistoryPreviewMatch =
    path.match(
      /^\/api\/products\/(\d+)\/purchase-history-preview$/,
    );

  if (
    request.method === "GET" &&
    purchaseHistoryPreviewMatch
  ) {
    const auth =
      await requireAdminActor(
        request,
        db,
        env,
      );

    if (!auth.ok) {
      return auth.response;
    }

    if (!auth.user.isOwner) {
      return json(
        {
          error:
            "بيانات تكلفة المشتريات متاحة للمالك فقط",
        },
        403,
      );
    }

    try {
      const preview =
        await getHistoricalPurchasePreview(
          db,
          {
            productId:
              Number(
                purchaseHistoryPreviewMatch[1],
              ),
            warehouseKey:
              "main",
          },
        );

      return json(preview);
    } catch (error) {
      if (
        error instanceof
        HistoricalPurchasePreviewError
      ) {
        return json(
          {
            error:
              error.message,
          },
          409,
        );
      }

      throw error;
    }
  }

  if (
    request.method === "POST" &&
    path === "/api/products"
  ) {
    return handleCreateProduct(request, db, env);
  }

  const variantMatch = path.match(
    /^\/api\/products\/(\d+)\/variant-stock$/,
  );

  if (
    request.method === "PATCH" &&
    variantMatch
  ) {
    return handleVariantStock(
      request,
      db,
      env,
      Number(variantMatch[1]),
    );
  }

  const stockMatch = path.match(
    /^\/api\/products\/(\d+)\/stock$/,
  );

  if (
    request.method === "PATCH" &&
    stockMatch
  ) {
    return handleStock(
      request,
      db,
      env,
      Number(stockMatch[1]),
    );
  }

  const visibilityMatch = path.match(
    /^\/api\/products\/(\d+)\/visibility$/,
  );

  if (request.method === "PATCH" && visibilityMatch) {
    const authError = await requireAdmin(request, db, env);
    if (authError) return authError;

    const body = await request.json().catch(() => null) as
      | { hidden?: boolean }
      | null;

    if (typeof body?.hidden !== "boolean") {
      return json({ error: "hidden مطلوب" }, 400);
    }

    const rows = await db
      .update(productsTable)
      .set({ isHidden: body.hidden, autoHiddenOutOfStock: false })
      .where(eq(productsTable.id, Number(visibilityMatch[1])))
      .returning();

    if (!rows[0]) return json({ error: "المنتج غير موجود" }, 404);

    const barcodes = await getAdditionalBarcodes(
      db,
      Number(visibilityMatch[1]),
    );

    return json(toProduct(rows[0], barcodes));
  }

  const restoreMatch = path.match(
    /^\/api\/products\/(\d+)\/restore$/,
  );

  if (request.method === "PATCH" && restoreMatch) {
    const authError = await requireAdmin(request, db, env);
    if (authError) return authError;

    const id = Number(restoreMatch[1]);

    const rows = await db
      .update(productsTable)
      .set({ deletedAt: null })
      .where(eq(productsTable.id, id))
      .returning();

    if (!rows[0]) return json({ error: "المنتج غير موجود" }, 404);

    const barcodes = await getAdditionalBarcodes(db, id);
    return json(toProduct(rows[0], barcodes));
  }

  const permanentMatch = path.match(
    /^\/api\/products\/(\d+)\/permanent$/,
  );

  if (request.method === "DELETE" && permanentMatch) {
    return handleDeleteProduct(
      request,
      db,
      env,
      Number(permanentMatch[1]),
    );
  }

  const productMatch = path.match(
    /^\/api\/products\/(\d+)$/,
  );

  if (
    request.method === "PUT" &&
    productMatch
  ) {
    return handleUpdateProduct(
      request,
      db,
      env,
      Number(productMatch[1]),
    );
  }

  if (
    request.method === "DELETE" &&
    productMatch
  ) {
    const authError = await requireAdmin(request, db, env);
    if (authError) return authError;

    const id = Number(productMatch[1]);

    const rows = await db
      .update(productsTable)
      .set({ deletedAt: new Date() })
      .where(eq(productsTable.id, id))
      .returning();

    if (!rows[0]) return json({ error: "المنتج غير موجود" }, 404);

    const barcodes = await getAdditionalBarcodes(db, id);
    return json(toProduct(rows[0], barcodes));
  }

  return null;
}

async function handleVariantStock(
  request: Request,
  db: Db,
  env: Env,
  id: number,
) {
  const auth =
    await requireAdminActor(
      request,
      db,
      env,
    );

  if (!auth.ok) {
    return auth.response;
  }

  const actor =
    auth.user;

  const body = await request.json().catch(() => null) as {
    color?: string;
    size?: string;
    action?: "set" | "add" | "subtract";
    amount?: number;
  } | null;

  const costInput =
    body as
      | (typeof body &
          ManualStockCostInput)
      | null;

  const costInputError =
    validateManualStockCostInput(
      costInput,
      actor.isOwner,
    );

  if (costInputError) {
    return costInputError;
  }

  if (
    !body?.color ||
    !body.size ||
    !body.action ||
    typeof body.amount !== "number" ||
    body.amount < 0
  ) {
    return json(
      {
        error:
          "color و size و action و amount مطلوبة",
      },
      400,
    );
  }

  const color = body.color;
  const size = body.size;
  const action = body.action;
  const amount =
    Math.round(body.amount);

  const result = await db.transaction(
    async (tx) => {
      const currentRows = await tx
        .select()
        .from(productsTable)
        .where(eq(productsTable.id, id))
        .for("update");

      const current = currentRows[0];

      if (!current) {
        return {
          kind: "not_found",
        } as const;
      }

      const effectiveQuantityBefore =
        getProductQuantity(
          current,
        );

      const variants =
        (current.colorVariants as
          | ColorVariant[]
          | null) ?? [];

      let found = false;
      let oldStock = 0;
      let newStock = 0;

      const updatedVariants =
        variants.map((variant) => {
          if (
            variant.color !== color
          ) {
            return variant;
          }

          return {
            ...variant,
            sizes:
              variant.sizes.map(
                (entry) => {
                  if (
                    entry.size !== size
                  ) {
                    return entry;
                  }

                  found = true;

                  oldStock =
                    entry.stock ?? 0;

                  if (action === "set") {
                    newStock =
                      Math.max(
                        0,
                        amount,
                      );
                  } else if (
                    action === "add"
                  ) {
                    newStock =
                      oldStock +
                      amount;
                  } else {
                    newStock =
                      Math.max(
                        0,
                        oldStock -
                          amount,
                      );
                  }

                  return {
                    ...entry,
                    stock:
                      newStock,
                    outOfStock:
                      newStock <= 0,
                  };
                },
              ),
          };
        });

      if (!found) {
        return {
          kind: "variant_not_found",
        } as const;
      }

      const effectiveQuantityAfter =
        getProductQuantity({
          ...current,
          colorVariants:
            updatedVariants,
        });

      const costSync =
        await syncManualProductCostQuantity(
          tx,
          {
            productId:
              current.id,

            quantityBefore:
              effectiveQuantityBefore,

            quantityAfter:
              effectiveQuantityAfter,

            explicitUnitCostMinor:
              actor.isOwner &&
              costInput?.costMode === "new"
                ? costInput.unitCostMinor
                : null,

            sameCostConfirmed:
              actor.isOwner &&
              costInput?.costMode === "same",

            requireExplicitIncreaseCost:
              actor.isOwner,

            sourceType:
              "manual_stock",

            sourceRef:
              String(current.id),

            sourceItemRef:
              `${color}:${size}`,

            note:
              "Manual variant stock adjustment",

            createdByUserId:
              actor.id,
          },
        );

      if (
        costSync &&
        !costSync.tracked
      ) {
        if (
          costSync.reason ===
            "uninitialized" &&
          !(
            actor.isOwner &&
            costInput?.costMode !==
              undefined
          )
        ) {
          // Uninitialized products remain untracked
          // until the owner enters opening cost.
        } else {
          return {
            kind: "cost_error",
            reason:
              costSync.reason ===
                "uninitialized"
                ? "opening_cost_required"
                : costSync.reason,
          } as const;
        }
      }

      const rows = await tx
        .update(productsTable)
        .set({
          colorVariants:
            updatedVariants,
        })
        .where(
          eq(
            productsTable.id,
            id,
          ),
        )
        .returning();

      const updated = rows[0];

      if (!updated) {
        throw new Error(
          "MANUAL_VARIANT_STOCK_UPDATE_FAILED",
        );
      }

      const delta =
        newStock - oldStock;

      // stock-card:manual-variant-stock
      if (delta !== 0) {
        const occurredAt =
          new Date();

        const barcodeRows =
          await tx
            .select({
              barcode:
                productBarcodesTable.barcode,
            })
            .from(
              productBarcodesTable,
            )
            .where(
              and(
                eq(
                  productBarcodesTable.productId,
                  id,
                ),
                eq(
                  productBarcodesTable.color,
                  color,
                ),
                eq(
                  productBarcodesTable.size,
                  size,
                ),
              ),
            )
            .limit(1);

        await tx
          .insert(inventoryMovementsTable)
          .values({
            productId:
              updated.id,

            barcode:
              barcodeRows[0]?.barcode ??
              updated.barcode ??
              null,

            productCode:
              updated.productCode ??
              null,

            productNameAr:
              updated.nameAr,

            color,
            size,

            movementType:
              "adjustment",

            quantityDelta:
              delta,

            generalStockBefore:
              null,

            generalStockAfter:
              null,

            variantStockBefore:
              oldStock,

            variantStockAfter:
              newStock,

            sourceType:
              "manual",

            sourceId:
              updated.id,

            sourceItemId:
              null,

            sourcePublicId:
              String(updated.id),

            eventKey:
              `product:${updated.id}:manual-variant:${crypto.randomUUID()}`,

            occurredAt,
          });
      }

      return {
        kind: "updated",
        product: updated,
      } as const;
    },
  );

  if (
    result.kind ===
    "cost_error"
  ) {
    const message =
      result.reason ===
        "opening_cost_required"
        ? "يجب إدخال التكلفة الافتتاحية للصنف أولاً"
        : result.reason ===
            "owner_cost_confirmation_required"
          ? "زادت كمية المخزون. حدد هل تكلفة الكمية الجديدة نفس التكلفة الحالية أم تغيرت."
          : result.reason ===
              "unknown_effective_quantity"
            ? "تعذر حساب الكمية الفعلية للصنف. يجب ضبط المخزون قبل مزامنة التكلفة."
            : result.reason ===
                "cost_input_not_applicable"
              ? "اختيار تكلفة الكمية الجديدة مسموح فقط عند زيادة المخزون."
              : result.reason ===
                  "accounting_quantity_mismatch"
                ? "كمية التكلفة المحاسبية لا تطابق المخزون الحالي. يجب تصحيح المزامنة قبل تعديل الكمية."
                : "تعذر مزامنة تكلفة المخزون";

    return json(
      { error: message },
      409,
    );
  }

  if (
    result.kind ===
    "not_found"
  ) {
    return json(
      { error: "المنتج غير موجود" },
      404,
    );
  }

  if (
    result.kind ===
    "variant_not_found"
  ) {
    return json(
      {
        error:
          "المقاس أو اللون غير موجود",
      },
      404,
    );
  }

  const additionalBarcodes =
    await getAdditionalBarcodes(
      db,
      id,
    );

  return json(
    toProduct(
      result.product,
      additionalBarcodes,
    ),
  );
}

async function deleteProductPermanently(
  db: Db,
  env: Env,
  id: number,
): Promise<boolean> {
  let rows;

  try {
    rows = await db
      .delete(productsTable)
      .where(eq(productsTable.id, id))
      .returning();
  } catch (error) {
    console.error("DELETE_PRODUCT_FAILED", {
      productId: id,
      error,
    });
    throw error;
  }

  if (!rows[0]) return false;

  try {
    const deletedProduct = rows[0];

    const deletedImageUrls = new Set<string>();

    if (deletedProduct.image) {
      deletedImageUrls.add(deletedProduct.image);
    }

    for (const url of (deletedProduct.images as string[]) ?? []) {
      if (url) deletedImageUrls.add(url);
    }

    for (
      const variant of
        (deletedProduct.colorVariants as ColorVariant[]) ?? []
    ) {
      if (variant.image) deletedImageUrls.add(variant.image);
    }

    const remainingProducts = await db
      .select({
        image: productsTable.image,
        images: productsTable.images,
        colorVariants: productsTable.colorVariants,
      })
      .from(productsTable);

    const usedImageUrls = new Set<string>();

    for (const product of remainingProducts) {
      if (product.image) usedImageUrls.add(product.image);

      for (const url of (product.images as string[]) ?? []) {
        if (url) usedImageUrls.add(url);
      }

      for (
        const variant of
          (product.colorVariants as ColorVariant[]) ?? []
      ) {
        if (variant.image) usedImageUrls.add(variant.image);
      }
    }

    const existingOrders = await db
      .select({ items: ordersTable.items })
      .from(ordersTable);

    for (const order of existingOrders) {
      const items =
        (order.items as Array<{ image?: string }>) ?? [];

      for (const item of items) {
        if (item.image) usedImageUrls.add(item.image);
      }
    }

    const objectPaths = [...deletedImageUrls]
      .filter((url) => !usedImageUrls.has(url))
      .map((url) => getProductImageObjectPath(url, env))
      .filter((path): path is string => !!path);

    await deleteProductImageObjects(env, objectPaths);
  } catch (error) {
    console.error("DELETE_PRODUCT_STORAGE_CLEANUP_FAILED", {
      productId: id,
      error,
    });
  }

  return true;
}

async function handleDeleteProduct(
  request: Request,
  db: Db,
  env: Env,
  id: number,
) {
  const authError = await requireAdmin(request, db, env);
  if (authError) return authError;

  const current = await db
    .select({
      deletedAt: productsTable.deletedAt,
    })
    .from(productsTable)
    .where(eq(productsTable.id, id))
    .limit(1);

  if (!current[0]) {
    return json({ error: "المنتج غير موجود" }, 404);
  }

  if (!current[0].deletedAt) {
    return json(
      { error: "يجب نقل المنتج إلى سلة المحذوفات أولاً" },
      400,
    );
  }

  try {
    const deleted = await deleteProductPermanently(
      db,
      env,
      id,
    );

    if (!deleted) {
      return json({ error: "المنتج غير موجود" }, 404);
    }

    return json({ success: true });
  } catch {
    return json({ error: "تعذر حذف المنتج نهائيًا" }, 500);
  }
}

export async function purgeExpiredTrashedProducts(
  db: Db,
  env: Env,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(
    now.getTime() - 15 * 24 * 60 * 60 * 1000,
  );

  const expiredProducts = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(lte(productsTable.deletedAt, cutoff));

  let purged = 0;

  for (const product of expiredProducts) {
    try {
      const deleted = await deleteProductPermanently(
        db,
        env,
        product.id,
      );

      if (deleted) purged += 1;
    } catch (error) {
      console.error("AUTO_DELETE_PRODUCT_FAILED", {
        productId: product.id,
        error,
      });
    }
  }

  return purged;
}
