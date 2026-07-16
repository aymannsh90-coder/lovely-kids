import { appSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "./auth";
import type { Env, openDb } from "./db";

type Db = Awaited<
  ReturnType<typeof openDb>
>["db"];

const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  });

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

  const merged = {
    ...existing,
    ...partial,
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
