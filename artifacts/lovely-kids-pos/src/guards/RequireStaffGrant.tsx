import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { usePosRuntime } from "../app/pos-context";

// A secondary guard for pages that were owner-only. The backend still checks
// the exact request action (read/write/reversal) independently.
export default function RequireStaffGrant({
  permissions,
  children,
}: {
  permissions: string[];
  children: ReactNode;
}) {
  const { user } = usePosRuntime();
  if (user?.isOwner) return <>{children}</>;
  if (user && !user.isAdmin && user.staffEnabled &&
      permissions.some(permission => user.permissions?.includes(permission))) {
    return <>{children}</>;
  }
  return <Navigate to="/" replace />;
}
