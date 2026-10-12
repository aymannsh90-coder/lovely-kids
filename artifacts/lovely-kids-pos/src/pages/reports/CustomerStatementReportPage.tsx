import { useSearchParams } from "react-router-dom";
import CustomerPicker from "../../components/CustomerPicker";
import {
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
  if (
    entry.sourceType ===
      "pos_sale" ||
    entry.transactionType ===
      "sale"
  ) {
    return "فاتورة بيع";
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
      return;
    }

    let active = true;

    setLedgerBusy(true);
    setError("");

    void getPosCustomerLedger(
      token,
      Number(customerId),
    )
      .then((response) => {
        if (!active) {
          return;
        }

        setLedger(response);
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
      className="work-panel customer-statement-page"
      dir="rtl"
    >
      <style>{`
        .customer-statement-print {
          background: #fff;
        }

        .customer-statement-table {
          width: 100%;
          border-collapse: collapse;
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
            size: A4;
            margin: 12mm;
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
            width: 100%;
            padding: 0;
            margin: 0;
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
          </div>

          <div
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
                fromDate ||
                  toDate
                  ? statement.closingBalanceMinor
                  : ledger.balanceMinor,
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
                    <tr
                      key={`${row.entry.transactionId ?? "x"}_${index}`}
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
                  ),
                )}
              </tbody>
            </table>
          )}

          <div
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
                ledger.balanceMinor,
              )}
            </strong>
          </div>

          <div
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
