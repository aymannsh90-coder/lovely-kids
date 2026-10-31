import "./ReportVisualRefresh.css";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  usePosRuntime,
} from "../../app/pos-context";
import {
  ApiError,
  getOwnerProductAnalytics,
  type OwnerProductAnalyticsReport,
  type OwnerProductAnalyticsRow,
} from "../../lib/api";

type SortMode =
  | "views"
  | "cart"
  | "sales"
  | "interest";

type ProductPreview = {
  image: string;
  name: string;
};

function dateInput(
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

function todayRange() {
  const today =
    dateInput(
      new Date(),
    );

  return {
    from: today,
    to: today,
  };
}

function weekRange() {
  const end =
    new Date();

  const start =
    new Date(end);

  const daysSinceSaturday =
    (start.getDay() + 1) % 7;

  start.setDate(
    start.getDate() -
      daysSinceSaturday,
  );

  return {
    from:
      dateInput(start),
    to:
      dateInput(end),
  };
}

function monthRange() {
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
      dateInput(start),
    to:
      dateInput(end),
  };
}

function formatMoney(
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

function formatNumber(
  value: number,
) {
  return new Intl.NumberFormat(
    "en-US",
  ).format(value);
}

function ratio(
  part: number,
  total: number,
) {
  if (total <= 0) {
    return null;
  }

  return Math.round(
    (part / total) *
      1000,
  ) / 10;
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
          ? "product-analytics-metric is-emphasis"
          : "product-analytics-metric"
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

function RankingCard({
  title,
  hint,
  rows,
  metric,
  metricLabel,
  onPreview,
}: {
  title: string;
  hint: string;
  rows: OwnerProductAnalyticsRow[];
  metric: (
    row: OwnerProductAnalyticsRow,
  ) => string;
  metricLabel: string;
  onPreview: (
    product: ProductPreview,
  ) => void;
}) {
  return (
    <article className="product-analytics-ranking">
      <div className="product-analytics-ranking-head">
        <div>
          <h3>{title}</h3>
          <p>{hint}</p>
        </div>
      </div>

      <div className="product-analytics-ranking-list">
        {rows.length === 0 ? (
          <div className="product-analytics-ranking-empty">
            لا توجد بيانات كافية ضمن الفترة.
          </div>
        ) : (
          rows.map(
            (
              row,
              index,
            ) => (
              <div
                key={
                  row.productId
                }
                className="product-analytics-ranking-row"
              >
                <span className="product-analytics-rank">
                  {index + 1}
                </span>

                <button
                  type="button"
                  className="product-analytics-image-button product-analytics-ranking-image-button"
                  onClick={() =>
                    onPreview({
                      image:
                        row.image,
                      name:
                        row.nameAr,
                    })
                  }
                  aria-label={`معاينة صورة ${row.nameAr}`}
                >
                  <img
                    src={row.image}
                    alt={row.nameAr}
                  />
                </button>

                <div className="product-analytics-ranking-name">
                  <strong>
                    {row.nameAr}
                  </strong>

                  <small>
                    #{row.productId}
                    {row.productCode
                      ? ` • ${row.productCode}`
                      : ""}
                  </small>
                </div>

                <div className="product-analytics-ranking-value">
                  <strong>
                    {metric(
                      row,
                    )}
                  </strong>
                  <small>
                    {metricLabel}
                  </small>
                </div>
              </div>
            ),
          )
        )}
      </div>
    </article>
  );
}

export default function ProductAnalyticsReportPage() {
  const {
    token,
    clearAuthentication,
  } =
    usePosRuntime();

  const [
    preview,
    setPreview,
  ] =
    useState<
      ProductPreview | null
    >(null);

  const initialRange =
    monthRange();

  const [
    from,
    setFrom,
  ] =
    useState(
      initialRange.from,
    );

  const [
    to,
    setTo,
  ] =
    useState(
      initialRange.to,
    );

  const [
    report,
    setReport,
  ] =
    useState<
      OwnerProductAnalyticsReport | null
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
    query,
    setQuery,
  ] =
    useState("");

  const [
    sortMode,
    setSortMode,
  ] =
    useState<SortMode>(
      "views",
    );

  const [
    showOnlyActive,
    setShowOnlyActive,
  ] =
    useState(true);

  async function loadRange(
    nextFrom: string,
    nextTo: string,
  ) {
    if (
      !nextFrom ||
      !nextTo
    ) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const result =
        await getOwnerProductAnalytics(
          token,
          {
            from:
              nextFrom,
            to:
              nextTo,
          },
        );

      setReport(
        result,
      );
    } catch (caught) {
      if (
        caught instanceof
          ApiError &&
        caught.status ===
          401
      ) {
        clearAuthentication();
        return;
      }

      setError(
        caught instanceof
          Error
          ? caught.message
          : "تعذر تحميل تحليلات المنتجات",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRange(
      initialRange.from,
      initialRange.to,
    );
    // Initial report load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function applyPreset(
    preset: {
      from: string;
      to: string;
    },
  ) {
    setFrom(
      preset.from,
    );
    setTo(
      preset.to,
    );

    void loadRange(
      preset.from,
      preset.to,
    );
  }

  const filtered =
    useMemo(() => {
      if (!report) {
        return [];
      }

      const normalized =
        query
          .trim()
          .toLowerCase();

      const rows =
        report.products.filter(
          (row) => {
            if (
              showOnlyActive &&
              row.isHidden
            ) {
              return false;
            }

            if (
              !normalized
            ) {
              return true;
            }

            return [
              row.nameAr,
              row.productCode ??
                "",
              row.barcode ??
                "",
              row.category,
              row.productId,
            ]
              .join(" ")
              .toLowerCase()
              .includes(
                normalized,
              );
          },
        );

      return rows.sort(
        (
          left,
          right,
        ) => {
          if (
            sortMode ===
            "cart"
          ) {
            return (
              right.addToCart -
                left.addToCart ||
              right.views -
                left.views
            );
          }

          if (
            sortMode ===
            "sales"
          ) {
            return (
              right.units -
                left.units ||
              right.revenueMinor -
                left.revenueMinor
            );
          }

          if (
            sortMode ===
            "interest"
          ) {
            const leftInterest =
              left.hasInterestWithoutSales
                ? left.interestScore
                : -1;

            const rightInterest =
              right.hasInterestWithoutSales
                ? right.interestScore
                : -1;

            return (
              rightInterest -
                leftInterest ||
              right.views -
                left.views
            );
          }

          return (
            right.views -
              left.views ||
            right.addToCart -
              left.addToCart
          );
        },
      );
    }, [
      report,
      query,
      sortMode,
      showOnlyActive,
    ]);

  const activeRows =
    useMemo(
      () =>
        report?.products.filter(
          (row) =>
            !row.isHidden,
        ) ?? [],
      [report],
    );

  const topViewed =
    useMemo(
      () =>
        [...activeRows]
          .filter(
            (row) =>
              row.views > 0,
          )
          .sort(
            (a, b) =>
              b.views -
              a.views,
          )
          .slice(0, 5),
      [activeRows],
    );

  const topCarted =
    useMemo(
      () =>
        [...activeRows]
          .filter(
            (row) =>
              row.addToCart >
              0,
          )
          .sort(
            (a, b) =>
              b.addToCart -
              a.addToCart,
          )
          .slice(0, 5),
      [activeRows],
    );

  const highInterestNoSales =
    useMemo(
      () =>
        [...activeRows]
          .filter(
            (row) =>
              row.hasInterestWithoutSales,
          )
          .sort(
            (a, b) =>
              b.interestScore -
              a.interestScore,
          )
          .slice(0, 5),
      [activeRows],
    );

  const summary =
    report?.summary;

  const cartPerView =
    summary
      ? ratio(
          summary.addToCart,
          summary.views,
        )
      : null;

  const unitsPerView =
    summary
      ? ratio(
          summary.units,
          summary.views,
        )
      : null;

  useEffect(() => {
    if (!preview) {
      return;
    }

    const handleKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (
        event.key === "Escape"
      ) {
        setPreview(null);
      }
    };

    window.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () =>
      window.removeEventListener(
        "keydown",
        handleKeyDown,
      );
  }, [preview]);

  return (
    <div
      className="product-analytics-page lk-report-refresh"
      dir="rtl"
    >
      <section className="product-analytics-hero">
        <div>
          <span className="product-analytics-eyebrow">
            التقارير
          </span>

          <h1>
            أداء المنتجات والمتجر الإلكتروني
          </h1>

          <p>
            تعرف أي الموديلات يفتحها الزبائن، أيها يُضاف للسلة، أيها يتحول لطلبات مكتملة، وأين يوجد اهتمام بدون مبيعات.
          </p>
        </div>

        {report && (
          <div className="product-analytics-range-badge">
            <span>
              الفترة المعروضة
            </span>
            <strong>
              {report.range.from}
              {" → "}
              {report.range.to}
            </strong>
          </div>
        )}
      </section>

      <section className="product-analytics-datebar">
        <div className="product-analytics-presets">
          <button
            type="button"
            className="secondary-button"
            disabled={loading}
            onClick={() =>
              applyPreset(
                todayRange(),
              )
            }
          >
            اليوم
          </button>

          <button
            type="button"
            className="secondary-button"
            disabled={loading}
            onClick={() =>
              applyPreset(
                weekRange(),
              )
            }
          >
            هذا الأسبوع
          </button>

          <button
            type="button"
            className="secondary-button"
            disabled={loading}
            onClick={() =>
              applyPreset(
                monthRange(),
              )
            }
          >
            هذا الشهر
          </button>
        </div>

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
          type="button"
          className="primary-button"
          disabled={
            loading ||
            !from ||
            !to
          }
          onClick={() =>
            void loadRange(
              from,
              to,
            )
          }
        >
          {loading
            ? "جاري التحميل…"
            : "عرض"}
        </button>
      </section>

      {error && (
        <div className="alert error-alert">
          {error}
        </div>
      )}

      {report?.warnings.map(
        (
          warning,
          index,
        ) => (
          <section
            key={
              `${index}-${warning}`
            }
            className="product-analytics-warning"
          >
            <strong>
              ملاحظة على دقة المقارنة
            </strong>
            <p>{warning}</p>
          </section>
        ),
      )}

      {summary && (
        <>
          <section className="product-analytics-metrics">
            <Metric
              label="مشاهدات صفحات المنتجات"
              value={formatNumber(
                summary.views,
              )}
              hint="فتح صفحة المنتج بالتفصيل"
            />

            <Metric
              label="زوار المنتجات"
              value={formatNumber(
                summary.uniqueViewers,
              )}
              hint="زوار فريدون ضمن الفترة"
            />

            <Metric
              label="إضافات للسلة"
              value={formatNumber(
                summary.addToCart,
              )}
              hint={
                cartPerView ===
                null
                  ? "لا توجد مشاهدات للمقارنة"
                  : `${cartPerView}% مقارنة بعدد المشاهدات`
              }
            />

            <Metric
              label="قطع مباعة أونلاين"
              value={formatNumber(
                summary.units,
              )}
              hint={
                unitsPerView ===
                null
                  ? `${formatNumber(summary.completedOnlineOrders)} طلب مكتمل`
                  : `${unitsPerView} قطعة لكل 100 مشاهدة`
              }
            />

            <Metric
              label="مبيعات المنتجات أونلاين"
              value={formatMoney(
                summary.revenueMinor,
              )}
              hint="بدون رسوم التوصيل"
              emphasis
            />

            <Metric
              label="اهتمام بدون مبيعات"
              value={formatNumber(
                summary.interestWithoutSales,
              )}
              hint="موديلات عليها مشاهدة/سلة بدون طلب مكتمل"
            />
          </section>

          <section className="product-analytics-rankings">
            <RankingCard
              title="الأكثر مشاهدة"
              hint="الموديلات التي يفتح الزبون صفحتها أكثر"
              rows={
                topViewed
              }
              metric={(
                row,
              ) =>
                formatNumber(
                  row.views,
                )
              }
              metricLabel="مشاهدة"
              onPreview={setPreview}
            />

            <RankingCard
              title="الأكثر إضافة للسلة"
              hint="أقوى إشارة نية شراء قبل إكمال الطلب"
              rows={
                topCarted
              }
              metric={(
                row,
              ) =>
                formatNumber(
                  row.addToCart,
                )
              }
              metricLabel="إضافة"
              onPreview={setPreview}
            />

            <RankingCard
              title="فرصة تحتاج متابعة"
              hint="اهتمام واضح لكن بدون مبيعات مكتملة"
              rows={
                highInterestNoSales
              }
              metric={(
                row,
              ) =>
                formatNumber(
                  row.interestScore,
                )
              }
              metricLabel="نقاط اهتمام"
              onPreview={setPreview}
            />
          </section>

          <section className="product-analytics-table-card">
            <div className="product-analytics-table-tools">
              <div>
                <h2>
                  تفاصيل أداء كل موديل
                </h2>

                <p>
                  {formatNumber(
                    filtered.length,
                  )}{" "}
                  موديل معروض
                </p>
              </div>

              <div className="product-analytics-table-controls">
                <input
                  value={query}
                  onChange={(
                    event,
                  ) =>
                    setQuery(
                      event.target.value,
                    )
                  }
                  placeholder="بحث بالاسم أو الكود أو الباركود"
                />

                <select
                  value={
                    sortMode
                  }
                  onChange={(
                    event,
                  ) =>
                    setSortMode(
                      event.target.value as SortMode,
                    )
                  }
                >
                  <option value="views">
                    الأكثر مشاهدة
                  </option>
                  <option value="cart">
                    الأكثر إضافة للسلة
                  </option>
                  <option value="sales">
                    الأكثر مبيعًا
                  </option>
                  <option value="interest">
                    اهتمام بدون مبيعات
                  </option>
                </select>

                <label className="product-analytics-active-toggle">
                  <input
                    type="checkbox"
                    checked={
                      showOnlyActive
                    }
                    onChange={(
                      event,
                    ) =>
                      setShowOnlyActive(
                        event.target.checked,
                      )
                    }
                  />
                  <span>
                    الأصناف الظاهرة فقط
                  </span>
                </label>
              </div>
            </div>

            <div className="product-analytics-table-wrap">
              <table className="product-analytics-table">
                <thead>
                  <tr>
                    <th>الصنف</th>
                    <th>مشاهدات</th>
                    <th>زوار</th>
                    <th>إضافة للسلة</th>
                    <th>طلبات</th>
                    <th>قطع مباعة</th>
                    <th>مبيعات</th>
                    <th>مؤشر الاهتمام</th>
                    <th>الحالة</th>
                  </tr>
                </thead>

                <tbody>
                  {filtered.length ===
                  0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="product-analytics-empty"
                      >
                        لا توجد بيانات مطابقة للفلاتر.
                      </td>
                    </tr>
                  ) : (
                    filtered.map(
                      (row) => (
                        <tr
                          key={
                            row.productId
                          }
                        >
                          <td>
                            <div className="product-analytics-product-cell">
                              <button
                                type="button"
                                className="product-analytics-image-button"
                                onClick={() =>
                                  setPreview({
                                    image:
                                      row.image,
                                    name:
                                      row.nameAr,
                                  })
                                }
                                aria-label={`معاينة صورة ${row.nameAr}`}
                              >
                                <img
                                  src={
                                    row.image
                                  }
                                  alt={
                                    row.nameAr
                                  }
                                />
                              </button>

                              <div>
                                <strong>
                                  {
                                    row.nameAr
                                  }
                                </strong>

                                <small>
                                  #
                                  {
                                    row.productId
                                  }
                                  {row.productCode
                                    ? ` • ${row.productCode}`
                                    : ""}
                                  {row.isHidden
                                    ? " • مخفي"
                                    : ""}
                                </small>
                              </div>
                            </div>
                          </td>

                          <td>
                            {formatNumber(
                              row.views,
                            )}
                          </td>

                          <td>
                            {formatNumber(
                              row.viewers,
                            )}
                          </td>

                          <td>
                            {formatNumber(
                              row.addToCart,
                            )}
                          </td>

                          <td>
                            {formatNumber(
                              row.orders,
                            )}
                          </td>

                          <td>
                            {formatNumber(
                              row.units,
                            )}
                          </td>

                          <td>
                            {formatMoney(
                              row.revenueMinor,
                            )}
                          </td>

                          <td>
                            {formatNumber(
                              row.interestScore,
                            )}
                          </td>

                          <td>
                            {row.hasInterestWithoutSales ? (
                              <span className="product-analytics-status needs-attention">
                                اهتمام بدون بيع
                              </span>
                            ) : row.orders >
                              0 ? (
                              <span className="product-analytics-status has-sales">
                                فيه مبيعات
                              </span>
                            ) : row.views >
                                0 ||
                              row.addToCart >
                                0 ? (
                              <span className="product-analytics-status engaged">
                                فيه تفاعل
                              </span>
                            ) : (
                              <span className="product-analytics-status quiet">
                                بدون تفاعل
                              </span>
                            )}
                          </td>
                        </tr>
                      ),
                    )
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="product-analytics-methodology">
            <strong>
              كيف نقرأ التقرير؟
            </strong>

            <p>
              المشاهدة تعني فتح صفحة المنتج بالتفصيل، والإضافة للسلة تُسجل فقط بعد نجاح الإضافة. المبيعات تُؤخذ من الطلبات الإلكترونية التي أصبحت منجزة ومُرحّلة ماليًا ضمن الفترة. بيانات المشاهدة والسلة ليست تاريخية قبل تشغيل هذا التتبع، لذلك لا نعتبر الفترات الأقدم Funnel كاملًا.
            </p>
          </section>
        </>
      )}

      {preview && (
        <div
          className="product-analytics-preview-backdrop"
          role="presentation"
          onMouseDown={(
            event,
          ) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setPreview(null);
            }
          }}
        >
          <section
            className="product-analytics-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`معاينة صورة ${preview.name}`}
          >
            <div className="product-analytics-preview-head">
              <div>
                <span>
                  معاينة المنتج
                </span>
                <strong>
                  {preview.name}
                </strong>
              </div>

              <button
                type="button"
                className="product-analytics-preview-close"
                onClick={() =>
                  setPreview(null)
                }
                aria-label="إغلاق المعاينة"
              >
                ×
              </button>
            </div>

            <div className="product-analytics-preview-image">
              <img
                src={
                  preview.image
                }
                alt={
                  preview.name
                }
              />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
