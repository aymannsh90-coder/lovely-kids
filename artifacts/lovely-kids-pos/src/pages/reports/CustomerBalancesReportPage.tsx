import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  useNavigate,
} from "react-router-dom";

import {
  ApiError,
  getPosCustomers,
  type PosCustomer,
} from "../../lib/api";

import {
  usePosRuntime,
} from "../../app/pos-context";

type BalanceFilter =
  | "all"
  | "debit"
  | "credit";

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

function errorText(
  caught: unknown,
) {
  return caught instanceof Error
    ? caught.message
    : "حدث خطأ غير متوقع";
}

export default function CustomerBalancesReportPage() {
  const {
    token,
    clearAuthentication,
  } = usePosRuntime();

  const navigate =
    useNavigate();

  const [
    customers,
    setCustomers,
  ] =
    useState<PosCustomer[]>([]);

  const [
    query,
    setQuery,
  ] =
    useState("");

  const [
    filter,
    setFilter,
  ] =
    useState<BalanceFilter>(
      "all",
    );

  const [
    busy,
    setBusy,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState("");

  useEffect(() => {
    let active = true;

    setBusy(true);
    setError("");

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

        if (active) {
          setError(
            errorText(caught),
          );
        }
      })
      .finally(() => {
        if (active) {
          setBusy(false);
        }
      });

    return () => {
      active = false;
    };
  }, [
    token,
    clearAuthentication,
  ]);

  const balanceCustomers =
    useMemo(
      () =>
        customers.filter(
          (customer) =>
            customer.balanceMinor !==
            0,
        ),
      [customers],
    );

  const summary =
    useMemo(() => {
      let debitMinor = 0;
      let creditMinor = 0;

      for (
        const customer of
        balanceCustomers
      ) {
        if (
          customer.balanceMinor >
          0
        ) {
          debitMinor +=
            customer.balanceMinor;
        } else {
          creditMinor +=
            Math.abs(
              customer.balanceMinor,
            );
        }
      }

      return {
        debitMinor,
        creditMinor,
        netMinor:
          debitMinor -
          creditMinor,
        count:
          balanceCustomers.length,
      };
    }, [
      balanceCustomers,
    ]);

  const rows =
    useMemo(() => {
      const normalized =
        query
          .trim()
          .toLowerCase();

      return balanceCustomers
        .filter((customer) => {
          if (
            filter ===
              "debit" &&
            customer.balanceMinor <=
              0
          ) {
            return false;
          }

          if (
            filter ===
              "credit" &&
            customer.balanceMinor >=
              0
          ) {
            return false;
          }

          if (!normalized) {
            return true;
          }

          return [
            customer.name,
            customer.code,
            customer.phone ?? "",
            customer.address ?? "",
          ].some(
            (field) =>
              field
                .toLowerCase()
                .includes(
                  normalized,
                ),
          );
        })
        .sort(
          (left, right) =>
            Math.abs(
              right.balanceMinor,
            ) -
              Math.abs(
                left.balanceMinor,
              ) ||
            left.name.localeCompare(
              right.name,
              "ar",
            ),
        );
    }, [
      balanceCustomers,
      query,
      filter,
    ]);

  const visibleTotals =
    useMemo(() => {
      let debitMinor = 0;
      let creditMinor = 0;

      for (
        const customer of rows
      ) {
        if (
          customer.balanceMinor >
          0
        ) {
          debitMinor +=
            customer.balanceMinor;
        } else {
          creditMinor +=
            Math.abs(
              customer.balanceMinor,
            );
        }
      }

      return {
        debitMinor,
        creditMinor,
      };
    }, [rows]);

  const netText =
    summary.netMinor > 0
      ? `لنا ${money(
          summary.netMinor,
        )}`
      : summary.netMinor < 0
        ? `للزبائن ${money(
            summary.netMinor,
          )}`
        : "متوازن";

  return (
    <section
      className="work-panel"
      dir="rtl"
    >
      <style>{`
        .customer-balances-print {
          background: #fff;
        }

        .customer-balances-heading {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 14px;
          flex-wrap: wrap;
          margin-bottom: 18px;
        }

        .customer-balances-heading h2 {
          margin: 0 0 5px;
        }

        .customer-balances-heading p {
          margin: 0;
          color: #67757d;
        }

        .customer-balances-summary {
          display: grid;
          grid-template-columns:
            repeat(
              4,
              minmax(150px, 1fr)
            );
          gap: 12px;
          margin-bottom: 18px;
        }

        .customer-balances-card {
          border: 1px solid #dce4e8;
          border-radius: 12px;
          padding: 14px;
          background: #fff;
        }

        .customer-balances-card span {
          display: block;
          margin-bottom: 7px;
          color: #68767e;
          font-size: 13px;
        }

        .customer-balances-card strong {
          display: block;
          font-size: 20px;
        }

        .customer-balances-filters {
          display: grid;
          grid-template-columns:
            minmax(260px, 2fr)
            minmax(180px, 1fr);
          gap: 12px;
          margin-bottom: 18px;
        }

        .customer-balances-filters label span {
          display: block;
          margin-bottom: 6px;
          font-weight: 700;
        }

        .customer-balances-filters input,
        .customer-balances-filters select {
          width: 100%;
          min-height: 42px;
          box-sizing: border-box;
        }

        .customer-balances-table {
          width: 100%;
          border-collapse: collapse;
          background: #fff;
        }

        .customer-balances-table th,
        .customer-balances-table td {
          border: 1px solid #d9e0e4;
          padding: 9px 10px;
          text-align: center;
          vertical-align: middle;
        }

        .customer-balances-table th {
          background: #f5f8fa;
          font-weight: 800;
        }

        .customer-balances-table tfoot td {
          font-weight: 800;
          background: #fafafa;
        }

        .customer-balances-name-button {
          border: 0;
          background: transparent;
          padding: 0;
          font: inherit;
          font-weight: 800;
          color: #b31469;
          cursor: pointer;
        }

        .customer-balances-debit {
          font-weight: 800;
        }

        .customer-balances-credit {
          font-weight: 800;
        }

        .customer-balances-empty {
          padding: 28px 14px;
          text-align: center;
          color: #6c7980;
        }

        @media (max-width: 900px) {
          .customer-balances-summary {
            grid-template-columns:
              repeat(
                2,
                minmax(140px, 1fr)
              );
          }

          .customer-balances-filters {
            grid-template-columns:
              1fr;
          }
        }

        @media print {
          @page {
            size: A4;
            margin: 10mm;
          }

          body * {
            visibility: hidden !important;
          }

          #customer-balances-print,
          #customer-balances-print * {
            visibility: visible !important;
          }

          #customer-balances-print {
            position: absolute;
            top: 0;
            right: 0;
            width: 100%;
            margin: 0;
            padding: 0;
          }

          .customer-balances-no-print {
            display: none !important;
          }

          .customer-balances-summary {
            grid-template-columns:
              repeat(
                4,
                1fr
              );
          }

          .customer-balances-table {
            font-size: 11px;
          }

          .customer-balances-name-button {
            color: #000;
          }
        }
      `}</style>

      <div
        className="customer-balances-heading customer-balances-no-print"
      >
        <div>
          <h2>
            📊 أرصدة الزبائن
          </h2>

          <p>
            الزبائن أصحاب الأرصدة
            فقط، مع المدين والدائن
            والإجماليات.
          </p>
        </div>

        <button
          type="button"
          className="primary-button"
          disabled={
            balanceCustomers.length ===
            0
          }
          onClick={() =>
            window.print()
          }
        >
          🖨️ طباعة A4
        </button>
      </div>

      {error && (
        <div
          className="error-message customer-balances-no-print"
          style={{
            marginBottom: 14,
          }}
        >
          {error}
        </div>
      )}

      {busy && (
        <div
          className="customer-balances-no-print"
          style={{
            marginBottom: 14,
          }}
        >
          جاري تحميل أرصدة
          الزبائن...
        </div>
      )}

      <div
        id="customer-balances-print"
        className="customer-balances-print"
      >
        <div
          style={{
            marginBottom: 14,
          }}
        >
          <h2
            style={{
              margin:
                "0 0 5px",
            }}
          >
            Lovely Kids —
            أرصدة الزبائن
          </h2>

          <p
            style={{
              margin: 0,
            }}
          >
            يظهر فقط الزبائن
            الذين لديهم رصيد
            مدين أو دائن.
          </p>
        </div>

        <div className="customer-balances-summary">
          <div className="customer-balances-card">
            <span>
              إجمالي لنا عند الزبائن
            </span>

            <strong>
              {money(
                summary.debitMinor,
              )}
            </strong>
          </div>

          <div className="customer-balances-card">
            <span>
              إجمالي للزبائن عندنا
            </span>

            <strong>
              {money(
                summary.creditMinor,
              )}
            </strong>
          </div>

          <div className="customer-balances-card">
            <span>
              صافي الأرصدة
            </span>

            <strong>
              {netText}
            </strong>
          </div>

          <div className="customer-balances-card">
            <span>
              عدد أصحاب الرصيد
            </span>

            <strong>
              {summary.count}
            </strong>
          </div>
        </div>

        <div className="customer-balances-filters customer-balances-no-print">
          <label>
            <span>
              البحث عن زبون
            </span>

            <input
              value={query}
              placeholder="الاسم أو جزء منه أو الهاتف..."
              onChange={(
                event,
              ) =>
                setQuery(
                  event.target
                    .value,
                )
              }
            />
          </label>

          <label>
            <span>
              نوع الرصيد
            </span>

            <select
              value={filter}
              onChange={(
                event,
              ) =>
                setFilter(
                  event.target
                    .value as
                    BalanceFilter,
                )
              }
            >
              <option value="all">
                كل الأرصدة
              </option>

              <option value="debit">
                المدينون فقط
              </option>

              <option value="credit">
                الدائنون فقط
              </option>
            </select>
          </label>
        </div>

        <div
          style={{
            overflowX: "auto",
          }}
        >
          <table className="customer-balances-table">
            <thead>
              <tr>
                <th>#</th>
                <th>
                  اسم الزبون
                </th>
                <th>
                  الهاتف
                </th>
                <th>
                  مدين
                </th>
                <th>
                  دائن
                </th>
              </tr>
            </thead>

            <tbody>
              {rows.map(
                (
                  customer,
                  index,
                ) => (
                  <tr
                    key={
                      customer.id
                    }
                  >
                    <td>
                      {index + 1}
                    </td>

                    <td>
                      <button
                        type="button"
                        className="customer-balances-name-button"
                        title="فتح كشف حساب الزبون"
                        onClick={() =>
                          navigate(
                            `/reports/customer-statement?customerId=${customer.id}`,
                          )
                        }
                      >
                        {
                          customer.name
                        }
                      </button>
                    </td>

                    <td dir="ltr">
                      {customer.phone ||
                        "—"}
                    </td>

                    <td className="customer-balances-debit">
                      {customer
                        .balanceMinor >
                      0
                        ? money(
                            customer
                              .balanceMinor,
                          )
                        : "—"}
                    </td>

                    <td className="customer-balances-credit">
                      {customer
                        .balanceMinor <
                      0
                        ? money(
                            customer
                              .balanceMinor,
                          )
                        : "—"}
                    </td>
                  </tr>
                ),
              )}
            </tbody>

            {rows.length > 0 && (
              <tfoot>
                <tr>
                  <td
                    colSpan={3}
                  >
                    مجموع النتائج
                    الظاهرة
                  </td>

                  <td>
                    {money(
                      visibleTotals
                        .debitMinor,
                    )}
                  </td>

                  <td>
                    {money(
                      visibleTotals
                        .creditMinor,
                    )}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>

          {!busy &&
            rows.length ===
              0 && (
              <div className="customer-balances-empty">
                لا توجد أرصدة
                مطابقة.
              </div>
            )}
        </div>
      </div>
    </section>
  );
}
