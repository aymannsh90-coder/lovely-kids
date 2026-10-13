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
  type InventoryMovementClass,
  type InventoryStockState,
  type OwnerInventoryIntelligenceProduct,
  type OwnerInventoryIntelligenceReport,
} from "../../lib/api";

type SortMode =
  | "attention"
  | "sold30"
  | "sold90"
  | "sell_through_30"
  | "days_of_supply"
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
    ? "—"
    : `${formatDecimal(value)}%`;
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

function attentionRank(
  product:
    OwnerInventoryIntelligenceProduct,
) {
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
            "days_of_supply"
          ) {
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
            Stage 5.1–5.2 · Inventory Intelligence
          </span>
          <h1>
            عمر وحركة وتغطية المخزون
          </h1>
          <p>
            يحدد الأصناف السريعة والبطيئة والميتة، ويضيف نسبة التصريف وأيام تغطية المخزون حتى تعرف أين المخزون ناقص وأين رأس المال متوقف.
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
            تاريخ بيع مسجل:{" "}
            {formatNumber(
              report.history
                .coverageDays,
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
          hint="مباع ÷ (مباع + المخزون الحالي) — مؤشر تقديري"
          emphasis
        />

        <Metric
          label="تصريف 90 يوم"
          value={formatPercent(
            report.summary
              .sellThrough90Percent,
          )}
          hint="نفس المؤشر على آخر 90 يوم"
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
          label="تغطية 15–30 يوم"
          value={formatNumber(
            report.summary
              .cover15To30Days,
          )}
          hint="تغطية متوسطة حسب سرعة البيع الحالية"
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
          label="بلا سرعة بيع 90 يوم"
          value={formatNumber(
            report.summary
              .noVelocityInStock,
          )}
          hint="مخزون موجود ولا توجد مبيعات خلال 90 يوم"
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
            <option value="sold30">
              الأكثر بيعًا 30 يوم
            </option>
            <option value="sold90">
              الأكثر بيعًا 90 يوم
            </option>
            <option value="sell_through_30">
              أعلى تصريف 30 يوم
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
              البيع هنا عدد القطع المكتملة، وليس قيمة المبيعات.
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
                  تصريف 30 يوم
                </th>
                <th>
                  أيام التغطية
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
                  الإشارة
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
                        {formatPercent(
                          product.sellThrough30Percent,
                        )}
                      </strong>
                      <small>
                        {product.currentQuantity ===
                        null
                          ? "المخزون غير مكتمل"
                          : `نافذة ${formatNumber(
                              product.salesWindow30Days,
                            )} يوم`}
                      </small>
                    </td>

                    <td>
                      <strong>
                        {product.daysOfSupply ===
                        null
                          ? "—"
                          : `${formatDecimal(
                              product.daysOfSupply,
                            )} يوم`}
                      </strong>
                      <small>
                        {product.currentQuantity ===
                        null
                          ? "كمية غير مكتملة"
                          : product.daysOfSupplyBasisDays
                            ? `على سرعة ${product.daysOfSupplyBasisDays} يوم`
                            : product.currentQuantity > 0
                              ? "لا بيع خلال 90 يوم"
                              : "لا يوجد مخزون"}
                      </small>
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
                        className={`inventory-intelligence-action movement-${product.movementClass}`}
                      >
                        {movementHint(
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
                    colSpan={11}
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
