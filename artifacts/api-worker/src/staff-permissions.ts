import { staffAccessTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import type { openDb } from "./db";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

export const STAFF_PERMISSION_KEYS = [
  "sales.view", "sales.create", "sales.edit", "sales.void", "sales.returns",
  "sales.exchange", "sales.exchange.online", "sales.exchange.void",
  "cash.view", "cash.open", "cash.close",
  "inventory.view", "inventory.edit", "inventory.cost",
  "purchases.view", "purchases.create", "purchases.edit",
  "parties.view", "parties.edit",
  "vouchers.view", "vouchers.create", "vouchers.void",
  "banking.view", "banking.create",
  "reports.sales", "reports.financial", "reports.cost",
  "orders.view", "orders.create", "orders.edit", "orders.cancel",
] as const;
export type StaffPermission = (typeof STAFF_PERMISSION_KEYS)[number];
const ALLOWED = new Set<string>(STAFF_PERMISSION_KEYS);

export function validateStaffPermissions(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > STAFF_PERMISSION_KEYS.length ||
      !value.every(p => typeof p === "string" && ALLOWED.has(p))) return null;
  return [...new Set(value)];
}

export async function getStaffAccess(db: Db, userId: number) {
  const rows = await db.select().from(staffAccessTable)
    .where(eq(staffAccessTable.userId, userId)).limit(1);
  return rows[0] ?? null;
}

export async function userHasPermission(
  db: Db,
  user: { id: number; isAdmin: boolean; isOwner: boolean },
  permission: StaffPermission,
): Promise<boolean> {
  if (user.isOwner || user.isAdmin) return true; // Existing administrators retain preexisting access.
  const staff = await getStaffAccess(db, user.id);
  return staff?.enabled === true && staff.permissions.includes(permission);
}

export async function userHasAnyPermission(
  db: Db,
  user: { id: number; isAdmin: boolean; isOwner: boolean },
  permissions: StaffPermission[],
): Promise<boolean> {
  if (user.isOwner || user.isAdmin) return true;
  const staff = await getStaffAccess(db, user.id);
  return staff?.enabled === true && permissions.some(p => staff.permissions.includes(p));
}

export async function getStaffLoginProfile(db: Db, user: { id: number; isAdmin: boolean; isOwner: boolean }) {
  if (user.isOwner || user.isAdmin) return { staffRole: null, permissions: ["*"], staffEnabled: true };
  const staff = await getStaffAccess(db, user.id);
  return {
    staffRole: staff?.roleName ?? null,
    permissions: staff?.enabled ? staff.permissions : [],
    staffEnabled: staff?.enabled ?? false,
  };
}
