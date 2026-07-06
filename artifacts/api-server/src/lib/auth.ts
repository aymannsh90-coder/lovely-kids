import type { Request } from "express";
import { db, usersTable, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAuth, clerkClient } from "@clerk/express";

export function getBearerToken(req: Request) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length);
}

export async function getUserFromToken(token: string | undefined) {
  if (!token) return null;
  const sessions = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.token, token));
  const session = sessions[0];
  if (!session) return null;
  const users = await db.select().from(usersTable).where(eq(usersTable.id, session.userId));
  return users[0] ?? null;
}

async function getOrCreateUserFromClerk(clerkUserId: string) {
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId));
  if (existing[0]) return existing[0];

  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const isAppleUser = clerkUser.externalAccounts.some(
    (account) => account.provider === "apple"
  );
  const name =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim() ||
    clerkUser.primaryEmailAddress?.emailAddress ||
    (isAppleUser ? "مستخدم آبل" : "مستخدم جديد");
  const avatarUrl = clerkUser.hasImage ? clerkUser.imageUrl : null;

  const rows = await db
    .insert(usersTable)
    .values({ clerkUserId, name, avatarUrl })
    .returning();
  return rows[0];
}

// Resolves the current user for either the legacy phone/password session
// tokens or a Clerk-authenticated request (Google sign-in). Clerk users are
// JIT-provisioned into the local `users` table on first sight so the rest of
// the app (orders, admin flag, etc.) can keep treating everyone uniformly.
export async function getCurrentUser(req: Request) {
  const legacyUser = await getUserFromToken(getBearerToken(req));
  if (legacyUser) return legacyUser;

  const auth = getAuth(req);
  if (auth?.userId) {
    return await getOrCreateUserFromClerk(auth.userId);
  }
  return null;
}
