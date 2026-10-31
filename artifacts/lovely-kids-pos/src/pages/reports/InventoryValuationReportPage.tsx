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
  correctOwnerOpeningCost,
  getOwnerInventoryValuationProducts,
  setOwnerOpeningCost,
  type OwnerInventoryValuationProduct,
} from "../../lib/api";
import {
  exportReportAsExcel,
  type A4ReportOptions,
} from "../../lib/reportOutput";

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

  const [
    costEditorProduct,
    setCostEditorProduct,
  ] =
    useState<
      OwnerInventoryValuationProduct | null
    >(null);

  const [
    costInput,
    setCostInput,
  ] = useState("");

  const [
    costReason,
    setCostReason,
  ] = useState("");

  const [
    savingCost,
    setSavingCost,
  ] = useState(false);


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

  function openCostEditor(
    product:
      OwnerInventoryValuationProduct,
  ) {
    setCostEditorProduct(
      product,
    );

    setCostInput(
      product.initialized &&
        product.referenceUnitCostMinor !==
          null
        ? (
            product.referenceUnitCostMinor /
            100
          ).toFixed(2)
        : "",
    );

    setCostReason("");
    setError("");
  }

  function closeCostEditor() {
    if (savingCost) {
      return;
    }

    setCostEditorProduct(null);
    setCostInput("");
    setCostReason("");
  }

  async function saveCostEditor() {
    if (!costEditorProduct) {
      return;
    }

    const normalized =
      costInput
        .trim()
        .replace(",", ".");

    const shekels =
      Number(normalized);

    if (
      !normalized ||
      !Number.isFinite(
        shekels,
      ) ||
      shekels < 0
    ) {
      setError(
        "أدخل سعر تكلفة صحيح",
      );
      return;
    }

    const unitCostMinor =
      Math.round(
        shekels * 100,
      );

    if (
      !Number.isSafeInteger(
        unitCostMinor,
      )
    ) {
      setError(
        "سعر التكلفة أكبر من الحد المسموح",
      );
      return;
    }

    setSavingCost(true);
    setError("");

    try {
      if (
        costEditorProduct.initialized
      ) {
        await correctOwnerOpeningCost(
          token,
          {
            productId:
              costEditorProduct.productId,
            unitCostMinor,
            reason:
              costReason,
          },
        );
      } else {
        await setOwnerOpeningCost(
          token,
          {
            productId:
              costEditorProduct.productId,
            unitCostMinor,
            costQuality:
              "confirmed",
          },
        );
      }

      await loadData();
      setCostEditorProduct(null);
      setCostInput("");
      setCostReason("");
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
          : "تعذر حفظ سعر التكلفة",
      );
    } finally {
      setSavingCost(false);
    }
  }


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

  function buildInventoryValuationExcel(): A4ReportOptions {
    return {
      title: "تقرير تقييم المخزون",
      subtitle: "قيمة المخزون بحسب البيانات والفلاتر الحالية",
      orientation: "landscape",
      summary: [
        { label: "عدد الموديلات", value: formatNumber(filtered.length) },
        { label: "الكمية الحالية", value: formatNumber(summary.quantity) },
        { label: "قيمة البيع", value: formatMoney(summary.saleValueMinor) },
        { label: "التكلفة المعروفة", value: formatMoney(summary.knownCostMinor) },
        {
          label: "الربح المتوقع",
          value: summary.expectedProfitMinor === null
            ? "غير مكتمل"
            : formatMoney(summary.expectedProfitMinor),
        },
        {
          label: "تغطية التكلفة",
          value: `${filtered.length > 0
            ? Math.round((summary.costCoveredProducts / filtered.length) * 100)
            : 100}%`,
        },
      ],
      sections: [
        {
          title: "تفاصيل المخزون",
          headers: ["رقم", "الصنف", "الكود", "التصنيف", "تاريخ الإدخال", "الكمية", "سعر البيع", "قيمة البيع", "متوسط التكلفة", "قيمة التكلفة", "ربح متوقع", "حالة التكلفة"],
          rows: filtered.map((product) => {
            const saleValue = rowSaleValueMinor(product);
            const costValue = rowCostValueMinor(product);
            const expectedProfit =
              saleValue !== null && costValue !== null
                ? saleValue - costValue
                : null;
            const averageCost =
              product.averageCostMinor ??
              product.referenceUnitCostMinor;

            return [
              product.productId,
              product.nameAr,
              product.productCode ?? "",
              product.category,
              productDate(product.createdAt),
              product.currentQuantity ?? "—",
              formatMoney(product.price * 100),
              saleValue === null ? "—" : formatMoney(saleValue),
              averageCost === null ? "—" : formatMoney(Math.round(averageCost)),
              costValue === null ? "—" : formatMoney(costValue),
              expectedProfit === null ? "—" : formatMoney(expectedProfit),
              costQualityLabel(product),
            ];
          }),
        },
      ],
    };
  }

  function exportInventoryValuationExcel() {
    exportReportAsExcel(
      "inventory-valuation.xls",
      buildInventoryValuationExcel(),
    );
  }

  return (
    <div
      className="inventory-valuation-page lk-report-refresh"
      dir="rtl"
    >
      <style>{`
        .inventory-valuation-print-only {
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

          #inventory-valuation-print,
          #inventory-valuation-print * {
            visibility: visible !important;
          }

          #inventory-valuation-print {
            position: absolute;
            inset: 0;
            width: 100%;
            margin: 0;
            padding: 0;
            background: #fff;
            color: #111827;
            font-size: 8.5px;
          }

          .inventory-valuation-no-print {
            display: none !important;
          }

          .inventory-valuation-print-only {
            display: block !important;
          }

          .inventory-valuation-print-header {
            margin-bottom: 4mm;
            text-align: center;
          }

          .inventory-valuation-print-brand {
            color: #E91E8C;
            font-size: 17px;
            font-weight: 900;
          }

          .inventory-valuation-print-header h1 {
            margin: 1mm 0;
            font-size: 19px;
          }

          .inventory-valuation-print-header p {
            margin: 1mm 0;
            color: #4b5563;
            font-size: 8.5px;
          }

          .inventory-valuation-metrics {
            grid-template-columns: repeat(5, minmax(0, 1fr)) !important;
            gap: 2mm !important;
            margin-bottom: 4mm;
          }

          .inventory-valuation-metric {
            min-height: 0 !important;
            padding: 2.5mm !important;
            border-radius: 0 !important;
          }

          .inventory-valuation-warning,
          .inventory-valuation-table-card {
            border-radius: 0 !important;
            box-shadow: none !important;
          }

          .inventory-valuation-table-card {
            padding: 0 !important;
          }

          .inventory-valuation-table-head {
            padding: 2.5mm 3mm !important;
          }

          .inventory-valuation-table-wrap {
            overflow: visible !important;
          }

          .inventory-valuation-table {
            width: 100% !important;
            min-width: 0 !important;
            table-layout: fixed;
            border-collapse: collapse;
          }

          .inventory-valuation-table thead {
            display: table-header-group;
          }

          .inventory-valuation-table th,
          .inventory-valuation-table td {
            padding: 1.4mm 1mm !important;
            font-size: 7.6px !important;
            line-height: 1.25;
            text-align: center;
            overflow-wrap: anywhere;
          }

          .inventory-valuation-table tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .inventory-valuation-print-action {
            display: none !important;
          }

          .inventory-valuation-print-footer {
            margin-top: 4mm;
            padding-top: 2.5mm;
            border-top: 1px solid #cfd8df;
            color: #6b7280;
            text-align: center;
            font-size: 8px;
          }
        }
      `}</style>
      <section className="inventory-valuation-hero inventory-valuation-no-print">
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

        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
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

          <a
            className="secondary-button"
            href="/reports/inventory-valuation-history"
          >
            🗓️ تقييم بتاريخ
          </a>

          <button
            type="button"
            className="primary-button"
            disabled={loading || filtered.length === 0}
            onClick={() =>
              window.print()
            }
          >
            🖨️ طباعة A4
          </button>

          <button
            type="button"
            className="secondary-button"
            disabled={loading || filtered.length === 0}
            onClick={exportInventoryValuationExcel}
          >
            📊 Excel
          </button>
        </div>
      </section>

      <section className="inventory-valuation-filters inventory-valuation-no-print">
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
        <div className="alert error-alert inventory-valuation-no-print">
          {error}
        </div>
      )}

      <div id="inventory-valuation-print">
        <header className="inventory-valuation-print-only inventory-valuation-print-header">
          <div className="inventory-valuation-print-brand">
            Lovely Kids
          </div>
          <h1>تقرير تقييم المخزون</h1>
          <p>
            عدد الموديلات المعروضة: {formatNumber(filtered.length)}
            {" · "}
            تغطية التكلفة:{" "}
            {filtered.length > 0
              ? Math.round(
                  (
                    summary.costCoveredProducts /
                    filtered.length
                  ) * 100,
                )
              : 100}
            %
          </p>
          <p>
            تاريخ إصدار التقرير: {generatedAt}
          </p>
        </header>

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
                <th className="inventory-valuation-print-action">التكلفة</th>
              </tr>
            </thead>

            <tbody>
              {filtered.length ===
              0 ? (
                <tr>
                  <td
                    colSpan={11}
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
                        <td className="inventory-valuation-print-action">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() =>
                              openCostEditor(
                                product,
                              )
                            }
                          >
                            {product.initialized
                              ? "تعديل التكلفة الأصلية"
                              : "إدخال التكلفة"}
                          </button>
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

        <footer className="inventory-valuation-print-only inventory-valuation-print-footer">
          تقرير صادر من نظام Lovely Kids — قيمة المخزون بحسب البيانات والفلاتر الحالية.
        </footer>
      </div>

      {costEditorProduct && (
        <div
          className="inventory-valuation-no-print"
          role="presentation"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeCostEditor();
            }
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 12000,
            background:
              "rgba(15, 23, 42, .68)",
            display: "grid",
            placeItems: "center",
            padding: 20,
          }}
        >
          <article
            role="dialog"
            aria-modal="true"
            aria-label={
              costEditorProduct.initialized
                ? "تعديل التكلفة الأصلية"
                : "إدخال التكلفة"
            }
            style={{
              width:
                "min(520px, 94vw)",
              background:
                "var(--panel, #fff)",
              borderRadius: 18,
              padding: 20,
              display: "grid",
              gap: 14,
              boxShadow:
                "0 24px 80px rgba(15,23,42,.45)",
            }}
          >
            <div>
              <h3
                style={{
                  margin: 0,
                }}
              >
                {costEditorProduct.initialized
                  ? "تعديل التكلفة الأصلية"
                  : "إدخال التكلفة"}
              </h3>

              <p>
                {costEditorProduct.nameAr}
                {" · "}
                #{costEditorProduct.productId}
              </p>
            </div>

            {costEditorProduct.initialized && (
              <div
                style={{
                  padding: 12,
                  borderRadius: 12,
                  background:
                    "rgba(245, 158, 11, .12)",
                }}
              >
                السعر الحالي:{" "}
                <strong>
                  {costEditorProduct.referenceUnitCostMinor ===
                  null
                    ? "—"
                    : formatMoney(
                        costEditorProduct.referenceUnitCostMinor,
                      )}
                </strong>
                <br />
                سيتم تسجيل العملية كتصحيح تكلفة للمالك، مع الحفاظ على سجل تدقيق.
              </div>
            )}

            <label
              style={{
                display: "grid",
                gap: 6,
              }}
            >
              <span>
                سعر تكلفة القطعة ₪
              </span>

              <input
                autoFocus
                inputMode="decimal"
                value={
                  costInput
                }
                onChange={(
                  event,
                ) =>
                  setCostInput(
                    event.target.value,
                  )
                }
                placeholder="مثال: 45.00"
                disabled={
                  savingCost
                }
              />
            </label>

            {costEditorProduct.initialized && (
              <label
                style={{
                  display: "grid",
                  gap: 6,
                }}
              >
                <span>
                  سبب التعديل (اختياري)
                </span>

                <input
                  value={
                    costReason
                  }
                  onChange={(
                    event,
                  ) =>
                    setCostReason(
                      event.target.value,
                    )
                  }
                  placeholder="مثال: خطأ عند إدخال التكلفة الأصلية"
                  maxLength={300}
                  disabled={
                    savingCost
                  }
                />
              </label>
            )}

            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent:
                  "flex-start",
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                className="primary-button"
                onClick={() =>
                  void saveCostEditor()
                }
                disabled={
                  savingCost
                }
              >
                {savingCost
                  ? "جاري الحفظ…"
                  : "حفظ التكلفة"}
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={
                  closeCostEditor
                }
                disabled={
                  savingCost
                }
              >
                إلغاء
              </button>
            </div>
          </article>
        </div>
      )}
    </div>
  );
}
