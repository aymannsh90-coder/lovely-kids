import {
  appSettingsTable,
  productsTable,
  type ColorVariant,
} from "@workspace/db/schema";
import { desc, eq } from "drizzle-orm";
import type { openDb } from "./db";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

function csvValue(value: unknown): string {
  const text = String(value ?? "")
    .replace(/\r?\n/g, " ")
    .trim();

  return `"${text.replace(/"/g, '""')}"`;
}

function isValidHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isSizeAvailable(size: {
  stock?: number | null;
  outOfStock?: boolean;
}): boolean {
  if (size.stock !== undefined && size.stock !== null) {
    return size.stock > 0;
  }

  return !size.outOfStock;
}

function isProductAvailable(
  product: typeof productsTable.$inferSelect,
): boolean {
  // If general stock is tracked and reached zero,
  // the whole product is unavailable.
  if (
    product.stock !== undefined &&
    product.stock !== null &&
    product.stock <= 0
  ) {
    return false;
  }

  const variants = (product.colorVariants as ColorVariant[] | null) ?? [];

  const variantSizes = variants.flatMap((variant) =>
    Array.isArray(variant.sizes) ? variant.sizes : [],
  );

  // If the product tracks stock by color/size,
  // at least one size must still be available.
  if (variantSizes.length > 0) {
    return variantSizes.some(isSizeAvailable);
  }

  // Legacy/untracked products stay available unless
  // their general stock explicitly says zero.
  return true;
}

export async function handleMetaCatalogRequest(
  request: Request,
  db: Db,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (
    request.method !== "GET" ||
    url.pathname !== "/api/meta/catalog.csv"
  ) {
    return null;
  }

  const settingsRows = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.id, 1))
    .limit(1);

  const settings =
    (settingsRows[0]?.data as Record<string, unknown> | undefined) ?? {};

  // Meta Catalog intentionally includes both summer and winter products
  // during the seasonal transition period.
  // The app's activeSeason setting is not used to filter this feed.

  const products = await db
    .select()
    .from(productsTable)
    .orderBy(desc(productsTable.createdAt));

  const eligibleProducts = products.filter((product) => {
    // Hidden or trashed products must never reach Meta/Facebook Catalog.
    if (product.isHidden || product.deletedAt) return false;

    const hasNoSeason = !product.season;
    const isSummerOrWinter =
      product.season === "summer" || product.season === "winter";
    const isInOffers = !!product.showInOffers;

    // During the seasonal transition, advertise both summer and winter
    // products, plus products without a season or included in Offers.
    if (!isSummerOrWinter && !hasNoSeason && !isInOffers) return false;

    // Never advertise a product that is fully out of stock.
    if (!isProductAvailable(product)) return false;

    if (!isValidHttpUrl(product.image)) return false;
    if (!Number.isFinite(product.price) || product.price <= 0) return false;

    return true;
  });

  const header = [
    "id",
    "title",
    "description",
    "availability",
    "condition",
    "price",
    "link",
    "image_link",
    "brand",
  ].join(",");

  const lines = eligibleProducts.map((product) => {
    const title = product.nameAr?.trim() || product.name?.trim() || `Product ${product.id}`;
    const description = product.description?.trim() || title;

    return [
      csvValue(String(product.id)),
      csvValue(title),
      csvValue(description),
      csvValue("in stock"),
      csvValue("new"),
      csvValue(`${product.price} ILS`),
      csvValue(`https://lovelykids.net/product/${product.id}`),
      csvValue(product.image),
      csvValue("Lovely Kids"),
    ].join(",");
  });

  const body = [header, ...lines].join("\n");

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'inline; filename="lovely-kids-meta-catalog.csv"',
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}
