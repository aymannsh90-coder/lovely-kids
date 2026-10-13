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
  getOwnerInventoryIntelligenceReport,
  type InventoryCoverageSignal,
  type InventoryMovementClass,
  type InventoryRiskSignal,
  type InventoryStockState,
  type OwnerInventoryIntelligenceProduct,
  type OwnerInventoryIntelligenceReport,
} from "../../lib/api";

type SortMode =
  | "attention"
  | "sold30"
  | "sold90"
  | "sell_through_30"
  | "velocity"
  | "days_of_supply"
  | "inventory_risk"
  | "oldest"
  | "last_sale";

type ProductPreview = {
  image: string;
  name: string;
};

const movementLabels:
  Record<
    InventoryMovementClass,
    string
  > = {
    fast: "سريع",
    normal: "طبيعي",
    slow: "بطيء",
    dead: "ميت",
    new: "جديد",
  };

const stockLabels:
  Record<
    InventoryStockState,
    string
  > = {
    in_stock: "متوفر",
    out_of_stock: "نفد",
    untracked: "كمية غير مكتملة",
  };

const coverageLabels:
  Record<
    InventoryCoverageSignal,
    string
  > = {
    untracked: "مخزون غير متتبع",
    insufficient_history:
      "تاريخ غير كافٍ",
    no_net_demand:
      "لا يوجد طلب صافي",
    out_of_stock: "نفد",
    low: "نفد قريبًا",
    healthy: "تغطية جيدة",
    high: "تغطية عالية",
  };

const riskLabels:
  Record<
    InventoryRiskSignal,
    string
  > = {
    untracked: "غير متتبع",
    insufficient_history:
      "بيانات غير كافية",
    balanced: "متوازن",
    stockout_now: "نفد مع طلب حديث",
    stockout_high: "خطر نفاد مرتفع",
    stockout_watch: "مراقبة نفاد",
    overstock_high: "فائض مرتفع",
    overstock_watch: "مراقبة فائض",
  };

function formatNumber(
  value: number,
) {
  return new Intl.NumberFormat(
    "en-US",
  ).format(value);
}

function formatDecimal(
  value: number,
) {
  return new Intl.NumberFormat(
    "en-US",
    {
      maximumFractionDigits: 1,
    },
  ).format(value);
}

function formatPercent(
  value: number | null,
) {
  return value === null
    ? "N/A"
    : `${formatDecimal(value)}%`;
}

function formatRate(
  value: number | null,
) {
  if (value === null) {
    return "N/A";
  }

  return new Intl.NumberFormat(
    "en-US",
    {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    },
  ).format(value);
}

function formatDate(
  value: string | null,
) {
  if (!value) {
    return "—";
  }

  return value;
}

const URGENT_REORDER_RECENCY_DAYS =
  14;

function isUrgentReorder(
  product:
    OwnerInventoryIntelligenceProduct,
) {
  return (
    product.movementClass ===
      "fast" &&
    product.stockState ===
      "out_of_stock" &&
    product.daysSinceLastSale !==
      null &&
    product.daysSinceLastSale <=
      URGENT_REORDER_RECENCY_DAYS
  );
}

function movementHint(
  product:
    OwnerInventoryIntelligenceProduct,
) {
  if (
    isUrgentReorder(product)
  ) {
    return "إعادة طلب عاجلة";
  }

  if (
    product.movementClass ===
      "fast" &&
    product.stockState ===
      "out_of_stock"
  ) {
    return "راجع إعادة الطلب";
  }

  if (
    product.movementClass ===
    "dead"
  ) {
    return "مرشح للتصريف";
  }

  if (
    product.movementClass ===
    "slow"
  ) {
    return "راجع السعر أو العرض";
  }

  if (
    product.movementClass ===
    "fast"
  ) {
    return "راقب إعادة الطلب";
  }

  if (
    product.movementClass ===
      "new" &&
    product.stockState ===
      "out_of_stock"
  ) {
    return "نفد مبكرًا — راقب الطلب";
  }

  if (
    product.movementClass ===
    "new"
  ) {
    return "أعطه وقتًا للحركة";
  }

  if (
    product.stockState ===
      "out_of_stock" &&
    product.sold30 > 0
  ) {
    return "نفد — راجع الحاجة";
  }

  return "حركة طبيعية";
}

function riskPriority(
  signal: InventoryRiskSignal,
) {
  switch (signal) {
    case "stockout_now":
      return 0;
    case "stockout_high":
      return 1;
    case "overstock_high":
      return 2;
    case "stockout_watch":
      return 3;
    case "overstock_watch":
      return 4;
    case "balanced":
      return 5;
    case "insufficient_history":
      return 6;
    case "untracked":
      return 7;
  }
}

function inventoryRiskAction(
  product:
    OwnerInventoryIntelligenceProduct,
) {
  switch (
    product.inventoryRiskSignal
  ) {
    case "stockout_now":
      return "إعادة طلب عاجلة";
    case "stockout_high":
      return "راجع إعادة الطلب اليوم";
    case "stockout_watch":
      return "جهّز إعادة الطلب";
    case "overstock_high":
      return "خفف الشراء وابدأ تصريف";
    case "overstock_watch":
      return "خفف الشراء وراقب الحركة";
    case "untracked":
      return "أكمل تتبع المخزون";
    case "insufficient_history":
      return "انتظر بيانات حركة موثوقة";
    case "balanced":
      return movementHint(
        product,
      );
  }
}

function attentionRank(
  product:
    OwnerInventoryIntelligenceProduct,
) {
  const inventoryRiskRank =
    riskPriority(
      product.inventoryRiskSignal,
    );

  if (inventoryRiskRank < 5) {
    return inventoryRiskRank;
  }
  if (
    isUrgentReorder(product)
  ) {
    return 0;
  }

  if (
    product.movementClass ===
    "dead"
  ) {
    return 1;
  }

  if (
    product.movementClass ===
    "slow"
  ) {
    return 2;
  }

  if (
    product.movementClass ===
    "fast"
  ) {
    return 3;
  }

  if (
    product.movementClass ===
    "new"
  ) {
    return 4;
  }

  return 5;
}

function Metric({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint: string;
  emphasis?: boolean;
}) {
  return (
    <article
      className={
        emphasis
          ? "inventory-intelligence-metric is-emphasis"
          : "inventory-intelligence-metric"
      }
    >
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

export default function InventoryIntelligenceReportPage() {
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

  const [
    report,
    setReport,
  ] =
    useState<
      OwnerInventoryIntelligenceReport | null
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
    movementFilter,
    setMovementFilter,
  ] =
    useState<
      InventoryMovementClass | "all"
    >("all");

  const [
    stockFilter,
    setStockFilter,
  ] =
    useState<
      InventoryStockState | "all"
    >("all");

  const [
    categoryFilter,
    setCategoryFilter,
  ] =
    useState("all");

  const [
    coverageFilter,
    setCoverageFilter,
  ] =
    useState<
      InventoryCoverageSignal | "all"
    >("all");

  const [
    riskFilter,
    setRiskFilter,
  ] =
    useState<
      InventoryRiskSignal | "all"
    >("all");

  const [
    sortMode,
    setSortMode,
  ] =
    useState<SortMode>(
      "attention",
    );

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const result =
        await getOwnerInventoryIntelligenceReport(
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
        caught instanceof Error
          ? caught.message
          : "تعذر تحميل ذكاء المخزون",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // Initial load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

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

  const categories =
    useMemo(
      () =>
        Array.from(
          new Set(
            report?.products.map(
              (product) =>
                product.category,
            ) ?? [],
          ),
        ).sort(
          (left, right) =>
            left.localeCompare(
              right,
              "ar",
            ),
        ),
      [report],
    );

  const filtered =
    useMemo(() => {
      const normalizedQuery =
        query
          .trim()
          .toLowerCase();

      const rows =
        report?.products.filter(
          (product) => {
            if (
              movementFilter !==
                "all" &&
              product.movementClass !==
                movementFilter
            ) {
              return false;
            }

            if (
              stockFilter !==
                "all" &&
              product.stockState !==
                stockFilter
            ) {
              return false;
            }

            if (
              categoryFilter !==
                "all" &&
              product.category !==
                categoryFilter
            ) {
              return false;
            }

            if (
              coverageFilter !==
                "all" &&
              product.coverageSignal !==
                coverageFilter
            ) {
              return false;
            }

            if (
              riskFilter !==
                "all" &&
              product.inventoryRiskSignal !==
                riskFilter
            ) {
              return false;
            }

            if (
              normalizedQuery
            ) {
              const haystack =
                [
                  product.nameAr,
                  product.productId,
                  product.productCode ??
                    "",
                  product.barcode ??
                    "",
                  product.category,
                ]
                  .join(" ")
                  .toLowerCase();

              if (
                !haystack.includes(
                  normalizedQuery,
                )
              ) {
                return false;
              }
            }

            return true;
          },
        ) ?? [];

      return [
        ...rows,
      ].sort(
        (left, right) => {
          if (
            sortMode ===
            "sold30"
          ) {
            return (
              right.sold30 -
              left.sold30
            );
          }

          if (
            sortMode ===
            "sold90"
          ) {
            return (
              right.sold90 -
              left.sold90
            );
          }

          if (
            sortMode ===
            "sell_through_30"
          ) {
            if (
              left.sellThrough30Percent ===
                null &&
              right.sellThrough30Percent ===
                null
            ) {
              return 0;
            }

            if (
              left.sellThrough30Percent ===
              null
            ) {
              return 1;
            }

            if (
              right.sellThrough30Percent ===
              null
            ) {
              return -1;
            }

            return (
              right.sellThrough30Percent -
              left.sellThrough30Percent
            );
          }

          if (
            sortMode ===
            "velocity"
          ) {
            return (
              (right.averageDailyNetDemand ??
                -1) -
              (left.averageDailyNetDemand ??
                -1)
            );
          }

          if (
            sortMode ===
            "days_of_supply"
          ) {
            if (
              left.daysOfSupply ===
                null &&
              right.daysOfSupply ===
                null
            ) {
              return 0;
            }

            if (
              left.daysOfSupply ===
              null
            ) {
              return 1;
            }

            if (
              right.daysOfSupply ===
              null
            ) {
              return -1;
            }

            return (
              left.daysOfSupply -
              right.daysOfSupply
            );
          }

          if (
            sortMode ===
            "inventory_risk"
          ) {
            const riskRank =
              riskPriority(
                left.inventoryRiskSignal,
              ) -
              riskPriority(
                right.inventoryRiskSignal,
              );

            if (riskRank !== 0) {
              return riskRank;
            }

            return (
              right.sold30 -
              left.sold30
            );
          }

          if (
            sortMode ===
            "oldest"
          ) {
            return (
              right.ageDays -
              left.ageDays
            );
          }

          if (
            sortMode ===
            "last_sale"
          ) {
            if (
              left.lastSaleDate ===
              null
            ) {
              return -1;
            }

            if (
              right.lastSaleDate ===
              null
            ) {
              return 1;
            }

            return left.lastSaleDate.localeCompare(
              right.lastSaleDate,
            );
          }

          const rank =
            attentionRank(
              left,
            ) -
            attentionRank(
              right,
            );

          if (rank !== 0) {
            return rank;
          }

          if (
            left.movementClass ===
            "dead"
          ) {
            return (
              right.ageDays -
              left.ageDays
            );
          }

          return (
            right.sold30 -
            left.sold30
          );
        },
      );
    }, [
      report,
      query,
      movementFilter,
      stockFilter,
      categoryFilter,
      coverageFilter,
      riskFilter,
      sortMode,
    ]);

  if (loading) {
    return (
      <section className="inventory-intelligence-page">
        <div className="inventory-intelligence-state">
          جاري تحليل حركة المخزون...
        </div>
      </section>
    );
  }

  if (
    error ||
    !report
  ) {
    return (
      <section className="inventory-intelligence-page">
        <div className="inventory-intelligence-state is-error">
          <strong>
            تعذر تحميل التقرير
          </strong>
          <p>
            {error ||
              "حدث خطأ غير متوقع"}
          </p>
          <button
            type="button"
            className="primary-button"
            onClick={() =>
              void loadData()
            }
          >
            إعادة المحاولة
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="inventory-intelligence-page">
      <header className="inventory-intelligence-hero">
        <div>
          <span className="inventory-intelligence-eyebrow">
            Stage 5.1–5.4 · Inventory Intelligence
          </span>
          <h1>
            عمر وحركة وتغطية المخزون
          </h1>
          <p>
            يحدد الحركة والتصريف والتغطية، ثم يحولها إلى إنذارات عملية لخطر النفاد أو فائض المخزون حتى تعرف أين تعيد الطلب وأين تخفف الشراء.
          </p>
        </div>

        <div className="inventory-intelligence-date">
          <span>
            التقرير حتى
          </span>
          <strong>
            {report.asOfDate}
          </strong>
          <small>
            بيع مكتمل:{" "}
            {formatNumber(
              report.history
                .coverageDays,
            )}{" "}
            يوم · حركات مخزون:{" "}
            {formatNumber(
              report.history
                .inventoryMovementCoverageDays,
            )}{" "}
            يوم
          </small>
        </div>
      </header>

      {report.warnings.length >
        0 && (
        <div className="inventory-intelligence-warning">
          <strong>
            ملاحظات دقة التقرير
          </strong>
          {report.warnings.map(
            (warning) => (
              <p key={warning}>
                {warning}
              </p>
            ),
          )}
        </div>
      )}

      <div className="inventory-intelligence-metrics">
        <Metric
          label="أصناف سريعة"
          value={formatNumber(
            report.summary
              .fastMovers,
          )}
          hint="وصلت لحد السرعة خلال 30 أو 90 يوم"
          emphasis
        />

        <Metric
          label="أصناف بطيئة"
          value={formatNumber(
            report.summary
              .slowMovers,
          )}
          hint="مخزون موجود وحركة بيع ضعيفة"
        />

        <Metric
          label="مخزون ميت"
          value={formatNumber(
            report.summary
              .deadMovers,
          )}
          hint={
            report.history
              .hasNinetyDayHistory
              ? "90 يوم بدون بيع مع وجود مخزون"
              : "لن يُفعّل قبل توفر 90 يوم من التاريخ"
          }
        />

        <Metric
          label="سريع ونفد"
          value={formatNumber(
            report.summary
              .fastOutOfStock,
          )}
          hint="السريع الذي نفد؛ العاجل فقط إذا كان آخر بيع خلال 14 يوم"
        />

        <Metric
          label="لم يُبع بعد"
          value={formatNumber(
            report.summary
              .neverSoldInStock,
          )}
          hint="أصناف لديها مخزون ولا يوجد بيع مسجل"
        />

        <Metric
          label="أصناف متوفرة"
          value={formatNumber(
            report.summary
              .inStockProducts,
          )}
          hint={`من أصل ${formatNumber(
            report.summary
              .totalProducts,
          )} صنف فعّال في التقرير`}
        />
      </div>

      <div className="inventory-intelligence-metrics">
        <Metric
          label="تصريف 30 يوم"
          value={formatPercent(
            report.summary
              .sellThrough30Percent,
          )}
          hint={`${formatNumber(
            report.summary
              .sellThrough30ReliableProducts,
          )} صنف بنافذة حركة موثوقة كاملة`}
          emphasis
        />

        <Metric
          label="تصريف 90 يوم"
          value={formatPercent(
            report.summary
              .sellThrough90Percent,
          )}
          hint={`${formatNumber(
            report.summary
              .sellThrough90ReliableProducts,
          )} صنف بنافذة حركة موثوقة كاملة`}
        />

        <Metric
          label="تغطية حتى 14 يوم"
          value={formatNumber(
            report.summary
              .coverUnder14Days,
          )}
          hint="مخزون متوفر لكن سرعته الحالية قد تنفده قريبًا"
        />

        <Metric
          label="تغطية 15–60 يوم"
          value={formatNumber(
            report.summary
              .cover15To60Days,
          )}
          hint="تغطية جيدة حسب صافي الطلب الحالي"
        />

        <Metric
          label="تغطية فوق 60 يوم"
          value={formatNumber(
            report.summary
              .coverOver60Days,
          )}
          hint="مرشح للمراجعة إذا استمرت نفس سرعة البيع"
        />

        <Metric
          label="بيانات تغطية غير كافية"
          value={formatNumber(
            report.summary
              .insufficientCoverageData,
          )}
          hint={`يلزم ${formatNumber(
            report.thresholds
              .minimumVelocityHistoryDays,
          )} أيام حركة موثوقة على الأقل؛ بلا طلب صافي: ${formatNumber(
            report.summary
              .noVelocityInStock,
          )}`}
        />
      </div>

      <div className="inventory-intelligence-metrics">
        <Metric
          label="نفد مع طلب حديث"
          value={formatNumber(
            report.summary
              .stockoutNow,
          )}
          hint={`مخزون صفر مع بيع خلال آخر ${formatNumber(
            report.thresholds
              .lowCoverageDays,
          )} يوم`}
          emphasis
        />

        <Metric
          label="خطر نفاد مرتفع"
          value={formatNumber(
            report.summary
              .stockoutHighRisk,
          )}
          hint={`متوفر لكن التغطية ${formatNumber(
            report.thresholds
              .stockoutHighDays,
          )} أيام أو أقل`}
        />

        <Metric
          label="مراقبة نفاد"
          value={formatNumber(
            report.summary
              .stockoutWatch,
          )}
          hint={`فوق ${formatNumber(
            report.thresholds
              .stockoutHighDays,
          )} وحتى ${formatNumber(
            report.thresholds
              .lowCoverageDays,
          )} يوم`}
        />

        <Metric
          label="فائض مرتفع"
          value={formatNumber(
            report.summary
              .overstockHighRisk,
          )}
          hint={`بعد عمر ${formatNumber(
            report.thresholds
              .minimumOverstockAgeDays,
          )} يوم وبإشارة فائض قوية`}
        />

        <Metric
          label="مراقبة فائض"
          value={formatNumber(
            report.summary
              .overstockWatch,
          )}
          hint={`بطيء، بلا طلب صافي، أو تغطية فوق ${formatNumber(
            report.thresholds
              .highCoverageDays,
          )} يوم`}
        />

        <Metric
          label="بيانات مخاطرة غير كافية"
          value={formatNumber(
            report.summary
              .insufficientRiskData,
          )}
          hint="لا يصدر إنذار نفاد/فائض قبل توفر بيانات موثوقة"
        />
      </div>

      <div className="inventory-intelligence-filters">
        <label className="inventory-intelligence-search">
          <span>
            بحث
          </span>
          <input
            value={query}
            onChange={(event) =>
              setQuery(
                event.target.value,
              )
            }
            placeholder="اسم، كود، باركود أو رقم الصنف"
          />
        </label>

        <label>
          <span>
            الحركة
          </span>
          <select
            value={
              movementFilter
            }
            onChange={(event) =>
              setMovementFilter(
                event.target
                  .value as
                  | InventoryMovementClass
                  | "all",
              )
            }
          >
            <option value="all">
              كل التصنيفات
            </option>
            <option value="fast">
              سريع
            </option>
            <option value="normal">
              طبيعي
            </option>
            <option value="slow">
              بطيء
            </option>
            <option value="dead">
              ميت
            </option>
            <option value="new">
              جديد
            </option>
          </select>
        </label>

        <label>
          <span>
            حالة المخزون
          </span>
          <select
            value={
              stockFilter
            }
            onChange={(event) =>
              setStockFilter(
                event.target
                  .value as
                  | InventoryStockState
                  | "all",
              )
            }
          >
            <option value="all">
              الكل
            </option>
            <option value="in_stock">
              متوفر
            </option>
            <option value="out_of_stock">
              نفد
            </option>
            <option value="untracked">
              كمية غير مكتملة
            </option>
          </select>
        </label>

        <label>
          <span>
            التصنيف
          </span>
          <select
            value={
              categoryFilter
            }
            onChange={(event) =>
              setCategoryFilter(
                event.target.value,
              )
            }
          >
            <option value="all">
              كل التصنيفات
            </option>
            {categories.map(
              (category) => (
                <option
                  key={category}
                  value={category}
                >
                  {category}
                </option>
              ),
            )}
          </select>
        </label>

        <label>
          <span>
            التغطية
          </span>
          <select
            value={
              coverageFilter
            }
            onChange={(event) =>
              setCoverageFilter(
                event.target
                  .value as
                  | InventoryCoverageSignal
                  | "all",
              )
            }
          >
            <option value="all">
              كل الإشارات
            </option>
            {(
              Object.keys(
                coverageLabels,
              ) as InventoryCoverageSignal[]
            ).map(
              (signal) => (
                <option
                  key={signal}
                  value={signal}
                >
                  {
                    coverageLabels[
                      signal
                    ]
                  }
                </option>
              ),
            )}
          </select>
        </label>

        <label>
          <span>
            مخاطر المخزون
          </span>
          <select
            value={
              riskFilter
            }
            onChange={(event) =>
              setRiskFilter(
                event.target
                  .value as
                  | InventoryRiskSignal
                  | "all",
              )
            }
          >
            <option value="all">
              كل المخاطر
            </option>
            {(
              Object.keys(
                riskLabels,
              ) as InventoryRiskSignal[]
            ).map(
              (signal) => (
                <option
                  key={signal}
                  value={signal}
                >
                  {
                    riskLabels[
                      signal
                    ]
                  }
                </option>
              ),
            )}
          </select>
        </label>

        <label>
          <span>
            الترتيب
          </span>
          <select
            value={sortMode}
            onChange={(event) =>
              setSortMode(
                event.target
                  .value as
                  SortMode,
              )
            }
          >
            <option value="attention">
              أولوية القرار
            </option>
            <option value="inventory_risk">
              أعلى مخاطر المخزون
            </option>
            <option value="sold30">
              الأكثر بيعًا 30 يوم
            </option>
            <option value="sold90">
              الأكثر بيعًا 90 يوم
            </option>
            <option value="sell_through_30">
              أعلى تصريف 30 يوم
            </option>
            <option value="velocity">
              أعلى سرعة طلب صافية
            </option>
            <option value="days_of_supply">
              أقل أيام تغطية
            </option>
            <option value="oldest">
              الأقدم
            </option>
            <option value="last_sale">
              الأبعد عن آخر بيع
            </option>
          </select>
        </label>

        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            void loadData()
          }
        >
          تحديث
        </button>
      </div>

      <div className="inventory-intelligence-table-card">
        <div className="inventory-intelligence-table-head">
          <div>
            <h2>
              تفاصيل الأصناف
            </h2>
            <p>
              بيع 30/90 للتصنيف هو البيع المكتمل؛ Sell-through والسرعة والتغطية تعتمد صافي حركة المخزون، وStage 5.4 يحول التغطية والحركة إلى خطر نفاد أو فائض بدون تخمين عند نقص البيانات.
            </p>
          </div>

          <span>
            {formatNumber(
              filtered.length,
            )}{" "}
            صنف
          </span>
        </div>

        <div className="inventory-intelligence-table-wrap">
          <table className="inventory-intelligence-table">
            <thead>
              <tr>
                <th>
                  الصنف
                </th>
                <th>
                  الحركة
                </th>
                <th>
                  المخزون
                </th>
                <th>
                  بيع 30 يوم
                </th>
                <th>
                  بيع 90 يوم
                </th>
                <th>
                  Sell-through
                </th>
                <th>
                  سرعة صافية
                </th>
                <th>
                  أيام التغطية
                </th>
                <th>
                  حالة التغطية
                </th>
                <th>
                  آخر بيع
                </th>
                <th>
                  آخر شراء
                </th>
                <th>
                  عمر الصنف
                </th>
                <th>
                  مخاطر المخزون
                </th>
                <th>
                  الإجراء
                </th>
              </tr>
            </thead>

            <tbody>
              {filtered.map(
                (product) => (
                  <tr
                    key={
                      product.productId
                    }
                    className={
                      product.isHidden
                        ? "is-hidden-product"
                        : undefined
                    }
                  >
                    <td>
                      <div className="inventory-intelligence-product">
                        <button
                          type="button"
                          className="product-analytics-image-button inventory-intelligence-image-button"
                          onClick={() =>
                            setPreview({
                              image:
                                product.image,
                              name:
                                product.nameAr,
                            })
                          }
                          aria-label={`معاينة صورة ${product.nameAr}`}
                        >
                          <img
                            src={
                              product.image
                            }
                            alt={
                              product.nameAr
                            }
                          />
                        </button>
                        <div>
                          <strong>
                            {
                              product.nameAr
                            }
                          </strong>
                          <small>
                            #
                            {
                              product.productId
                            }
                            {" · "}
                            كود:{" "}
                            {product.productCode ||
                              "—"}
                            {product.isHidden
                              ? " · مخفي"
                              : ""}
                          </small>
                        </div>
                      </div>
                    </td>

                    <td>
                      <span
                        className={`inventory-intelligence-badge movement-${product.movementClass}`}
                      >
                        {
                          movementLabels[
                            product
                              .movementClass
                          ]
                        }
                      </span>
                    </td>

                    <td>
                      <strong>
                        {product.currentQuantity ===
                        null
                          ? "—"
                          : formatNumber(
                              product.currentQuantity,
                            )}
                      </strong>
                      <small className={`inventory-intelligence-stock stock-${product.stockState}`}>
                        {
                          stockLabels[
                            product
                              .stockState
                          ]
                        }
                      </small>
                    </td>

                    <td>
                      <strong>
                        {formatNumber(
                          product.sold30,
                        )}
                      </strong>
                    </td>

                    <td>
                      <strong>
                        {formatNumber(
                          product.sold90,
                        )}
                      </strong>
                    </td>

                    <td>
                      <strong>
                        30d{" "}
                        {formatPercent(
                          product.sellThrough30Percent,
                        )}
                      </strong>
                      <small>
                        {product.sellThrough30Reliable
                          ? `صافي ${formatNumber(
                              product.sellThrough30NetDemand,
                            )} من ${formatNumber(
                              product.sellThrough30AvailableUnits ??
                                0,
                            )} · ${formatNumber(
                              product.sellThrough30WindowDays,
                            )} يوم`
                          : "30d: سجل الحركات لا يغطي النافذة كاملة"}
                      </small>
                      <small>
                        90d{" "}
                        {formatPercent(
                          product.sellThrough90Percent,
                        )}
                        {product.sellThrough90Reliable
                          ? ` · صافي ${formatNumber(
                              product.sellThrough90NetDemand,
                            )}`
                          : " · N/A"}
                      </small>
                    </td>

                    <td>
                      <strong>
                        {formatRate(
                          product.averageDailyNetDemand,
                        )}{" "}
                        {product.averageDailyNetDemand ===
                        null
                          ? ""
                          : "قطعة/يوم"}
                      </strong>
                      <small>
                        صافي{" "}
                        {formatNumber(
                          product.velocityNetDemand,
                        )}{" "}
                        خلال{" "}
                        {formatNumber(
                          product.velocityWindowDays,
                        )}{" "}
                        يوم
                      </small>
                    </td>

                    <td>
                      <strong>
                        {product.daysOfSupply ===
                        null
                          ? "N/A"
                          : `${formatDecimal(
                              product.daysOfSupply,
                            )} يوم`}
                      </strong>
                      <small>
                        {product.coverageSignal ===
                        "no_net_demand"
                          ? "لا توجد حركة طلب صافية"
                          : product.coverageSignal ===
                              "insufficient_history"
                            ? "تاريخ الحركة غير كافٍ"
                            : product.coverageSignal ===
                                "untracked"
                              ? "المخزون غير متتبع"
                              : `نافذة السرعة ${formatNumber(
                                  product.velocityWindowDays,
                                )} يوم`}
                      </small>
                    </td>

                    <td>
                      <span
                        className={`inventory-intelligence-badge coverage-${product.coverageSignal}`}
                      >
                        {
                          coverageLabels[
                            product
                              .coverageSignal
                          ]
                        }
                      </span>
                    </td>

                    <td>
                      <strong>
                        {formatDate(
                          product.lastSaleDate,
                        )}
                      </strong>
                      <small>
                        {product.daysSinceLastSale ===
                        null
                          ? "لم يُبع"
                          : `منذ ${formatNumber(
                              product.daysSinceLastSale,
                            )} يوم`}
                      </small>
                    </td>

                    <td>
                      <strong>
                        {formatDate(
                          product.lastPurchaseDate,
                        )}
                      </strong>
                      <small>
                        {product.firstPurchaseDate
                          ? `أول شراء ${product.firstPurchaseDate}`
                          : "العمر من تاريخ إنشاء الصنف"}
                      </small>
                    </td>

                    <td>
                      <strong>
                        {formatNumber(
                          product.ageDays,
                        )}{" "}
                        يوم
                      </strong>
                      <small>
                        من{" "}
                        {
                          product.inventoryStartDate
                        }
                      </small>
                    </td>

                    <td>
                      <span
                        className={`inventory-intelligence-badge risk-${product.inventoryRiskSignal}`}
                      >
                        {
                          riskLabels[
                            product
                              .inventoryRiskSignal
                          ]
                        }
                      </span>
                    </td>

                    <td>
                      <span
                        className={`inventory-intelligence-action risk-${product.inventoryRiskSignal}`}
                      >
                        {inventoryRiskAction(
                          product,
                        )}
                      </span>
                    </td>
                  </tr>
                ),
              )}

              {filtered.length ===
                0 && (
                <tr>
                  <td
                    colSpan={14}
                    className="inventory-intelligence-empty"
                  >
                    لا توجد أصناف مطابقة للفلاتر الحالية.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <section className="inventory-intelligence-methodology">
        <h2>
          كيف يتم التصنيف؟
        </h2>

        <div>
          <p>
            <strong>
              سريع:
            </strong>{" "}
            {
              report.methodology
                .fast
            }
          </p>
          <p>
            <strong>
              بطيء:
            </strong>{" "}
            {
              report.methodology
                .slow
            }
          </p>
          <p>
            <strong>
              ميت:
            </strong>{" "}
            {
              report.methodology
                .dead
            }
          </p>
          <p>
            <strong>
              جديد:
            </strong>{" "}
            {
              report.methodology
                .new
            }
          </p>
          <p>
            <strong>
              Sell-through:
            </strong>{" "}
            {
              report.methodology
                .sellThrough
            }
          </p>
          <p>
            <strong>
              أيام التغطية:
            </strong>{" "}
            {
              report.methodology
                .daysOfSupply
            }
          </p>
          <p>
            <strong>
              مخاطر المخزون:
            </strong>{" "}
            {
              report.methodology
                .inventoryRisk
            }
          </p>
          <p>
            <strong>
              مصدر البيع:
            </strong>{" "}
            {
              report.methodology
                .sales
            }
          </p>
          <p>
            <strong>
              عمر الصنف:
            </strong>{" "}
            {
              report.methodology
                .purchase
            }
          </p>
        </div>
      </section>

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
    </section>
  );
}
