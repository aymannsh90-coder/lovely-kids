import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { usePosRuntime } from "../../app/pos-context";
import {
  ApiError,
  getPosSupplierLedger,
  getPosSuppliers,
  type PosSupplier,
  type PosSupplierLedgerEntry,
  type PosSupplierLedgerResult,
} from "../../lib/api";

function money(minor: number) {
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(minor) / 100)} ₪`;
}

function balanceLabel(minor: number) {
  if (minor > 0) {
    return `مستحق للمورد ${money(minor)}`;
  }

  if (minor < 0) {
    return `لنا عند المورد ${money(minor)}`;
  }

  return "مسدد";
}

function entryDate(entry: PosSupplierLedgerEntry) {
  return (
    entry.businessDate ??
    entry.createdAt.slice(0, 10)
  );
}

function movementLabel(entry: PosSupplierLedgerEntry) {
  if (entry.sourceType === "pos_purchase") {
    return "فاتورة مشتريات";
  }

  if (
    entry.transactionType === "payment" ||
    entry.sourceEvent?.includes("payment")
  ) {
    return "دفعة للمورد";
  }

  if (
    entry.transactionType === "receipt" ||
    entry.sourceEvent?.includes("receipt")
  ) {
    return "قبض من المورد";
  }

  if (entry.transactionType === "reversal") {
    return "عكس حركة";
  }

  return (
    entry.memo ??
    entry.sourceEvent ??
    entry.transactionType ??
    "حركة حساب"
  );
}

function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "حدث خطأ غير متوقع";
}

export default function SupplierStatementReportPage() {
  const {
    token,
    clearAuthentication,
  } = usePosRuntime();

  const [searchParams] = useSearchParams();
  const requestedSupplierId =
    searchParams.get("supplierId") ?? "";

  const [suppliers, setSuppliers] =
    useState<PosSupplier[]>([]);
  const [supplierId, setSupplierId] =
    useState("");
  const [ledger, setLedger] =
    useState<PosSupplierLedgerResult | null>(null);
  const [fromDate, setFromDate] =
    useState("");
  const [toDate, setToDate] =
    useState("");
  const [loadingSuppliers, setLoadingSuppliers] =
    useState(false);
  const [loadingLedger, setLoadingLedger] =
    useState(false);
  const [error, setError] =
    useState("");

  useEffect(() => {
    let active = true;

    setLoadingSuppliers(true);
    setError("");

    void getPosSuppliers(token)
      .then((result) => {
        if (!active) {
          return;
        }

        setSuppliers(result.results);
      })
      .catch((caught) => {
        if (
          caught instanceof ApiError &&
          caught.status === 401
        ) {
          clearAuthentication();
          return;
        }

        setError(errorText(caught));
      })
      .finally(() => {
        if (active) {
          setLoadingSuppliers(false);
        }
      });

    return () => {
      active = false;
    };
  }, [token, clearAuthentication]);

  useEffect(() => {
    if (
      !requestedSupplierId ||
      suppliers.length === 0
    ) {
      return;
    }

    if (
      suppliers.some(
        (supplier) =>
          supplier.id === requestedSupplierId,
      )
    ) {
      setSupplierId(requestedSupplierId);
    }
  }, [requestedSupplierId, suppliers]);

  useEffect(() => {
    if (!supplierId) {
      setLedger(null);
      return;
    }

    let active = true;

    setLoadingLedger(true);
    setError("");

    void getPosSupplierLedger(
      token,
      Number(supplierId),
    )
      .then((result) => {
        if (active) {
          setLedger(result);
        }
      })
      .catch((caught) => {
        if (
          caught instanceof ApiError &&
          caught.status === 401
        ) {
          clearAuthentication();
          return;
        }

        if (active) {
          setError(errorText(caught));
        }
      })
      .finally(() => {
        if (active) {
          setLoadingLedger(false);
        }
      });

    return () => {
      active = false;
    };
  }, [
    token,
    supplierId,
    clearAuthentication,
  ]);

  const statement =
    useMemo(() => {
      if (!ledger) {
        return {
          rows: [] as Array<{
            entry: PosSupplierLedgerEntry;
            date: string;
            running: number;
          }>,
          openingBalanceMinor: 0,
          closingBalanceMinor: 0,
          periodDebitMinor: 0,
          periodCreditMinor: 0,
        };
      }

      let running =
        ledger.baseOpeningBalanceMinor;
      let openingBalanceMinor =
        ledger.baseOpeningBalanceMinor;

      const allRows =
        ledger.entries.map((entry) => {
          running +=
            entry.creditMinor -
            entry.debitMinor;

          const date =
            entryDate(entry);

          if (
            fromDate &&
            date < fromDate
          ) {
            openingBalanceMinor =
              running;
          }

          return {
            entry,
            date,
            running,
          };
        });

      const rows =
        allRows.filter((row) => {
          if (
            fromDate &&
            row.date < fromDate
          ) {
            return false;
          }

          if (
            toDate &&
            row.date > toDate
          ) {
            return false;
          }

          return true;
        });

      const periodDebitMinor =
        rows.reduce(
          (sum, row) =>
            sum +
            row.entry.debitMinor,
          0,
        );

      const periodCreditMinor =
        rows.reduce(
          (sum, row) =>
            sum +
            row.entry.creditMinor,
          0,
        );

      return {
        rows,
        openingBalanceMinor,
        closingBalanceMinor:
          openingBalanceMinor +
          periodCreditMinor -
          periodDebitMinor,
        periodDebitMinor,
        periodCreditMinor,
      };
    }, [
      ledger,
      fromDate,
      toDate,
    ]);

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

  return (
    <section
      className="work-panel supplier-statement-page"
      dir="rtl"
    >
      <style>{`
        .supplier-statement-page {
          display: grid;
          gap: 16px;
        }

        .supplier-statement-no-print,
        .supplier-statement-toolbar,
        .supplier-statement-filters {
          background: #fff;
        }

        .supplier-statement-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          flex-wrap: wrap;
          padding: 16px 18px;
          border: 1px solid #e6edf3;
          border-radius: 14px;
        }

        .supplier-statement-toolbar h2 {
          margin: 0 0 4px;
          font-size: 20px;
        }

        .supplier-statement-toolbar p {
          margin: 0;
          color: #667085;
          font-size: 12px;
        }

        .supplier-statement-filters {
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
        }

        .supplier-statement-filters label {
          display: grid;
          gap: 5px;
        }

        .supplier-statement-filters label > span {
          color: #475467;
          font-size: 12px;
          font-weight: 800;
        }

        .supplier-statement-filters select,
        .supplier-statement-filters input {
          width: 100%;
          min-height: 40px;
          box-sizing: border-box;
          border: 1px solid #cfd9df;
          border-radius: 8px;
          padding: 0 10px;
          background: #fff;
        }

        .supplier-statement-print {
          background: #fff;
        }

        .supplier-statement-info {
          display: grid;
          grid-template-columns:
            repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 14px;
          border: 1px solid #dce3e8;
          border-radius: 10px;
          padding: 14px;
        }

        .supplier-statement-summary {
          display: grid;
          grid-template-columns:
            repeat(4, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 16px;
        }

        .supplier-statement-summary article {
          padding: 12px 14px;
          border: 1px solid #e1e8ed;
          border-radius: 12px;
          background: #f9fbfc;
        }

        .supplier-statement-summary span,
        .supplier-statement-summary strong {
          display: block;
        }

        .supplier-statement-summary span {
          margin-bottom: 5px;
          color: #667085;
          font-size: 11px;
          font-weight: 800;
        }

        .supplier-statement-summary strong {
          font-size: 14px;
        }

        .supplier-statement-table {
          width: 100%;
          table-layout: fixed;
          border-collapse: collapse;
        }

        .supplier-statement-table th,
        .supplier-statement-table td {
          border: 1px solid #d6dde2;
          padding: 8px 6px;
          text-align: center;
          vertical-align: middle;
          overflow-wrap: anywhere;
        }

        .supplier-statement-table th {
          background: #f3f4f6;
        }

        .supplier-statement-table thead {
          display: table-header-group;
        }

        .supplier-statement-final {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          margin-top: 18px;
          border-top: 2px solid #222;
          padding-top: 12px;
          font-size: 16px;
        }

        @media (max-width: 760px) {
          .supplier-statement-filters,
          .supplier-statement-summary,
          .supplier-statement-info {
            grid-template-columns: 1fr;
          }
        }

        @media print {
          @page {
            size: A4 landscape;
            margin: 9mm 10mm;
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

          #supplier-statement-print,
          #supplier-statement-print * {
            visibility: visible !important;
          }

          #supplier-statement-print {
            position: absolute;
            inset: 0;
            width: 100%;
            margin: 0;
            padding: 0;
            color: #111827;
            background: #fff;
            font-size: 9px;
          }

          .supplier-statement-no-print {
            display: none !important;
          }

          .supplier-statement-info {
            grid-template-columns:
              repeat(2, minmax(0, 1fr));
            gap: 2.5mm;
            margin-bottom: 3mm;
            padding: 3mm;
            border-radius: 0;
          }

          .supplier-statement-summary {
            grid-template-columns:
              repeat(4, minmax(0, 1fr));
            gap: 2mm;
            margin-bottom: 3mm;
          }

          .supplier-statement-summary article {
            padding: 2.5mm;
            border-radius: 0;
          }

          .supplier-statement-table th,
          .supplier-statement-table td {
            padding: 1.7mm 1.2mm;
            font-size: 8.2px;
            line-height: 1.3;
          }

          .supplier-statement-table tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .supplier-statement-final {
            margin-top: 4mm;
            padding-top: 2.5mm;
            font-size: 11px;
          }
        }
      `}</style>

      <div className="supplier-statement-no-print supplier-statement-toolbar">
        <div>
          <h2>🚚 كشف حساب مورد</h2>
          <p>
            فواتير المشتريات والدفعات والعكس والرصيد بعد كل حركة.
          </p>
        </div>

        <button
          type="button"
          className="primary-button"
          disabled={!ledger}
          onClick={() =>
            window.print()
          }
        >
          🖨️ طباعة A4
        </button>
      </div>

      <div className="supplier-statement-no-print supplier-statement-filters">
        <label>
          <span>المورد</span>
          <select
            value={supplierId}
            disabled={loadingSuppliers}
            onChange={(event) =>
              setSupplierId(
                event.target.value,
              )
            }
          >
            <option value="">
              {loadingSuppliers
                ? "جاري تحميل الموردين..."
                : "اختر المورد"}
            </option>

            {suppliers.map(
              (supplier) => (
                <option
                  key={supplier.id}
                  value={supplier.id}
                >
                  {supplier.name} — {supplier.code}
                </option>
              ),
            )}
          </select>
        </label>

        <label>
          <span>من تاريخ</span>
          <input
            type="date"
            value={fromDate}
            onChange={(event) =>
              setFromDate(
                event.target.value,
              )
            }
          />
        </label>

        <label>
          <span>إلى تاريخ</span>
          <input
            type="date"
            value={toDate}
            onChange={(event) =>
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
        <div className="alert error-alert supplier-statement-no-print">
          {error}
        </div>
      )}

      {loadingLedger && (
        <div className="supplier-statement-no-print">
          جاري تحميل كشف المورد...
        </div>
      )}

      {ledger && (
        <div
          id="supplier-statement-print"
          className="supplier-statement-print"
        >
          <header
            style={{
              textAlign: "center",
              marginBottom: 16,
            }}
          >
            <h1
              style={{
                margin: 0,
                color: "#E91E8C",
                fontSize: 21,
              }}
            >
              Lovely Kids
            </h1>

            <h2
              style={{
                margin: "4px 0",
              }}
            >
              كشف حساب مورد
            </h2>

            <div
              style={{
                color: "#667085",
                fontSize: 11,
              }}
            >
              تاريخ إصدار الكشف: {generatedAt}
            </div>
          </header>

          <div className="supplier-statement-info">
            <div>
              <strong>اسم المورد:</strong>{" "}
              {ledger.supplier.name}
            </div>

            <div>
              <strong>رمز المورد:</strong>{" "}
              <span dir="ltr">
                {ledger.supplier.code}
              </span>
            </div>

            <div>
              <strong>الهاتف:</strong>{" "}
              {[ledger.supplier.phone, ledger.supplier.mobile]
                .filter(Boolean)
                .join(" / ") || "—"}
            </div>

            <div>
              <strong>الفترة:</strong>{" "}
              {fromDate || "من البداية"}
              {" — "}
              {toDate || "حتى الآن"}
            </div>
          </div>

          <div className="supplier-statement-summary">
            <article>
              <span>الرصيد الافتتاحي للفترة</span>
              <strong>
                {balanceLabel(
                  statement.openingBalanceMinor,
                )}
              </strong>
            </article>

            <article>
              <span>مدين الفترة / تخفيض المستحق</span>
              <strong>
                {money(
                  statement.periodDebitMinor,
                )}
              </strong>
            </article>

            <article>
              <span>دائن الفترة / زيادة المستحق</span>
              <strong>
                {money(
                  statement.periodCreditMinor,
                )}
              </strong>
            </article>

            <article>
              <span>الرصيد الختامي للفترة</span>
              <strong>
                {balanceLabel(
                  statement.closingBalanceMinor,
                )}
              </strong>
            </article>
          </div>

          {statement.rows.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: 28,
              }}
            >
              لا توجد حركات ضمن الفترة المحددة.
            </div>
          ) : (
            <table className="supplier-statement-table">
              <colgroup>
                <col style={{ width: "5%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "15%" }} />
                <col style={{ width: "26%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "10%" }} />
              </colgroup>

              <thead>
                <tr>
                  <th>#</th>
                  <th>التاريخ</th>
                  <th>رقم المستند</th>
                  <th>نوع الحركة</th>
                  <th>البيان</th>
                  <th>مدين</th>
                  <th>دائن</th>
                  <th>الرصيد</th>
                </tr>
              </thead>

              <tbody>
                {statement.rows.map(
                  (row, index) => (
                    <tr
                      key={
                        row.entry.lineId ??
                        `${row.entry.transactionId ?? "x"}_${index}`
                      }
                    >
                      <td>{index + 1}</td>
                      <td>{row.date}</td>
                      <td dir="ltr">
                        {row.entry.publicId ?? "—"}
                      </td>
                      <td>
                        {movementLabel(
                          row.entry,
                        )}
                      </td>
                      <td>
                        {row.entry.memo ?? "—"}
                      </td>
                      <td>
                        {row.entry.debitMinor > 0
                          ? money(row.entry.debitMinor)
                          : "—"}
                      </td>
                      <td>
                        {row.entry.creditMinor > 0
                          ? money(row.entry.creditMinor)
                          : "—"}
                      </td>
                      <td>
                        {balanceLabel(
                          row.running,
                        )}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          )}

          <div className="supplier-statement-final">
            <strong>
              {fromDate || toDate
                ? "الرصيد الختامي للفترة"
                : "الرصيد الحالي"}
            </strong>

            <strong>
              {balanceLabel(
                fromDate || toDate
                  ? statement.closingBalanceMinor
                  : ledger.balanceMinor,
              )}
            </strong>
          </div>

          <div
            style={{
              marginTop: 18,
              textAlign: "center",
              color: "#667085",
              fontSize: 10,
            }}
          >
            كشف صادر من نظام Lovely Kids — للمطابقة والمراجعة.
          </div>
        </div>
      )}
    </section>
  );
}
