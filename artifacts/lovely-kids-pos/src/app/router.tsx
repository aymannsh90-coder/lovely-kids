import { Navigate, Route, Routes } from "react-router-dom";

import RequireOpenSession from "../guards/RequireOpenSession";
import RequireOwner from "../guards/RequireOwner";
import DashboardLayout from "../layouts/DashboardLayout";
import ComingSoonPage from "../pages/ComingSoonPage";
import DashboardPage from "../pages/DashboardPage";
import AdminPanelPage from "../pages/admin/AdminPanelPage";
import BankingPage from "../pages/finance/BankingPage";
import CardSettlementsPage from "../pages/finance/CardSettlementsPage";
import CashSessionPage from "../pages/finance/CashSessionPage";
import ChecksPage from "../pages/finance/ChecksPage";
import CustomerReceiptsPage from "../pages/finance/CustomerReceiptsPage";
import DeliveryCompanyAccountingPage from "../pages/finance/DeliveryCompanyAccountingPage";
import ExpensesPage from "../pages/finance/ExpensesPage";
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

export default function AppRouter() {
  return (
    <Routes>
      <Route
        path="sales/mobile/manual-order"
        element={<ManualOnlineOrderPage layout="mobile" />}
      />

      <Route
        path="sales/mobile"
        element={
          <RequireOpenSession>
            <MobileSalePage />
          </RequireOpenSession>
        }
      />

      <Route
        path="sales/mobile/returns"
        element={
          <RequireOpenSession>
            <MobileReturnsPage />
          </RequireOpenSession>
        }
      />

      <Route
        path="sales/mobile/price-check"
        element={
          <RequireOpenSession>
            <MobilePriceCheckPage />
          </RequireOpenSession>
        }
      />

      <Route
        path="sales/mobile/assistant"
        element={<MobileAssistantPage />}
      />

      <Route element={<DashboardLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="admin" element={<AdminPanelPage />} />

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

        <Route
          path="purchases/new"
          element={
            <RequireOwner>
              <PurchaseInvoicePage />
            </RequireOwner>
          }
        />

        <Route
          path="purchases/returns"
          element={
            <RequireOwner>
              <ComingSoonPage
              icon="📦"
              title="مردودات المشتريات"
              description="إرجاع أصناف إلى المورد وربطها بفاتورة الشراء."
              points={[
                "البحث بفاتورة الشراء أو باركود الصنف.",
                "اختيار الكمية المراد إرجاعها.",
                "خصم الكمية من المخزون.",
                "تحديث حساب المورد.",
              ]}
              />
            </RequireOwner>
          }
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
            <RequireOwner>
              <UnifiedPartyVoucherPage mode="receipt" />
            </RequireOwner>
          }
        />

        <Route
          path="vouchers/payment"
          element={
            <RequireOwner>
              <UnifiedPartyVoucherPage mode="payment" />
            </RequireOwner>
          }
        />

        <Route
          path="vouchers/journal"
          element={
            <RequireOwner>
              <JournalVoucherPage />
            </RequireOwner>
          }
        />

        <Route
          path="vouchers/register"
          element={
            <RequireOwner>
              <VoucherRegisterPage />
            </RequireOwner>
          }
        />

        <Route
          path="finance/expenses"
          element={
            <RequireOpenSession>
              <ExpensesPage />
            </RequireOpenSession>
          }
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
            <RequireOwner>
              <BankingPage />
            </RequireOwner>
          }
        />

        <Route
          path="finance/card-settlements"
          element={
            <RequireOwner>
              <CardSettlementsPage />
            </RequireOwner>
          }
        />

        <Route
          path="finance/checks"
          element={
            <RequireOwner>
              <ChecksPage />
            </RequireOwner>
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
            <RequireOwner>
              <StatementsPage />
            </RequireOwner>
          }
        />

        <Route
          path="reports/trial-balance"
          element={
            <RequireOwner>
              <TrialBalanceReportPage />
            </RequireOwner>
          }
        />

        <Route
          path="reports/receivables-liquidity"
          element={
            <RequireOwner>
              <ReceivablesLiquidityReportPage />
            </RequireOwner>
          }
        />

        <Route
          path="reports/financial-statements"
          element={
            <RequireOwner>
              <FinancialStatementsReportPage />
            </RequireOwner>
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
            <RequireOwner>
              <SupplierStatementReportPage />
            </RequireOwner>
          }
        />

        <Route
          path="reports/sales"
          element={
            <RequireOwner>
              <SalesAnalyticsPage />
            </RequireOwner>
          }
        />

        <Route
          path="reports/inventory-valuation"
          element={
            <RequireOwner>
              <InventoryValuationReportPage />
            </RequireOwner>
          }
        />

        <Route
          path="reports/inventory-valuation-history"
          element={
            <RequireOwner>
              <HistoricalInventoryValuationReportPage />
            </RequireOwner>
          }
        />

        <Route
          path="reports/inventory-intelligence"
          element={
            <RequireOwner>
              <InventoryIntelligenceReportPage />
            </RequireOwner>
          }
        />

        <Route
          path="reports/product-analytics"
          element={
            <RequireOwner>
              <ProductAnalyticsReportPage />
            </RequireOwner>
          }
        />

        <Route
          path="reports"
          element={
            <RequireOwner>
              <GrossProfitReportPage />
            </RequireOwner>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
