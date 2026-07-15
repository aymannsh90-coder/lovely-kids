import type { Request, Response, NextFunction } from "express";
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
  const name =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim() ||
    clerkUser.primaryEmailAddress?.emailAddress ||
    "مستخدم جديد";
  const email = clerkUser.primaryEmailAddress?.emailAddress?.toLowerCase() || null;
  const avatarUrl = clerkUser.hasImage ? clerkUser.imageUrl : null;

  const rows = await db
    .insert(usersTable)
    .values({ clerkUserId, name, email, avatarUrl })
    .returning();
  return rows[0];
}

// Resolves the current user for either the legacy phone/password session
// tokens or a Clerk-authenticated request. Clerk users are JIT-provisioned
// into the local `users` table on first sight.
export async function getCurrentUser(req: Request) {
  const legacyUser = await getUserFromToken(getBearerToken(req));
  if (legacyUser) return legacyUser;

  const auth = getAuth(req);
  if (auth?.userId) {
    return await getOrCreateUserFromClerk(auth.userId);
  }
  return null;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const user = await getCurrentUser(req);

    if (!user) {
      res.status(401).json({ error: "يجب تسجيل الدخول" });
      return;
    }

    res.locals.user = user;
    next();
  } catch (error) {
    console.error("requireAuth failed", error);
    res.status(500).json({ error: "تعذر التحقق من المستخدم" });
  }
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const user = await getCurrentUser(req);

    if (!user) {
      res.status(401).json({ error: "يجب تسجيل الدخول" });
      return;
    }

    if (!user.isAdmin) {
      res.status(403).json({ error: "هذه العملية متاحة للإدارة فقط" });
      return;
    }

    res.locals.user = user;
    next();
  } catch (error) {
    console.error("requireAdmin failed", error);
    res.status(500).json({ error: "تعذر التحقق من صلاحيات الإدارة" });
  }
}
