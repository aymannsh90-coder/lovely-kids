import { Navigate, Route, Routes } from "react-router-dom";

import RequireOpenSession from "../guards/RequireOpenSession";
import RequireOwner from "../guards/RequireOwner";
import RequireStaffCapability from "../guards/RequireStaffCapability";
import RequireFinancialReports from "../guards/RequireFinancialReports";
import RequireStaffPage from "../guards/RequireStaffPage";
import DashboardLayout from "../layouts/DashboardLayout";
import ComingSoonPage from "../pages/ComingSoonPage";
import DashboardPage from "../pages/DashboardPage";
import AdminPanelPage from "../pages/admin/AdminPanelPage";
import StaffAccessPage from "../pages/admin/StaffAccessPage";
import BankingPage from "../pages/finance/BankingPage";
import CardSettlementsPage from "../pages/finance/CardSettlementsPage";
import CashSessionPage from "../pages/finance/CashSessionPage";
import ChecksPage from "../pages/finance/ChecksPage";
import CustomerReceiptsPage from "../pages/finance/CustomerReceiptsPage";
import DeliveryCompanyAccountingPage from "../pages/finance/DeliveryCompanyAccountingPage";
import ExpensesPage from "../pages/finance/ExpensesPage";
import StaffExpensesPage from "../pages/finance/StaffExpensesPage";
import { usePosRuntime } from "./pos-context";
import AssistantInboxPage from "../pages/finance/AssistantInboxPage";
import VoucherRegisterPage from "../pages/finance/VoucherRegisterPage";
import UnifiedPartyVoucherPage from "../pages/finance/UnifiedPartyVoucherPage";
import JournalVoucherPage from "../pages/finance/JournalVoucherPage";
import ProductCardPage from "../pages/inventory/ProductCardPage";
import InventoryStockPage from "../pages/inventory/InventoryStockPage";
import QuickStockCheckPage from "../pages/inventory/QuickStockCheckPage";
import ProductManagementPage from "../pages/inventory/ProductManagementPage";
import ProductEditorPage from "../pages/inventory/ProductEditorPage";
import CustomersPage from "../pages/parties/CustomersPage";
import EmployeesPage from "../pages/parties/EmployeesPage";
import SuppliersPage from "../pages/parties/SuppliersPage";
import PurchaseInvoicePage from "../pages/purchases/PurchaseInvoicePage";
import PurchaseHistoryPage from "../pages/purchases/PurchaseHistoryPage";
import PurchaseReturnsPage from "../pages/purchases/PurchaseReturnsPage";
import InvoiceLookupPage from "../pages/sales/InvoiceLookupPage";
import MobileSalePage from "../pages/sales/MobileSalePage";
import ManualOnlineOrderPage from "../pages/sales/ManualOnlineOrderPage";
import MobileReturnsPage from "../pages/sales/MobileReturnsPage";
import MobilePriceCheckPage from "../pages/sales/MobilePriceCheckPage";
import MobileAssistantPage from "../pages/sales/MobileAssistantPage";
import NewSalePage from "../pages/sales/NewSalePage";
import SalesInvoicePage from "../pages/sales/SalesInvoicePage";
import SalesReturnsPage from "../pages/sales/SalesReturnsPage";
import ExchangePage from "../pages/sales/ExchangePage";
import TodaySalesPage from "../pages/sales/TodaySalesPage";
import CustomerBalancesReportPage from "../pages/reports/CustomerBalancesReportPage";
import CustomerStatementReportPage from "../pages/reports/CustomerStatementReportPage";
import SupplierStatementReportPage from "../pages/reports/SupplierStatementReportPage";
import GrossProfitReportPage from "../pages/reports/GrossProfitReportPage";
import InventoryValuationReportPage from "../pages/reports/InventoryValuationReportPage";
import HistoricalInventoryValuationReportPage from "../pages/reports/HistoricalInventoryValuationReportPage";
import InventoryIntelligenceReportPage from "../pages/reports/InventoryIntelligenceReportPage";
import ProductAnalyticsReportPage from "../pages/reports/ProductAnalyticsReportPage";
import SalesAnalyticsPage from "../pages/reports/SalesAnalyticsPage";
import StatementsPage from "../pages/reports/StatementsPage";
import TrialBalanceReportPage from "../pages/reports/TrialBalanceReportPage";
import ReceivablesLiquidityReportPage from "../pages/reports/ReceivablesLiquidityReportPage";
import FinancialStatementsReportPage from "../pages/reports/FinancialStatementsReportPage";

function ExpensesRoute() {
  const { user } = usePosRuntime();
  return user?.isOwner || user?.isAdmin
    ? <RequireOpenSession><ExpensesPage /></RequireOpenSession>
    : <StaffExpensesPage />;
}

export default function AppRouter() {
  return (
    <Routes>
      <Route
        path="sales/mobile/manual-order"
        element={<RequireStaffPage><ManualOnlineOrderPage layout="mobile" /></RequireStaffPage>}
      />

      <Route
        path="sales/mobile"
        element={
          <RequireStaffPage><RequireOpenSession>
            <MobileSalePage />
          </RequireOpenSession></RequireStaffPage>
        }
      />

      <Route
        path="sales/mobile/returns"
        element={
          <RequireStaffPage><RequireOpenSession>
            <MobileReturnsPage />
          </RequireOpenSession></RequireStaffPage>
        }
      />

      <Route
        path="sales/mobile/price-check"
        element={
          <RequireStaffPage><RequireOpenSession>
            <MobilePriceCheckPage />
          </RequireOpenSession></RequireStaffPage>
        }
      />

      <Route
        path="sales/mobile/assistant"
        element={<RequireStaffPage><MobileAssistantPage /></RequireStaffPage>}
      />

      <Route element={<DashboardLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="admin" element={<AdminPanelPage />} />
        <Route path="access" element={<RequireOwner><StaffAccessPage /></RequireOwner>} />

        <Route
          path="sales/manual-order"
          element={<ManualOnlineOrderPage layout="desktop" />}
        />

        <Route
          path="sales/pos"
          element={
            <RequireOpenSession>
              <NewSalePage />
            </RequireOpenSession>
          }
        />

        <Route
          path="sales/exchange"
          element={
            <ExchangePage />
          }
        />

        <Route
          path="sales/new"
          element={
            <RequireOpenSession>
              <SalesInvoicePage />
            </RequireOpenSession>
          }
        />

        <Route
          path="sales/returns"
          element={
            <RequireOpenSession>
              <SalesReturnsPage />
            </RequireOpenSession>
          }
        />

        <Route path="sales/invoice-check" element={<InvoiceLookupPage />} />

        <Route
          path="sales/today"
          element={
            <RequireOpenSession>
              <TodaySalesPage />
            </RequireOpenSession>
          }
        />

        <Route path="purchases/history" element={<PurchaseHistoryPage />} />

        <Route
          path="purchases/new"
          element={
            <RequireStaffCapability capability="purchases.create" also={["purchases.view"]}>
              <PurchaseInvoicePage />
            </RequireStaffCapability>
          }
        />

        <Route
          path="purchases/returns"
          element={<RequireStaffCapability capability="purchases.returns" also={["purchases.view"]}><PurchaseReturnsPage /></RequireStaffCapability>}
        />

        <Route
          path="inventory/products"
          element={<ProductManagementPage />}
        />

        <Route
          path="inventory/products/new"
          element={<ProductEditorPage />}
        />

        <Route
          path="inventory/products/:productId/edit"
          element={<ProductEditorPage />}
        />

        <Route
          path="inventory/stock-check"
          element={<QuickStockCheckPage />}
        />

        <Route
          path="inventory/product-card"
          element={<ProductCardPage />}
        />

        <Route
          path="inventory/stock"
          element={
            <RequireOwner>
              <InventoryStockPage />
            </RequireOwner>
          }
        />

        <Route
          path="parties/customers"
          element={<CustomersPage />}
        />

        <Route
          path="parties/suppliers"
          element={<SuppliersPage />}
        />

        <Route
          path="parties/employees"
          element={
            <RequireOwner>
              <EmployeesPage />
            </RequireOwner>
          }
        />

        <Route
          path="finance/receipts"
          element={<CustomerReceiptsPage />}
        />

        <Route
          path="vouchers/receipt"
          element={
            <RequireStaffCapability capability="vouchers.create">
              <UnifiedPartyVoucherPage mode="receipt" />
            </RequireStaffCapability>
          }
        />

        <Route
          path="vouchers/payment"
          element={
            <RequireStaffCapability capability="vouchers.create">
              <UnifiedPartyVoucherPage mode="payment" />
            </RequireStaffCapability>
          }
        />

        <Route
          path="vouchers/journal"
          element={
            <RequireStaffCapability capability="vouchers.create">
              <JournalVoucherPage />
            </RequireStaffCapability>
          }
        />

        <Route
          path="vouchers/register"
          element={
            <RequireStaffCapability capability="vouchers.view">
              <VoucherRegisterPage />
            </RequireStaffCapability>
          }
        />

        <Route
          path="finance/expenses"
          element={<ExpensesRoute />}
        />

        <Route
          path="finance/assistant-inbox"
          element={
            <RequireOwner>
              <AssistantInboxPage />
            </RequireOwner>
          }
        />

        <Route
          path="finance/banking"
          element={
            <RequireStaffCapability capability="banking.view">
              <BankingPage />
            </RequireStaffCapability>
          }
        />

        <Route
          path="finance/card-settlements"
          element={
            <RequireStaffCapability capability="banking.view">
              <CardSettlementsPage />
            </RequireStaffCapability>
          }
        />

        <Route
          path="finance/checks"
          element={
            <RequireStaffCapability capability="banking.view">
              <ChecksPage />
            </RequireStaffCapability>
          }
        />

        <Route path="cash-session" element={<CashSessionPage />} />

        <Route
          path="finance/delivery-company"
          element={<DeliveryCompanyAccountingPage />}
        />

        <Route
          path="statements"
          element={
            <RequireFinancialReports>
              <StatementsPage />
            </RequireFinancialReports>
          }
        />

        <Route
          path="reports/trial-balance"
          element={
            <RequireFinancialReports>
              <TrialBalanceReportPage />
            </RequireFinancialReports>
          }
        />

        <Route
          path="reports/receivables-liquidity"
          element={
            <RequireFinancialReports>
              <ReceivablesLiquidityReportPage />
            </RequireFinancialReports>
          }
        />

        <Route
          path="reports/financial-statements"
          element={
            <RequireStaffCapability capability="reports.financial" also={["reports.cost","inventory.cost"]}>
              <FinancialStatementsReportPage />
            </RequireStaffCapability>
          }
        />

        <Route
          path="reports/customer-balances"
          element={<CustomerBalancesReportPage />}
        />

        <Route
          path="reports/customer-statement"
          element={<CustomerStatementReportPage />}
        />

        <Route
          path="reports/supplier-statement"
          element={
            <RequireFinancialReports>
              <SupplierStatementReportPage />
            </RequireFinancialReports>
          }
        />

        <Route
          path="reports/sales"
          element={
            <RequireStaffCapability capability="reports.cost">
              <SalesAnalyticsPage />
            </RequireStaffCapability>
          }
        />

        <Route
          path="reports/inventory-valuation"
          element={
            <RequireStaffCapability capability="inventory.cost">
              <InventoryValuationReportPage />
            </RequireStaffCapability>
          }
        />

        <Route
          path="reports/inventory-valuation-history"
          element={
            <RequireStaffCapability capability="reports.cost">
              <HistoricalInventoryValuationReportPage />
            </RequireStaffCapability>
          }
        />

        <Route
          path="reports/inventory-intelligence"
          element={
            <RequireStaffCapability capability="reports.cost">
              <InventoryIntelligenceReportPage />
            </RequireStaffCapability>
          }
        />

        <Route
          path="reports/product-analytics"
          element={
            <RequireStaffCapability capability="reports.sales">
              <ProductAnalyticsReportPage />
            </RequireStaffCapability>
          }
        />

        <Route
          path="reports"
          element={
            <RequireStaffCapability capability="reports.cost">
              <GrossProfitReportPage />
            </RequireStaffCapability>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
