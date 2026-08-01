import { Navigate, Route, Routes } from "react-router-dom";

import RequireOpenSession from "../guards/RequireOpenSession";
import DashboardLayout from "../layouts/DashboardLayout";
import ComingSoonPage from "../pages/ComingSoonPage";
import DashboardPage from "../pages/DashboardPage";
import CashSessionPage from "../pages/finance/CashSessionPage";
import InvoiceLookupPage from "../pages/sales/InvoiceLookupPage";
import NewSalePage from "../pages/sales/NewSalePage";
import SalesInvoicePage from "../pages/sales/SalesInvoicePage";
import SalesReturnsPage from "../pages/sales/SalesReturnsPage";
import TodaySalesPage from "../pages/sales/TodaySalesPage";

export default function AppRouter() {
  return (
    <Routes>
      <Route element={<DashboardLayout />}>
        <Route index element={<DashboardPage />} />

        <Route
          path="sales/pos"
          element={
            <RequireOpenSession>
              <NewSalePage />
            </RequireOpenSession>
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
            <ComingSoonPage
              icon="🛒"
              title="فاتورة مشتريات"
              description="تسجيل مشتريات الموردين وإضافة الكميات إلى المخزون."
              points={[
                "اختيار المورد أو إضافته.",
                "إدخال الأصناف والكميات والتكلفة.",
                "تحديث المخزون بشكل ذري.",
                "تسجيل طريقة الدفع والرصيد المستحق.",
              ]}
            />
          }
        />

        <Route
          path="purchases/returns"
          element={
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
          }
        />

        <Route
          path="inventory/products"
          element={
            <ComingSoonPage
              icon="👕"
              title="الأصناف"
              description="إدارة الأصناف والأسعار والباركود والمتغيرات."
              points={[
                "إضافة وتعديل الأصناف.",
                "باركود أساسي وباركودات متعددة.",
                "ألوان ومقاسات ومخزون دقيق.",
                "أسعار البيع والتكلفة.",
              ]}
            />
          }
        />

        <Route
          path="inventory/stock"
          element={
            <ComingSoonPage
              icon="🏬"
              title="المخزون"
              description="عرض الكميات وحركات المخزون والتسويات."
              points={[
                "رصيد كل صنف ومتغير.",
                "حركات البيع والشراء والمردودات.",
                "تسويات الجرد.",
                "تنبيهات انخفاض المخزون.",
              ]}
            />
          }
        />

        <Route
          path="parties/customers"
          element={
            <ComingSoonPage
              icon="👨‍👩‍👧"
              title="الزبائن"
              description="بيانات الزبائن وفواتيرهم وأرصدتهم."
              points={[
                "بيانات التواصل.",
                "سجل المشتريات والمردودات.",
                "الأرصدة والمدفوعات.",
                "ملاحظات خاصة بالزبون.",
              ]}
            />
          }
        />

        <Route
          path="parties/suppliers"
          element={
            <ComingSoonPage
              icon="🚚"
              title="الموردون"
              description="إدارة الموردين والمشتريات والحسابات."
              points={[
                "بيانات المورد.",
                "فواتير المشتريات والمردودات.",
                "الأرصدة والدفعات.",
                "الشيكات ومواعيد الاستحقاق.",
              ]}
            />
          }
        />

        <Route
          path="finance/expenses"
          element={
            <RequireOpenSession>
              <ComingSoonPage
                icon="💸"
                title="مصروفات اليوم"
                description="تسجيل كل مبلغ يخرج من الصندوق."
                points={[
                  "قيمة المصروف وتصنيفه.",
                  "السبب والملاحظات.",
                  "الموظف ووقت التسجيل.",
                  "خصمه من الرصيد المتوقع.",
                ]}
              />
            </RequireOpenSession>
          }
        />

        <Route
          path="finance/checks"
          element={
            <ComingSoonPage
              icon="📝"
              title="الشيكات"
              description="متابعة الشيكات المستلمة والمدفوعة."
              points={[
                "رقم الشيك والبنك.",
                "صاحب الشيك والمستفيد.",
                "تاريخ الاستحقاق والحالة.",
                "ربطه بزبون أو مورد.",
              ]}
            />
          }
        />

        <Route path="cash-session" element={<CashSessionPage />} />

        <Route
          path="reports"
          element={
            <ComingSoonPage
              icon="📊"
              title="التقارير"
              description="مركز موحد لجميع تقارير النظام."
              points={[
                "تقارير المبيعات والمردودات.",
                "تقارير المشتريات والموردين.",
                "تقارير المخزون والأصناف.",
                "تقارير الصندوق والمصروفات والشيكات.",
              ]}
            />
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
