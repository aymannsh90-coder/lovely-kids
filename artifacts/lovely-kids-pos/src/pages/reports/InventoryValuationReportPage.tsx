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
  getOwnerInventoryValuationProducts,
  type OwnerInventoryValuationProduct,
} from "../../lib/api";

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

function productDate(
  value: string,
) {
  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return "";
  }

  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone:
        "Asia/Hebron",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    },
  ).format(date);
}

function cleanInteger(
  value: string,
) {
  if (!value.trim()) {
    return null;
  }

  const numeric =
    Number(value);

  return Number.isSafeInteger(
    numeric,
  ) &&
    numeric > 0
    ? numeric
    : null;
}

function rowSaleValueMinor(
  product:
    OwnerInventoryValuationProduct,
) {
  if (
    product.currentQuantity ===
    null
  ) {
    return null;
  }

  return (
    product.currentQuantity *
    product.price *
    100
  );
}

function rowCostValueMinor(
  product:
    OwnerInventoryValuationProduct,
) {
  const quantity =
    product.currentQuantity;

  if (quantity === null) {
    return null;
  }

  if (quantity === 0) {
    return 0;
  }

  if (
    !product.initialized ||
    !product.stockMatchesAccounting ||
    product.accountingQuantity !==
      quantity ||
    product.inventoryValueMinor ===
      null
  ) {
    return null;
  }

  return product.inventoryValueMinor;
}

function costQualityLabel(
  product:
    OwnerInventoryValuationProduct,
) {
  if (
    product.currentQuantity ===
    null
  ) {
    return "كمية غير معروفة";
  }

  if (
    product.currentQuantity ===
    0
  ) {
    return "لا يوجد مخزون";
  }

  if (
    !product.initialized
  ) {
    return "تكلفة غير مدخلة";
  }

  if (
    !product.stockMatchesAccounting
  ) {
    return "فرق كمية";
  }

  if (
    product.costQuality ===
    "confirmed"
  ) {
    return "مؤكدة";
  }

  if (
    product.costQuality ===
    "estimated"
  ) {
    return "تقديرية";
  }

  if (
    product.costQuality ===
    "mixed"
  ) {
    return "مختلطة";
  }

  return "غير مكتملة";
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
          ? "inventory-valuation-metric is-emphasis"
          : "inventory-valuation-metric"
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

export default function InventoryValuationReportPage() {
  const {
    token,
    clearAuthentication,
  } =
    usePosRuntime();

  const [
    products,
    setProducts,
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
    minProductId,
    setMinProductId,
  ] = useState("");

  const [
    maxProductId,
    setMaxProductId,
  ] = useState("");

  const [
    createdFrom,
    setCreatedFrom,
  ] = useState("");

  const [
    createdTo,
    setCreatedTo,
  ] = useState("");

  const [
    query,
    setQuery,
  ] = useState("");

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const result =
        await getOwnerInventoryValuationProducts(
          token,
        );

      setProducts(
        result.products,
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
          : "تعذر تحميل تقييم المخزون",
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

  const filtered =
    useMemo(() => {
      const minId =
        cleanInteger(
          minProductId,
        );

      const maxId =
        cleanInteger(
          maxProductId,
        );

      const normalizedQuery =
        query
          .trim()
          .toLowerCase();

      return products
        .filter(
          (product) => {
            const id =
              Number(
                product.productId,
              );

            if (
              minProductId.trim() &&
              minId === null
            ) {
              return false;
            }

            if (
              maxProductId.trim() &&
              maxId === null
            ) {
              return false;
            }

            if (
              minId !== null &&
              id < minId
            ) {
              return false;
            }

            if (
              maxId !== null &&
              id > maxId
            ) {
              return false;
            }

            const created =
              productDate(
                product.createdAt,
              );

            if (
              createdFrom &&
              created <
                createdFrom
            ) {
              return false;
            }

            if (
              createdTo &&
              created >
                createdTo
            ) {
              return false;
            }

            if (
              normalizedQuery
            ) {
              const haystack =
                [
                  product.nameAr,
                  product.productCode ??
                    "",
                  product.barcode ??
                    "",
                  product.category,
                  product.productId,
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
        )
        .sort(
          (left, right) =>
            Number(
              left.productId,
            ) -
            Number(
              right.productId,
            ),
        );
    }, [
      products,
      minProductId,
      maxProductId,
      createdFrom,
      createdTo,
      query,
    ]);

  const summary =
    useMemo(() => {
      let quantity = 0;
      let saleValueMinor = 0;
      let knownCostMinor = 0;
      let unknownQuantityProducts = 0;
      let incompleteCostProducts = 0;
      let costCoveredProducts = 0;

      for (
        const product of filtered
      ) {
        const productQuantity =
          product.currentQuantity;

        if (
          productQuantity ===
          null
        ) {
          unknownQuantityProducts +=
            1;
          continue;
        }

        quantity +=
          productQuantity;

        saleValueMinor +=
          rowSaleValueMinor(
            product,
          ) ?? 0;

        const cost =
          rowCostValueMinor(
            product,
          );

        if (cost === null) {
          if (
            productQuantity > 0
          ) {
            incompleteCostProducts +=
              1;
          }
        } else {
          knownCostMinor += cost;
          costCoveredProducts +=
            1;
        }
      }

      const complete =
        unknownQuantityProducts ===
          0 &&
        incompleteCostProducts ===
          0;

      const expectedProfitMinor =
        complete
          ? saleValueMinor -
            knownCostMinor
          : null;

      const marginPercent =
        expectedProfitMinor !==
          null &&
        saleValueMinor > 0
          ? Math.round(
              (
                expectedProfitMinor /
                saleValueMinor
              ) *
                1000,
            ) / 10
          : null;

      return {
        quantity,
        saleValueMinor,
        knownCostMinor,
        expectedProfitMinor,
        marginPercent,
        unknownQuantityProducts,
        incompleteCostProducts,
        costCoveredProducts,
        complete,
      };
    }, [filtered]);

  function clearFilters() {
    setMinProductId("");
    setMaxProductId("");
    setCreatedFrom("");
    setCreatedTo("");
    setQuery("");
  }

  return (
    <div
      className="inventory-valuation-page"
      dir="rtl"
    >
      <section className="inventory-valuation-hero">
        <div>
          <span className="inventory-valuation-eyebrow">
            التقارير
          </span>

          <h1>
            تقييم المخزون
          </h1>

          <p>
            قيمة الكمية الحالية بسعر البيع والتكلفة المسجلة، مع هامش الربح المتوقع وجودة بيانات التكلفة.
          </p>
        </div>

        <button
          type="button"
          className="secondary-button"
          disabled={loading}
          onClick={() =>
            void loadData()
          }
        >
          تحديث البيانات
        </button>
      </section>

      <section className="inventory-valuation-filters">
        <label className="inventory-valuation-search">
          <span>
            بحث
          </span>

          <input
            value={query}
            onChange={(
              event,
            ) =>
              setQuery(
                event.target.value,
              )
            }
            placeholder="اسم الصنف أو الكود أو الباركود"
          />
        </label>

        <label>
          <span>
            من رقم منتج
          </span>

          <input
            dir="ltr"
            inputMode="numeric"
            value={
              minProductId
            }
            onChange={(
              event,
            ) =>
              setMinProductId(
                event.target.value,
              )
            }
            placeholder="مثال: 295"
          />
        </label>

        <label>
          <span>
            إلى رقم منتج
          </span>

          <input
            dir="ltr"
            inputMode="numeric"
            value={
              maxProductId
            }
            onChange={(
              event,
            ) =>
              setMaxProductId(
                event.target.value,
              )
            }
            placeholder="مثال: 450"
          />
        </label>

        <label>
          <span>
            إدخال من تاريخ
          </span>

          <input
            type="date"
            value={
              createdFrom
            }
            onChange={(
              event,
            ) =>
              setCreatedFrom(
                event.target.value,
              )
            }
          />
        </label>

        <label>
          <span>
            إدخال إلى تاريخ
          </span>

          <input
            type="date"
            value={
              createdTo
            }
            onChange={(
              event,
            ) =>
              setCreatedTo(
                event.target.value,
              )
            }
          />
        </label>

        <button
          type="button"
          className="secondary-button"
          onClick={
            clearFilters
          }
        >
          مسح الفلاتر
        </button>
      </section>

      {error && (
        <div className="alert error-alert">
          {error}
        </div>
      )}

      <section className="inventory-valuation-metrics">
        <Metric
          label="عدد الموديلات"
          value={formatNumber(
            filtered.length,
          )}
          hint="بعد تطبيق الفلاتر"
        />

        <Metric
          label="الكمية الحالية"
          value={formatNumber(
            summary.quantity,
          )}
          hint={
            summary.unknownQuantityProducts >
            0
              ? `${summary.unknownQuantityProducts} موديل بكمية غير معروفة`
              : "كل الكميات قابلة للحساب"
          }
        />

        <Metric
          label="قيمة المخزون بسعر البيع"
          value={formatMoney(
            summary.saleValueMinor,
          )}
          hint="السعر الحالي × الكمية الحالية"
        />

        <Metric
          label={
            summary.complete
              ? "قيمة المخزون بالتكلفة"
              : "التكلفة المسجلة المعروفة"
          }
          value={formatMoney(
            summary.knownCostMinor,
          )}
          hint={
            summary.incompleteCostProducts >
              0
              ? `${summary.incompleteCostProducts} موديل يحتاج استكمال التكلفة`
              : "تكلفة المخزون المغطى"
          }
        />

        <Metric
          label="الربح المتوقع"
          value={
            summary.expectedProfitMinor ===
            null
              ? "غير مكتمل"
              : formatMoney(
                  summary.expectedProfitMinor,
                )
          }
          hint={
            summary.marginPercent ===
            null
              ? "يظهر بعد اكتمال الكمية والتكلفة"
              : `هامش متوقع ${summary.marginPercent}%`
          }
          emphasis
        />
      </section>

      {!summary.complete &&
        filtered.length > 0 && (
          <section className="inventory-valuation-warning">
            <strong>
              تنبيه على دقة التقييم
            </strong>

            <p>
              لا يتم اختراع تكلفة للموديلات الناقصة. قيمة البيع تُحسب فقط للكميات المعروفة، وقيمة التكلفة تعرض الجزء المسجل فعليًا. الربح المتوقع يبقى “غير مكتمل” حتى تصبح الكمية والتكلفة متطابقتين.
            </p>
          </section>
        )}

      <section className="inventory-valuation-table-card">
        <div className="inventory-valuation-table-head">
          <div>
            <h2>
              تفاصيل المخزون
            </h2>

            <p>
              {loading
                ? "جاري التحميل…"
                : `${formatNumber(filtered.length)} موديل معروض`}
            </p>
          </div>

          <span>
            تغطية التكلفة:{" "}
            <b>
              {filtered.length > 0
                ? Math.round(
                    (
                      summary.costCoveredProducts /
                      filtered.length
                    ) *
                      100,
                  )
                : 100}
              %
            </b>
          </span>
        </div>

        <div className="inventory-valuation-table-wrap">
          <table className="inventory-valuation-table">
            <thead>
              <tr>
                <th>رقم</th>
                <th>الصنف</th>
                <th>تاريخ الإدخال</th>
                <th>الكمية</th>
                <th>سعر البيع</th>
                <th>قيمة البيع</th>
                <th>متوسط التكلفة</th>
                <th>قيمة التكلفة</th>
                <th>ربح متوقع</th>
                <th>حالة التكلفة</th>
              </tr>
            </thead>

            <tbody>
              {filtered.length ===
              0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="inventory-valuation-empty"
                  >
                    {loading
                      ? "جاري تحميل الأصناف…"
                      : "لا توجد أصناف مطابقة للفلاتر."}
                  </td>
                </tr>
              ) : (
                filtered.map(
                  (product) => {
                    const saleValue =
                      rowSaleValueMinor(
                        product,
                      );

                    const costValue =
                      rowCostValueMinor(
                        product,
                      );

                    const expectedProfit =
                      saleValue !==
                        null &&
                      costValue !==
                        null
                        ? saleValue -
                          costValue
                        : null;

                    const averageCost =
                      product.averageCostMinor ??
                      product.referenceUnitCostMinor;

                    return (
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
                          <b dir="ltr">
                            #{product.productId}
                          </b>
                        </td>

                        <td>
                          <strong>
                            {product.nameAr}
                          </strong>

                          <small>
                            {product.productCode
                              ? `كود: ${product.productCode}`
                              : product.category}
                            {product.isHidden
                              ? " • مخفي من المتجر"
                              : ""}
                          </small>
                        </td>

                        <td dir="ltr">
                          {productDate(
                            product.createdAt,
                          )}
                        </td>

                        <td>
                          {product.currentQuantity ===
                          null
                            ? "—"
                            : formatNumber(
                                product.currentQuantity,
                              )}
                        </td>

                        <td>
                          {formatMoney(
                            product.price *
                              100,
                          )}
                        </td>

                        <td>
                          {saleValue ===
                          null
                            ? "—"
                            : formatMoney(
                                saleValue,
                              )}
                        </td>

                        <td>
                          {averageCost ===
                          null
                            ? "—"
                            : formatMoney(
                                Math.round(
                                  averageCost,
                                ),
                              )}
                        </td>

                        <td>
                          {costValue ===
                          null
                            ? "—"
                            : formatMoney(
                                costValue,
                              )}
                        </td>

                        <td>
                          {expectedProfit ===
                          null
                            ? "—"
                            : formatMoney(
                                expectedProfit,
                              )}
                        </td>

                        <td>
                          <span
                            className={
                              costValue !==
                                null
                                ? "inventory-cost-state is-ok"
                                : "inventory-cost-state is-warning"
                            }
                          >
                            {costQualityLabel(
                              product,
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  },
                )
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
