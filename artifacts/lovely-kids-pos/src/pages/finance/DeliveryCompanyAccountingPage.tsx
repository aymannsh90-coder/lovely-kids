import { useEffect, useMemo, useState } from "react";
import "./DeliveryCompanyAccountingPage.css";

import { usePosRuntime } from "../../app/pos-context";
import {
  ApiError,
  createDeliveryCompanySettlement,
  getDeliveryCompanies,
  getDeliveryCompanySettlementSummary,
  reverseDeliveryCompanySettlement,
  type PosDeliveryCompany,
  type PosDeliverySettlementSummary,
} from "../../lib/api";

function formatMoney(minor: number) {
  const amount = minor / 100;

  return `${amount.toLocaleString("ar", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  })} ₪`;
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "حدث خطأ غير متوقع";
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function statementMoney(
  minor: number,
  forExcel: boolean,
) {
  const amount = (minor / 100).toFixed(2);

  return forExcel ? amount : `${amount} ₪`;
}

function statementDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }

  return date.toLocaleDateString("ar-PS", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function buildDeliveryCompanyStatementDocument(
  summary: PosDeliverySettlementSummary,
  forExcel: boolean,
) {
  const generatedAt = new Date().toLocaleString("ar-PS", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const totals =
    summary.unsettledOrders.reduce(
      (current, order) => ({
        orderTotalMinor:
          current.orderTotalMinor +
          Math.round(order.totalPrice * 100),
        shippingChargedMinor:
          current.shippingChargedMinor +
          order.shippingChargedMinor,
        deliveryCompanyCostMinor:
          current.deliveryCompanyCostMinor +
          order.deliveryCompanyCostMinor,
        deliveryMarginMinor:
          current.deliveryMarginMinor +
          order.deliveryMarginMinor,
        amountMinor:
          current.amountMinor +
          order.amountMinor,
      }),
      {
        orderTotalMinor: 0,
        shippingChargedMinor: 0,
        deliveryCompanyCostMinor: 0,
        deliveryMarginMinor: 0,
        amountMinor: 0,
      },
    );

  const money = (minor: number) =>
    statementMoney(minor, forExcel);

  const orderRows =
    summary.unsettledOrders.length === 0
      ? `
          <tr>
            <td colspan="9">لا توجد طلبات غير مسوّاة.</td>
          </tr>
        `
      : summary.unsettledOrders
          .map(
            (order) => `
              <tr>
                <td>${order.id}</td>
                <td>${escapeHtml(statementDate(order.createdAt))}</td>
                <td>${escapeHtml(order.customerName || "—")}</td>
                <td>${escapeHtml(order.shippingZone || "—")}</td>
                <td class="money">${money(
                  Math.round(order.totalPrice * 100),
                )}</td>
                <td class="money">${money(
                  order.shippingChargedMinor,
                )}</td>
                <td class="money">${money(
                  order.deliveryCompanyCostMinor,
                )}</td>
                <td class="money">${money(
                  order.deliveryMarginMinor,
                )}</td>
                <td class="money strong">${money(
                  order.amountMinor,
                )}</td>
              </tr>
            `,
          )
          .join("");

  const settlementRows =
    summary.settlements.length === 0
      ? `
          <tr>
            <td colspan="7">لا توجد تسويات سابقة.</td>
          </tr>
        `
      : summary.settlements
          .map(
            (settlement) => `
              <tr>
                <td>${escapeHtml(settlement.publicId)}</td>
                <td>${escapeHtml(settlement.businessDate)}</td>
                <td>${
                  settlement.receiptMethod === "cash"
                    ? "نقدي"
                    : "بنك"
                }</td>
                <td>${settlement.orders.length}</td>
                <td class="money strong">${money(
                  settlement.totalMinor,
                )}</td>
                <td>${escapeHtml(
                  settlement.orders
                    .map((item) => `#${item.orderId}`)
                    .join("، "),
                )}</td>
                <td>${
                  settlement.status === "posted"
                    ? "فعّالة"
                    : "معكوسة"
                }</td>
              </tr>
            `,
          )
          .join("");

  const excelNamespaces = forExcel
    ? ' xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"'
    : "";

  return `<!doctype html>
<html${excelNamespaces} lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>كشف حساب شركة التوصيل - ${escapeHtml(
    summary.company.name,
  )}</title>
  <style>
    * {
      box-sizing: border-box;
    }

    html,
    body {
      width: 100%;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: Arial, Tahoma, sans-serif;
      direction: rtl;
      color: #111827;
      font-size: 11px;
      background: #ffffff;
    }

    .report-shell {
      width: 100%;
      max-width: 277mm;
      margin: 0 auto;
    }

    .report-header {
      width: 100%;
      margin: 0 auto 12px;
      text-align: center;
    }

    h1 {
      margin: 2px 0 4px;
      font-size: 21px;
      line-height: 1.25;
      text-align: center;
    }

    h2 {
      margin: 16px 0 7px;
      font-size: 15px;
      line-height: 1.35;
      text-align: center;
    }

    .brand {
      color: #E91E8C;
      font-weight: 700;
      font-size: 17px;
      text-align: center;
    }

    .meta {
      margin: 2px 0;
      color: #4b5563;
      text-align: center;
    }

    .summary {
      width: 100%;
      table-layout: fixed;
      border-collapse: collapse;
      margin: 12px auto 0;
    }

    .summary td {
      border: 1px solid #d1d5db;
      padding: 7px 8px;
      text-align: center;
      vertical-align: middle;
    }

    .summary .label {
      font-weight: 700;
      background: #f3f4f6;
    }

    table.data {
      width: 100%;
      table-layout: fixed;
      border-collapse: collapse;
      margin: 7px auto 0;
    }

    table.data th,
    table.data td {
      border: 1px solid #9ca3af;
      padding: 5px 4px;
      text-align: center;
      vertical-align: middle;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }

    table.data th {
      background: #f3f4f6;
      font-weight: 700;
      font-size: 10px;
    }

    table.data td {
      font-size: 10.5px;
    }

    table.data thead {
      display: table-header-group;
    }

    table.data tbody {
      display: table-row-group;
    }

    .money {
      direction: ltr;
      white-space: nowrap;
    }

    .strong {
      font-weight: 700;
    }

    .total-row td {
      font-weight: 700;
      background: #f9fafb;
    }

    .footer {
      margin-top: 18px;
      color: #6b7280;
      font-size: 9.5px;
      text-align: center;
    }

    @page {
      size: A4 landscape;
      margin: 12mm 9mm;
    }

    @media print {
      html,
      body {
        width: 100%;
        margin: 0 !important;
        padding: 0 !important;
      }

      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      .report-shell {
        width: 100%;
        max-width: none;
        margin: 0 auto;
      }

      table.data thead {
        display: table-header-group;
      }

      h2 {
        break-after: avoid;
        page-break-after: avoid;
      }

      tr {
        break-inside: avoid;
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <main class="report-shell">
    <header class="report-header">
      <div class="brand">Lovely Kids</div>
      <h1>كشف حساب شركة التوصيل</h1>
      <div class="meta">
        الشركة: <strong>${escapeHtml(summary.company.name)}</strong>
      </div>
      <div class="meta">
        تاريخ إصدار الكشف: ${escapeHtml(generatedAt)}
      </div>
    </header>

  <table class="summary">
    <colgroup>
      <col style="width: 29%" />
      <col style="width: 21%" />
      <col style="width: 29%" />
      <col style="width: 21%" />
    </colgroup>
    <tbody>
      <tr>
        <td class="label">المبلغ غير المسوّى</td>
        <td class="money strong">${money(
          summary.outstandingMinor,
        )}</td>
        <td class="label">طلبات غير مسوّاة</td>
        <td>${summary.unsettledOrders.length}</td>
      </tr>
      <tr>
        <td class="label">إيراد التوصيل من الزبائن</td>
        <td class="money">${money(
          summary.shippingChargedMinor,
        )}</td>
        <td class="label">تكلفة شركة التوصيل</td>
        <td class="money">${money(
          summary.deliveryCompanyCostMinor,
        )}</td>
      </tr>
      <tr>
        <td class="label">صافي ربح/خسارة التوصيل</td>
        <td class="money">${money(
          summary.deliveryMarginMinor,
        )}</td>
        <td class="label">عدد التسويات السابقة</td>
        <td>${summary.settlements.length}</td>
      </tr>
    </tbody>
  </table>

  <h2>الطلبات غير المسوّاة</h2>

  <table class="data order-data">
    <colgroup>
      <col style="width: 6.5%" />
      <col style="width: 9%" />
      <col style="width: 17%" />
      <col style="width: 11%" />
      <col style="width: 11%" />
      <col style="width: 11%" />
      <col style="width: 11%" />
      <col style="width: 12%" />
      <col style="width: 11.5%" />
    </colgroup>
    <thead>
      <tr>
        <th>رقم الطلب</th>
        <th>تاريخ الطلب</th>
        <th>الزبون</th>
        <th>المنطقة</th>
        <th>إجمالي الطلب${forExcel ? " (₪)" : ""}</th>
        <th>التوصيل على الزبون${forExcel ? " (₪)" : ""}</th>
        <th>تكلفة الشركة${forExcel ? " (₪)" : ""}</th>
        <th>ربح/خسارة التوصيل${forExcel ? " (₪)" : ""}</th>
        <th>المستحق لنا${forExcel ? " (₪)" : ""}</th>
      </tr>
    </thead>
    <tbody>
      ${orderRows}
      ${
        summary.unsettledOrders.length > 0
          ? `
            <tr class="total-row">
              <td colspan="4">الإجمالي</td>
              <td class="money">${money(
                totals.orderTotalMinor,
              )}</td>
              <td class="money">${money(
                totals.shippingChargedMinor,
              )}</td>
              <td class="money">${money(
                totals.deliveryCompanyCostMinor,
              )}</td>
              <td class="money">${money(
                totals.deliveryMarginMinor,
              )}</td>
              <td class="money">${money(
                totals.amountMinor,
              )}</td>
            </tr>
          `
          : ""
      }
    </tbody>
  </table>

  <h2>سجل التسويات</h2>

  <table class="data settlement-data">
    <colgroup>
      <col style="width: 12%" />
      <col style="width: 12%" />
      <col style="width: 10%" />
      <col style="width: 10%" />
      <col style="width: 12%" />
      <col style="width: 32%" />
      <col style="width: 12%" />
    </colgroup>
    <thead>
      <tr>
        <th>رقم التسوية</th>
        <th>التاريخ</th>
        <th>الطريقة</th>
        <th>عدد الطلبات</th>
        <th>المبلغ${forExcel ? " (₪)" : ""}</th>
        <th>الطلبات</th>
        <th>الحالة</th>
      </tr>
    </thead>
    <tbody>
      ${settlementRows}
    </tbody>
  </table>

  <div class="footer">
    كشف صادر من نظام Lovely Kids — للمطابقة والمراجعة.
  </div>
  </main>
</body>
</html>`;
}

export default function DeliveryCompanyAccountingPage() {
  const {
    token,
    session,
    clearAuthentication,
  } = usePosRuntime();

  const [companies, setCompanies] =
    useState<PosDeliveryCompany[]>([]);

  const [companyId, setCompanyId] =
    useState<number | null>(null);

  const [summary, setSummary] =
    useState<PosDeliverySettlementSummary | null>(null);

  const [selectedIds, setSelectedIds] =
    useState<number[]>([]);

  const [receiptMethod, setReceiptMethod] =
    useState<"cash" | "bank">("cash");

  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reversingId, setReversingId] =
    useState<number | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void loadCompanies();
  }, [token]);

  useEffect(() => {
    if (companyId) {
      void loadSummary(companyId);
    }
  }, [companyId, token]);

  async function loadCompanies() {
    setLoading(true);
    setError("");

    try {
      const rows = await getDeliveryCompanies(token);

      setCompanies(rows);

      const active =
        rows.find((company) => company.status === "active") ??
        rows[0];

      setCompanyId(active?.id ?? null);
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  async function loadSummary(id = companyId) {
    if (!id) return;

    setLoading(true);
    setError("");

    try {
      const result =
        await getDeliveryCompanySettlementSummary(
          token,
          id,
        );

      setSummary(result);

      setSelectedIds((current) =>
        current.filter((orderId) =>
          result.unsettledOrders.some(
            (order) => order.id === orderId,
          ),
        ),
      );
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  const selectedOrders = useMemo(() => {
    if (!summary) return [];

    const selected = new Set(selectedIds);

    return summary.unsettledOrders.filter((order) =>
      selected.has(order.id),
    );
  }, [summary, selectedIds]);

  const selectedTotalMinor = useMemo(
    () =>
      selectedOrders.reduce(
        (sum, order) => sum + order.amountMinor,
        0,
      ),
    [selectedOrders],
  );

  const allSelected =
    !!summary?.unsettledOrders.length &&
    selectedIds.length ===
      summary.unsettledOrders.length;

  function toggleOrder(orderId: number) {
    setSelectedIds((current) =>
      current.includes(orderId)
        ? current.filter((id) => id !== orderId)
        : [...current, orderId],
    );
  }

  function toggleAll() {
    if (!summary) return;

    setSelectedIds(
      allSelected
        ? []
        : summary.unsettledOrders.map(
            (order) => order.id,
          ),
    );
  }

  async function saveSettlement() {
    if (!companyId || saving) return;

    if (selectedIds.length === 0) {
      setError("اختر طلبًا واحدًا على الأقل.");
      return;
    }

    if (receiptMethod === "cash" && !session) {
      setError(
        "يجب فتح يوم العمل قبل تسجيل تحصيل نقدي.",
      );
      return;
    }

    const confirmed = window.confirm(
      [
        "تسجيل تسوية شركة التوصيل؟",
        "",
        `عدد الطلبات: ${selectedIds.length}`,
        `المبلغ: ${formatMoney(selectedTotalMinor)}`,
        `طريقة التحصيل: ${
          receiptMethod === "cash" ? "نقدي" : "بنك"
        }`,
        "",
        "سيتم إنشاء قيد محاسبي واحد للمبلغ الإجمالي.",
      ].join("\n"),
    );

    if (!confirmed) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const result =
        await createDeliveryCompanySettlement(
          token,
          companyId,
          {
            orderIds: selectedIds,
            receiptMethod,
            notes: notes.trim() || undefined,
          },
        );

      setMessage(
        `تم تسجيل التسوية بقيمة ${formatMoney(
          result.totalMinor,
        )}.`,
      );

      setSelectedIds([]);
      setNotes("");

      await loadSummary(companyId);
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function reverseSettlement(
    settlement: PosDeliverySettlementSummary["settlements"][number],
  ) {
    if (!companyId || reversingId !== null) {
      return;
    }

    const reason = window.prompt(
      [
        `عكس التسوية ${settlement.publicId}`,
        `المبلغ: ${formatMoney(settlement.totalMinor)}`,
        "",
        "أدخل سبب العكس:",
      ].join("\n"),
      "",
    );

    if (reason === null) {
      return;
    }

    const cleanReason = reason.trim();

    if (!cleanReason) {
      setError("سبب عكس التسوية مطلوب.");
      return;
    }

    const confirmed = window.confirm(
      [
        "تأكيد عكس تسوية شركة التوصيل",
        "",
        `رقم التسوية: ${settlement.publicId}`,
        `المبلغ: ${formatMoney(settlement.totalMinor)}`,
        `الطلبات: ${settlement.orders
          .map((item) => `#${item.orderId}`)
          .join("، ")}`,
        "",
        "سيتم إنشاء قيد عكسي ولن يتم حذف القيد الأصلي.",
        "وستعود الطلبات إلى قائمة غير المسوّاة.",
        "",
        "هل تريد المتابعة؟",
      ].join("\n"),
    );

    if (!confirmed) {
      return;
    }

    setReversingId(settlement.id);
    setError("");
    setMessage("");

    try {
      const result =
        await reverseDeliveryCompanySettlement(
          token,
          companyId,
          settlement.id,
          cleanReason,
        );

      setMessage(
        `تم عكس التسوية ${settlement.publicId} بقيمة ${formatMoney(
          result.totalMinor,
        )} وإعادة ${result.orderIds.length} طلب إلى غير المسوّى.`,
      );

      setSelectedIds([]);

      await loadSummary(companyId);
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setError(errorMessage(caught));
    } finally {
      setReversingId(null);
    }
  }


  function printStatement() {
    if (!summary) {
      return;
    }

    const printWindow = window.open(
      "",
      "_blank",
      "width=1200,height=850",
    );

    if (!printWindow) {
      setError(
        "تعذر فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد المحاولة.",
      );
      return;
    }

    printWindow.opener = null;
    printWindow.document.open();
    printWindow.document.write(
      buildDeliveryCompanyStatementDocument(
        summary,
        false,
      ),
    );
    printWindow.document.close();

    const runPrint = () => {
      printWindow.focus();
      printWindow.print();
    };

    if (printWindow.document.readyState === "complete") {
      window.setTimeout(runPrint, 100);
    } else {
      printWindow.addEventListener(
        "load",
        () => window.setTimeout(runPrint, 100),
        { once: true },
      );
    }
  }

  function exportStatementToExcel() {
    if (!summary) {
      return;
    }

    const documentHtml =
      buildDeliveryCompanyStatementDocument(
        summary,
        true,
      );

    const blob = new Blob(
      ["\ufeff", documentHtml],
      {
        type: "application/vnd.ms-excel;charset=utf-8",
      },
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeCompanyName =
      summary.company.name
        .trim()
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/\s+/g, "-") ||
      "delivery-company";
    const today =
      new Date().toISOString().slice(0, 10);

    link.href = url;
    link.download =
      `كشف-حساب-${safeCompanyName}-${today}.xls`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(
      () => URL.revokeObjectURL(url),
      0,
    );
  }

  return (
    <section
      className="accounting-invoice-page delivery-company-scroll-page delivery-ledger"
      dir="rtl"
    >
      <header className="delivery-ledger-hero">
        <div className="delivery-ledger-brand">
          <div className="delivery-ledger-hero-icon" aria-hidden="true">🚚</div>
          <div>
            <span className="delivery-ledger-eyebrow">المالية / شركات التوصيل</span>
            <h1>حساب شركة التوصيل</h1>
            <p>
              متابعة المبالغ المستحقة، تكاليف التوصيل، وتحصيل وتسوية الطلبات المسلّمة.
            </p>
          </div>
        </div>

        <div className="delivery-ledger-actions">
          <label className="delivery-ledger-company-field">
            <span>شركة التوصيل</span>
            <select
              aria-label="شركة التوصيل"
              value={companyId ?? ""}
              onChange={(event) => {
                const id = Number(event.target.value);
                setCompanyId(
                  Number.isSafeInteger(id) && id > 0 ? id : null,
                );
                setSelectedIds([]);
                setSummary(null);
              }}
            >
              {companies.length === 0 && (
                <option value="">لا توجد شركات</option>
              )}
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                  {company.status === "inactive" ? " — موقوفة" : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="delivery-ledger-action delivery-ledger-action-primary"
            disabled={!companyId || loading}
            onClick={() => void loadSummary()}
          >
            <span aria-hidden="true">↻</span>
            {loading ? "جارٍ التحديث..." : "تحديث الحساب"}
          </button>
          <button
            type="button"
            className="delivery-ledger-action"
            disabled={!summary || loading}
            onClick={printStatement}
          >
            <span aria-hidden="true">🖨️</span>
            طباعة الكشف
          </button>
          <button
            type="button"
            className="delivery-ledger-action"
            disabled={!summary || loading}
            onClick={exportStatementToExcel}
          >
            <span aria-hidden="true">📊</span>
            Excel
          </button>
        </div>
      </header>

      {error && (
        <div className="delivery-ledger-message is-error" role="alert">
          <span aria-hidden="true">⚠️</span> {error}
        </div>
      )}
      {message && (
        <div className="delivery-ledger-message" role="status">
          <span aria-hidden="true">✓</span> {message}
        </div>
      )}

      {summary ? (
        <>
          <section className="delivery-ledger-metrics" aria-label="ملخص حساب شركة التوصيل">
            <article className="delivery-ledger-metric is-highlight">
              <div className="delivery-ledger-metric-label">
                <span>المبلغ غير المسوّى</span>
                <span className="dl-symbol" aria-hidden="true">₪</span>
              </div>
              <strong dir="ltr">{formatMoney(summary.outstandingMinor)}</strong>
              <span className="delivery-ledger-metric-hint">
                المستحق من شركة التوصيل عن الطلبات غير المسوّاة
              </span>
            </article>
            <article className="delivery-ledger-metric is-sky">
              <div className="delivery-ledger-metric-label">
                <span>طلبات غير مسوّاة</span>
                <span className="dl-symbol" aria-hidden="true">📦</span>
              </div>
              <strong>{summary.unsettledOrders.length}</strong>
              <span className="delivery-ledger-metric-hint">طلب بانتظار التسوية</span>
            </article>
            <article className={
              "delivery-ledger-metric " +
              (summary.deliveryMarginMinor < 0 ? "is-negative" : "is-mint")
            }>
              <div className="delivery-ledger-metric-label">
                <span>صافي ربح / خسارة التوصيل</span>
                <span className="dl-symbol" aria-hidden="true">📈</span>
              </div>
              <strong dir="ltr">{formatMoney(summary.deliveryMarginMinor)}</strong>
              <span className="delivery-ledger-metric-hint">
                إيراد الزبائن مطروحًا منه تكلفة شركة التوصيل
              </span>
            </article>
            <article className="delivery-ledger-metric is-rose">
              <div className="delivery-ledger-metric-label">
                <span>إيراد التوصيل من الزبائن</span>
                <span className="dl-symbol" aria-hidden="true">💳</span>
              </div>
              <strong dir="ltr">{formatMoney(summary.shippingChargedMinor)}</strong>
              <span className="delivery-ledger-metric-hint">مجموع رسوم التوصيل المحمّلة على الزبائن</span>
            </article>
            <article className="delivery-ledger-metric is-amber">
              <div className="delivery-ledger-metric-label">
                <span>تكلفة شركة التوصيل</span>
                <span className="dl-symbol" aria-hidden="true">🚚</span>
              </div>
              <strong dir="ltr">{formatMoney(summary.deliveryCompanyCostMinor)}</strong>
              <span className="delivery-ledger-metric-hint">تكلفة الشحن الفعلية المسجلة على الطلبات</span>
            </article>
            <article className="delivery-ledger-metric">
              <div className="delivery-ledger-metric-label">
                <span>التسويات السابقة</span>
                <span className="dl-symbol" aria-hidden="true">🧾</span>
              </div>
              <strong>{summary.settlements.length}</strong>
              <span className="delivery-ledger-metric-hint">تسويات مسجلة في حساب {summary.company.name}</span>
            </article>
            <article className="delivery-ledger-metric">
              <div className="delivery-ledger-metric-label">
                <span>شركة التوصيل المختارة</span>
                <span className="dl-symbol" aria-hidden="true">✓</span>
              </div>
              <strong style={{ fontSize: 21 }}>{summary.company.name}</strong>
              <span className="delivery-ledger-metric-hint">الكشف الحالي حسب الشركة المحددة</span>
            </article>
          </section>

          <section className="delivery-ledger-panel" aria-labelledby="delivery-ledger-orders-title">
            <div className="delivery-ledger-panel-head">
              <div className="delivery-ledger-panel-heading">
                <span className="delivery-ledger-panel-glyph" aria-hidden="true">📋</span>
                <div>
                  <h2 id="delivery-ledger-orders-title">الطلبات غير المسوّاة</h2>
                  <p>حدد الطلبات المطلوب تحصيلها من شركة التوصيل.</p>
                </div>
              </div>
              <div className="delivery-ledger-head-tools">
                <span className="delivery-ledger-count">
                  {summary.unsettledOrders.length} طلب غير مسوّى
                </span>
                {summary.unsettledOrders.length > 0 && (
                  <button
                    type="button"
                    className="delivery-ledger-action delivery-ledger-select-all"
                    onClick={toggleAll}
                  >
                    {allSelected ? "إلغاء تحديد الكل" : "☑ تحديد الكل"}
                  </button>
                )}
              </div>
            </div>

            {summary.unsettledOrders.length === 0 ? (
              <div className="delivery-ledger-empty">
                <span className="emoji" aria-hidden="true">✅</span>
                <strong>لا توجد طلبات معلّقة حاليًا</strong>
                <p>جميع الطلبات المؤهلة مسوّاة لهذه الشركة.</p>
              </div>
            ) : (
              <div className="delivery-ledger-table-wrap" role="region" aria-label="جدول الطلبات غير المسواة" tabIndex={0}>
                <table className="delivery-ledger-table">
                  <thead>
                    <tr>
                      <th>تحديد</th>
                      <th>رقم الطلب</th>
                      <th>الزبون</th>
                      <th>المنطقة</th>
                      <th>إجمالي الطلب</th>
                      <th>توصيل الزبون</th>
                      <th>تكلفة الشركة</th>
                      <th>ربح / خسارة</th>
                      <th>المستحق لنا</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.unsettledOrders.map((order) => (
                      <tr
                        key={order.id}
                        className={selectedIds.includes(order.id) ? "is-selected" : ""}
                      >
                        <td>
                          <input
                            type="checkbox"
                            aria-label={"تحديد الطلب رقم " + order.id}
                            checked={selectedIds.includes(order.id)}
                            onChange={() => toggleOrder(order.id)}
                          />
                        </td>
                        <td><span className="delivery-ledger-order-id">#{order.id}</span></td>
                        <td className="delivery-ledger-customer">{order.customerName || "—"}</td>
                        <td>{order.shippingZone || "—"}</td>
                        <td>
                          <span className="delivery-ledger-money">
                            {formatMoney(Math.round(order.totalPrice * 100))}
                          </span>
                        </td>
                        <td><span className="delivery-ledger-money">{formatMoney(order.shippingChargedMinor)}</span></td>
                        <td><span className="delivery-ledger-money">{formatMoney(order.deliveryCompanyCostMinor)}</span></td>
                        <td>
                          <span
                            className={
                              "delivery-ledger-money " +
                              (order.deliveryMarginMinor < 0
                                ? "is-negative"
                                : order.deliveryMarginMinor > 0
                                  ? "is-positive"
                                  : "is-neutral")
                            }
                          >
                            {formatMoney(order.deliveryMarginMinor)}
                          </span>
                        </td>
                        <td>
                          <span className="delivery-ledger-money is-strong">
                            {formatMoney(order.amountMinor)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="delivery-ledger-selection">
              <div className="delivery-ledger-selection-title">
                <span>إجمالي المستحق عن الطلبات المحددة</span>
                <strong dir="ltr">{formatMoney(selectedTotalMinor)}</strong>
                <small>المبلغ الذي سيتم تسجيله عند إتمام التسوية</small>
              </div>
              <span className="delivery-ledger-selected-count">
                {selectedIds.length} طلب محدد
              </span>
            </div>
          </section>

          {summary.unsettledOrders.length > 0 && (
            <section className="delivery-ledger-panel" aria-labelledby="delivery-ledger-receipt-title">
              <div className="delivery-ledger-panel-head">
                <div className="delivery-ledger-panel-heading">
                  <span className="delivery-ledger-panel-glyph" aria-hidden="true">💰</span>
                  <div>
                    <h2 id="delivery-ledger-receipt-title">تسجيل التحصيل والتسوية</h2>
                    <p>تسوية مجمّعة للطلبات المحددة، مع قيد محاسبي واحد.</p>
                  </div>
                </div>
                <span className="delivery-ledger-count">المحدد: {selectedIds.length} طلب</span>
              </div>
              <div className="delivery-ledger-settlement-body">
                <label className="delivery-ledger-form-field">
                  <span>طريقة التحصيل</span>
                  <select
                    value={receiptMethod}
                    onChange={(event) =>
                      setReceiptMethod(event.target.value === "bank" ? "bank" : "cash")
                    }
                  >
                    <option value="cash">نقدي — يدخل الصندوق</option>
                    <option value="bank">بنك / تحويل</option>
                  </select>
                </label>
                <label className="delivery-ledger-form-field">
                  <span>ملاحظات التسوية</span>
                  <input
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="مثال: تحصيل أسبوعي من شركة التوصيل"
                  />
                </label>
                <button
                  type="button"
                  className="delivery-ledger-submit"
                  disabled={
                    saving ||
                    selectedIds.length === 0 ||
                    (receiptMethod === "cash" && !session)
                  }
                  onClick={() => void saveSettlement()}
                >
                  <span aria-hidden="true">✓</span>
                  {saving ? "جارٍ تسجيل التسوية..." : "تسجيل تسوية مجمعة"}
                </button>
              </div>
              <div className={
                "delivery-ledger-settlement-footnote " +
                (receiptMethod === "cash" && !session ? "is-warning" : "")
              }>
                {receiptMethod === "cash" && !session
                  ? "⚠️ يجب فتح يوم العمل قبل تسجيل تحصيل نقدي."
                  : selectedIds.length === 0
                    ? "اختر طلبًا واحدًا على الأقل من الجدول لتفعيل تسجيل التسوية."
                    : "سيتم تسجيل المستحق المحدد حسب طريقة التحصيل المختارة دون تغيير بيانات الطلبات."}
              </div>
            </section>
          )}

          <section className="delivery-ledger-panel" aria-labelledby="delivery-ledger-history-title">
            <div className="delivery-ledger-panel-head">
              <div className="delivery-ledger-panel-heading">
                <span className="delivery-ledger-panel-glyph" aria-hidden="true">🗂️</span>
                <div>
                  <h2 id="delivery-ledger-history-title">سجل التسويات</h2>
                  <p>التسويات السابقة مع حالة كل عملية وإمكانية عكسها.</p>
                </div>
              </div>
              <span className="delivery-ledger-count">{summary.settlements.length} تسوية</span>
            </div>

            {summary.settlements.length === 0 ? (
              <div className="delivery-ledger-empty">
                <span className="emoji" aria-hidden="true">🗂️</span>
                <strong>لا توجد تسويات سابقة</strong>
                <p>ستظهر هنا العمليات بعد تسجيل أول تحصيل.</p>
              </div>
            ) : (
              <div className="delivery-ledger-table-wrap" role="region" aria-label="سجل التسويات السابقة" tabIndex={0}>
                <table className="delivery-ledger-table delivery-ledger-settlement-table">
                  <thead>
                    <tr>
                      <th>رقم التسوية</th>
                      <th>التاريخ</th>
                      <th>طريقة التحصيل</th>
                      <th>عدد الطلبات</th>
                      <th>المبلغ</th>
                      <th>الطلبات المرتبطة</th>
                      <th>الحالة</th>
                      <th>الإجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.settlements.map((settlement) => (
                      <tr key={settlement.id}>
                        <td>
                          <span className="delivery-ledger-order-id" dir="ltr">
                            {settlement.publicId}
                          </span>
                        </td>
                        <td>{settlement.businessDate}</td>
                        <td>{settlement.receiptMethod === "cash" ? "💵 نقدي" : "🏦 بنك"}</td>
                        <td>{settlement.orders.length}</td>
                        <td>
                          <span className="delivery-ledger-money is-strong">
                            {formatMoney(settlement.totalMinor)}
                          </span>
                        </td>
                        <td>
                          <span className="delivery-ledger-order-references">
                            {settlement.orders.map((item) => "#" + item.orderId).join("، ")}
                          </span>
                        </td>
                        <td>
                          <span className={
                            "delivery-ledger-pill " +
                            (settlement.status === "posted" ? "is-posted" : "is-reversed")
                          }>
                            {settlement.status === "posted" ? "● فعّالة" : "● معكوسة"}
                          </span>
                        </td>
                        <td>
                          {settlement.status === "posted" ? (
                            <button
                              type="button"
                              className="delivery-ledger-danger"
                              disabled={reversingId !== null}
                              onClick={() => void reverseSettlement(settlement)}
                            >
                              {reversingId === settlement.id ? "جارٍ العكس..." : "عكس التسوية"}
                            </button>
                          ) : (
                            <span className="delivery-ledger-money is-neutral">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : (
        <div className="delivery-ledger-panel">
          <div className="delivery-ledger-empty">
            <span className="emoji" aria-hidden="true">{loading ? "⏳" : "🚚"}</span>
            <strong>{loading ? "جارٍ تحميل حساب الشركة..." : "اختر شركة التوصيل"}</strong>
            <p>سيظهر ملخص الحساب والطلبات والتسويات هنا.</p>
          </div>
        </div>
      )}
    </section>
  );
}
