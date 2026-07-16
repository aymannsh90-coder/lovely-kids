import { appSettingsTable, productsTable } from "@workspace/db/schema";
import { desc, eq } from "drizzle-orm";
import { openDb, type Env } from "./db";
import { handleAuthRequest } from "./auth-routes";
import { handleProductRequest } from "./product-routes";
import { handleSettingsRequest } from "./settings-routes";

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers });

function toProduct(r: typeof productsTable.$inferSelect) {
  return {
    id: String(r.id),
    name: r.name,
    nameAr: r.nameAr,
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
    isNew: r.isNew ?? false,
    discount: r.discount ?? undefined,
    description: r.description,
    stock: r.stock ?? null,
  };
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
    const { client, db } = await openDb(env);

    try {
      const authResponse = await handleAuthRequest(request, db, env);
      if (authResponse) return authResponse;

      const productResponse = await handleProductRequest(request, db, env);
      if (productResponse) return productResponse;

      const settingsResponse = await handleSettingsRequest(request, db, env);
      if (settingsResponse) return settingsResponse;
      if (path === "/api/health") {
        await client.query("select 1");
        return json({ ok: true, service: "Lovely Kids Worker API", database: "connected" });
      }

      if (request.method === "GET" && path === "/api/products") {
        const rows = await db.select().from(productsTable).orderBy(desc(productsTable.createdAt));
        return json(rows.map(toProduct));
      }

      if (request.method === "GET" && path === "/api/settings") {
        const rows = await db.select().from(appSettingsTable).where(eq(appSettingsTable.id, 1));
        return json((rows[0]?.data as Record<string, unknown>) ?? {});
      }

      return json({ error: "Not found" }, 404);
    } finally {
      await client.end().catch(() => {});
    }
  },
};
