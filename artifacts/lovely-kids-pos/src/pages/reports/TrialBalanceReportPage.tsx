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

  return (
    <section
      className="trial-balance-page"
      dir="rtl"
    >
      <header className="trial-balance-heading">
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
        className="trial-balance-filters"
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
        <div className="alert error-alert">
          {error}
        </div>
      )}

      {result && (
        <>
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
        </>
      )}
    </section>
  );
}
