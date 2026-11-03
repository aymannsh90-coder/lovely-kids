import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { usePosRuntime } from "../app/pos-context";

type Props = { children: ReactNode; capability: string; also?: string[] };

/** Preserves legacy owner-only restrictions for existing Admin accounts. */
export default function RequireStaffCapability({ children, capability, also = [] }: Props) {
  const { user } = usePosRuntime();
  if (user?.isOwner) return <>{children}</>;
  if (!user?.isAdmin && user?.staffEnabled && [capability, ...also].every(p => user.permissions?.includes(p))) {
    return <>{children}</>;
  }
  return <Navigate to="/" replace />;
}
