import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { usePosRuntime } from "../app/pos-context";

// A staff user can open only an explicitly authorized POS page.
// Administrators keep their previous permissions; server APIs enforce the same staff grants.
export function canVisitStaffPage(path: string, permissions: string[]): boolean {
  const byPath: Record<string, string[]> = {
    "/sales/pos": ["sales.create"],
    "/sales/exchange": ["sales.exchange", "sales.exchange.online"],
    "/sales/mobile": ["sales.create"],
    "/sales/mobile/price-check": ["sales.create"],
    "/sales/mobile/manual-order": ["orders.create"],
    "/sales/mobile/returns": ["sales.returns"],
    "/sales/today": ["sales.view"],
    "/sales/invoice-check": ["sales.view"],
    "/cash-session": ["cash.view", "cash.open", "cash.close"],
    "/sales/orders": ["orders.view"],
    "/sales/manual-order": ["orders.create"],
    "/sales/new": ["sales.create"],
    "/sales/returns": ["sales.returns"],
    "/finance/receipts": ["vouchers.create"],
    "/purchases/history": ["purchases.view"],
    "/purchases/new": ["purchases.create"],
    "/purchases/returns": ["purchases.returns"],
    "/inventory/products": ["inventory.view"],
    "/inventory/products/new": ["inventory.edit"],
    "/inventory/stock-check": ["inventory.view"],
    "/inventory/product-card": ["inventory.view"],
    "/parties/customers": ["parties.view"],
    "/parties/suppliers": ["parties.view"],
    "/vouchers/receipt": ["vouchers.create"],
    "/vouchers/payment": ["vouchers.create"],
    "/vouchers/journal": ["vouchers.create"],
    "/vouchers/register": ["vouchers.view"],
    "/finance/expenses": ["finance.expenses.view", "finance.expenses.create"],
    "/finance/banking": ["banking.view"],
    "/finance/card-settlements": ["banking.view"],
    "/finance/checks": ["banking.view"],
    "/finance/delivery-company": ["delivery.view"],
    "/reports/financial-statements": ["reports.financial", "reports.cost"],
    "/reports/sales": ["reports.cost"],
    "/reports/inventory-valuation": ["inventory.cost"],
    "/reports/inventory-valuation-history": ["reports.cost"],
    "/reports/inventory-intelligence": ["reports.cost"],
    "/reports/product-analytics": ["reports.sales"],
    "/reports": ["reports.cost"],
    "/statements": ["reports.financial"],
    "/reports/trial-balance": ["reports.financial"],
    "/reports/receivables-liquidity": ["reports.financial"],
    "/reports/customer-balances": ["reports.financial"],
    "/reports/customer-statement": ["reports.financial"],
    "/reports/supplier-statement": ["reports.financial"],
  };
  if (path === "/purchases/new") {
    return ["purchases.view", "purchases.create"].every(p => permissions.includes(p));
  }
  if (path === "/reports/financial-statements") {
    return ["reports.financial", "reports.cost", "inventory.cost"].every(p => permissions.includes(p));
  }
  if (path === "/finance/expenses") {
    return permissions.includes("finance.expenses.view");
  }
  if (path === "/purchases/returns") {
    return ["purchases.returns", "purchases.view"].every(p => permissions.includes(p));
  }
  return (byPath[path] ?? []).some(p => permissions.includes(p));
}

const preferredStaffLandingRoutes: Array<[string, string]> = [
  ["sales.create", "/sales/pos"],
  ["sales.exchange", "/sales/exchange"],
  ["sales.exchange.online", "/sales/exchange"],
  ["reports.financial", "/reports/trial-balance"],
  ["sales.view", "/sales/today"],
  ["orders.view", "/sales/orders"],
  ["orders.create", "/sales/manual-order"],
  ["cash.view", "/cash-session"],
  ["cash.open", "/cash-session"],
  ["cash.close", "/cash-session"],
  ["inventory.view", "/inventory/product-card"],
  ["inventory.edit", "/inventory/products"],
  ["purchases.view", "/purchases/history"],
  ["purchases.create", "/purchases/new"],
  ["purchases.returns", "/purchases/returns"],
  ["parties.view", "/parties/customers"],
  ["vouchers.view", "/vouchers/register"],
  ["vouchers.create", "/vouchers/receipt"],
  ["banking.view", "/finance/banking"],
  ["delivery.view", "/finance/delivery-company"],
  ["reports.cost", "/reports"],
  ["reports.sales", "/reports/product-analytics"],
  ["finance.expenses.view", "/finance/expenses"],
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
