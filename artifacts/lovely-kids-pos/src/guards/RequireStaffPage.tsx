import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { usePosRuntime } from "../app/pos-context";

// A staff user can open only an explicitly authorized POS page.
// Administrators keep their previous permissions; server APIs enforce the same staff grants.
export function canVisitStaffPage(path: string, permissions: string[]): boolean {
  const byPath: Record<string, string[]> = {
    "/sales/pos": ["sales.create"],
    "/sales/manual-order": ["orders.create"],
    "/orders": ["orders.view", "orders.edit", "orders.cancel"],
    "/sales/exchange": ["sales.exchange", "sales.exchange.online"],
    "/sales/mobile": ["sales.create"],
    "/sales/mobile/price-check": ["sales.create"],
    "/sales/mobile/manual-order": ["orders.create"],
    "/sales/mobile/returns": ["sales.returns"],
    "/sales/today": ["sales.view"],
    "/sales/invoice-check": ["sales.view"],
    "/cash-session": ["cash.view", "cash.open", "cash.close"],
    "/inventory/product-card": ["inventory.view"],
    "/inventory/products": ["inventory.view", "inventory.edit"],
    "/inventory/products/new": ["inventory.edit"],
    "/inventory/stock-check": ["inventory.view", "inventory.edit"],
    "/purchases/new": ["purchases.create"],
    "/purchases/returns": ["purchases.view"],
    "/parties/customers": ["parties.view", "parties.edit"],
    "/parties/suppliers": ["parties.view", "parties.edit", "purchases.view", "purchases.create"],
    "/vouchers/receipt": ["vouchers.create"],
    "/vouchers/payment": ["vouchers.create"],
    "/vouchers/journal": ["vouchers.create"],
    "/vouchers/register": ["vouchers.view", "vouchers.void"],
    "/finance/banking": ["banking.view", "banking.create"],
    "/finance/card-settlements": ["banking.view", "banking.create"],
    "/finance/checks": ["banking.view", "banking.create"],
    "/statements": ["reports.financial"],
    "/reports/trial-balance": ["reports.financial"],
    "/reports/receivables-liquidity": ["reports.financial"],
    "/reports/customer-balances": ["reports.financial"],
    "/reports/customer-statement": ["reports.financial"],
    "/reports/supplier-statement": ["reports.financial"],
    "/reports": ["reports.cost"],
    "/reports/sales": ["reports.cost"],
    "/reports/product-analytics": ["reports.sales"],
    "/reports/inventory-intelligence": ["reports.cost"],
    "/reports/inventory-valuation": ["reports.cost", "inventory.cost"],
    "/reports/financial-statements": ["reports.financial", "reports.cost"],
  };
  const required = /^\/inventory\/products\/\d+\/edit$/.test(path)
    ? ["inventory.edit"]
    : byPath[path] ?? [];
  if (path === "/reports/financial-statements") {
    return permissions.includes("reports.financial") && permissions.includes("reports.cost");
  }
  return required.some(p => permissions.includes(p));
}

const preferredStaffLandingRoutes: Array<[string, string]> = [
  ["sales.create", "/sales/pos"],
  ["sales.exchange", "/sales/exchange"],
  ["sales.exchange.online", "/sales/exchange"],
  ["reports.financial", "/reports/trial-balance"],
  ["sales.view", "/sales/today"],
  ["cash.view", "/cash-session"],
  ["cash.open", "/cash-session"],
  ["cash.close", "/cash-session"],
  ["inventory.view", "/inventory/products"],
  ["inventory.edit", "/inventory/products"],
  ["purchases.create", "/purchases/new"],
  ["purchases.view", "/purchases/returns"],
  ["parties.view", "/parties/customers"],
  ["parties.edit", "/parties/customers"],
  ["vouchers.view", "/vouchers/register"],
  ["vouchers.void", "/vouchers/register"],
  ["vouchers.create", "/vouchers/receipt"],
  ["banking.view", "/finance/banking"],
  ["banking.create", "/finance/banking"],
  ["orders.view", "/orders"],
  ["orders.edit", "/orders"],
  ["orders.cancel", "/orders"],
  ["orders.create", "/sales/manual-order"],
  ["reports.sales", "/reports/product-analytics"],
  ["reports.cost", "/reports"],
];

export function firstAuthorizedStaffPage(permissions: string[]): string | null {
  const matching = preferredStaffLandingRoutes.find(([permission, path]) =>
    permissions.includes(permission) && canVisitStaffPage(path, permissions),
  );
  return matching?.[1] ?? null;
}

export default function RequireStaffPage({ children }: { children: ReactNode }) {
  const { user } = usePosRuntime();
  const location = useLocation();
  if (user?.isOwner || user?.isAdmin) return <>{children}</>;
  if (location.pathname === "/" && user) {
    const landing = firstAuthorizedStaffPage(user.permissions ?? []);
    if (landing) return <Navigate to={landing} replace />;
  }
  if (user && canVisitStaffPage(location.pathname, user.permissions ?? [])) return <>{children}</>;
  return <section style={{ padding: 24 }} role="alert">
    <h2>غير مصرح بالدخول</h2>
    <p>هذه الصفحة غير متاحة لصلاحيات حسابك. راجع المالك إذا كنت بحاجة إليها.</p>
  </section>;
}
