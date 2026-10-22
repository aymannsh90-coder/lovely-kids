import { useEffect, useMemo, useState } from "react";

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
    body {
      font-family: Arial, Tahoma, sans-serif;
      direction: rtl;
      color: #111827;
      margin: 24px;
      font-size: 12px;
    }

    h1 {
      margin: 0 0 4px;
      font-size: 22px;
    }

    h2 {
      margin: 24px 0 8px;
      font-size: 16px;
    }

    .brand {
      color: #E91E8C;
      font-weight: 700;
      font-size: 18px;
    }

    .meta {
      margin: 3px 0;
      color: #4b5563;
    }

    .summary {
      width: 100%;
      border-collapse: collapse;
      margin-top: 16px;
    }

    .summary td {
      border: 1px solid #d1d5db;
      padding: 8px;
    }

    .summary .label {
      font-weight: 700;
      background: #f3f4f6;
    }

    table.data {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
    }

    table.data th,
    table.data td {
      border: 1px solid #9ca3af;
      padding: 6px;
      text-align: center;
      vertical-align: middle;
    }

    table.data th {
      background: #f3f4f6;
      font-weight: 700;
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
      margin-top: 24px;
      color: #6b7280;
      font-size: 10px;
    }

    @page {
      size: A4 landscape;
      margin: 10mm;
    }

    @media print {
      body {
        margin: 0;
      }

      h2,
      table,
      tr {
        break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="brand">Lovely Kids</div>
  <h1>كشف حساب شركة التوصيل</h1>
  <div class="meta">
    الشركة: <strong>${escapeHtml(summary.company.name)}</strong>
  </div>
  <div class="meta">
    تاريخ إصدار الكشف: ${escapeHtml(generatedAt)}
  </div>

  <table class="summary">
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

  <table class="data">
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

  <table class="data">
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
    <section className="accounting-invoice-page delivery-company-scroll-page">
      <div className="panel-heading">
        <div className="panel-icon">🚚</div>

        <div>
          <h2>حساب شركة التوصيل</h2>
          <p>
            الطلبات المسلّمة غير المسوّاة والتحصيلات
            المجمعة من شركة التوصيل.
          </p>
        </div>
      </div>

      {error && <div className="alert">{error}</div>}

      {message && (
        <div className="alert">
          {message}
        </div>
      )}

      <section className="accounting-invoice-card">
        <label>
          <span>شركة التوصيل</span>

          <select
            value={companyId ?? ""}
            onChange={(event) => {
              const id = Number(event.target.value);

              setCompanyId(
                Number.isSafeInteger(id) && id > 0
                  ? id
                  : null,
              );

              setSelectedIds([]);
            }}
          >
            {companies.map((company) => (
              <option
                value={company.id}
                key={company.id}
              >
                {company.name}
                {company.status === "inactive"
                  ? " — موقوفة"
                  : ""}
              </option>
            ))}
          </select>
        </label>

        <div
          style={{
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            disabled={!companyId || loading}
            onClick={() => void loadSummary()}
          >
            {loading ? "جارٍ التحديث..." : "تحديث الحساب"}
          </button>

          <button
            type="button"
            className="secondary-button"
            disabled={!summary || loading}
            onClick={printStatement}
          >
            🖨️ طباعة الكشف
          </button>

          <button
            type="button"
            className="secondary-button"
            disabled={!summary || loading}
            onClick={exportStatementToExcel}
          >
            📊 Excel
          </button>
        </div>
      </section>

      {summary && (
        <>
          <section className="supplier-summary-grid">
            <article>
              <span>المبلغ غير المسوّى</span>
              <strong>
                {formatMoney(summary.outstandingMinor)}
              </strong>
            </article>

            <article>
              <span>طلبات غير مسوّاة</span>
              <strong>
                {summary.unsettledOrders.length}
              </strong>
            </article>

            <article>
              <span>إيراد التوصيل من الزبائن</span>
              <strong>
                {formatMoney(summary.shippingChargedMinor)}
              </strong>
            </article>

            <article>
              <span>تكلفة شركة التوصيل</span>
              <strong>
                {formatMoney(summary.deliveryCompanyCostMinor)}
              </strong>
            </article>

            <article>
              <span>صافي ربح/خسارة التوصيل</span>
              <strong>
                {formatMoney(summary.deliveryMarginMinor)}
              </strong>
            </article>

            <article>
              <span>شركة التوصيل</span>
              <strong>{summary.company.name}</strong>
            </article>

            <article>
              <span>التسويات السابقة</span>
              <strong>
                {summary.settlements.length}
              </strong>
            </article>
          </section>

          <section className="accounting-invoice-card">
            <div className="panel-heading">
              <div>
                <h2>الطلبات غير المسوّاة</h2>
                <p>
                  اختر الطلبات الداخلة في التحصيل الحالي.
                </p>
              </div>

              {summary.unsettledOrders.length > 0 && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={toggleAll}
                >
                  {allSelected
                    ? "إلغاء تحديد الكل"
                    : "تحديد الكل"}
                </button>
              )}
            </div>

            {summary.unsettledOrders.length === 0 ? (
              <p>لا توجد طلبات معلقة حاليًا.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th>اختيار</th>
                      <th>الطلب</th>
                      <th>الزبون</th>
                      <th>المنطقة</th>
                      <th>إجمالي الطلب</th>
                      <th>التوصيل على الزبون</th>
                      <th>تكلفة الشركة</th>
                      <th>ربح/خسارة التوصيل</th>
                      <th>المستحق لنا</th>
                    </tr>
                  </thead>

                  <tbody>
                    {summary.unsettledOrders.map(
                      (order) => (
                        <tr key={order.id}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(
                                order.id,
                              )}
                              onChange={() =>
                                toggleOrder(order.id)
                              }
                            />
                          </td>

                          <td>#{order.id}</td>
                          <td>{order.customerName || "—"}</td>
                          <td>{order.shippingZone || "—"}</td>

                          <td>
                            {formatMoney(
                              Math.round(
                                order.totalPrice * 100,
                              ),
                            )}
                          </td>

                          <td>
                            {formatMoney(
                              order.shippingChargedMinor,
                            )}
                          </td>

                          <td>
                            {formatMoney(
                              order.deliveryCompanyCostMinor,
                            )}
                          </td>

                          <td>
                            <strong>
                              {formatMoney(
                                order.deliveryMarginMinor,
                              )}
                            </strong>
                          </td>

                          <td>
                            <strong>
                              {formatMoney(
                                order.amountMinor,
                              )}
                            </strong>
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {summary.unsettledOrders.length > 0 && (
            <section className="accounting-invoice-card">
              <h2>تسجيل التحصيل</h2>

              <label>
                <span>طريقة التحصيل</span>

                <select
                  value={receiptMethod}
                  onChange={(event) =>
                    setReceiptMethod(
                      event.target.value === "bank"
                        ? "bank"
                        : "cash",
                    )
                  }
                >
                  <option value="cash">
                    نقدي — يدخل الصندوق
                  </option>

                  <option value="bank">
                    بنك / تحويل
                  </option>
                </select>
              </label>

              <label>
                <span>ملاحظات</span>

                <input
                  value={notes}
                  onChange={(event) =>
                    setNotes(event.target.value)
                  }
                  placeholder="مثال: تحصيل أسبوعي"
                />
              </label>

              <p>
                المحدد: {selectedIds.length} طلب —{" "}
                <strong>
                  {formatMoney(selectedTotalMinor)}
                </strong>
              </p>

              <button
                type="button"
                className="primary-button"
                disabled={
                  saving ||
                  selectedIds.length === 0 ||
                  (receiptMethod === "cash" && !session)
                }
                onClick={() => void saveSettlement()}
              >
                {saving
                  ? "جارٍ تسجيل التسوية..."
                  : "تسجيل تسوية مجمعة"}
              </button>
            </section>
          )}

          <section className="accounting-invoice-card">
            <h2>سجل التسويات</h2>

            {summary.settlements.length === 0 ? (
              <p>لا توجد تسويات سابقة.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th>رقم التسوية</th>
                      <th>التاريخ</th>
                      <th>الطريقة</th>
                      <th>عدد الطلبات</th>
                      <th>المبلغ</th>
                      <th>الطلبات</th>
                      <th>الحالة</th>
                      <th>إجراء</th>
                    </tr>
                  </thead>

                  <tbody>
                    {summary.settlements.map(
                      (settlement) => (
                        <tr key={settlement.id}>
                          <td dir="ltr">
                            {settlement.publicId}
                          </td>

                          <td>
                            {settlement.businessDate}
                          </td>

                          <td>
                            {settlement.receiptMethod ===
                            "cash"
                              ? "نقدي"
                              : "بنك"}
                          </td>

                          <td>
                            {settlement.orders.length}
                          </td>

                          <td>
                            <strong>
                              {formatMoney(
                                settlement.totalMinor,
                              )}
                            </strong>
                          </td>

                          <td>
                            {settlement.orders
                              .map(
                                (item) =>
                                  `#${item.orderId}`,
                              )
                              .join("، ")}
                          </td>

                          <td>
                            {settlement.status ===
                            "posted"
                              ? "فعّالة"
                              : "معكوسة"}
                          </td>

                          <td>
                            {settlement.status ===
                            "posted" ? (
                              <button
                                type="button"
                                className="danger-button delivery-settlement-danger"
                                disabled={
                                  reversingId !==
                                  null
                                }
                                onClick={() =>
                                  void reverseSettlement(
                                    settlement,
                                  )
                                }
                              >
                                {reversingId ===
                                settlement.id
                                  ? "جارٍ العكس..."
                                  : "عكس التسوية"}
                              </button>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
