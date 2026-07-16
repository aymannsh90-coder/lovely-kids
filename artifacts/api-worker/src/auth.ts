import { sessionsTable, usersTable } from "@workspace/db/schema";
import { eq, or } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { getClerkUser, getClerkUserId } from "./clerk";
import { openDb, type Env } from "./db";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

export function normalizePhone(raw: string) {
  return raw
    .replace(/[\u0660-\u0669]/g, (c) =>
      String(c.codePointAt(0)! - 0x0660),
    )
    .replace(/[\s\-().]/g, "");
}

export function hashSessionToken(token: string) {
  const hash = createHash("sha256").update(token).digest("hex");
  return `sha256:${hash}`;
}

export function generateToken() {
  return randomBytes(32).toString("hex");
}

export function getBearerToken(request: Request) {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length);
}

export function toUser(user: typeof usersTable.$inferSelect) {
  return {
    id: String(user.id),
    phone: user.phone,
    email: user.email,
    name: user.name,
    isAdmin: user.isAdmin,
    avatarUrl: user.avatarUrl,
    deliveryAddress: user.deliveryAddress,
  };
}

export async function getUserFromToken(
  db: Db,
  token: string | undefined,
) {
  if (!token) return null;

  const hashed = hashSessionToken(token);
  const legacy = /^[a-f0-9]{64}$/i.test(token);

  const rows = await db
    .select()
    .from(sessionsTable)
    .where(
      legacy
        ? or(
            eq(sessionsTable.token, hashed),
            eq(sessionsTable.token, token),
          )
        : eq(sessionsTable.token, hashed),
    )
    .limit(1);

  const session = rows[0];
  if (!session) return null;

  if (legacy && session.token === token) {
    await db
      .update(sessionsTable)
      .set({ token: hashed })
      .where(eq(sessionsTable.token, token));
  }

  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, session.userId))
    .limit(1);

  return users[0] ?? null;
}

export async function getCurrentUser(
  db: Db,
  request: Request,
  env: Env,
) {
  const localUser = await getUserFromToken(
    db,
    getBearerToken(request),
  );

  if (localUser) return localUser;

  const clerkUserId = await getClerkUserId(request, env);
  if (!clerkUserId) return null;

  return getOrCreateUserFromClerk(db, clerkUserId, env);
}

async function getOrCreateUserFromClerk(
  db: Db,
  clerkUserId: string,
  env: Env,
) {
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);

  if (existing[0]) return existing[0];

  const clerkUser = await getClerkUser(
    clerkUserId,
    env,
  );

  if (!clerkUser) return null;

  const name =
    [clerkUser.firstName, clerkUser.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    clerkUser.primaryEmailAddress?.emailAddress ||
    "مستخدم جديد";

  const email =
    clerkUser.primaryEmailAddress?.emailAddress
      ?.toLowerCase() ?? null;

  const avatarUrl = clerkUser.hasImage
    ? clerkUser.imageUrl
    : null;

  const rows = await db
    .insert(usersTable)
    .values({
      clerkUserId,
      name,
      email,
      avatarUrl,
    })
    .returning();

  return rows[0] ?? null;
}
