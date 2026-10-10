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

  useEffect(() => {
    let active = true;

    setCustomersBusy(true);

    void getPosCustomers(
      token,
      {
        status: "active",
      },
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

  const rows =
    useMemo(() => {
      if (!ledger) {
        return [];
      }

      let running = 0;

      return ledger.entries
        .map((entry) => {
          running +=
            entry.debitMinor -
            entry.creditMinor;

          return {
            entry,
            running,
            date:
              entryDate(
                entry,
              ),
          };
        })
        .filter((row) => {
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
    }, [
      ledger,
      fromDate,
      toDate,
    ]);

  const selectedCustomer =
    customers.find(
      (customer) =>
        String(customer.id) ===
        customerId,
    ) ?? null;

  return (
    <section
      className="work-panel"
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

        .customer-statement-table th,
        .customer-statement-table td {
          border: 1px solid #d9d9d9;
          padding: 8px;
          text-align: center;
        }

        .customer-statement-table th {
          font-weight: 700;
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

      <div
        className="customer-statement-no-print"
        style={{
          display: "flex",
          justifyContent:
            "space-between",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
          marginBottom: 18,
        }}
      >
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

      <div
        className="customer-statement-no-print"
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(260px, 2fr) repeat(2, minmax(150px, 1fr))",
          gap: 12,
          marginBottom: 18,
        }}
      >
        <label>
          <span>الزبون</span>

          <select
            value={
              customerId
            }
            disabled={
              customersBusy
            }
            onChange={(
              event,
            ) =>
              setCustomerId(
                event.target.value,
              )
            }
          >
            <option value="">
              اختر الزبون
            </option>

            {customers.map(
              (customer) => (
                <option
                  key={
                    customer.id
                  }
                  value={
                    customer.id
                  }
                >
                  {customer.name}
                  {customer.phone
                    ? ` — ${customer.phone}`
                    : ""}
                </option>
              ),
            )}
          </select>
        </label>

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
              الرصيد النهائي
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
    </section>
  );
}
