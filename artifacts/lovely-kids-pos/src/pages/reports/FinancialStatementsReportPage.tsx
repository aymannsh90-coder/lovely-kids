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
  getGrossProfitReport,
  getOwnerInventoryValuationProducts,
  getPosFinanceTrialBalance,
  setOwnerHistoricalCostRepair,
  setOwnerOpeningCost,
  type GrossProfitMissingCostProduct,
  type GrossProfitReport,
  type OwnerInventoryValuationProduct,
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

function parseCostMinor(
  value: string,
) {
  const numeric =
    Number(
      value
        .trim()
        .replace(",", "."),
    );

  if (
    !Number.isFinite(numeric) ||
    numeric < 0
  ) {
    return null;
  }

  const minor =
    Math.round(
      numeric * 100,
    );

  return Number.isSafeInteger(
    minor,
  )
    ? minor
    : null;
}

function periodNormalAmount(
  row: PosTrialBalanceRow,
) {
  if (
    row.account.accountType ===
      "income"
  ) {
    return (
      row.periodCreditMinor -
      row.periodDebitMinor
    );
  }

  if (
    row.account.accountType ===
      "expense"
  ) {
    return (
      row.periodDebitMinor -
      row.periodCreditMinor
    );
  }

  return 0;
}

function closingNormalAmount(
  row: PosTrialBalanceRow,
) {
  if (
    row.account.accountType ===
      "asset" ||
    row.account.accountType ===
      "expense"
  ) {
    return (
      row.closingDebitMinor -
      row.closingCreditMinor
    );
  }

  return (
    row.closingCreditMinor -
    row.closingDebitMinor
  );
}

function sum(
  values: number[],
) {
  return values.reduce(
    (
      total,
      value,
    ) =>
      total + value,
    0,
  );
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?:
    | "positive"
    | "negative"
    | "warning";
}) {
  return (
    <article
      className={
        `financial-statement-metric${tone ? ` is-${tone}` : ""}`
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

function AccountRows({
  rows,
}: {
  rows: Array<{
    account:
      PosTrialBalanceRow["account"];
    amountMinor: number;
  }>;
}) {
  if (
    rows.length === 0
  ) {
    return (
      <div className="financial-statement-empty">
        لا توجد حركة ضمن هذه المجموعة في الفترة المحددة.
      </div>
    );
  }

  return (
    <div className="financial-statement-account-list">
      {rows.map(
        (row) => (
          <div
            key={
              row.account.id
            }
            className="financial-statement-account-row"
          >
            <div>
              <strong>
                {row.account.name}
              </strong>
              <small>
                {row.account.code}
              </small>
            </div>

            <b>
              {money(
                row.amountMinor,
              )}
            </b>
          </div>
        ),
      )}
    </div>
  );
}

export default function FinancialStatementsReportPage() {
  const {
    token,
    clearAuthentication,
  } =
    usePosRuntime();

  const initial =
    useMemo(
      initialRange,
      [],
    );

  const [
    from,
    setFrom,
  ] =
    useState(
      initial.from,
    );

  const [
    to,
    setTo,
  ] =
    useState(
      initial.to,
    );

  const [
    trialBalance,
    setTrialBalance,
  ] =
    useState<
      PosTrialBalanceResult | null
    >(null);

  const [
    grossProfit,
    setGrossProfit,
  ] =
    useState<
      GrossProfitReport | null
    >(null);

  const [
    inventoryProducts,
    setInventoryProducts,
  ] =
    useState<
      OwnerInventoryValuationProduct[]
    >([]);

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
    costInputs,
    setCostInputs,
  ] =
    useState<
      Record<string, string>
    >({});

  const [
    savingCostProductId,
    setSavingCostProductId,
  ] =
    useState<string | null>(
      null,
    );

  const [
    costActionError,
    setCostActionError,
  ] =
    useState("");

  const [
    costActionMessage,
    setCostActionMessage,
  ] =
    useState("");

  async function loadData(
    nextFrom = from,
    nextTo = to,
  ) {
    setLoading(true);
    setError("");

    try {
      const [
        trial,
        gross,
        inventory,
      ] =
        await Promise.all([
          getPosFinanceTrialBalance(
            token,
            {
              from:
                nextFrom,
              to:
                nextTo,
            },
          ),
          getGrossProfitReport(
            token,
            nextFrom,
            nextTo,
          ),
          getOwnerInventoryValuationProducts(
            token,
          ),
        ]);

      setTrialBalance(
        trial,
      );

      setGrossProfit(
        gross,
      );

      setInventoryProducts(
        inventory.products,
      );
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
          : "تعذر تحميل القوائم المالية",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleCostAction(
    product:
      GrossProfitMissingCostProduct,
  ) {
    if (!token) {
      return;
    }

    const unitCostMinor =
      parseCostMinor(
        costInputs[
          product.productId
        ] ?? "",
      );

    if (
      unitCostMinor === null
    ) {
      setCostActionMessage("");
      setCostActionError(
        "أدخل تكلفة صحيحة للقطعة بالشيكل.",
      );
      return;
    }

    setSavingCostProductId(
      product.productId,
    );
    setCostActionError("");
    setCostActionMessage("");

    const reportFrom =
      grossProfit?.range.from ??
      from;

    const reportTo =
      grossProfit?.range.to ??
      to;

    try {
      if (
        product.canSetOpeningCost
      ) {
        await setOwnerOpeningCost(
          token,
          {
            productId:
              product.productId,
            unitCostMinor,
            costQuality:
              "confirmed",
          },
        );
      } else {
        await setOwnerHistoricalCostRepair(
          token,
          {
            productId:
              product.productId,
            unitCostMinor,
            from:
              reportFrom,
            to:
              reportTo,
            costQuality:
              "confirmed",
          },
        );
      }

      setCostInputs(
        (current) => {
          const next = {
            ...current,
          };

          delete next[
            product.productId
          ];

          return next;
        },
      );

      setCostActionMessage(
        `تم حفظ تكلفة ${product.nameAr} وتحديث التقرير.`,
      );

      await loadData(
        reportFrom,
        reportTo,
      );
    } catch (caught) {
      if (
        caught instanceof
          ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setCostActionError(
        caught instanceof Error
          ? caught.message
          : "تعذر حفظ التكلفة",
      );
    } finally {
      setSavingCostProductId(
        null,
      );
    }
  }

  useEffect(() => {
    void loadData(
      initial.from,
      initial.to,
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

  const derived =
    useMemo(
      () => {
        if (
          !trialBalance ||
          !grossProfit
        ) {
          return null;
        }

        const incomeRows =
          trialBalance.rows
            .filter(
              (row) =>
                row.account.accountType ===
                  "income",
            )
            .map(
              (row) => ({
                account:
                  row.account,
                amountMinor:
                  periodNormalAmount(
                    row,
                  ),
              }),
            )
            .filter(
              (row) =>
                row.amountMinor !==
                  0,
            );

        const expenseRows =
          trialBalance.rows
            .filter(
              (row) =>
                row.account.accountType ===
                  "expense",
            )
            .map(
              (row) => ({
                account:
                  row.account,
                amountMinor:
                  periodNormalAmount(
                    row,
                  ),
              }),
            )
            .filter(
              (row) =>
                row.amountMinor !==
                  0,
            );

        const revenueMinor =
          sum(
            incomeRows.map(
              (row) =>
                row.amountMinor,
            ),
          );

        const operatingExpenseMinor =
          sum(
            expenseRows.map(
              (row) =>
                row.amountMinor,
            ),
          );

        const cogsKnownMinor =
          grossProfit
            .channels
            .total
            .cogsKnownMinor;

        const marginAfterKnownCostMinor =
          revenueMinor -
          cogsKnownMinor;

        const resultOnKnownCostMinor =
          marginAfterKnownCostMinor -
          operatingExpenseMinor;

        const closingByType = {
          asset: 0,
          liability: 0,
          equity: 0,
          income: 0,
          expense: 0,
        };

        for (
          const row of
          trialBalance.rows
        ) {
          const accountType =
            row.account
              .accountType as keyof typeof closingByType;

          if (
            accountType in
            closingByType
          ) {
            closingByType[
              accountType
            ] +=
              closingNormalAmount(
                row,
              );
          }
        }

        const unclosedResultMinor =
          closingByType.income -
          closingByType.expense;

        const equationDifferenceMinor =
          closingByType.asset -
          closingByType.liability -
          closingByType.equity -
          unclosedResultMinor;

        const initialized =
          inventoryProducts.filter(
            (product) =>
              product.initialized,
          );

        const uninitializedWithStock =
          inventoryProducts.filter(
            (product) =>
              !product.initialized &&
              product.currentQuantity !==
                null &&
              product.currentQuantity >
                0,
          );

        const valuedAvailableInventoryMinor =
          sum(
            initialized.map(
              (product) =>
                product
                  .inventoryValueMinor ??
                0,
            ),
          );

        const valuedQuantity =
          sum(
            initialized.map(
              (product) =>
                product
                  .accountingQuantity ??
                0,
            ),
          );

        const unvaluedQuantity =
          sum(
            uninitializedWithStock.map(
              (product) =>
                product
                  .currentQuantity ??
                0,
            ),
          );

        const inventoryMismatchCount =
          initialized.filter(
            (product) =>
              !product
                .stockMatchesAccounting,
          ).length;

        return {
          incomeRows,
          expenseRows,
          revenueMinor,
          operatingExpenseMinor,
          cogsKnownMinor,
          marginAfterKnownCostMinor,
          resultOnKnownCostMinor,
          closingByType,
          unclosedResultMinor,
          equationDifferenceMinor,
          valuedAvailableInventoryMinor,
          valuedQuantity,
          initializedCount:
            initialized.length,
          uninitializedCount:
            inventoryProducts.length -
            initialized.length,
          uninitializedWithStockCount:
            uninitializedWithStock.length,
          unvaluedQuantity,
          inventoryMismatchCount,
        };
      },
      [
        trialBalance,
        grossProfit,
        inventoryProducts,
      ],
    );

  const today =
    localDate(
      new Date(),
    );

  const coverage =
    grossProfit
      ?.channels
      .total
      .costCoveragePercent ??
    0;

  const coverageComplete =
    grossProfit
      ?.channels
      .total
      .costCoverageComplete ??
    false;

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
      className="financial-statements-page"
      dir="rtl"
    >
      <style>{`
        .financial-print-only {
          display: none;
        }

        @media print {
          @page {
            size: A4 portrait;
            margin: 10mm;
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

          #financial-statements-print,
          #financial-statements-print * {
            visibility: visible !important;
          }

          #financial-statements-print {
            position: absolute;
            top: 0;
            right: 0;
            left: 0;
            width: 100%;
            max-width: none;
            margin: 0 auto;
            padding: 0;
            background: #fff;
            color: #111827;
            font-size: 10px;
          }

          .financial-print-only {
            display: block !important;
          }

          .financial-statements-no-print {
            display: none !important;
          }

          .financial-print-header {
            margin-bottom: 6mm;
            text-align: center;
          }

          .financial-print-brand {
            color: #E91E8C;
            font-size: 17px;
            font-weight: 900;
          }

          .financial-print-header h1 {
            margin: 1.5mm 0;
            font-size: 20px;
          }

          .financial-print-header p {
            margin: 1mm 0;
            color: #4b5563;
            font-size: 9.5px;
          }

          .financial-statements-gate,
          .financial-cost-coverage-card,
          .financial-statement-card,
          .financial-inventory-memo {
            margin: 0 0 5mm;
            border: 1px solid #cfd8df;
            border-radius: 0;
            box-shadow: none;
            background: #fff;
          }

          .financial-statements-gate,
          .financial-cost-coverage-card,
          .financial-statement-card,
          .financial-inventory-memo {
            padding: 4mm;
          }

          .financial-statement-card > header,
          .financial-inventory-memo > header,
          .financial-cost-coverage-head {
            margin-bottom: 3mm;
          }

          .financial-statement-card > header h2,
          .financial-inventory-memo > header h2 {
            font-size: 15px;
          }

          .financial-statement-card > header > strong,
          .financial-inventory-memo > header > strong,
          .financial-cost-coverage-head strong {
            font-size: 14px;
          }

          .financial-statement-metrics {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            gap: 2.5mm !important;
          }

          .financial-statement-metric {
            min-height: 0;
            padding: 3mm;
            border-radius: 0;
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .financial-statement-metric > span {
            font-size: 9px;
          }

          .financial-statement-metric > strong {
            font-size: 12px;
          }

          .financial-statement-metric > small {
            font-size: 8.5px;
          }

          .financial-statement-columns {
            grid-template-columns: 1fr 1fr !important;
            gap: 3mm !important;
            margin-top: 3mm;
          }

          .financial-statement-columns > article {
            border-radius: 0;
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .financial-statement-columns > article > header {
            padding: 2.5mm 3mm;
          }

          .financial-statement-account-row {
            padding: 2.2mm 3mm;
          }

          .financial-statement-account-row strong,
          .financial-statement-account-row b {
            font-size: 9.5px;
          }

          .financial-statement-account-row small {
            font-size: 8px;
          }

          .financial-equation {
            grid-template-columns: auto auto 18px minmax(0, 1fr) auto;
            gap: 2mm;
            margin-top: 3mm;
            border-radius: 0;
            padding: 3mm;
            font-size: 9px;
          }

          .financial-equation i {
            font-size: 16px;
          }

          .financial-disclosure,
          .financial-history-warning {
            margin-top: 3mm;
            border-radius: 0;
            padding: 3mm;
            font-size: 8.5px;
          }

          .financial-cost-progress {
            height: 2.5mm;
            margin-top: 2.5mm;
          }

          .financial-cost-coverage-card p,
          .financial-statements-gate p {
            margin-top: 1.5mm;
            font-size: 9px;
          }

          .financial-balance-sheet {
            break-before: page;
            page-break-before: always;
          }

          .financial-print-footer {
            margin-top: 5mm;
            padding-top: 3mm;
            border-top: 1px solid #cfd8df;
            color: #6b7280;
            text-align: center;
            font-size: 8.5px;
          }
        }
      `}</style>

      <header className="financial-statements-heading financial-statements-no-print">
        <div>
          <span>
            Stage 7 · القوائم المالية
          </span>
          <h1>
            قائمة الدخل والميزانية العمومية
          </h1>
          <p>
            الإيرادات والمصروفات والأرصدة مأخوذة مباشرة من دفتر الأستاذ.
            تكلفة البضاعة تأتي من نظام التكلفة الفعلي، ومع كل تكلفة جديدة تدخلها
            ترتفع نسبة التغطية تلقائيًا بدون افتراض تكلفة للمنتجات غير المهيأة.
          </p>
        </div>
      </header>

      <form
        className="financial-statements-filters financial-statements-no-print"
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
            ? "جاري الاحتساب..."
            : "تحديث القوائم"}
        </button>

        <button
          type="button"
          className="secondary-button"
          disabled={
            loading ||
            !trialBalance ||
            !grossProfit ||
            !derived
          }
          onClick={() =>
            window.print()
          }
        >
          🖨️ طباعة A4
        </button>
      </form>

      {error && (
        <div className="alert error-alert financial-statements-no-print">
          {error}
        </div>
      )}

      {trialBalance &&
        grossProfit &&
        derived && (
          <div
            id="financial-statements-print"
            className="financial-statements-print"
          >
            <header className="financial-print-only financial-print-header">
              <div className="financial-print-brand">
                Lovely Kids
              </div>
              <h1>
                القوائم المالية
              </h1>
              <p>
                الفترة: {from} — {to}
              </p>
              <p>
                تاريخ إصدار التقرير: {generatedAt}
              </p>
            </header>
            <section
              className={
                trialBalance
                  .integrity
                  .passed
                  ? "financial-statements-gate is-pass"
                  : "financial-statements-gate is-fail"
              }
            >
              <div>
                <strong>
                  {trialBalance
                    .integrity
                    .passed
                    ? "Integrity Gate: دفتر الأستاذ متوازن"
                    : "Integrity Gate: يوجد فرق محاسبي"}
                </strong>
                <p>
                  فرق الـLedger:{" "}
                  {money(
                    Math.abs(
                      trialBalance
                        .integrity
                        .ledgerDifferenceMinor,
                    ),
                  )}
                  {" · "}
                  القيود غير المتوازنة:{" "}
                  {
                    trialBalance
                      .integrity
                      .unbalancedTransactionCount
                  }
                </p>
              </div>

              <b>
                {trialBalance
                  .integrity
                  .passed
                  ? "✓"
                  : "!"}
              </b>
            </section>

            <section className="financial-cost-coverage-card">
              <div className="financial-cost-coverage-head">
                <div>
                  <span>
                    تغطية تكلفة الفترة
                  </span>
                  <strong>
                    {coverage.toFixed(
                      2,
                    )}
                    %
                  </strong>
                </div>

                <div
                  className={
                    coverageComplete
                      ? "financial-cost-status is-complete"
                      : "financial-cost-status is-partial"
                  }
                >
                  {coverageComplete
                    ? "التكلفة مكتملة"
                    : "النتيجة مؤقتة حتى اكتمال التكلفة"}
                </div>
              </div>

              <div className="financial-cost-progress">
                <span
                  style={{
                    width:
                      `${Math.max(
                        0,
                        Math.min(
                          100,
                          coverage,
                        ),
                      )}%`,
                  }}
                />
              </div>

              <p>
                تكلفة معروفة:{" "}
                <b>
                  {money(
                    derived
                      .cogsKnownMinor,
                  )}
                </b>
                {" · "}
                أسطر تكلفة غير محلولة:{" "}
                <b>
                  {
                    grossProfit
                      .unresolvedMissingCostLines
                  }
                </b>
                {" · "}
                منتجات مباعة ناقصة تكلفة:{" "}
                <b>
                  {
                    grossProfit
                      .missingCostProducts
                      .length
                  }
                </b>
              </p>
            </section>

            <section className="financial-statement-card financial-income-statement">
              <header>
                <div>
                  <span>
                    عن الفترة{" "}
                    {from}
                    {" → "}
                    {to}
                  </span>
                  <h2>
                    قائمة الدخل
                  </h2>
                </div>

                <strong
                  className={
                    derived
                      .resultOnKnownCostMinor >=
                    0
                      ? "is-positive-text"
                      : "is-negative-text"
                  }
                >
                  {money(
                    derived
                      .resultOnKnownCostMinor,
                  )}
                </strong>
              </header>

              <div className="financial-statement-metrics">
                <Metric
                  label="صافي الإيرادات المسجلة"
                  value={money(
                    derived
                      .revenueMinor,
                  )}
                />

                <Metric
                  label="تكلفة البضاعة المعروفة"
                  value={money(
                    derived
                      .cogsKnownMinor,
                  )}
                  hint={
                    coverageComplete
                      ? "تغطية مكتملة"
                      : `تغطية ${coverage.toFixed(2)}%`
                  }
                  tone={
                    coverageComplete
                      ? undefined
                      : "warning"
                  }
                />

                <Metric
                  label="الهامش بعد التكلفة المعروفة"
                  value={money(
                    derived
                      .marginAfterKnownCostMinor,
                  )}
                />

                <Metric
                  label="المصروفات المسجلة"
                  value={money(
                    derived
                      .operatingExpenseMinor,
                  )}
                />

                <Metric
                  label={
                    coverageComplete
                      ? "صافي نتيجة الفترة"
                      : "النتيجة المؤقتة على التكلفة المعروفة"
                  }
                  value={money(
                    derived
                      .resultOnKnownCostMinor,
                  )}
                  tone={
                    derived
                      .resultOnKnownCostMinor >=
                    0
                      ? "positive"
                      : "negative"
                  }
                  hint={
                    coverageComplete
                      ? "الـCOGS مغطى بالكامل"
                      : "لا تعتبر ربحًا نهائيًا قبل اكتمال Cost Coverage"
                  }
                />
              </div>

              <div className="financial-statement-columns">
                <article>
                  <header>
                    <h3>
                      الإيرادات
                    </h3>
                    <b>
                      {money(
                        derived
                          .revenueMinor,
                      )}
                    </b>
                  </header>

                  <AccountRows
                    rows={
                      derived
                        .incomeRows
                    }
                  />
                </article>

                <article>
                  <header>
                    <h3>
                      المصروفات
                    </h3>
                    <b>
                      {money(
                        derived
                          .operatingExpenseMinor,
                      )}
                    </b>
                  </header>

                  <AccountRows
                    rows={
                      derived
                        .expenseRows
                    }
                  />
                </article>
              </div>
            </section>

            <section className="financial-statement-card financial-balance-sheet">
              <header>
                <div>
                  <span>
                    كما في{" "}
                    {to}
                  </span>
                  <h2>
                    الميزانية العمومية — أساس دفتر الأستاذ
                  </h2>
                </div>

                <strong>
                  فرق المعادلة{" "}
                  {money(
                    Math.abs(
                      derived
                        .equationDifferenceMinor,
                    ),
                  )}
                </strong>
              </header>

              <div className="financial-statement-metrics">
                <Metric
                  label="الأصول المسجلة"
                  value={money(
                    derived
                      .closingByType
                      .asset,
                  )}
                />

                <Metric
                  label="الالتزامات"
                  value={money(
                    derived
                      .closingByType
                      .liability,
                  )}
                />

                <Metric
                  label="حقوق الملكية المسجلة"
                  value={money(
                    derived
                      .closingByType
                      .equity,
                  )}
                />

                <Metric
                  label="النتيجة غير المقفلة في الـGL"
                  value={money(
                    derived
                      .unclosedResultMinor,
                  )}
                />
              </div>

              <div className="financial-equation">
                <span>
                  الأصول
                </span>
                <strong>
                  {money(
                    derived
                      .closingByType
                      .asset,
                  )}
                </strong>
                <i>=</i>
                <span>
                  الالتزامات + حقوق الملكية + النتيجة غير المقفلة
                </span>
                <strong>
                  {money(
                    derived
                      .closingByType
                      .liability +
                    derived
                      .closingByType
                      .equity +
                    derived
                      .unclosedResultMinor,
                  )}
                </strong>
              </div>

              <div className="financial-disclosure">
                <strong>
                  ملاحظة مهمة
                </strong>
                <p>
                  هذه الميزانية تعرض ما هو مُرحّل فعليًا إلى دفتر الأستاذ.
                  تقييم مخزون المنتجات موجود حاليًا في Cost Subledger مستقل،
                  لذلك نعرضه أدناه كمذكرة رقابية ولا نضيفه للأصول مرتين أو ننشئ
                  قيدًا افتراضيًا لمصدره.
                </p>
              </div>
            </section>

            <section className="financial-inventory-memo">
              <header>
                <div>
                  <span>
                    مذكرة خارج الـGL
                  </span>
                  <h2>
                    تقييم المخزون الحالي
                  </h2>
                </div>

                <strong>
                  {money(
                    derived
                      .valuedAvailableInventoryMinor,
                  )}
                </strong>
              </header>

              {to !== today && (
                <div className="financial-history-warning">
                  قيمة المخزون هنا هي القيمة الحالية بتاريخ {today} وليست
                  إعادة بناء تاريخية للمخزون بتاريخ {to}.
                </div>
              )}

              <div className="financial-statement-metrics">
                <Metric
                  label="مخزون متاح مقيّم"
                  value={money(
                    derived
                      .valuedAvailableInventoryMinor,
                  )}
                  hint={
                    `${derived.valuedQuantity} وحدة ضمن Cost State`
                  }
                />

                <Metric
                  label="منتجات مهيأة بالتكلفة"
                  value={
                    new Intl.NumberFormat(
                      "en-US",
                    ).format(
                      derived
                        .initializedCount,
                    )
                  }
                />

                <Metric
                  label="منتجات غير مهيأة"
                  value={
                    new Intl.NumberFormat(
                      "en-US",
                    ).format(
                      derived
                        .uninitializedCount,
                    )
                  }
                  hint={
                    `${derived.uninitializedWithStockCount} منها لديها مخزون حالي`
                  }
                  tone={
                    derived
                      .uninitializedWithStockCount >
                    0
                      ? "warning"
                      : undefined
                  }
                />

                <Metric
                  label="وحدات غير مقيّمة"
                  value={
                    new Intl.NumberFormat(
                      "en-US",
                    ).format(
                      derived
                        .unvaluedQuantity,
                    )
                  }
                  hint="لا يتم اختراع تكلفة لها"
                  tone={
                    derived
                      .unvaluedQuantity >
                    0
                      ? "warning"
                      : undefined
                  }
                />

                <Metric
                  label="اختلاف مخزون/تكلفة"
                  value={
                    new Intl.NumberFormat(
                      "en-US",
                    ).format(
                      derived
                        .inventoryMismatchCount,
                    )
                  }
                  tone={
                    derived
                      .inventoryMismatchCount >
                    0
                      ? "negative"
                      : "positive"
                  }
                />
              </div>
            </section>

            {grossProfit
              .missingCostProducts
              .length >
              0 && (
              <section className="financial-missing-cost-card financial-statements-no-print">
                <header>
                  <div>
                    <span>
                      تحتاج إدخال تكلفة
                    </span>
                    <h2>
                      منتجات أثرت على مبيعات الفترة بدون تكلفة كاملة
                    </h2>
                  </div>

                  <b>
                    {
                      grossProfit
                        .missingCostProducts
                        .length
                    }
                  </b>
                </header>

                <p className="financial-missing-cost-help">
                  أدخل تكلفة القطعة بالشيكل واحفظها من نفس الصف. إذا لم يكن للصنف Cost State
                  تُسجل كتكلفة افتتاحية وتُملأ الحركات التاريخية المتاحة، وإذا كان مهيأ مسبقًا
                  تُستكمل تكلفة الفترة فقط بدون تغيير تكلفة المخزون الحالية.
                </p>

                {costActionError && (
                  <div className="alert error-alert financial-cost-action-alert">
                    {costActionError}
                  </div>
                )}

                {costActionMessage && (
                  <div className="alert success-alert financial-cost-action-alert">
                    {costActionMessage}
                  </div>
                )}

                <div className="financial-missing-cost-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>
                          المنتج
                        </th>
                        <th>
                          الكود
                        </th>
                        <th>
                          الكمية المباعة
                        </th>
                        <th>
                          القناة
                        </th>
                        <th>
                          تكلفة القطعة
                        </th>
                        <th>
                          الإجراء
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {grossProfit
                        .missingCostProducts
                        .map(
                          (
                            product,
                          ) => {
                            const saving =
                              savingCostProductId ===
                              product.productId;

                            return (
                              <tr
                                key={
                                  product.productId
                                }
                              >
                                <td>
                                  <strong>
                                    {
                                      product.nameAr
                                    }
                                  </strong>
                                </td>
                                <td>
                                  <code className="financial-product-code">
                                    {
                                      product.productCode ??
                                      "—"
                                    }
                                  </code>
                                </td>
                                <td>
                                  {
                                    product.soldQuantity
                                  }
                                </td>
                                <td>
                                  {product.channels
                                    .map(
                                      (
                                        channel,
                                      ) =>
                                        channel ===
                                        "pos"
                                          ? "POS"
                                          : channel ===
                                              "online"
                                            ? "أونلاين"
                                            : "تبديل",
                                    )
                                    .join(
                                      "، ",
                                    )}
                                </td>
                                <td>
                                  <div className="financial-cost-input-wrap">
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      placeholder="مثال: 18.50"
                                      value={
                                        costInputs[
                                          product.productId
                                        ] ?? ""
                                      }
                                      disabled={
                                        saving
                                      }
                                      onChange={(
                                        event,
                                      ) => {
                                        setCostActionError("");
                                        setCostActionMessage("");

                                        setCostInputs(
                                          (
                                            current,
                                          ) => ({
                                            ...current,
                                            [product.productId]:
                                              event.target.value,
                                          }),
                                        );
                                      }}
                                      onKeyDown={(
                                        event,
                                      ) => {
                                        if (
                                          event.key ===
                                            "Enter" &&
                                          !saving
                                        ) {
                                          event.preventDefault();
                                          void handleCostAction(
                                            product,
                                          );
                                        }
                                      }}
                                    />
                                    <span>
                                      ₪
                                    </span>
                                  </div>
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className="primary-button financial-cost-save-button"
                                    disabled={
                                      saving ||
                                      !(
                                        costInputs[
                                          product.productId
                                        ] ?? ""
                                      ).trim()
                                    }
                                    onClick={() =>
                                      void handleCostAction(
                                        product,
                                      )
                                    }
                                  >
                                    {saving
                                      ? "جاري الحفظ..."
                                      : product.canSetOpeningCost
                                        ? "حفظ التكلفة"
                                        : "تحديث تكلفة الفترة"}
                                  </button>
                                </td>
                              </tr>
                            );
                          },
                        )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <footer className="financial-print-only financial-print-footer">
              تقرير صادر من نظام Lovely Kids — للمراجعة والمطابقة.
            </footer>
          </div>
        )}
    </section>
  );
}
