import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";

import { usePosRuntime } from "../../app/pos-context";
import "./FinanceVisualRefresh.css";
import {
  ApiError,
  getCurrentCashSession,
  getDeliveryCompanies,
  getPosCustomers,
  getPosEmployees,
  getPosExpenseCategories,
  getPosFinanceVouchers,
  getPosSuppliers,
  POS_REGISTER_KEY,
  replacePosUnifiedVoucher,
  voidPosFinanceVoucher,
  type PosCustomer,
  type PosDeliveryCompany,
  type PosEmployee,
  type PosExpenseCategory,
  type PosFinanceVoucher,
  type PosSupplier,
} from "../../lib/api";

function formatMinor(value: number) {
  return `${new Intl.NumberFormat("ar", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100)} ₪`;
}

function formatCurrencyMinor(
  value: number,
  currencyCode: string,
) {
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100)} ${currencyCode}`;
}

function foreignReceiptBaseMinor(
  voucher: PosFinanceVoucher,
) {
  if (
    voucher.currencyCode ===
      "ILS" ||
    voucher.transactionAmountMinor ===
      null
  ) {
    return null;
  }

  return Math.round(
    (
      voucher.transactionAmountMinor *
      voucher.exchangeRateMicros
    ) /
      1_000_000,
  );
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "حدث خطأ غير متوقع";
}

function voucherLabel(voucher: PosFinanceVoucher) {
  if (voucher.voucherPurpose === "customer_receipt") {
    return "سند قبض / دفعة زبون";
  }

  if (voucher.voucherPurpose === "employee_repayment") {
    return "سند قبض / تسديد سلفة موظف";
  }

  if (voucher.voucherPurpose === "supplier_refund") {
    return "سند قبض / إرجاع من مورد";
  }

  if (voucher.voucherPurpose === "delivery_company_settlement") {
    return "سند قبض / شركة توصيل";
  }

  if (voucher.voucherPurpose === "customer_cash_loan") {
    return "سند صرف / زبون على الحساب";
  }

  if (voucher.voucherPurpose === "employee_advance") {
    return "سند صرف / سلفة موظف";
  }

  if (voucher.voucherPurpose === "employee_payment") {
    return "سند صرف / مستحقات موظف";
  }

  if (voucher.voucherPurpose === "supplier_payment") {
    return "سند صرف / مورد";
  }

  if (voucher.voucherPurpose === "account_transfer") {
    return "سند قيد / نقل بين حسابات";
  }

  switch (voucher.voucherType) {
    case "customer_receipt":
      return "سند قبض زبون";
    case "expense":
      return "سند صرف / مصروف";
    case "employee_advance":
      return "سند صرف / سلفة موظف";
    case "employee_repayment":
      return "سند قبض / تسديد موظف";
    case "salary_accrual":
      return "قيد استحقاق راتب";
    case "employee_payment":
      return "سند صرف / مستحقات موظف";
    case "owner_withdrawal":
      return "سند صرف / سحب مالك";
    case "adjustment":
      return "سند قيد / تسوية";
    case "receipt":
      return "سند قبض";
    case "payment":
      return "سند صرف";
    case "journal":
      return "سند قيد";
    default:
      return voucher.voucherType;
  }
}

function paymentLabel(method: PosFinanceVoucher["paymentMethod"]) {
  if (method === "cash") {
    return "كاش";
  }

  if (method === "card") {
    return "بطاقة";
  }

  if (method === "bank") {
    return "بنك";
  }

  return "قيد داخلي";
}

export default function VoucherRegisterPage() {
  const navigate = useNavigate();

  const {
    token,
    user,
    setSession,
    clearAuthentication,
  } = usePosRuntime();

  const [vouchers, setVouchers] =
    useState<PosFinanceVoucher[]>([]);
  const [customers, setCustomers] =
    useState<PosCustomer[]>([]);
  const [employees, setEmployees] =
    useState<PosEmployee[]>([]);
  const [suppliers, setSuppliers] =
    useState<PosSupplier[]>([]);
  const [deliveryCompanies, setDeliveryCompanies] =
    useState<PosDeliveryCompany[]>([]);
  const [expenseCategories, setExpenseCategories] =
    useState<PosExpenseCategory[]>([]);

  const [query, setQuery] = useState("");
  const [kind, setKind] =
    useState<"all" | "receipt" | "payment" | "journal">("all");
  const [status, setStatus] =
    useState<"all" | "posted" | "voided">("all");

  const [loading, setLoading] =
    useState(true);
  const [voidingId, setVoidingId] =
    useState<number | null>(null);
  const [editingId, setEditingId] =
    useState<number | null>(null);
  const [error, setError] =
    useState("");
  const [message, setMessage] =
    useState("");

  async function load() {
    setLoading(true);
    setError("");

    try {
      const [
        voucherResult,
        customerResult,
        employeeResult,
      ] =
        await Promise.all([
          getPosFinanceVouchers(token),
          getPosCustomers(token),
          getPosEmployees(token),
        ]);

      const [
        supplierResult,
        deliveryResult,
        expenseResult,
      ] =
        await Promise.allSettled([
          getPosSuppliers(token),
          getDeliveryCompanies(token),
          getPosExpenseCategories(token),
        ]);

      setVouchers(voucherResult.results);
      setCustomers(customerResult.results);
      setEmployees(employeeResult.results);

      setSuppliers(
        supplierResult.status === "fulfilled"
          ? supplierResult.value.results
          : [],
      );

      setDeliveryCompanies(
        deliveryResult.status === "fulfilled"
          ? deliveryResult.value
          : [],
      );

      setExpenseCategories(
        expenseResult.status === "fulfilled"
          ? expenseResult.value.results
          : [],
      );
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setError(errorText(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const customerById = useMemo(
    () =>
      new Map(
        customers.map((customer) => [
          customer.id,
          customer,
        ]),
      ),
    [customers],
  );

  const employeeById = useMemo(
    () =>
      new Map(
        employees.map((employee) => [
          employee.id,
          employee,
        ]),
      ),
    [employees],
  );


  const supplierById = useMemo(
    () =>
      new Map(
        suppliers.map((supplier) => [
          Number(supplier.id),
          supplier,
        ]),
      ),
    [suppliers],
  );

  const deliveryCompanyById = useMemo(
    () =>
      new Map(
        deliveryCompanies.map((company) => [
          company.id,
          company,
        ]),
      ),
    [deliveryCompanies],
  );

  const expenseCategoryById = useMemo(
    () =>
      new Map(
        expenseCategories.map((category) => [
          category.id,
          category,
        ]),
      ),
    [expenseCategories],
  );

  function partyLabel(voucher: PosFinanceVoucher) {
    if (
      voucher.partyType === "customer" &&
      voucher.partyId !== null
    ) {
      return (
        customerById.get(voucher.partyId)?.name ??
        `زبون #${voucher.partyId}`
      );
    }

    if (
      voucher.partyType === "employee" &&
      voucher.partyId !== null
    ) {
      return (
        employeeById.get(voucher.partyId)?.name ??
        `موظف #${voucher.partyId}`
      );
    }

    if (
      voucher.partyType === "supplier" &&
      voucher.partyId !== null
    ) {
      return (
        supplierById.get(voucher.partyId)?.name ??
        `مورد #${voucher.partyId}`
      );
    }

    if (
      voucher.partyType === "delivery_company" &&
      voucher.partyId !== null
    ) {
      return (
        deliveryCompanyById.get(voucher.partyId)?.name ??
        `شركة توصيل #${voucher.partyId}`
      );
    }

    if (
      voucher.partyType === "owner"
    ) {
      return "المالك";
    }

    if (
      voucher.expenseCategoryId !== null
    ) {
      return (
        expenseCategoryById.get(
          voucher.expenseCategoryId,
        )?.name ?? "مصروف"
      );
    }

    return "—";
  }

  function normalizedKind(
    voucher: PosFinanceVoucher,
  ) {
    if (
      voucher.voucherType === "customer_receipt" ||
      voucher.voucherType === "employee_repayment" ||
      voucher.voucherType === "receipt"
    ) {
      return "receipt";
    }

    if (
      voucher.voucherType === "expense" ||
      voucher.voucherType === "employee_advance" ||
      voucher.voucherType === "employee_payment" ||
      voucher.voucherType === "owner_withdrawal" ||
      voucher.voucherType === "payment"
    ) {
      return "payment";
    }

    return "journal";
  }

  const visible = useMemo(() => {
    const normalized =
      query.trim().toLowerCase();

    return vouchers.filter((voucher) => {
      if (
        status !== "all" &&
        voucher.status !== status
      ) {
        return false;
      }

      if (
        kind !== "all" &&
        normalizedKind(voucher) !== kind
      ) {
        return false;
      }

      if (!normalized) {
        return true;
      }

      return [
        voucher.publicId,
        voucher.businessDate,
        voucher.notes ?? "",
        voucherLabel(voucher),
        partyLabel(voucher),
        String(voucher.amountMinor / 100),
      ].some((value) =>
        value
          .toLowerCase()
          .includes(normalized),
      );
    });
  }, [
    vouchers,
    query,
    kind,
    status,
    customerById,
    employeeById,
    supplierById,
    deliveryCompanyById,
    expenseCategoryById,
  ]);

  function openPrintDocument(
    html: string,
    width = 1100,
    height = 850,
  ) {
    const printWindow =
      window.open(
        "",
        "_blank",
        `width=${width},height=${height}`,
      );

    if (!printWindow) {
      setError(
        "تعذر فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.",
      );
      return;
    }

    printWindow.opener = null;
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();

    const runPrint = () => {
      printWindow.focus();
      printWindow.print();
    };

    if (
      printWindow.document.readyState ===
      "complete"
    ) {
      window.setTimeout(
        runPrint,
        100,
      );
    } else {
      printWindow.addEventListener(
        "load",
        () =>
          window.setTimeout(
            runPrint,
            100,
          ),
        { once: true },
      );
    }
  }

  function printVoucher(
    voucher: PosFinanceVoucher,
  ) {
    const party =
      partyLabel(
        voucher,
      );

    const generatedAt =
      new Date().toLocaleString(
        "ar-PS",
        {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        },
      );

    const foreignDetail =
      voucher.currencyCode !==
        "ILS" &&
      voucher.transactionAmountMinor !==
        null
        ? `
          <tr>
            <th>المبلغ المستلم بالعملة</th>
            <td>${escapeHtml(
              formatCurrencyMinor(
                voucher.transactionAmountMinor,
                voucher.currencyCode,
              ),
            )}</td>
          </tr>
          <tr>
            <th>سعر الصرف</th>
            <td>${escapeHtml(
              (
                voucher.exchangeRateMicros /
                1_000_000
              ).toFixed(6),
            )}</td>
          </tr>
        `
        : "";

    openPrintDocument(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(voucherLabel(voucher))} - ${escapeHtml(voucher.publicId)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, Tahoma, sans-serif;
      color: #111827;
      background: #fff;
    }
    .sheet {
      width: 100%;
      max-width: 185mm;
      margin: 0 auto;
      padding: 8mm;
    }
    .head {
      text-align: center;
      margin-bottom: 8mm;
    }
    .brand {
      color: #E91E8C;
      font-size: 20px;
      font-weight: 800;
    }
    h1 {
      margin: 2mm 0 1mm;
      font-size: 24px;
    }
    .sub {
      color: #6b7280;
      font-size: 11px;
    }
    .voucher-id {
      margin: 5mm auto;
      border: 2px solid #111827;
      padding: 3mm 5mm;
      width: fit-content;
      direction: ltr;
      font-size: 16px;
      font-weight: 800;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      border: 1px solid #cfd8df;
      padding: 4mm;
      vertical-align: middle;
    }
    th {
      width: 34%;
      background: #f3f4f6;
      text-align: right;
    }
    td {
      font-weight: 600;
    }
    .amount {
      font-size: 22px;
      font-weight: 900;
      direction: ltr;
      text-align: center;
    }
    .notes {
      min-height: 22mm;
      white-space: pre-wrap;
    }
    .status-voided {
      color: #b42318;
      font-weight: 900;
    }
    .footer {
      margin-top: 10mm;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18mm;
    }
    .signature {
      padding-top: 12mm;
      border-top: 1px solid #6b7280;
      text-align: center;
      font-size: 11px;
    }
    .system-footer {
      margin-top: 10mm;
      color: #6b7280;
      text-align: center;
      font-size: 9px;
    }
    @page {
      size: A4 portrait;
      margin: 12mm 9mm;
    }
    @media print {
      .sheet {
        max-width: none;
        padding: 0;
      }
    }
  </style>
</head>
<body>
  <main class="sheet">
    <header class="head">
      <div class="brand">Lovely Kids</div>
      <h1>${escapeHtml(voucherLabel(voucher))}</h1>
      <div class="sub">تاريخ الطباعة: ${escapeHtml(generatedAt)}</div>
      <div class="voucher-id">${escapeHtml(voucher.publicId)}</div>
    </header>

    <table>
      <tbody>
        <tr>
          <th>التاريخ</th>
          <td>${escapeHtml(voucher.businessDate)}</td>
        </tr>
        <tr>
          <th>الطرف / الحساب</th>
          <td>${escapeHtml(party)}</td>
        </tr>
        <tr>
          <th>المبلغ</th>
          <td class="amount">${escapeHtml(formatMinor(voucher.amountMinor))}</td>
        </tr>
        <tr>
          <th>طريقة الحركة</th>
          <td>${escapeHtml(paymentLabel(voucher.paymentMethod))}</td>
        </tr>
        ${foreignDetail}
        <tr>
          <th>الحالة</th>
          <td class="${voucher.status === "voided" ? "status-voided" : ""}">
            ${voucher.status === "posted" ? "فعال" : "ملغى"}
          </td>
        </tr>
        ${voucher.voidReason ? `
          <tr>
            <th>سبب الإلغاء</th>
            <td>${escapeHtml(voucher.voidReason)}</td>
          </tr>
        ` : ""}
        <tr>
          <th>البيان / الملاحظات</th>
          <td class="notes">${escapeHtml(voucher.notes ?? "—")}</td>
        </tr>
      </tbody>
    </table>

    <div class="footer">
      <div class="signature">توقيع المستلم / الطرف</div>
      <div class="signature">توقيع المسؤول</div>
    </div>

    <div class="system-footer">
      سند صادر من نظام Lovely Kids — محفوظ ضمن سجل التدقيق المحاسبي.
    </div>
  </main>
</body>
</html>`);
  }

  function printRegister() {
    const generatedAt =
      new Date().toLocaleString(
        "ar-PS",
        {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        },
      );

    const rows =
      visible
        .map(
          (voucher) => `
            <tr>
              <td dir="ltr">${escapeHtml(voucher.publicId)}</td>
              <td>${escapeHtml(voucherLabel(voucher))}</td>
              <td>${escapeHtml(voucher.businessDate)}</td>
              <td>${escapeHtml(partyLabel(voucher))}</td>
              <td class="money">${escapeHtml(formatMinor(voucher.amountMinor))}</td>
              <td>${escapeHtml(paymentLabel(voucher.paymentMethod))}</td>
              <td>${voucher.status === "posted" ? "فعال" : "ملغى"}</td>
              <td>${escapeHtml(voucher.notes ?? "—")}</td>
            </tr>
          `,
        )
        .join("");

    openPrintDocument(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>سجل السندات - Lovely Kids</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, Tahoma, sans-serif;
      color: #111827;
      font-size: 9px;
    }
    .head {
      text-align: center;
      margin-bottom: 5mm;
    }
    .brand {
      color: #E91E8C;
      font-size: 17px;
      font-weight: 800;
    }
    h1 {
      margin: 1mm 0;
      font-size: 20px;
    }
    .meta {
      color: #6b7280;
      margin-top: 1mm;
    }
    table {
      width: 100%;
      table-layout: fixed;
      border-collapse: collapse;
    }
    thead { display: table-header-group; }
    th, td {
      border: 1px solid #9ca3af;
      padding: 1.8mm 1.2mm;
      text-align: center;
      vertical-align: middle;
      overflow-wrap: anywhere;
    }
    th {
      background: #f3f4f6;
      font-weight: 800;
    }
    tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .money {
      direction: ltr;
      white-space: nowrap;
    }
    .footer {
      margin-top: 4mm;
      padding-top: 2mm;
      border-top: 1px solid #cfd8df;
      color: #6b7280;
      text-align: center;
    }
    @page {
      size: A4 landscape;
      margin: 12mm 9mm;
    }
  </style>
</head>
<body>
  <header class="head">
    <div class="brand">Lovely Kids</div>
    <h1>سجل السندات</h1>
    <div class="meta">
      عدد السندات: ${visible.length}
      · نوع الفلتر: ${escapeHtml(kind)}
      · الحالة: ${escapeHtml(status)}
    </div>
    <div class="meta">تاريخ إصدار التقرير: ${escapeHtml(generatedAt)}</div>
  </header>

  <table>
    <thead>
      <tr>
        <th style="width:13%">رقم السند</th>
        <th style="width:15%">النوع</th>
        <th style="width:9%">التاريخ</th>
        <th style="width:13%">الطرف</th>
        <th style="width:11%">المبلغ</th>
        <th style="width:9%">الطريقة</th>
        <th style="width:8%">الحالة</th>
        <th style="width:22%">البيان</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="8">لا توجد سندات مطابقة.</td></tr>'}
    </tbody>
  </table>

  <div class="footer">
    تقرير صادر من نظام Lovely Kids — سجل السندات حسب الفلاتر الحالية.
  </div>
</body>
</html>`);
  }

  async function handleEdit(
    voucher: PosFinanceVoucher,
  ) {
    if (!user?.isOwner) {
      setError(
        "تعديل السندات متاح للمالك فقط.",
      );
      return;
    }

    if (
      voucher.status !== "posted" ||
      (
        voucher.voucherType !== "receipt" &&
        voucher.voucherType !== "payment" &&
        voucher.voucherType !== "journal"
      )
    ) {
      return;
    }

    const amount =
      window.prompt(
        `المبلغ الجديد للسند ${voucher.publicId}:`,
        (voucher.amountMinor / 100).toFixed(2),
      );

    if (amount === null) {
      return;
    }

    const numericAmount =
      Number(
        amount
          .trim()
          .replace(",", "."),
      );

    if (
      !Number.isFinite(numericAmount) ||
      numericAmount <= 0
    ) {
      setError(
        "أدخل مبلغًا صحيحًا أكبر من صفر.",
      );
      return;
    }

    const notes =
      window.prompt(
        "البيان / الملاحظات الجديدة:",
        voucher.notes ?? "",
      );

    if (notes === null) {
      return;
    }

    const confirmed =
      window.confirm(
        "سيبقى نفس الطرف ونفس الصندوق/البنك ونفس نوع الحركة. سيتم إلغاء السند الحالي وإنشاء سند بديل داخل عملية محاسبية واحدة. متابعة؟",
      );

    if (!confirmed) {
      return;
    }

    setEditingId(voucher.id);
    setError("");
    setMessage("");

    try {
      const result =
        await replacePosUnifiedVoucher(
          token,
          voucher.id,
          {
            amount:
              numericAmount.toFixed(2),
            notes:
              notes.trim(),
            idempotencyKey:
              `voucher_replace:${voucher.id}:${crypto.randomUUID()}`,
          },
        );

      const sessionResult =
        await getCurrentCashSession(
          token,
          POS_REGISTER_KEY,
        ).catch(() => null);

      if (sessionResult) {
        setSession(
          sessionResult.session,
        );
      }

      await load();

      setMessage(
        `تم تعديل ${voucher.publicId} بأمان وإصدار السند البديل ${result.replacementVoucher.publicId}.`,
      );
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setError(
        errorText(caught),
      );
    } finally {
      setEditingId(null);
    }
  }

  async function handleVoid(
    voucher: PosFinanceVoucher,
  ) {
    if (!user?.isOwner) {
      setError(
        "إلغاء السندات متاح للمالك فقط.",
      );
      return;
    }

    if (voucher.status !== "posted") {
      return;
    }

    const reason =
      window.prompt(
        `سبب إلغاء السند ${voucher.publicId}:`,
        "إلغاء سند مسجل بالخطأ",
      );

    if (!reason?.trim()) {
      return;
    }

    const confirmed =
      window.confirm(
        "سيتم إنشاء عكس محاسبي للسند ولن يُحذف من السجل. متابعة؟",
      );

    if (!confirmed) {
      return;
    }

    setVoidingId(voucher.id);
    setError("");
    setMessage("");

    try {
      await voidPosFinanceVoucher(
        token,
        voucher.id,
        reason.trim(),
      );

      const sessionResult =
        await getCurrentCashSession(
          token,
          POS_REGISTER_KEY,
        ).catch(() => null);

      if (sessionResult) {
        setSession(
          sessionResult.session,
        );
      }

      await load();

      setMessage(
        `تم إلغاء السند ${voucher.publicId} بعكس محاسبي.`,
      );
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setError(errorText(caught));
    } finally {
      setVoidingId(null);
    }
  }

  return (
    <section
      className="work-panel lk-finance-refresh lk-finance-voucher-register"
      dir="rtl"
    >
      <div
        className="panel-heading lk-finance-header"
        style={{
          marginBottom: 16,
        }}
      >
        <div>
          <h2>🗂️ سجل السندات</h2>
          <p>
            سجل موحد لسندات القبض
            والصرف والقيود مع الاحتفاظ
            الكامل بأثر التدقيق.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className="primary-button"
            onClick={() =>
              navigate(
                "/vouchers/receipt",
              )
            }
          >
            + سند قبض
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              navigate(
                "/vouchers/payment",
              )
            }
          >
            + سند صرف
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              navigate(
                "/vouchers/journal",
              )
            }
          >
            + سند قيد
          </button>

          <button
            type="button"
            className="secondary-button"
            disabled={loading || visible.length === 0}
            onClick={printRegister}
          >
            🖨️ طباعة السجل A4
          </button>
        </div>
      </div>

      {error && (
        <div
          className="error-message"
          style={{
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {message && (
        <div
          className="lk-finance-success"
          style={{
            padding: 12,
            marginBottom: 12,
            borderRadius: 10,
            background:
              "rgba(16,185,129,.12)",
          }}
        >
          {message}
        </div>
      )}

      <div
        className="lk-finance-filterbar"
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(240px,1fr) 180px 180px auto",
          gap: 10,
          marginBottom: 16,
          alignItems: "end",
        }}
      >
        <label>
          <span>بحث</span>
          <input
            value={query}
            onChange={(event) =>
              setQuery(
                event.target.value,
              )
            }
            placeholder="رقم السند، الطرف، المبلغ..."
          />
        </label>

        <label>
          <span>نوع السند</span>
          <select
            value={kind}
            onChange={(event) =>
              setKind(
                event.target.value as
                  | "all"
                  | "receipt"
                  | "payment"
                  | "journal",
              )
            }
          >
            <option value="all">
              كل السندات
            </option>
            <option value="receipt">
              سندات قبض
            </option>
            <option value="payment">
              سندات صرف
            </option>
            <option value="journal">
              سندات قيد
            </option>
          </select>
        </label>

        <label>
          <span>الحالة</span>
          <select
            value={status}
            onChange={(event) =>
              setStatus(
                event.target.value as
                  | "all"
                  | "posted"
                  | "voided",
              )
            }
          >
            <option value="all">
              الكل
            </option>
            <option value="posted">
              فعال
            </option>
            <option value="voided">
              ملغى
            </option>
          </select>
        </label>

        <button
          type="button"
          className="secondary-button"
          disabled={loading}
          onClick={() =>
            void load()
          }
        >
          تحديث
        </button>
      </div>

      <div
        className="lk-finance-table-shell"
        style={{
          overflowX: "auto",
          border:
            "1px solid var(--border-color, #ddd)",
          borderRadius: 12,
        }}
      >
        <table
          className="lk-finance-table"
          style={{
            width: "100%",
            borderCollapse:
              "collapse",
          }}
        >
          <thead>
            <tr>
              <th>رقم السند</th>
              <th>النوع</th>
              <th>التاريخ</th>
              <th>الطرف</th>
              <th>المبلغ</th>
              <th>الطريقة</th>
              <th>الحالة</th>
              <th>البيان</th>
              <th>إجراءات</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={9}
                  style={{
                    padding: 20,
                    textAlign:
                      "center",
                  }}
                >
                  جاري تحميل السندات...
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  style={{
                    padding: 20,
                    textAlign:
                      "center",
                  }}
                >
                  لا توجد سندات مطابقة.
                </td>
              </tr>
            ) : (
              visible.map(
                (voucher) => (
                  <tr
                    key={voucher.id}
                  >
                    <td dir="ltr">
                      {voucher.publicId}
                    </td>

                    <td>
                      {voucherLabel(
                        voucher,
                      )}
                    </td>

                    <td>
                      {voucher.businessDate}
                    </td>

                    <td>
                      {partyLabel(
                        voucher,
                      )}
                    </td>

                    <td>
                      <strong>
                        {formatMinor(
                          voucher.amountMinor,
                        )}
                      </strong>

                      {voucher.currencyCode !==
                        "ILS" &&
                        voucher.transactionAmountMinor !==
                          null && (
                        <small
                          style={{
                            display:
                              "block",
                            marginTop:
                              4,
                            opacity:
                              0.8,
                          }}
                        >
                          استلام{" "}
                          {formatCurrencyMinor(
                            voucher.transactionAmountMinor,
                            voucher.currencyCode,
                          )}{" "}
                          ×{" "}
                          {(
                            voucher.exchangeRateMicros /
                            1_000_000
                          ).toFixed(
                            6,
                          )}{" "}
                          ={" "}
                          {formatMinor(
                            foreignReceiptBaseMinor(
                              voucher,
                            ) ??
                              voucher.amountMinor,
                          )}
                          {(() => {
                            const received =
                              foreignReceiptBaseMinor(
                                voucher,
                              );

                            if (
                              received ===
                                null ||
                              received <=
                                voucher.amountMinor
                            ) {
                              return "";
                            }

                            return ` — باقي ${formatMinor(received - voucher.amountMinor)}`;
                          })()}
                        </small>
                      )}
                    </td>

                    <td>
                      {paymentLabel(
                        voucher.paymentMethod,
                      )}
                    </td>

                    <td>
                      {voucher.status ===
                      "posted"
                        ? "فعال"
                        : "ملغى"}
                    </td>

                    <td>
                      {voucher.notes ??
                        "—"}
                    </td>

                    <td>
                      <div
                        style={{
                          display: "flex",
                          gap: 6,
                          flexWrap: "wrap",
                        }}
                      >
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() =>
                            printVoucher(
                              voucher,
                            )
                          }
                        >
                          طباعة
                        </button>

                        {voucher.status ===
                          "posted" &&
                        user?.isOwner && (
                          <>
                            {voucher.currencyCode ===
                              "ILS" &&
                            (
                              voucher.voucherType === "receipt" ||
                              voucher.voucherType === "payment" ||
                              voucher.voucherType === "journal"
                            ) && (
                              <button
                                type="button"
                                className="secondary-button"
                                disabled={
                                  editingId === voucher.id ||
                                  voidingId === voucher.id
                                }
                                onClick={() =>
                                  void handleEdit(
                                    voucher,
                                  )
                                }
                              >
                                {editingId ===
                                voucher.id
                                  ? "جاري التعديل..."
                                  : "تعديل"}
                              </button>
                            )}

                            <button
                              type="button"
                              className="secondary-button"
                              disabled={
                                voidingId === voucher.id ||
                                editingId === voucher.id
                              }
                              onClick={() =>
                                void handleVoid(
                                  voucher,
                                )
                              }
                            >
                              {voidingId ===
                              voucher.id
                                ? "جاري الإلغاء..."
                                : "إلغاء"}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ),
              )
            )}
          </tbody>
        </table>
      </div>

      <p
        style={{
          marginTop: 12,
          fontSize: 13,
          opacity: 0.8,
        }}
      >
        السند المالي لا يُحذف نهائيًا.
        الإلغاء ينشئ عكسًا محاسبيًا
        ويحافظ على السجل التاريخي.
      </p>
    </section>
  );
}
