import bcrypt from "bcryptjs";
import { securityAuditLogsTable, sessionsTable, staffAccessTable, usersTable } from "@workspace/db/schema";
import { asc, desc, eq, like } from "drizzle-orm";
import { getCurrentUser, normalizePhone } from "./auth";
import { validateStaffPermissions } from "./staff-permissions";
import type { Env, openDb } from "./db";

type Db = Awaited<ReturnType<typeof openDb>>["db"];
const json = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
});
const roles = new Set(["cashier", "accountant", "inventory", "custom"]);

type StaffInput = {
  name?: string; phone?: string; password?: string;
  ownerPassword?: string; roleName?: string; permissions?: unknown; enabled?: boolean;
};

async function verifyOwner(db: Db, request: Request, env: Env, ownerPassword?: string) {
  const owner = await getCurrentUser(db, request, env);
  if (!owner?.isOwner) return { error: json({ error: "هذه العملية متاحة للمالك فقط" }, 403) } as const;
  if (typeof ownerPassword !== "string" || !ownerPassword || ownerPassword.length > 128 ||
      !owner.passwordHash || !(await bcrypt.compare(ownerPassword, owner.passwordHash))) {
    return { error: json({ error: "يرجى تأكيد كلمة مرور المالك الصحيحة" }, 401) } as const;
  }
  return { owner } as const;
}

const staffUser = (u: typeof usersTable.$inferSelect, s: typeof staffAccessTable.$inferSelect) => ({
  id: String(u.id), name: u.name, phone: u.phone,
  roleName: s.roleName, permissions: s.permissions, enabled: s.enabled,
  createdAt: s.createdAt.toISOString(),
});

export async function handleStaffAccessRequest(request: Request, db: Db, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/pos/access/")) return null;
  const actor = await getCurrentUser(db, request, env);
  if (!actor?.isOwner) return json({ error: "إدارة الصلاحيات للمالك فقط" }, 403);

  if (request.method === "GET" && path === "/api/pos/access/staff") {
    const rows = await db.select({ user: usersTable, staff: staffAccessTable })
      .from(staffAccessTable).innerJoin(usersTable, eq(staffAccessTable.userId, usersTable.id))
      .orderBy(asc(usersTable.name));
    return json(rows.map(r => staffUser(r.user, r.staff)));
  }
  if (request.method === "GET" && path === "/api/pos/access/audit") {
    const rows = await db.select().from(securityAuditLogsTable)
      .where(like(securityAuditLogsTable.action, "staff_%"))
      .orderBy(desc(securityAuditLogsTable.createdAt)).limit(200);
    return json(rows);
  }

  if (request.method === "POST" && path === "/api/pos/access/staff") {
    const body = await request.json().catch(() => null) as StaffInput | null;
    const verified = await verifyOwner(db, request, env, body?.ownerPassword);
    if ("error" in verified && verified.error !== undefined) return verified.error;
    if (!body || typeof body.name !== "string" || body.name.trim().length < 2 || body.name.trim().length > 100 ||
        typeof body.phone !== "string" || !body.phone.trim() ||
        typeof body.password !== "string" || body.password.length < 10 || body.password.length > 128 ||
        !roles.has(body.roleName ?? "") || body.enabled === false) {
      return json({ error: "تحقق من الاسم والرقم والدور وكلمة مرور الموظف (10 أحرف على الأقل)" }, 400);
    }
    const perms = validateStaffPermissions(body.permissions);
    if (!perms) return json({ error: "الصلاحيات غير صالحة" }, 400);
    const phone = normalizePhone(body.phone.trim());
    if (!/^\+?[0-9]{8,15}$/.test(phone)) return json({ error: "رقم هاتف غير صالح" }, 400);
    const found = await db.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.phone, phone)).limit(1);
    if (found.length) return json({ error: "رقم الهاتف مرتبط بحساب موجود" }, 409);
    const passwordHash = await bcrypt.hash(body.password, 12);
    try {
      const created = await db.transaction(async tx => {
        const [user] = await tx.insert(usersTable).values({
          name: body.name!.trim(), phone, passwordHash, isAdmin: false, isOwner: false,
        }).returning();
        const [access] = await tx.insert(staffAccessTable).values({
          userId: user.id, roleName: body.roleName!, permissions: perms,
          createdByUserId: verified.owner.id,
        }).returning();
        await tx.insert(securityAuditLogsTable).values({
          actorUserId: verified.owner.id, targetUserId: user.id,
          action: "staff_created", details: { roleName: access.roleName, permissions: perms },
        });
        return staffUser(user, access);
      });
      return json(created, 201);
    } catch (error) {
      // Avoid exposing constraint or database internals.
      return json({ error: "تعذر إضافة الموظف؛ تأكد من عدم تكرار رقم الهاتف" }, 409);
    }
  }

  const match = path.match(/^\/api\/pos\/access\/staff\/(\d+)$/);
  if (request.method === "PATCH" && match) {
    const targetId = Number(match[1]);
    if (!Number.isSafeInteger(targetId)) return json({ error: "رقم مستخدم غير صالح" }, 400);
    const body = await request.json().catch(() => null) as StaffInput | null;
    const verified = await verifyOwner(db, request, env, body?.ownerPassword);
    if ("error" in verified && verified.error !== undefined) return verified.error;
    if (!body) return json({ error: "بيانات غير صحيحة" }, 400);
    const perms = body.permissions === undefined ? undefined : validateStaffPermissions(body.permissions);
    if (perms === null || (body.roleName !== undefined && !roles.has(body.roleName)) ||
        (body.enabled !== undefined && typeof body.enabled !== "boolean") ||
        (body.password !== undefined && (typeof body.password !== "string" || body.password.length < 10 || body.password.length > 128))) {
      return json({ error: "التعديل يحتوي قيماً غير صالحة" }, 400);
    }
    const [existing] = await db.select({ user: usersTable, staff: staffAccessTable })
      .from(staffAccessTable).innerJoin(usersTable, eq(staffAccessTable.userId, usersTable.id))
      .where(eq(staffAccessTable.userId, targetId)).limit(1);
    if (!existing || existing.user.isOwner || existing.user.isAdmin) return json({ error: "موظف غير موجود" }, 404);
    const hash = body.password ? await bcrypt.hash(body.password, 12) : undefined;
    const updated = await db.transaction(async tx => {
      if (hash) await tx.update(usersTable).set({ passwordHash: hash }).where(eq(usersTable.id, targetId));
      const [access] = await tx.update(staffAccessTable).set({
        roleName: body.roleName ?? existing.staff.roleName,
        permissions: perms ?? existing.staff.permissions,
        enabled: body.enabled ?? existing.staff.enabled,
        updatedAt: new Date(),
      }).where(eq(staffAccessTable.userId, targetId)).returning();
      // All access changes take effect immediately, including active sessions.
      await tx.delete(sessionsTable).where(eq(sessionsTable.userId, targetId));
      await tx.insert(securityAuditLogsTable).values({
        actorUserId: verified.owner.id, targetUserId: targetId, action: "staff_updated",
        details: { previousRole: existing.staff.roleName, roleName: access.roleName,
          previousPermissions: existing.staff.permissions, permissions: access.permissions,
          enabled: access.enabled, passwordChanged: Boolean(hash) },
      });
      return access;
    });
    return json(staffUser(existing.user, updated));
  }
  return json({ error: "مسار غير موجود" }, 404);
}
