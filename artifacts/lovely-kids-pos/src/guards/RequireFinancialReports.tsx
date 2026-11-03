import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { usePosRuntime } from "../app/pos-context";

// These were formerly owner-only screens. Preserve that restriction for
// preexisting admin accounts; only an owner-managed staff grant opens them.
export default function RequireFinancialReports({ children }: { children: ReactNode }) {
  const { user } = usePosRuntime();
  if (user?.isOwner) return <>{children}</>;
  if (!user?.isAdmin && user?.staffEnabled && user?.permissions?.includes("reports.financial")) {
    return <>{children}</>;
  }
  return <Navigate to="/" replace />;
}
