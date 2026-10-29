import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { usePosRuntime } from "../app/pos-context";

// A staff user can open only an explicitly authorized POS page.
// Administrators keep their previous permissions; server APIs enforce the same staff grants.
export function canVisitStaffPage(path: string, permissions: string[]): boolean {
  const byPath: Record<string, string[]> = {
    "/sales/pos": ["sales.create"],
    "/sales/today": ["sales.view"],
    "/sales/invoice-check": ["sales.view"],
    "/cash-session": ["cash.view", "cash.open", "cash.close"],
    "/inventory/product-card": ["inventory.view"],
  };
  return (byPath[path] ?? []).some(p => permissions.includes(p));
}

export default function RequireStaffPage({ children }: { children: ReactNode }) {
  const { user } = usePosRuntime();
  const location = useLocation();
  if (user?.isOwner || user?.isAdmin) return <>{children}</>;
  if (user && canVisitStaffPage(location.pathname, user.permissions ?? [])) return <>{children}</>;
  return <section style={{ padding: 24 }} role="alert">
    <h2>غير مصرح بالدخول</h2>
    <p>هذه الصفحة غير متاحة لصلاحيات حسابك. راجع المالك إذا كنت بحاجة إليها.</p>
  </section>;
}
