import "./ReportVisualRefresh.css";
import { useSearchParams } from "react-router-dom";
import CustomerPicker from "../../components/CustomerPicker";
import {
  Fragment,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ApiError,
  getPosCustomerLedger,
  getPosCustomers,
  type PosCustomer,
  type PosCustomerLedgerEntry,
  type PosCustomerLedgerDocument,
  type PosCustomerLedgerDocumentItem,
  type PosCustomerLedgerResult,
} from "../../lib/api";

import {
  usePosRuntime,
} from "../../app/pos-context";

function money(
  value: number,
) {
  return `${new Intl.NumberFormat(
    "en-US",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  ).format(
    Math.abs(value) / 100,
  )} ₪`;
}

function balanceLabel(
  value: number,
) {
  if (value > 0) {
    return `عليه ${money(value)}`;
  }

  if (value < 0) {
    return `له ${money(value)}`;
  }

  return "مسدد";
}

function movementLabel(
  entry:
    PosCustomerLedgerEntry,
) {
  if (entry.sourceEvent === "customer_credit_note") return "إشعار دائن / خصم مسموح";
  if (entry.sourceEvent === "customer_debit_note") return "إشعار مدين للزبون";
  if (entry.sourceEvent === "receipt_with_discount") return "سند قبض مع خصم مسموح";
  if (
    entry.sourceType ===
      "pos_sale" ||
    entry.transactionType ===
      "sale"
  ) {
    return "فاتورة بيع";
  }

  if (
    entry.sourceType === "exchange" &&
    entry.transactionType !== "reversal"
  ) {
    return "فاتورة تبديل";
  }

  if (
    entry.transactionType ===
      "receipt"
  ) {
    return "سند قبض";
  }

  if (
    entry.transactionType ===
      "refund"
  ) {
    return "مرتجع / رصيد للزبون";
  }

  if (
    entry.transactionType ===
      "reversal"
  ) {
    return "عكس حركة";
  }

  return (
    entry.memo ??
    entry.sourceEvent ??
    entry.transactionType ??
    "حركة حساب"
  );
}

function statusLabel(
  value: string | null,
) {
  if (value === "posted") {
    return "مرحّل";
  }

  if (value === "reversed") {
    return "معكوس";
  }

  if (value === "voided") {
    return "ملغى";
  }

  return value ?? "—";
}

function entryDate(
  entry:
    PosCustomerLedgerEntry,
) {
  return (
    entry.businessDate ??
    entry.createdAt.slice(
      0,
      10,
    )
  );
}

function errorText(
  caught: unknown,
) {
  return caught instanceof Error
    ? caught.message
    : "حدث خطأ غير متوقع";
}


function StatementInvoiceItemTable({
  label,
  items,
}: {
  label: string;
  items: PosCustomerLedgerDocumentItem[];
}) {
  if (!items.length) return null;

  return (
    <div className="customer-statement-invoice-group">
      <h4>{label}</h4>
      <table className="customer-statement-invoice-table">
        <thead>
          <tr>
            <th>الصنف / الكود</th>
            <th>اللون والمقاس</th>
            <th>الكمية</th>
            <th>سعر القطعة</th>
            <th>خصم الصنف</th>
            <th>صافي السطر</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={index}>
              <td className="customer-statement-invoice-name">
                <div className="customer-statement-invoice-product">
                  {item.productImage ? (
                    <img
                      className="customer-statement-invoice-image"
                      src={item.productImage}
                      alt={item.productNameAr}
                      loading="eager"
                      decoding="sync"
                    />
                  ) : (
                    <span
                      className="customer-statement-invoice-no-image"
                      aria-label="لا توجد صورة محفوظة"
                    >
                      بدون صورة
                    </span>
                  )}
                  <div>
                    <strong>{item.productNameAr}</strong>
                    {(item.productCode || item.barcode) && (
                      <small dir="ltr">{item.productCode || item.barcode}</small>
                    )}
                  </div>
                </div>
              </td>
              <td>{[item.color, item.size].filter(Boolean).join(" / ") || "—"}</td>
              <td>{item.quantity}</td>
              <td>{money(item.unitPriceMinor)}</td>
              <td>{item.discountMinor ? money(item.discountMinor) : "—"}</td>
              <td>{money(item.lineTotalMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatementInvoiceDetails({
  document,
  netOnly = false,
}: {
  document: PosCustomerLedgerDocument;
  netOnly?: boolean;
}) {
  const netItems = document.netSaleItems ?? document.saleItems;
  return (
    <div className="customer-statement-invoice-details">
      <div className="customer-statement-invoice-heading">
        <strong>
          {netOnly
            ? "الأصناف الصافية بعد التبديل"
            : document.kind === "sale"
              ? "تفاصيل فاتورة البيع"
              : "تفاصيل فاتورة التبديل"}
          {" — "}
          <span dir="ltr">{document.publicId}</span>
        </strong>
      </div>
      {netOnly ? (
        netItems.length > 0 ? (
          <StatementInvoiceItemTable
            label={document.kind === "sale"
              ? "الأصناف المتبقية والبدائل المرتبطة"
              : "الأصناف الجديدة بعد التبديل"}
            items={netItems}
          />
        ) : (
          <p className="customer-statement-net-empty">
            لا توجد أصناف صافية متبقية من هذه الفاتورة.
          </p>
        )
      ) : (
      <>
      {document.kind === "exchange" && (
        <StatementInvoiceItemTable
          label="الأصناف المرتجعة من الزبون"
          items={document.returnItems}
        />
      )}
      <StatementInvoiceItemTable
        label={document.kind === "exchange" ? "الأصناف الجديدة للزبون" : "الأصناف المباعة"}
        items={document.saleItems}
      />
      <div className="customer-statement-invoice-totals">
        {document.kind === "sale" ? (
          <>
            <span>قبل الخصم: {money(document.subtotalMinor ?? 0)}</span>
            <span>إجمالي الخصومات: {money(document.discountMinor ?? 0)}</span>
            <strong>إجمالي الفاتورة: {money(document.totalMinor ?? 0)}</strong>
          </>
        ) : (
          <>
            <span>قيمة المرتجع: {money(document.returnNetMinor ?? 0)}</span>
            <span>قيمة الأصناف الجديدة: {money(document.newNetMinor ?? 0)}</span>
            <span>فرق التبديل: {balanceLabel(document.differenceMinor ?? 0)}</span>
            {(document.deliveryChargeMinor ?? 0) > 0 && (
              <span>رسوم التوصيل: {money(document.deliveryChargeMinor ?? 0)}</span>
            )}
            <strong>صافي تسوية التبديل: {balanceLabel(document.settlementAmountMinor ?? 0)}</strong>
          </>
        )}
      </div>
      </>
      )}
    </div>
  );
}

export default function CustomerStatementReportPage() {
  const {
    token,
    clearAuthentication,
  } = usePosRuntime();

  const [searchParams] =
    useSearchParams();

  const requestedCustomerId =
    searchParams.get(
      "customerId",
    ) ?? "";

  const [
    customers,
    setCustomers,
  ] =
    useState<PosCustomer[]>([]);

  const [
    customerId,
    setCustomerId,
  ] =
    useState("");

  const [
    ledger,
    setLedger,
  ] =
    useState<PosCustomerLedgerResult | null>(
      null,
    );

  const [
    customersBusy,
    setCustomersBusy,
  ] =
    useState(false);

  const [
    ledgerBusy,
    setLedgerBusy,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState("");

  const [
    fromDate,
    setFromDate,
  ] =
    useState("");

  const [
    toDate,
    setToDate,
  ] =
    useState("");

  const [showItemDetails, setShowItemDetails] = useState(false);
  const [showNetItems, setShowNetItems] = useState(false);
  const [detailsLoaded, setDetailsLoaded] = useState(false);

  const [
    selectedMovement,
    setSelectedMovement,
  ] =
    useState<{
      entry:
        PosCustomerLedgerEntry;
      running: number;
      date: string;
    } | null>(null);

  useEffect(() => {
    let active = true;

    setCustomersBusy(true);

    void getPosCustomers(
      token,
    )
      .then((response) => {
        if (!active) {
          return;
        }

        setCustomers(
          response.results,
        );
      })
      .catch((caught) => {
        if (
          caught instanceof
            ApiError &&
          caught.status === 401
        ) {
          clearAuthentication();
          return;
        }

        setError(
          errorText(caught),
        );
      })
      .finally(() => {
        if (active) {
          setCustomersBusy(false);
        }
      });

    return () => {
      active = false;
    };
  }, [
    token,
    clearAuthentication,
  ]);

  useEffect(() => {
    if (
      !requestedCustomerId ||
      customers.length === 0
    ) {
      return;
    }

    const requested =
      customers.find(
        (customer) =>
          String(
            customer.id,
          ) ===
          requestedCustomerId,
      );

    if (
      requested &&
      customerId !==
        String(requested.id)
    ) {
      setCustomerId(
        String(requested.id),
      );
    }
  }, [
    requestedCustomerId,
    customers,
    customerId,
  ]);

  useEffect(() => {
    if (!customerId) {
      setLedger(null);
      setDetailsLoaded(false);
      return;
    }

    let active = true;

    setLedger(null);
    setLedgerBusy(true);
    setDetailsLoaded(false);
    setError("");

    void getPosCustomerLedger(
      token,
      Number(customerId),
      showItemDetails,
      showItemDetails ? toDate : undefined,
    )
      .then((response) => {
        if (!active) {
          return;
        }

        setLedger(response);
        setDetailsLoaded(showItemDetails);
      })
      .catch((caught) => {
        if (
          caught instanceof
            ApiError &&
          caught.status === 401
        ) {
          clearAuthentication();
          return;
        }

        setError(
          errorText(caught),
        );
      })
      .finally(() => {
        if (active) {
          setLedgerBusy(false);
        }
      });

    return () => {
      active = false;
    };
  }, [
    token,
    customerId,
    showItemDetails,
    toDate,
    clearAuthentication,
  ]);

  useEffect(() => {
    setSelectedMovement(null);
  }, [customerId]);

  useEffect(() => {
    if (!selectedMovement) {
      return;
    }

    const handleKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (event.key === "Escape") {
        setSelectedMovement(null);
      }
    };

    window.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, [selectedMovement]);

  const statement =
    useMemo(() => {
      if (!ledger) {
        return {
          rows: [] as Array<{
            entry:
              PosCustomerLedgerEntry;
            running: number;
            date: string;
          }>,
          openingBalanceMinor:
            0,
          closingBalanceMinor:
            0,
        };
      }

      let running = 0;
      let openingBalanceMinor =
        0;

      const allRows =
        ledger.entries.map(
          (entry) => {
            running +=
              entry.debitMinor -
              entry.creditMinor;

            const date =
              entryDate(
                entry,
              );

            if (
              fromDate &&
              date < fromDate
            ) {
              openingBalanceMinor =
                running;
            }

            return {
              entry,
              running,
              date,
            };
          },
        );

      const rows =
        allRows.filter(
          (row) => {
            if (
              fromDate &&
              row.date <
                fromDate
            ) {
              return false;
            }

            if (
              toDate &&
              row.date >
                toDate
            ) {
              return false;
            }

            return true;
          },
        );

      const periodDeltaMinor =
        rows.reduce(
          (
            total,
            row,
          ) =>
            total +
            row.entry
              .debitMinor -
            row.entry
              .creditMinor,
          0,
        );

      return {
        rows,
        openingBalanceMinor,
        closingBalanceMinor:
          openingBalanceMinor +
          periodDeltaMinor,
      };
    }, [
      ledger,
      fromDate,
      toDate,
    ]);

  const rows =
    statement.rows;

  const selectedCustomer =
    customers.find(
      (customer) =>
        String(customer.id) ===
        customerId,
    ) ?? null;

  return (
    <section
      className="work-panel customer-statement-page lk-report-refresh"
      dir="rtl"
    >
      <style>{`
        .customer-statement-print {
          background: #fff;
        }

        .customer-statement-table {
          width: 100%;
          table-layout: fixed;
          border-collapse: collapse;
        }

        .customer-statement-table thead {
          display: table-header-group;
        }

        .customer-statement-table th,
        .customer-statement-table td {
          overflow-wrap: anywhere;
          vertical-align: middle;
        }

        .customer-statement-issued-at {
          margin-top: 5px;
          color: #667085;
          font-size: 11px;
        }

        .customer-statement-page {
          display: grid;
          gap: 16px;
        }

        .customer-statement-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          flex-wrap: wrap;
          padding: 16px 18px;
          border: 1px solid #e6edf3;
          border-radius: 14px;
          background: #fff;
        }

        .customer-statement-toolbar h2 {
          margin: 0 0 4px;
          font-size: 20px;
        }

        .customer-statement-toolbar p {
          margin: 0;
          color: #667085;
          font-size: 12px;
        }

        .customer-statement-filters {
          display: grid;
          grid-template-columns:
            minmax(260px, 2fr)
            repeat(2, minmax(150px, 1fr))
            auto;
          gap: 10px;
          align-items: end;
          padding: 14px;
          border: 1px solid #e6edf3;
          border-radius: 14px;
          background: #fff;
        }

        .customer-statement-filters label > span {
          display: block;
          margin-bottom: 5px;
          color: #475467;
          font-size: 12px;
          font-weight: 800;
        }

        .customer-statement-filters input {
          width: 100%;
          min-height: 38px;
          box-sizing: border-box;
          padding: 0 10px;
          border: 1px solid #cfd9df;
          border-radius: 7px;
          background: #fff;
        }

        .customer-statement-balance-strip {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 16px;
        }

        .customer-statement-balance-strip > div {
          padding: 12px 14px;
          border: 1px solid #e1e8ed;
          border-radius: 12px;
          background: #f9fbfc;
        }

        .customer-statement-balance-strip span,
        .customer-statement-balance-strip strong {
          display: block;
        }

        .customer-statement-balance-strip span {
          margin-bottom: 5px;
          color: #667085;
          font-size: 11px;
          font-weight: 800;
        }

        .customer-statement-balance-strip strong {
          font-size: 15px;
        }

        .customer-statement-table th,
        .customer-statement-table td {
          border: 1px solid #d9d9d9;
          padding: 8px;
          text-align: center;
        }

        .customer-statement-table th {
          font-weight: 700;
        }


        .customer-statement-toolbar-actions {
          display: flex;
          gap: 9px;
          align-items: center;
          flex-wrap: wrap;
        }
        .customer-statement-detail-row > td {
          background: #f8fbfd;
          padding: 12px 14px;
          text-align: right;
        }
        .customer-statement-invoice-details {
          text-align: right;
          color: #1f2937;
        }
        .customer-statement-invoice-heading {
          margin-bottom: 10px;
          font-size: 13px;
        }
        .customer-statement-invoice-group + .customer-statement-invoice-group {
          margin-top: 13px;
        }
        .customer-statement-invoice-group h4 {
          font-size: 12px;
          margin: 8px 0;
          color: #344054;
        }
        .customer-statement-invoice-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: auto;
          font-size: 11px;
        }
        .customer-statement-invoice-table th,
        .customer-statement-invoice-table td {
          padding: 6px;
          border: 1px solid #dfe7ec;
          text-align: center;
          overflow-wrap: anywhere;
        }
        .customer-statement-invoice-table th { background: #edf5f8; }
        .customer-statement-invoice-name { text-align: right !important; }
        .customer-statement-invoice-product {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          gap: 9px;
          min-width: 0;
        }
        .customer-statement-invoice-product > div { min-width: 0; }
        .customer-statement-invoice-image {
          display: block;
          flex: 0 0 46px;
          width: 46px;
          height: 46px;
          border: 1px solid #e3eaf1;
          border-radius: 6px;
          object-fit: contain;
          background: #fff;
        }
        .customer-statement-invoice-no-image {
          display: flex;
          align-items: center;
          justify-content: center;
          flex: 0 0 46px;
          width: 46px;
          height: 46px;
          border: 1px dashed #d1d5db;
          border-radius: 6px;
          color: #98a2b3;
          font-size: 8px;
        }
        .customer-statement-invoice-name small {
          display: block;
          color: #667085;
          margin-top: 3px;
        }
        .customer-statement-net-empty {
          margin: 3px 0;
          font-size: 11px;
          color: #64748b;
        }
        .customer-statement-invoice-totals {
          display: flex;
          flex-wrap: wrap;
          gap: 7px 18px;
          margin-top: 10px;
          font-size: 11px;
        }

        .customer-statement-clickable-row {
          cursor: pointer;
        }

        .customer-statement-clickable-row:hover {
          background: #f7fbfd;
        }

        .customer-movement-overlay {
          position: fixed;
          inset: 0;
          z-index: 2000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          background: rgb(15 34 45 / 45%);
        }

        .customer-movement-dialog {
          width: min(720px, 96vw);
          max-height: 86vh;
          overflow: auto;
          background: #fff;
          border-radius: 12px;
          box-shadow: 0 18px 55px rgb(0 0 0 / 28%);
          border: 1px solid #ccd9df;
        }

        .customer-movement-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 16px 18px;
          border-bottom: 1px solid #dde5e9;
        }

        .customer-movement-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          padding: 18px;
        }

        .customer-movement-field {
          border: 1px solid #dde5e9;
          border-radius: 8px;
          padding: 12px;
          min-width: 0;
        }

        .customer-movement-field span {
          display: block;
          font-size: 12px;
          margin-bottom: 5px;
          color: #5a6970;
        }

        .customer-movement-field strong {
          overflow-wrap: anywhere;
        }

        .customer-movement-field-wide {
          grid-column: 1 / -1;
        }

        @media (max-width: 900px) {
          .customer-statement-filters {
            grid-template-columns: 1fr 1fr;
          }

          .customer-statement-filters > :first-child {
            grid-column: 1 / -1;
          }
        }

        @media (max-width: 680px) {
          .customer-movement-grid,
          .customer-statement-balance-strip,
          .customer-statement-filters {
            grid-template-columns: 1fr;
          }

          .customer-statement-filters > :first-child,
          .customer-movement-field-wide {
            grid-column: auto;
          }
        }

        @media print {
          @page {
            size: A4 portrait;
            margin: 7mm 6mm;
          }

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

          body * {
            visibility: hidden !important;
          }

          #customer-statement-print,
          #customer-statement-print * {
            visibility: visible !important;
          }

          #customer-statement-print {
            position: absolute;
            top: 0;
            right: 0;
            left: 0;
            width: 100%;
            max-width: none;
            padding: 0;
            margin: 0 auto;
            box-sizing: border-box;
            background: #fff;
            color: #111827;
            font-size: 10.5px;
          }

          /* Compact print header: the screen layout remains unchanged. */
          .customer-statement-print-header {
            margin-bottom: 2mm !important;
          }

          #customer-statement-print h1 {
            margin: 0 0 0.5mm !important;
            font-size: 16px;
            line-height: 1.15;
          }

          #customer-statement-print h2 {
            margin: 0 !important;
            font-size: 12px;
            line-height: 1.15;
          }

          .customer-statement-issued-at {
            margin: 0.6mm 0 0 !important;
            font-size: 8px;
            line-height: 1.2;
          }

          .customer-statement-customer-info {
            gap: 1mm 3mm !important;
            margin-bottom: 2mm !important;
            padding: 1.8mm 2mm !important;
            border-radius: 0 !important;
            font-size: 8px;
            line-height: 1.25;
          }

          .customer-statement-balance-strip {
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 1.5mm;
            margin-bottom: 2mm;
          }

          .customer-statement-balance-strip > div {
            min-height: 0;
            padding: 1.4mm 1.8mm;
            border-radius: 0;
          }

          .customer-statement-balance-strip span {
            margin-bottom: 0.5mm;
            font-size: 7px;
            line-height: 1.15;
          }

          .customer-statement-balance-strip strong {
            font-size: 9px;
            line-height: 1.2;
          }

          .customer-statement-table {
            width: 100%;
            table-layout: fixed;
            border-collapse: collapse;
          }

          .customer-statement-table thead {
            display: table-header-group;
          }

          .customer-statement-table th,
          .customer-statement-table td {
            padding: 1mm 0.8mm;
            font-size: 7.5px;
            line-height: 1.2;
            text-align: center;
          }

          .customer-statement-table > tbody > tr > td[dir="ltr"] {
            font-size: 6.7px;
            overflow-wrap: anywhere;
          }

          .customer-statement-table th {
            background: #f3f4f6 !important;
          }

          /*
           * Preserve single-line movements, but allow long invoice detail
           * sections to continue on the next page. Keeping the entire
           * nested detail row unbreakable caused nearly empty pages.
           */
          .customer-statement-clickable-row,
          .customer-statement-invoice-table tbody tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .customer-statement-table > tbody > tr.customer-statement-detail-row,
          .customer-statement-invoice-details,
          .customer-statement-invoice-group {
            break-inside: auto !important;
            page-break-inside: auto !important;
          }

          .customer-statement-detail-row > td {
            padding: 1mm !important;
            text-align: right !important;
          }

          .customer-statement-invoice-heading {
            margin-bottom: 0.8mm;
            font-size: 8.5px;
            line-height: 1.2;
          }

          .customer-statement-invoice-group + .customer-statement-invoice-group {
            margin-top: 1.2mm;
          }

          .customer-statement-invoice-group h4 {
            margin: 0 0 0.8mm;
            font-size: 8px;
            line-height: 1.2;
          }

          .customer-statement-invoice-table {
            table-layout: fixed;
            font-size: 7.5px;
          }

          .customer-statement-invoice-table thead {
            display: table-header-group;
          }

          .customer-statement-invoice-table th,
          .customer-statement-invoice-table td {
            padding: 0.7mm 0.7mm;
            font-size: 7px;
            line-height: 1.15;
            vertical-align: middle;
          }

          /* Give product names room on narrow portrait paper. */
          .customer-statement-invoice-table th:first-child,
          .customer-statement-invoice-table td:first-child { width: 38%; }
          .customer-statement-invoice-table th:nth-child(2),
          .customer-statement-invoice-table td:nth-child(2) { width: 20%; }
          .customer-statement-invoice-table th:nth-child(3),
          .customer-statement-invoice-table td:nth-child(3) { width: 7%; }
          .customer-statement-invoice-table th:nth-child(4),
          .customer-statement-invoice-table td:nth-child(4) { width: 12%; }
          .customer-statement-invoice-table th:nth-child(5),
          .customer-statement-invoice-table td:nth-child(5) { width: 11%; }
          .customer-statement-invoice-table th:nth-child(6),
          .customer-statement-invoice-table td:nth-child(6) { width: 12%; }

          .customer-statement-invoice-image,
          .customer-statement-invoice-no-image {
            flex: 0 0 8mm;
            width: 8mm;
            height: 8mm;
            border-radius: 0.7mm;
          }
          .customer-statement-invoice-product { gap: 1mm; }
          .customer-statement-invoice-name small {
            margin-top: 0.3mm;
            font-size: 6px;
          }
          .customer-statement-invoice-totals {
            margin-top: 1mm;
            gap: 1mm 3mm;
            font-size: 7.5px;
            line-height: 1.2;
          }

          .customer-statement-bottom-balance {
            margin-top: 2mm !important;
            padding-top: 1.5mm !important;
            font-size: 11px !important;
            break-inside: avoid;
          }
          .customer-statement-footer {
            margin-top: 2mm !important;
            font-size: 8px !important;
          }

          .customer-statement-clickable-row {
            cursor: default;
          }

          .customer-statement-no-print {
            display: none !important;
          }
        }
      `}</style>

      <div className="customer-statement-no-print customer-statement-toolbar">
        <div>
          <h2>
            📒 كشف حساب زبون
          </h2>

          <p>
            عرض كامل حركات الزبون
            والرصيد بعد كل حركة.
          </p>
        </div>

        <div className="customer-statement-toolbar-actions">
          <button
            type="button"
            className={showItemDetails ? "primary-button" : "secondary-button"}
            aria-pressed={showItemDetails}
            disabled={!customerId || ledgerBusy}
            onClick={() => {
              setShowItemDetails((current) => !current);
              setShowNetItems(false);
            }}
          >
            {showItemDetails ? "✓ إخفاء تفاصيل الأصناف" : "▤ إظهار تفاصيل الأصناف"}
          </button>
          <button
            type="button"
            className={showNetItems ? "primary-button" : "secondary-button"}
            aria-pressed={showNetItems}
            disabled={!showItemDetails || !detailsLoaded || ledgerBusy}
            onClick={() => setShowNetItems((current) => !current)}
          >
            {showNetItems ? "✓ عرض الأصناف الصافية" : "إخفاء المرتجعات (الصافي)"}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!ledger || ledgerBusy || (showItemDetails && !detailsLoaded)}
            onClick={() => window.print()}
          >
            🖨️ طباعة A4
          </button>
        </div>
      </div>

      <div className="customer-statement-no-print customer-statement-filters">
        <CustomerPicker
          customers={customers}
          value={customerId}
          loading={
            customersBusy
          }
          label="الزبون"
          placeholder="اختر الزبون"
          onChange={(customer) =>
            setCustomerId(
              customer
                ? String(
                    customer.id,
                  )
                : "",
            )
          }
        />

        <label>
          <span>
            من تاريخ
          </span>

          <input
            type="date"
            value={fromDate}
            onChange={(
              event,
            ) =>
              setFromDate(
                event.target.value,
              )
            }
          />
        </label>

        <label>
          <span>
            إلى تاريخ
          </span>

          <input
            type="date"
            value={toDate}
            onChange={(
              event,
            ) =>
              setToDate(
                event.target.value,
              )
            }
          />
        </label>

        <button
          type="button"
          className="secondary-button"
          disabled={
            !fromDate &&
            !toDate
          }
          onClick={() => {
            setFromDate("");
            setToDate("");
          }}
        >
          مسح الفترة
        </button>
      </div>

      {error && (
        <div
          className="error-message customer-statement-no-print"
          style={{
            marginBottom: 14,
          }}
        >
          {error}
        </div>
      )}

      {ledgerBusy && (
        <div
          className="customer-statement-no-print"
        >
          جاري تحميل كشف
          الحساب...
        </div>
      )}

      {ledger && (
        <div
          id="customer-statement-print"
          className="customer-statement-print"
        >
          <div
            className="customer-statement-print-header"
            style={{
              textAlign:
                "center",
              marginBottom: 20,
            }}
          >
            <h1
              style={{
                marginBottom: 4,
              }}
            >
              Lovely Kids
            </h1>

            <h2
              style={{
                margin:
                  "4px 0",
              }}
            >
              كشف حساب زبون
            </h2>

            <div className="customer-statement-issued-at">
              تاريخ إصدار الكشف:{" "}
              {new Date().toLocaleString(
                "ar-PS",
                {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                },
              )}
            </div>
          </div>

          <div
            className="customer-statement-customer-info"
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(2, 1fr)",
              gap: 10,
              marginBottom: 18,
              border:
                "1px solid #ddd",
              padding: 14,
              borderRadius: 8,
            }}
          >
            <div>
              <strong>
                اسم الزبون:
              </strong>{" "}
              {ledger.customer.name}
            </div>

            <div>
              <strong>
                الهاتف:
              </strong>{" "}
              {ledger.customer.phone ??
                "—"}
            </div>

            <div>
              <strong>
                كود الزبون:
              </strong>{" "}
              {ledger.customer.code}
            </div>

            <div>
              <strong>
                الرصيد الحالي:
              </strong>{" "}
              {balanceLabel(
                ledger.balanceMinor,
              )}
            </div>

            {(fromDate ||
              toDate) && (
              <div
                style={{
                  gridColumn:
                    "1 / -1",
                }}
              >
                <strong>
                  الفترة:
                </strong>{" "}
                {fromDate ||
                  "من البداية"}
                {" — "}
                {toDate ||
                  "حتى الآن"}
              </div>
            )}
          </div>

          {showItemDetails && detailsLoaded && (
            <p className="customer-statement-issued-at" style={{ textAlign: "center" }}>
              {showNetItems
                ? "عرض الأصناف الصافية بعد التبديل — يُخفي المرتجعات ويعرض الكميات المتبقية والبدائل؛ الحركات والأرصدة المالية دون تغيير."
                : "كشف مفصّل يتضمن أصناف فواتير البيع والتبديل"}
            </p>
          )}

          <div className="customer-statement-balance-strip">
            <div>
              <span>
                الرصيد الافتتاحي للفترة
              </span>
              <strong>
                {balanceLabel(
                  statement.openingBalanceMinor,
                )}
              </strong>
            </div>

            <div>
              <span>
                حركة الفترة
              </span>
              <strong>
                {balanceLabel(
                  statement.closingBalanceMinor -
                    statement.openingBalanceMinor,
                )}
              </strong>
            </div>

            <div>
              <span>
                الرصيد الختامي للفترة
              </span>
              <strong>
                {balanceLabel(
                  statement.closingBalanceMinor,
                )}
              </strong>
            </div>
          </div>

          {rows.length ===
          0 ? (
            <div
              style={{
                textAlign:
                  "center",
                padding: 30,
              }}
            >
              لا توجد حركات ضمن
              الفترة المحددة.
            </div>
          ) : (
            <table className="customer-statement-table">
              <colgroup>
                <col style={{ width: "5%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "24%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "14%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>#</th>
                  <th>التاريخ</th>
                  <th>
                    رقم المستند
                  </th>
                  <th>
                    نوع الحركة
                  </th>
                  <th>البيان</th>
                  <th>عليه</th>
                  <th>له</th>
                  <th>
                    الرصيد
                  </th>
                </tr>
              </thead>

              <tbody>
                {rows.map(
                  (
                    row,
                    index,
                  ) => (
                    <Fragment key={`${row.entry.transactionId ?? "x"}_${index}`}>
                    <tr
                      className="customer-statement-clickable-row"
                      role="button"
                      tabIndex={0}
                      title="فتح تفاصيل الحركة"
                      onClick={() =>
                        setSelectedMovement(
                          row,
                        )
                      }
                      onKeyDown={(
                        event,
                      ) => {
                        if (
                          event.key !==
                            "Enter" &&
                          event.key !==
                            " "
                        ) {
                          return;
                        }

                        event.preventDefault();

                        setSelectedMovement(
                          row,
                        );
                      }}
                    >
                      <td>
                        {index + 1}
                      </td>

                      <td>
                        {row.date}
                      </td>

                      <td dir="ltr">
                        {row.entry.publicId ??
                          "—"}
                      </td>

                      <td>
                        {movementLabel(
                          row.entry,
                        )}
                      </td>

                      <td>
                        {row.entry.memo ??
                          "—"}
                      </td>

                      <td>
                        {row.entry.debitMinor >
                        0
                          ? money(
                              row.entry
                                .debitMinor,
                            )
                          : "—"}
                      </td>

                      <td>
                        {row.entry.creditMinor >
                        0
                          ? money(
                              row.entry
                                .creditMinor,
                            )
                          : "—"}
                      </td>

                      <td>
                        {balanceLabel(
                          row.running,
                        )}
                      </td>
                    </tr>
                    {showItemDetails && detailsLoaded &&
                      (row.entry.sourceType === "pos_sale" || row.entry.sourceType === "exchange") &&
                      (!showNetItems || row.entry.transactionType !== "reversal") && (
                        <tr className="customer-statement-detail-row">
                          <td colSpan={8}>
                            {row.entry.document ? (
                              <StatementInvoiceDetails document={row.entry.document} netOnly={showNetItems} />
                            ) : (
                              <span>تفاصيل أصناف هذه الفاتورة غير متوفرة في السجل.</span>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ),
                )}
              </tbody>
            </table>
          )}

          <div
            className="customer-statement-bottom-balance"
            style={{
              display: "flex",
              justifyContent:
                "space-between",
              marginTop: 18,
              borderTop:
                "2px solid #222",
              paddingTop: 12,
              fontSize: 16,
            }}
          >
            <strong>
              {fromDate || toDate
                ? "الرصيد الختامي للفترة"
                : "الرصيد النهائي"}
            </strong>

            <strong>
              {balanceLabel(
                fromDate ||
                  toDate
                  ? statement.closingBalanceMinor
                  : ledger.balanceMinor,
              )}
            </strong>
          </div>

          <div
            className="customer-statement-footer"
            style={{
              marginTop: 20,
              textAlign:
                "center",
              fontSize: 12,
            }}
          >
            تم إصدار كشف الحساب
            من نظام Lovely Kids
          </div>
        </div>
      )}

      {!ledger &&
        !ledgerBusy &&
        selectedCustomer && (
          <div>
            اختر الزبون لعرض
            كشف الحساب.
          </div>
        )}

      {selectedMovement && (
        <div
          className="customer-movement-overlay customer-statement-no-print"
          role="presentation"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setSelectedMovement(
                null,
              );
            }
          }}
        >
          <section
            className="customer-movement-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="تفاصيل حركة حساب الزبون"
          >
            <header className="customer-movement-header">
              <div>
                <h3
                  style={{
                    margin: 0,
                  }}
                >
                  📄 تفاصيل الحركة
                </h3>

                <small>
                  {movementLabel(
                    selectedMovement.entry,
                  )}
                </small>
              </div>

              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  setSelectedMovement(
                    null,
                  )
                }
              >
                ✕ إغلاق
              </button>
            </header>

            <div className="customer-movement-grid">
              <div className="customer-movement-field">
                <span>
                  التاريخ
                </span>
                <strong>
                  {selectedMovement.date}
                </strong>
              </div>

              <div className="customer-movement-field">
                <span>
                  نوع الحركة
                </span>
                <strong>
                  {movementLabel(
                    selectedMovement.entry,
                  )}
                </strong>
              </div>

              <div className="customer-movement-field customer-movement-field-wide">
                <span>
                  رقم المستند
                </span>
                <strong dir="ltr">
                  {selectedMovement.entry.publicId ??
                    "—"}
                </strong>
              </div>

              <div className="customer-movement-field customer-movement-field-wide">
                <span>
                  البيان
                </span>
                <strong>
                  {selectedMovement.entry.memo ??
                    "—"}
                </strong>
              </div>

              <div className="customer-movement-field">
                <span>
                  عليه
                </span>
                <strong>
                  {selectedMovement.entry.debitMinor >
                  0
                    ? money(
                        selectedMovement.entry
                          .debitMinor,
                      )
                    : "—"}
                </strong>
              </div>

              <div className="customer-movement-field">
                <span>
                  له
                </span>
                <strong>
                  {selectedMovement.entry.creditMinor >
                  0
                    ? money(
                        selectedMovement.entry
                          .creditMinor,
                      )
                    : "—"}
                </strong>
              </div>

              <div className="customer-movement-field">
                <span>
                  الرصيد بعد الحركة
                </span>
                <strong>
                  {balanceLabel(
                    selectedMovement.running,
                  )}
                </strong>
              </div>

              <div className="customer-movement-field">
                <span>
                  حالة القيد
                </span>
                <strong>
                  {statusLabel(
                    selectedMovement.entry
                      .status,
                  )}
                </strong>
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
