import { appSettingsTable, productsTable } from "@workspace/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { openDb, type Env } from "./db";
import { handleAuthRequest } from "./auth-routes";
import {
  handleProductRequest,
  purgeExpiredTrashedProducts,
} from "./product-routes";
import { handleMetaCatalogRequest } from "./meta-catalog-routes";
import { handleSettingsRequest } from "./settings-routes";
import { handleOrderRequest } from "./order-routes";
import { handleImageRequest } from "./image-routes";
import { handleHeroMediaRequest } from "./hero-media-routes";
import { handleNotificationRequest } from "./notification-routes";
import { handlePasswordResetRequest } from "./password-reset-routes";
import { handleLikesRequest } from "./likes-routes";
import { handleUsersRequest } from "./users-routes";
import { handleVisitorAnalyticsRequest } from "./visitor-analytics-routes";
import { handleCashSessionRequest } from "./cash-session-routes";
import { handlePosSaleRequest } from "./pos-sale-routes";
import { handlePosSaleReturnRequest } from "./pos-sale-return-routes";
import { handleSupplierRequest } from "./supplier-routes";
import { handlePosPurchaseRequest } from "./pos-purchase-routes";
import {
  isPurchaseApiEnabled,
  isPurchaseWriteEnabled,
  purchaseFeatureDisabledResponse,
  purchaseWritesDisabledResponse,
} from "./purchase-feature";
import { WorkerEntrypoint } from "cloudflare:workers";
import { rewriteMediaUrlsForPublic } from "./media-url";

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(rewriteMediaUrlsForPublic(data)), { status, headers });

const PUBLIC_CACHE_TTL_SECONDS: Record<string, number> = {
  "/api/products": 60,
  "/api/settings": 300,
};

const PUBLIC_CACHE_TAGS = {
  products: "lovely-products",
  settings: "lovely-settings",
} as const;

type PublicApiBinding = {
  fetch(
    request: Request,
    init?: {
      cf?: {
        cacheControl: string;
      };
    },
  ): Promise<Response>;
  purgeTags(tags: string[]): Promise<void>;
};

type GatewayContext = {
  waitUntil(promise: Promise<unknown>): void;
  exports: {
    PublicAPI: PublicApiBinding;
  };
};

function isMutation(request: Request): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(request.method);
}

async function purgePublicTags(
  ctx: GatewayContext,
  tags: string[],
): Promise<void> {
  try {
    await ctx.exports.PublicAPI.purgeTags(tags);
  } catch (error) {
    // Never turn a successful business write into a failure because
    // cache invalidation failed. TTL remains the safety fallback.
    console.error("PUBLIC_WORKERS_CACHE_PURGE_FAILED", {
      tags,
      error,
    });
  }
}

async function fetchPublicThroughCache(
  request: Request,
  path: string,
  ctx: GatewayContext,
): Promise<Response> {
  const ttl = PUBLIC_CACHE_TTL_SECONDS[path];

  if (!ttl) {
    return json({ error: "Not found" }, 404);
  }

  // Canonical key: these public endpoints do not use query parameters.
  const url = new URL(request.url);
  url.search = "";
  url.hash = "";

  const internalRequest = new Request(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  const cachedResponse = await ctx.exports.PublicAPI.fetch(
    internalRequest,
    {
      cf: {
        cacheControl: `public, max-age=${ttl}`,
      },
    },
  );

  // Default gateway itself is uncached. Browsers also must not retain
  // stale catalog/settings data; only PublicAPI's Workers Cache stores it.
  const clientResponse = new Response(cachedResponse.body, {
    status: cachedResponse.status,
    statusText: cachedResponse.statusText,
    headers: cachedResponse.headers,
  });

  clientResponse.headers.delete("Cache-Tag");
  clientResponse.headers.set("Cache-Control", "no-store");
  clientResponse.headers.set(
    "X-Lovely-Public-Cache",
    "workers-caching",
  );

  const innerStatus =
    cachedResponse.headers.get("CF-Cache-Status");

  if (innerStatus) {
    clientResponse.headers.set(
      "X-Lovely-Public-Cache-Status",
      innerStatus,
    );
  }

  return clientResponse;
}

function toProduct(r: typeof productsTable.$inferSelect) {
  return {
    id: String(r.id),
    name: r.name,
    nameAr: r.nameAr,
    productCode: r.productCode ?? null,
    barcode: r.barcode ?? null,
    price: r.price,
    originalPrice: r.originalPrice ?? undefined,
    image: r.image,
    images: (r.images as string[]) ?? [],
    category: r.category,
    ageGroup: r.ageGroup,
    gender: r.gender,
    season: r.season,
    sizes: (r.sizes as string[]) ?? [],
    colorVariants: (r.colorVariants as unknown[]) ?? [],
    rating: r.rating / 10,
    reviews: r.reviews,
    isPinned: !!r.isPinned,
    showInOffers: !!r.showInOffers,
    isHidden: !!r.isHidden,
    deletedAt: r.deletedAt?.toISOString() ?? null,
    facebookUrl: r.facebookUrl ?? null,
    instagramUrl: r.instagramUrl ?? null,
    tiktokUrl: r.tiktokUrl ?? null,
    isNew: !!r.isNew && !!r.newUntil && r.newUntil.getTime() > Date.now(),
    newUntil: r.newUntil?.toISOString() ?? null,
    discount: r.discount ?? undefined,
    description: r.description,
    stock: r.stock ?? null,
  };
}
export class PublicAPI extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405);
    }

    const { client, db } = await openDb(this.env);

    try {
      if (path === "/api/products") {
        const rows = await db
          .select()
          .from(productsTable)
          .where(
            and(
              eq(productsTable.isHidden, false),
              isNull(productsTable.deletedAt),
            ),
          )
          .orderBy(desc(productsTable.createdAt));

        return new Response(
          JSON.stringify(
            rewriteMediaUrlsForPublic(rows.map(toProduct)),
          ),
          {
            headers: {
              ...headers,
              "Cache-Tag": PUBLIC_CACHE_TAGS.products,
              "X-Lovely-Public-Generated-At":
                new Date().toISOString(),
            },
          },
        );
      }

      if (path === "/api/settings") {
        const rows = await db
          .select()
          .from(appSettingsTable)
          .where(eq(appSettingsTable.id, 1));

        return new Response(
          JSON.stringify(
            rewriteMediaUrlsForPublic(
              (rows[0]?.data as Record<string, unknown>) ?? {},
            ),
          ),
          {
            headers: {
              ...headers,
              "Cache-Tag": PUBLIC_CACHE_TAGS.settings,
              "X-Lovely-Public-Generated-At":
                new Date().toISOString(),
            },
          },
        );
      }

      return json({ error: "Not found" }, 404);
    } finally {
      await client.end().catch(() => {});
    }
  }

  async purgeTags(tags: string[]): Promise<void> {
    const ctx = this.ctx as unknown as {
      cache: {
        purge(input: {
          tags: string[];
        }): Promise<unknown>;
      };
    };

    await ctx.cache.purge({ tags });
  }
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: GatewayContext,
  ): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...headers,
          "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type,Authorization",
        },
      });
    }

    const path = new URL(request.url).pathname;

    if (
      request.method === "GET" &&
      !request.headers.has("Authorization") &&
      (
        path === "/api/products" ||
        path === "/api/settings"
      )
    ) {
      return fetchPublicThroughCache(
        request,
        path,
        ctx,
      );
    }

    if (
      request.method === "GET" &&
      path === "/api/pos/suppliers" &&
      !isPurchaseApiEnabled(env)
    ) {
      return purchaseFeatureDisabledResponse();
    }

    if (
      request.method === "POST" &&
      (
        path === "/api/pos/suppliers" ||
        path === "/api/pos/purchases"
      ) &&
      !isPurchaseWriteEnabled(env)
    ) {
      return purchaseWritesDisabledResponse();
    }

    const { client, db } = await openDb(env);

    try {
      const metaCatalogResponse =
        await handleMetaCatalogRequest(request, db);

      if (metaCatalogResponse) {
        return metaCatalogResponse;
      }

      const authResponse = await handleAuthRequest(request, db, env);
      if (authResponse) return authResponse;

      const cashSessionResponse = await handleCashSessionRequest(
        request,
        db,
        env,
      );

      if (cashSessionResponse) {
        return cashSessionResponse;
      }

      const posSaleResponse = await handlePosSaleRequest(request, db, env);

      if (posSaleResponse) {
        if (
          posSaleResponse.ok &&
          isMutation(request)
        ) {
          await purgePublicTags(
            ctx,
            [PUBLIC_CACHE_TAGS.products],
          );
        }

        return posSaleResponse;
      }

      const posSaleReturnResponse = await handlePosSaleReturnRequest(
        request,
        db,
        env,
      );

      if (posSaleReturnResponse) {
        if (
          posSaleReturnResponse.ok &&
          isMutation(request)
        ) {
          await purgePublicTags(
            ctx,
            [PUBLIC_CACHE_TAGS.products],
          );
        }

        return posSaleReturnResponse;
      }
      const supplierResponse = await handleSupplierRequest(
        request,
        db,
        env,
      );

      if (supplierResponse) {
        return supplierResponse;
      }

      const posPurchaseResponse =
        await handlePosPurchaseRequest(
          request,
          db,
          env,
        );

      if (posPurchaseResponse) {
        if (
          posPurchaseResponse.ok &&
          isMutation(request)
        ) {
          await purgePublicTags(
            ctx,
            [PUBLIC_CACHE_TAGS.products],
          );
        }

        return posPurchaseResponse;
      }



      const passwordResetResponse = await handlePasswordResetRequest(
        request,
        db,
        env,
      );

      if (passwordResetResponse) {
        return passwordResetResponse;
      }

      const productResponse = await handleProductRequest(request, db, env);

      if (productResponse) {
        if (
          productResponse.ok &&
          isMutation(request)
        ) {
          await purgePublicTags(
            ctx,
            [PUBLIC_CACHE_TAGS.products],
          );
        }

        return productResponse;
      }

      const settingsResponse = await handleSettingsRequest(request, db, env);

      if (settingsResponse) {
        if (
          settingsResponse.ok &&
          isMutation(request)
        ) {
          await purgePublicTags(
            ctx,
            [PUBLIC_CACHE_TAGS.settings],
          );
        }

        return settingsResponse;
      }

      const orderResponse =
        await handleOrderRequest(request, db, env);

      if (orderResponse) {
        if (
          orderResponse.ok &&
          isMutation(request)
        ) {
          await purgePublicTags(
            ctx,
            [PUBLIC_CACHE_TAGS.products],
          );
        }

        return orderResponse;
      }

      const imageResponse = await handleImageRequest(request, db, env);
      if (imageResponse) return imageResponse;

      const heroMediaResponse = await handleHeroMediaRequest(request, db, env);
      if (heroMediaResponse) return heroMediaResponse;

      const notificationResponse = await handleNotificationRequest(
        request,
        db,
        env,
      );
      if (notificationResponse) {
        return notificationResponse;
      }

      const likesResponse = await handleLikesRequest(request, db, env);

      if (likesResponse) {
        return likesResponse;
      }

      const usersResponse = await handleUsersRequest(request, db, env);

      if (usersResponse) {
        return usersResponse;
      }

      const visitorAnalyticsResponse =
        await handleVisitorAnalyticsRequest(
          request,
          db,
          env,
        );

      if (visitorAnalyticsResponse) {
        return visitorAnalyticsResponse;
      }

      if (path === "/api/health" || path === "/api/healthz") {
        await client.query("select 1");
        return json({
          ok: true,
          service: "Lovely Kids Worker API",
          database: "connected",
        });
      }

      if (request.method === "GET" && path === "/api/products") {
        const rows = await db
          .select()
          .from(productsTable)
          .where(
            and(
              eq(productsTable.isHidden, false),
              isNull(productsTable.deletedAt),
            ),
          )
          .orderBy(desc(productsTable.createdAt));
        const response = json(rows.map(toProduct));

        return response;
      }

      if (request.method === "GET" && path === "/api/settings") {
        const rows = await db
          .select()
          .from(appSettingsTable)
          .where(eq(appSettingsTable.id, 1));
        const response = json(
          (rows[0]?.data as Record<string, unknown>) ?? {},
        );

        return response;
      }

      return json({ error: "Not found" }, 404);
    } finally {
      await client.end().catch(() => {});
    }

  },

  async scheduled(
    _controller: unknown,
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const { client, db } = await openDb(env);

        try {
          const purged =
            await purgeExpiredTrashedProducts(db, env);

          console.log("PRODUCT_TRASH_PURGE_COMPLETE", {
            purged,
          });
        } catch (error) {
          console.error(
            "PRODUCT_TRASH_PURGE_FAILED",
            error,
          );
          throw error;
        } finally {
          await client.end().catch(() => {});
        }
      })(),
    );
  },
};