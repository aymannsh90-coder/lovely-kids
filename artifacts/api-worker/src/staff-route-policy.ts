import type { openDb } from "./db";
import { userHasPermission, type StaffPermission } from "./staff-permissions";

type Db = Awaited<ReturnType<typeof openDb>>["db"];
type User = { id: number; isOwner: boolean; isAdmin: boolean };

/**
 * An allowlist for endpoints which were historically owner-only.
 * Preserve owner access and explicitly reject legacy administrator accounts.
 * Staff grants must match BOTH the HTTP method and exact endpoint (or an
 * explicitly supplied anchored regex). No implied write or reverse privilege.
 */
export type StaffRouteGrant = {
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  permission: StaffPermission;
  path?: string;
  pattern?: RegExp;
};

export function resolveStaffRouteGrant(request: Request, rules: readonly StaffRouteGrant[]): StaffPermission | null {
  const path = new URL(request.url).pathname;
  const rule = rules.find(r =>
    r.method === request.method &&
    (r.path === path || (r.pattern !== undefined && r.pattern.test(path))),
  );
  return rule?.permission ?? null;
}

export async function canAccessOwnerOnlyStaffRoute(
  db: Db,
  user: User,
  request: Request,
  rules: readonly StaffRouteGrant[],
): Promise<boolean> {
  if (user.isOwner) return true;
  if (user.isAdmin) return false;
  const permission = resolveStaffRouteGrant(request, rules);
  return permission !== null && userHasPermission(db, user, permission);
}
