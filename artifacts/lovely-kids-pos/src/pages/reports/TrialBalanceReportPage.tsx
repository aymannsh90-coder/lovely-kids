import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import {
  usePosRuntime,
} from "../../app/pos-context";
import {
  ApiError,
  getPosFinanceTrialBalance,
  type PosTrialBalanceResult,
  type PosTrialBalanceRow,
} from "../../lib/api";

function localDate(
  date: Date,
) {
  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1,
    ).padStart(2, "0");

  const day =
    String(
      date.getDate(),
    ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function initialRange() {
  const end =
    new Date();

  const start =
    new Date(
      end.getFullYear(),
      end.getMonth(),
      1,
    );

  return {
    from:
      localDate(start),
    to:
      localDate(end),
  };
}

function money(
  minor: number,
) {
  return `${new Intl.NumberFormat(
    "en-US",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  ).format(minor / 100)} ₪`;
}

function accountTypeLabel(
  value: string,
) {
  switch (value) {
    case "asset":
      return "أصل";
    case "liability":
      return "التزام";
    case "income":
      return "إيراد";
    case "expense":
      return "مصروف";
    case "equity":
      return "حقوق ملكية";
    default:
      return value;
  }
}

function rowHasBalance(
  row: PosTrialBalanceRow,
) {
  return (
    row.openingDebitMinor !== 0 ||
    row.openingCreditMinor !== 0 ||
    row.periodDebitMinor !== 0 ||
    row.periodCreditMinor !== 0 ||
    row.closingDebitMinor !== 0 ||
    row.closingCreditMinor !== 0
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <article className="trial-balance-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </article>
  );
}

export default function TrialBalanceReportPage() {
  const {
    token,
    clearAuthentication,
  } =
    usePosRuntime();

  const range =
    useMemo(
      initialRange,
      [],
    );

  const [
    from,
    setFrom,
  ] =
    useState(
      range.from,
    );

  const [
    to,
    setTo,
  ] =
    useState(
      range.to,
    );

  const [
    result,
    setResult,
  ] =
    useState<
      PosTrialBalanceResult | null
    >(null);

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    error,
    setError,
  ] =
    useState("");

  const [
    hideZero,
    setHideZero,
  ] =
    useState(true);

  async function loadData(
    nextFrom = from,
    nextTo = to,
  ) {
    setLoading(true);
    setError("");

    try {
      const data =
        await getPosFinanceTrialBalance(
          token,
          {
            from:
              nextFrom,
            to:
              nextTo,
          },
        );

      setResult(data);
    } catch (caught) {
      if (
        caught instanceof
          ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setError(
        caught instanceof Error
          ? caught.message
          : "تعذر تحميل ميزان المراجعة",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData(
      range.from,
      range.to,
    );
  }, []);

  function submit(
    event: FormEvent,
  ) {
    event.preventDefault();

    if (
      !from ||
      !to ||
      from > to
    ) {
      setError(
        "الفترة الزمنية غير صالحة",
      );
      return;
    }

    void loadData();
  }

  const rows =
    result?.rows.filter(
      (row) =>
        !hideZero ||
        rowHasBalance(row),
    ) ?? [];

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
      className="trial-balance-page"
      dir="rtl"
    >
      <style>{`
        .trial-balance-print-only {
          display: none;
        }

        @media print {
          @page {
            size: A4 landscape;
            margin: 12mm 9mm;
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

          #trial-balance-print,
          #trial-balance-print * {
            visibility: visible !important;
          }

          #trial-balance-print {
            position: absolute;
            inset: 0;
            width: 100%;
            margin: 0;
            padding: 0;
            background: #fff;
            color: #111827;
            font-size: 9px;
          }

          .trial-balance-no-print {
            display: none !important;
          }

          .trial-balance-print-only {
            display: block !important;
          }

          .trial-balance-print-header {
            margin-bottom: 4mm;
            text-align: center;
          }

          .trial-balance-print-brand {
            color: #E91E8C;
            font-size: 17px;
            font-weight: 900;
          }

          .trial-balance-print-header h1 {
            margin: 1mm 0;
            font-size: 19px;
          }

          .trial-balance-print-header p {
            margin: 1mm 0;
            color: #4b5563;
            font-size: 9px;
          }

          .trial-balance-integrity,
          .trial-balance-metrics,
          .trial-balance-table-card,
          .trial-balance-problems {
            margin-bottom: 4mm;
            box-shadow: none !important;
            border-radius: 0 !important;
          }

          .trial-balance-metrics {
            grid-template-columns: repeat(6, minmax(0, 1fr)) !important;
            gap: 2mm !important;
          }

          .trial-balance-metric {
            min-height: 0 !important;
            padding: 2.5mm !important;
            border-radius: 0 !important;
          }

          .trial-balance-metric span,
          .trial-balance-metric small {
            font-size: 8px !important;
          }

          .trial-balance-metric strong {
            font-size: 10px !important;
          }

          .trial-balance-table-wrap {
            overflow: visible !important;
          }

          .trial-balance-table {
            width: 100% !important;
            min-width: 0 !important;
            table-layout: fixed;
            border-collapse: collapse;
          }

          .trial-balance-table thead {
            display: table-header-group;
          }

          .trial-balance-table th,
          .trial-balance-table td {
            padding: 1.6mm 1.2mm !important;
            font-size: 8.2px !important;
            line-height: 1.3;
            text-align: center;
            overflow-wrap: anywhere;
          }

          .trial-balance-table tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .trial-balance-table-heading {
            padding: 2.5mm 3mm !important;
          }

          .trial-balance-table-heading h2 {
            font-size: 13px !important;
          }

          .trial-balance-print-footer {
            margin-top: 4mm;
            padding-top: 2.5mm;
            border-top: 1px solid #cfd8df;
            color: #6b7280;
            text-align: center;
            font-size: 8px;
          }
        }
      `}</style>

      <header className="trial-balance-heading trial-balance-no-print">
        <div>
          <span>
            Stage 6 · سلامة المحاسبة
          </span>
          <h1>
            ميزان المراجعة
          </h1>
          <p>
            قراءة مباشرة من دفتر الأستاذ العام. القيود المعكوسة تبقى ضمن التاريخ
            ويظهر أثرها مع قيد العكس المقابل، بدون حذف أو إخفاء الحركة الأصلية.
          </p>
        </div>
      </header>

      <form
        className="trial-balance-filters trial-balance-no-print"
        onSubmit={submit}
      >
        <label>
          <span>
            من تاريخ
          </span>
          <input
            type="date"
            value={from}
            onChange={(
              event,
            ) =>
              setFrom(
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
            value={to}
            onChange={(
              event,
            ) =>
              setTo(
                event.target.value,
              )
            }
          />
        </label>

        <button
          type="submit"
          className="primary-button"
          disabled={loading}
        >
          {loading
            ? "جاري الفحص..."
            : "تحديث ميزان المراجعة"}
        </button>

        <button
          type="button"
          className="secondary-button"
          disabled={!result}
          onClick={() =>
            window.print()
          }
        >
          🖨️ طباعة A4
        </button>

        <label className="trial-balance-zero-toggle">
          <input
            type="checkbox"
            checked={hideZero}
            onChange={(
              event,
            ) =>
              setHideZero(
                event.target.checked,
              )
            }
          />
          <span>
            إخفاء الحسابات بدون حركة أو رصيد
          </span>
        </label>
      </form>

      {error && (
        <div className="alert error-alert trial-balance-no-print">
          {error}
        </div>
      )}

      {result && (
        <div id="trial-balance-print">
          <header className="trial-balance-print-only trial-balance-print-header">
            <div className="trial-balance-print-brand">
              Lovely Kids
            </div>
            <h1>ميزان المراجعة</h1>
            <p>
              الفترة: {result.range.from} — {result.range.to}
            </p>
            <p>
              تاريخ إصدار التقرير: {generatedAt}
            </p>
          </header>
          <section
            className={
              result.integrity.passed
                ? "trial-balance-integrity is-pass"
                : "trial-balance-integrity is-fail"
            }
          >
            <div className="trial-balance-integrity-icon">
              {result.integrity.passed
                ? "✓"
                : "!"}
            </div>

            <div>
              <strong>
                {result.integrity.passed
                  ? "Integrity Gate: سليم"
                  : "Integrity Gate: يوجد فرق يحتاج مراجعة"}
              </strong>

              <p>
                تم فحص{" "}
                {new Intl.NumberFormat(
                  "en-US",
                ).format(
                  result.integrity.transactionsChecked,
                )}{" "}
                قيد. عدد القيود غير المتوازنة:{" "}
                {result.integrity.unbalancedTransactionCount}.
              </p>
            </div>

            <div className="trial-balance-integrity-difference">
              <span>
                فرق الـLedger
              </span>
              <b>
                {money(
                  Math.abs(
                    result.integrity.ledgerDifferenceMinor,
                  ),
                )}
              </b>
            </div>
          </section>

          <section className="trial-balance-metrics">
            <Metric
              label="افتتاحي مدين"
              value={money(
                result.totals.openingDebitMinor,
              )}
            />
            <Metric
              label="افتتاحي دائن"
              value={money(
                result.totals.openingCreditMinor,
              )}
            />
            <Metric
              label="حركة الفترة - مدين"
              value={money(
                result.totals.periodDebitMinor,
              )}
              hint={
                result.integrity.periodDifferenceMinor === 0
                  ? "متوازن مع الدائن"
                  : "يوجد فرق"
              }
            />
            <Metric
              label="حركة الفترة - دائن"
              value={money(
                result.totals.periodCreditMinor,
              )}
            />
            <Metric
              label="ختامي مدين"
              value={money(
                result.totals.closingDebitMinor,
              )}
            />
            <Metric
              label="ختامي دائن"
              value={money(
                result.totals.closingCreditMinor,
              )}
            />
          </section>

          {!result.integrity.passed &&
            result.integrity.unbalancedTransactions.length > 0 && (
              <section className="trial-balance-problems">
                <h2>
                  قيود تحتاج مراجعة
                </h2>

                <div className="trial-balance-problem-list">
                  {result.integrity.unbalancedTransactions.map(
                    (transaction) => (
                      <article
                        key={transaction.transactionId}
                      >
                        <div>
                          <strong>
                            {transaction.publicId}
                          </strong>
                          <span>
                            {transaction.businessDate} ·{" "}
                            {transaction.status}
                          </span>
                        </div>

                        <div>
                          <span>
                            مدين{" "}
                            {money(
                              transaction.debitMinor,
                            )}
                          </span>
                          <span>
                            دائن{" "}
                            {money(
                              transaction.creditMinor,
                            )}
                          </span>
                          <b>
                            الفرق{" "}
                            {money(
                              Math.abs(
                                transaction.differenceMinor,
                              ),
                            )}
                          </b>
                        </div>
                      </article>
                    ),
                  )}
                </div>
              </section>
            )}

          <section className="trial-balance-table-card">
            <div className="trial-balance-table-heading">
              <div>
                <h2>
                  الحسابات
                </h2>
                <p>
                  الفترة: {result.range.from} — {result.range.to}
                </p>
              </div>

              <strong>
                {rows.length} حساب
              </strong>
            </div>

            <div className="trial-balance-table-wrap">
              <table className="trial-balance-table">
                <thead>
                  <tr>
                    <th>
                      الحساب
                    </th>
                    <th>
                      النوع
                    </th>
                    <th>
                      افتتاحي مدين
                    </th>
                    <th>
                      افتتاحي دائن
                    </th>
                    <th>
                      حركة مدين
                    </th>
                    <th>
                      حركة دائن
                    </th>
                    <th>
                      ختامي مدين
                    </th>
                    <th>
                      ختامي دائن
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {rows.map(
                    (row) => (
                      <tr key={row.account.id}>
                        <td>
                          <strong>
                            {row.account.name}
                          </strong>
                          <small>
                            {row.account.code}
                          </small>
                        </td>
                        <td>
                          {accountTypeLabel(
                            row.account.accountType,
                          )}
                        </td>
                        <td>
                          {money(
                            row.openingDebitMinor,
                          )}
                        </td>
                        <td>
                          {money(
                            row.openingCreditMinor,
                          )}
                        </td>
                        <td>
                          {money(
                            row.periodDebitMinor,
                          )}
                        </td>
                        <td>
                          {money(
                            row.periodCreditMinor,
                          )}
                        </td>
                        <td className="trial-balance-closing">
                          {money(
                            row.closingDebitMinor,
                          )}
                        </td>
                        <td className="trial-balance-closing">
                          {money(
                            row.closingCreditMinor,
                          )}
                        </td>
                      </tr>
                    ),
                  )}

                  {rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="trial-balance-empty"
                      >
                        لا توجد حركة أو أرصدة ضمن الفلتر الحالي.
                      </td>
                    </tr>
                  )}
                </tbody>

                <tfoot>
                  <tr>
                    <th colSpan={2}>
                      الإجمالي
                    </th>
                    <th>
                      {money(
                        result.totals.openingDebitMinor,
                      )}
                    </th>
                    <th>
                      {money(
                        result.totals.openingCreditMinor,
                      )}
                    </th>
                    <th>
                      {money(
                        result.totals.periodDebitMinor,
                      )}
                    </th>
                    <th>
                      {money(
                        result.totals.periodCreditMinor,
                      )}
                    </th>
                    <th>
                      {money(
                        result.totals.closingDebitMinor,
                      )}
                    </th>
                    <th>
                      {money(
                        result.totals.closingCreditMinor,
                      )}
                    </th>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <footer className="trial-balance-print-only trial-balance-print-footer">
            تقرير صادر من نظام Lovely Kids — للمراجعة والمطابقة.
          </footer>
        </div>
      )}
    </section>
  );
}
