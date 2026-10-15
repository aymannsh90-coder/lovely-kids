import {
  useEffect,
  useState,
} from "react";

import {
  usePosRuntime,
} from "../../app/pos-context";
import {
  ApiError,
  getPosFinanceLiquidityReport,
  type PosFinanceAgingRow,
  type PosFinanceLiquidityReport,
} from "../../lib/api";

function money(
  minor: number,
) {
  const sign =
    minor < 0
      ? "-"
      : "";

  return `${sign}${new Intl.NumberFormat(
    "en-US",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  ).format(
    Math.abs(minor) / 100,
  )} ₪`;
}

function currencyMoney(
  minor: number,
  currencyCode: string,
) {
  const symbol =
    currencyCode === "ILS"
      ? "₪"
      : currencyCode === "USD"
        ? "$"
        : currencyCode === "JOD"
          ? "JD"
          : currencyCode;

  return `${new Intl.NumberFormat(
    "en-US",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  ).format(
    minor / 100,
  )} ${symbol}`;
}

function errorText(
  error: unknown,
) {
  return error instanceof Error
    ? error.message
    : "تعذر تحميل تقرير الذمم والسيولة";
}

function dueText(
  daysUntilDue: number,
) {
  if (
    daysUntilDue < 0
  ) {
    return `متأخر ${Math.abs(
      daysUntilDue,
    )} يوم`;
  }

  if (
    daysUntilDue === 0
  ) {
    return "مستحق اليوم";
  }

  return `بعد ${daysUntilDue} يوم`;
}

function Metric({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <article
      className={
        emphasis
          ? "liquidity-metric is-emphasis"
          : "liquidity-metric"
      }
    >
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && (
        <small>{hint}</small>
      )}
    </article>
  );
}

function AgingSummary({
  title,
  subtitle,
  rows,
  totals,
  oppositeLabel,
}: {
  title: string;
  subtitle: string;
  rows: PosFinanceAgingRow[];
  totals: PosFinanceLiquidityReport["customerAging"]["totals"];
  oppositeLabel: string;
}) {
  return (
    <section className="liquidity-aging-card">
      <header>
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>

        <strong>
          {money(
            totals.balanceMinor,
          )}
        </strong>
      </header>

      <div className="liquidity-aging-buckets">
        <div>
          <span>0–30 يوم</span>
          <b>
            {money(
              totals.currentMinor,
            )}
          </b>
        </div>

        <div>
          <span>31–60 يوم</span>
          <b>
            {money(
              totals.days31To60Minor,
            )}
          </b>
        </div>

        <div>
          <span>61–90 يوم</span>
          <b>
            {money(
              totals.days61To90Minor,
            )}
          </b>
        </div>

        <div>
          <span>+90 يوم</span>
          <b>
            {money(
              totals.daysOver90Minor,
            )}
          </b>
        </div>
      </div>

      {totals.oppositeBalanceMinor >
        0 && (
        <div className="liquidity-opposite-balance">
          <span>
            {oppositeLabel}
          </span>
          <strong>
            {money(
              totals.oppositeBalanceMinor,
            )}
          </strong>
        </div>
      )}

      <div className="liquidity-table-wrap">
        <table className="liquidity-aging-table">
          <thead>
            <tr>
              <th>الطرف</th>
              <th>0–30</th>
              <th>31–60</th>
              <th>61–90</th>
              <th>+90</th>
              <th>الإجمالي</th>
            </tr>
          </thead>

          <tbody>
            {rows
              .filter(
                (row) =>
                  row.balanceMinor >
                  0,
              )
              .map(
                (row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>
                        {row.name}
                      </strong>
                      <small>
                        {row.code}
                      </small>
                    </td>
                    <td>
                      {money(
                        row.currentMinor,
                      )}
                    </td>
                    <td>
                      {money(
                        row.days31To60Minor,
                      )}
                    </td>
                    <td>
                      {money(
                        row.days61To90Minor,
                      )}
                    </td>
                    <td>
                      {money(
                        row.daysOver90Minor,
                      )}
                    </td>
                    <td>
                      <b>
                        {money(
                          row.balanceMinor,
                        )}
                      </b>
                    </td>
                  </tr>
                ),
              )}

            {rows.filter(
              (row) =>
                row.balanceMinor >
                0,
            ).length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="liquidity-empty"
                >
                  لا توجد أرصدة مستحقة.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function ReceivablesLiquidityReportPage() {
  const {
    token,
    clearAuthentication,
  } =
    usePosRuntime();

  const [
    report,
    setReport,
  ] =
    useState<
      PosFinanceLiquidityReport | null
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

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const result =
        await getPosFinanceLiquidityReport(
          token,
        );

      setReport(result);
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
        errorText(caught),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const diagnosticsWarning =
    report &&
    (
      report.diagnostics
        .missingCustomerPartyMinor !==
        0 ||
      report.diagnostics
        .missingSupplierPartyMinor !==
        0 ||
      !report.diagnostics
        .cashBaseComplete
    );

  return (
    <section
      className="liquidity-report-page"
      dir="rtl"
    >
      <header className="liquidity-report-heading">
        <div>
          <span>
            Stage 6 · الذمم والسيولة
          </span>
          <h1>
            الذمم والسيولة
          </h1>
          <p>
            أعمار الذمم، الشيكات المعلقة، والسيولة الحالية من الصناديق والبنوك
            اعتمادًا على دفتر الأستاذ العام.
          </p>
        </div>

        <button
          type="button"
          className="primary-button"
          disabled={loading}
          onClick={() =>
            void loadData()
          }
        >
          {loading
            ? "جاري التحديث..."
            : "تحديث"}
        </button>
      </header>

      {error && (
        <div className="alert error-alert">
          {error}
        </div>
      )}

      {diagnosticsWarning && (
        <div className="alert error-alert">
          توجد بيانات تحتاج مراجعة قبل الاعتماد الكامل على الملخص:
          {!report
            ?.diagnostics
            .cashBaseComplete &&
            " يوجد صندوق بعملة أجنبية دون سعر صرف متاح."}
          {report &&
            report.diagnostics
              .missingCustomerPartyMinor !==
              0 &&
            ` فرق ذمم زبائن بلا طرف: ${money(
              report.diagnostics
                .missingCustomerPartyMinor,
            )}.`}
          {report &&
            report.diagnostics
              .missingSupplierPartyMinor !==
              0 &&
            ` فرق ذمم موردين بلا طرف: ${money(
              report.diagnostics
                .missingSupplierPartyMinor,
            )}.`}
        </div>
      )}

      {report && (
        <>
          <section className="liquidity-summary-card">
            <div className="liquidity-summary-title">
              <div>
                <span>
                  لقطة حتى
                </span>
                <strong>
                  {report.asOf}
                </strong>
              </div>

              <div>
                <span>
                  صافي السيولة المتوقعة
                </span>
                <strong
                  className={
                    report.summary
                      .projectedLiquidityMinor <
                    0
                      ? "is-negative"
                      : ""
                  }
                >
                  {money(
                    report.summary
                      .projectedLiquidityMinor,
                  )}
                </strong>
              </div>
            </div>

            <div className="liquidity-primary-metrics">
              <Metric
                label="السيولة الحالية"
                value={money(
                  report.summary
                    .currentLiquidityMinor,
                )}
                hint="الصناديق التشغيلية + البنوك"
                emphasis
              />

              <Metric
                label="المتوقع تحصيله"
                value={money(
                  report.summary
                    .expectedCollectionsMinor,
                )}
                hint="ذمم + شيكات واردة + أرصدة لنا"
              />

              <Metric
                label="المتوقع دفعه"
                value={money(
                  report.summary
                    .expectedPaymentsMinor,
                )}
                hint="موردون + شيكات صادرة + أرصدة للزبائن"
              />

              <Metric
                label="ذمم الزبائن"
                value={money(
                  report.summary
                    .customerReceivableMinor,
                )}
              />

              <Metric
                label="ذمم الموردين"
                value={money(
                  report.summary
                    .supplierPayableMinor,
                )}
              />

              <Metric
                label="صافي بعد المتوقع"
                value={money(
                  report.summary
                    .projectedLiquidityMinor,
                )}
              />
            </div>

            <div className="liquidity-secondary-metrics">
              <Metric
                label="نقد بالصناديق"
                value={money(
                  report.summary
                    .cashOperationalBaseMinor,
                )}
              />

              <Metric
                label="البنوك"
                value={money(
                  report.summary
                    .bankBaseMinor,
                )}
              />

              <Metric
                label="شيكات واردة معلقة"
                value={money(
                  report.summary
                    .incomingChecksMinor,
                )}
              />

              <Metric
                label="شيكات صادرة معلقة"
                value={money(
                  report.summary
                    .outgoingChecksMinor,
                )}
              />
            </div>
          </section>

          <div className="liquidity-aging-grid">
            <AgingSummary
              title="أعمار ذمم الزبائن"
              subtitle="الدفعات تُطفئ أقدم دين أولًا"
              rows={
                report.customerAging
                  .rows
              }
              totals={
                report.customerAging
                  .totals
              }
              oppositeLabel="أرصدة دائنة للزبائن"
            />

            <AgingSummary
              title="أعمار مستحقات الموردين"
              subtitle="الدفعات تُطفئ أقدم استحقاق أولًا"
              rows={
                report.supplierAging
                  .rows
              }
              totals={
                report.supplierAging
                  .totals
              }
              oppositeLabel="أرصدة لنا على الموردين"
            />
          </div>

          <section className="liquidity-checks-card">
            <header>
              <div>
                <h2>
                  الشيكات القادمة
                </h2>
                <p>
                  الواردة: على اليد أو مودعة ولم تُحصّل. الصادرة: لم تُصرف بعد.
                </p>
              </div>

              <div className="liquidity-check-totals">
                <span>
                  وارد{" "}
                  <b>
                    {money(
                      report.checks
                        .totals
                        .incomingMinor,
                    )}
                  </b>
                </span>

                <span>
                  صادر{" "}
                  <b>
                    {money(
                      report.checks
                        .totals
                        .outgoingMinor,
                    )}
                  </b>
                </span>
              </div>
            </header>

            <div className="liquidity-table-wrap">
              <table className="liquidity-checks-table">
                <thead>
                  <tr>
                    <th>النوع</th>
                    <th>الطرف</th>
                    <th>رقم الشيك</th>
                    <th>الاستحقاق</th>
                    <th>الحالة الزمنية</th>
                    <th>المبلغ الأصلي</th>
                    <th>بالشيكل</th>
                  </tr>
                </thead>

                <tbody>
                  {report.checks.rows.map(
                    (check) => (
                      <tr key={check.id}>
                        <td>
                          <span
                            className={
                              check.direction ===
                              "received"
                                ? "liquidity-check-direction is-in"
                                : "liquidity-check-direction is-out"
                            }
                          >
                            {check.direction ===
                            "received"
                              ? "وارد"
                              : "صادر"}
                          </span>
                        </td>

                        <td>
                          <strong>
                            {check.partyName}
                          </strong>
                        </td>

                        <td
                          dir="ltr"
                        >
                          {check.checkNumber}
                        </td>

                        <td>
                          {check.dueDate}
                        </td>

                        <td
                          className={
                            check.daysUntilDue <
                            0
                              ? "is-overdue"
                              : ""
                          }
                        >
                          {dueText(
                            check.daysUntilDue,
                          )}
                        </td>

                        <td>
                          {currencyMoney(
                            check.amountMinor,
                            check.currencyCode,
                          )}
                        </td>

                        <td>
                          <b>
                            {money(
                              check.baseAmountMinor,
                            )}
                          </b>
                        </td>
                      </tr>
                    ),
                  )}

                  {report.checks.rows
                    .length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="liquidity-empty"
                      >
                        لا توجد شيكات معلقة.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <div className="liquidity-breakdown-grid">
            <section className="liquidity-breakdown-card">
              <header>
                <h2>
                  الصناديق
                </h2>
                <strong>
                  {money(
                    report.summary
                      .cashOperationalBaseMinor,
                  )}
                </strong>
              </header>

              <div className="liquidity-breakdown-list">
                {report.liquidity.cash.map(
                  (account) => (
                    <article
                      key={account.id}
                    >
                      <div>
                        <strong>
                          {account.name}
                        </strong>
                        <span>
                          {account.code} ·{" "}
                          {account.balanceSource ===
                          "cash_session"
                            ? "جلسة صندوق"
                            : "Ledger"}
                        </span>
                      </div>

                      <div>
                        <b>
                          {currencyMoney(
                            account.operationalMinor,
                            account.currencyCode,
                          )}
                        </b>
                        <small>
                          {account
                            .operationalBaseMinor ===
                          null
                            ? "قيمة ILS غير متاحة"
                            : account.balanceSource ===
                                "cash_session"
                              ? `دفتر الأستاذ: ${money(
                                  account.bookBaseMinor,
                                )} · الفرق التشغيلي: ${money(
                                  account.operationalBaseMinor -
                                    account.bookBaseMinor,
                                )}`
                              : `دفتر الأستاذ: ${money(
                                  account.bookBaseMinor,
                                )}`}
                        </small>
                      </div>
                    </article>
                  ),
                )}

                {report.liquidity.cash
                  .length === 0 && (
                  <p className="liquidity-empty">
                    لا توجد صناديق فعالة.
                  </p>
                )}
              </div>
            </section>

            <section className="liquidity-breakdown-card">
              <header>
                <h2>
                  الحسابات البنكية
                </h2>
                <strong>
                  {money(
                    report.summary
                      .bankBaseMinor,
                  )}
                </strong>
              </header>

              <div className="liquidity-breakdown-list">
                {report.liquidity.banks.map(
                  (account) => (
                    <article
                      key={account.id}
                    >
                      <div>
                        <strong>
                          {account.bankName} ·{" "}
                          {account.name}
                        </strong>
                        <span>
                          {account.code}
                        </span>
                      </div>

                      <div>
                        <b>
                          {currencyMoney(
                            account.currencyBalanceMinor,
                            account.currencyCode,
                          )}
                        </b>
                        <small>
                          {money(
                            account.baseBalanceMinor,
                          )}
                        </small>
                      </div>
                    </article>
                  ),
                )}

                {report.liquidity.banks
                  .length === 0 && (
                  <p className="liquidity-empty">
                    لا توجد حسابات بنكية فعالة.
                  </p>
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </section>
  );
}
