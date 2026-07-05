import type { Request } from "express";
import { db, usersTable, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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
