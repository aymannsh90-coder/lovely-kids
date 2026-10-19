import { appSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "./auth";
import type { Env, openDb } from "./db";
import { rewriteMediaUrlsForPublic } from "./media-url";
import { rewriteMediaUrlsForStorage } from "./media-url";

type Db = Awaited<
  ReturnType<typeof openDb>
>["db"];

export function sanitizePublicSettingsData(
  data: Record<string, unknown>,
) {
  const shippingZones =
    Array.isArray(data.shippingZones)
      ? data.shippingZones.map(
          (zone) => {
            if (
              !zone ||
              typeof zone !== "object" ||
              Array.isArray(zone)
            ) {
              return zone;
            }

            const publicZone = {
              ...(zone as Record<string, unknown>),
            };

            delete publicZone.companyCost;

            return publicZone;
          },
        )
      : data.shippingZones;

  return {
    ...data,
    ...(shippingZones === undefined
      ? {}
      : { shippingZones }),
  };
}

const json = (data: unknown, status = 200) =>
  Response.json(rewriteMediaUrlsForPublic(data), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  });

async function handleGetSettings(
  request: Request,
  db: Db,
  env: Env,
) {
  const rows = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.id, 1));

  const data =
    (rows[0]?.data as Record<string, unknown>) ?? {};

  const user = await getCurrentUser(
    db,
    request,
    env,
  );

  return json(
    user?.isAdmin
      ? data
      : sanitizePublicSettingsData(data),
  );
}

async function handleUpdateSettings(
  request: Request,
  db: Db,
  env: Env,
) {
  const user = await getCurrentUser(
    db,
    request,
    env,
  );

  if (!user?.isAdmin) {
    return json(
      { error: "غير مصرح لك بتعديل الإعدادات" },
      403,
    );
  }

  const partial =
    await request.json().catch(() => ({})) as
      Record<string, unknown>;

  const rows = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.id, 1));

  const existing =
    (rows[0]?.data as Record<string, unknown>) ?? {};

  const storedPartial =
    rewriteMediaUrlsForStorage(partial, env);

  const merged = {
    ...existing,
    ...storedPartial,
  };

  await db
    .insert(appSettingsTable)
    .values({
      id: 1,
      data: merged,
    })
    .onConflictDoUpdate({
      target: appSettingsTable.id,
      set: { data: merged },
    });

  return json(merged);
}

export async function handleSettingsRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (
    request.method === "GET" &&
    path === "/api/settings"
  ) {
    return handleGetSettings(
      request,
      db,
      env,
    );
  }

  if (
    request.method === "PUT" &&
    path === "/api/settings"
  ) {
    return handleUpdateSettings(
      request,
      db,
      env,
    );
  }

  return null;
}
