import "./InventoryVisualRefresh.css";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

import { usePosRuntime } from "../../app/pos-context";
import {
  ApiError,
  getOwnerInventoryIntelligenceReport,
  getOwnerInventoryValuationProducts,
  getPosAdminInventoryProducts,
  setPosGeneralStock,
  setPosVariantStock,
  type OwnerInventoryIntelligenceProduct,
  type OwnerInventoryIntelligenceReport,
  type OwnerInventoryValuationProduct,
  type PosAdminInventoryProduct,
} from "../../lib/api";
import {
  exportReportAsExcel,
  printA4Report,
  type A4ReportOptions,
} from "../../lib/reportOutput";
import {
  captureScannerKeyboardEvent,
  createScannerKeyboardBuffer,
} from "../../lib/scannerKeyboard";

type StockFilter =
  | "all"
  | "attention"
  | "out"
  | "hidden";

type AdjustmentTarget = {
  productId: string;
  kind: "general" | "variant";
  currentStock: number;
  color?: string;
  size?: string;
};

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "حدث خطأ غير متوقع";
}

function stockNumber(
  value: number | null | undefined,
) {
  return typeof value === "number" &&
    Number.isFinite(value)
    ? Math.max(0, value)
    : null;
}

function effectiveQuantity(
  product: PosAdminInventoryProduct,
) {
  const sizes =
    product.colorVariants.flatMap(
      (variant) => variant.sizes,
    );

  const trackedVariants =
    sizes.length > 0 &&
    sizes.every(
      (entry) =>
        typeof entry.stock === "number" &&
        Number.isFinite(entry.stock),
    );

  const variantStock =
    trackedVariants
      ? sizes.reduce(
          (sum, entry) =>
            sum +
            Math.max(
              0,
              entry.stock ?? 0,
            ),
          0,
        )
      : null;

  const general =
    stockNumber(product.stock);

  if (
    general !== null &&
    variantStock !== null
  ) {
    return Math.min(
      general,
      variantStock,
    );
  }

  return general ?? variantStock;
}

function productWithTargetStock(
  product: PosAdminInventoryProduct,
  target: AdjustmentTarget,
  nextStock: number,
): PosAdminInventoryProduct {
  if (target.kind === "general") {
    return {
      ...product,
      stock: nextStock,
    };
  }

  return {
    ...product,
    colorVariants:
      product.colorVariants.map(
        (variant) =>
          variant.color !==
          target.color
            ? variant
            : {
                ...variant,
                sizes:
                  variant.sizes.map(
                    (entry) =>
                      entry.size !==
                      target.size
                        ? entry
                        : {
                            ...entry,
                            stock:
                              nextStock,
                            outOfStock:
                              nextStock <=
                              0,
                          },
                  ),
              },
      ),
  };
}

function parseMoneyMinor(
  value: string,
) {
  const normalized =
    value
      .trim()
      .replace(",", ".");

  if (!normalized) {
    return null;
  }

  const amount =
    Number(normalized);

  if (
    !Number.isFinite(amount) ||
    amount < 0
  ) {
    return null;
  }

  const minor =
    Math.round(amount * 100);

  if (
    !Number.isSafeInteger(minor) ||
    Math.abs(
      minor / 100 - amount,
    ) > 0.000001
  ) {
    return null;
  }

  return minor;
}

function riskLabel(
  product:
    | OwnerInventoryIntelligenceProduct
    | undefined,
) {
  switch (
    product?.inventoryRiskSignal
  ) {
    case "stockout_now":
      return "نفد مع طلب حديث";
    case "stockout_high":
      return "خطر نفاد مرتفع";
    case "stockout_watch":
      return "مراقبة نفاد";
    case "overstock_high":
      return "فائض مرتفع";
    case "overstock_watch":
      return "مراقبة فائض";
    case "insufficient_history":
      return "بيانات غير كافية";
    case "untracked":
      return "مخزون غير متتبع";
    default:
      return "متوازن";
  }
}

function needsAttention(
  product:
    | OwnerInventoryIntelligenceProduct
    | undefined,
) {
  return (
    product
      ?.inventoryRiskSignal ===
      "stockout_now" ||
    product
      ?.inventoryRiskSignal ===
      "stockout_high" ||
    product
      ?.inventoryRiskSignal ===
      "stockout_watch"
  );
}

export default function InventoryStockPage() {
  const {
    token,
    clearAuthentication,
  } = usePosRuntime();

  const [
    products,
    setProducts,
  ] = useState<
    PosAdminInventoryProduct[]
  >([]);

  const [
    valuation,
    setValuation,
  ] = useState<
    OwnerInventoryValuationProduct[]
  >([]);

  const [
    intelligence,
    setIntelligence,
  ] =
    useState<OwnerInventoryIntelligenceReport | null>(
      null,
    );

  const [query, setQuery] =
    useState("");

  const scannerKeyboard = useRef(
    createScannerKeyboardBuffer(),
  );

  const [filter, setFilter] =
    useState<StockFilter>("all");

  const [
    selectedProductId,
    setSelectedProductId,
  ] = useState("");

  const [
    adjustment,
    setAdjustment,
  ] =
    useState<AdjustmentTarget | null>(
      null,
    );

  const [
    countedStock,
    setCountedStock,
  ] = useState("");

  const [
    costMode,
    setCostMode,
  ] =
    useState<"" | "same" | "new">(
      "",
    );

  const [
    newUnitCost,
    setNewUnitCost,
  ] = useState("");

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");

  const [message, setMessage] =
    useState("");

  useEffect(() => {
    document.title =
      "المخزون | Lovely Kids POS";

    void loadData();
  }, []);

  useEffect(() => {
    if (!selectedProductId) {
      return;
    }

    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow =
      "hidden";

    const handleKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (
        event.key === "Escape" &&
        !saving
      ) {
        if (adjustment) {
          closeAdjustment();
        } else {
          setSelectedProductId("");
        }
      }
    };

    window.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () => {
      document.body.style.overflow =
        previousOverflow;

      window.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, [
    selectedProductId,
    adjustment,
    saving,
  ]);


  function handleInventorySearchKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement>,
  ) {
    if (event.nativeEvent.isComposing) {
      return;
    }

    const scannedValue =
      captureScannerKeyboardEvent(
        scannerKeyboard.current,
        event,
      );

    if (
      event.key === "Enter" &&
      scannedValue
    ) {
      event.preventDefault();
      setQuery(scannedValue);
    }
  }

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const [
        productRows,
        valuationResult,
        intelligenceResult,
      ] = await Promise.all([
        getPosAdminInventoryProducts(
          token,
        ),
        getOwnerInventoryValuationProducts(
          token,
        ),
        getOwnerInventoryIntelligenceReport(
          token,
        ),
      ]);

      setProducts(
        productRows.filter(
          (product) =>
            !product.deletedAt,
        ),
      );

      setValuation(
        valuationResult.products,
      );

      setIntelligence(
        intelligenceResult,
      );
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setError(
        errorMessage(caught),
      );
    } finally {
      setLoading(false);
    }
  }

  const valuationByProduct =
    useMemo(
      () =>
        new Map(
          valuation.map(
            (entry) => [
              entry.productId,
              entry,
            ],
          ),
        ),
      [valuation],
    );

  const intelligenceByProduct =
    useMemo(
      () =>
        new Map(
          (
            intelligence?.products ??
            []
          ).map(
            (entry) => [
              entry.productId,
              entry,
            ],
          ),
        ),
      [intelligence],
    );

  const displayedProducts =
    useMemo(() => {
      const search =
        query
          .trim()
          .toLocaleLowerCase();

      return products
        .filter((product) => {
          const intel =
            intelligenceByProduct.get(
              product.id,
            );

          if (
            filter ===
              "attention" &&
            !needsAttention(intel)
          ) {
            return false;
          }

          if (
            filter === "out" &&
            (
              intel?.currentQuantity ??
              effectiveQuantity(
                product,
              )
            ) !== 0
          ) {
            return false;
          }

          if (
            filter ===
              "hidden" &&
            !product.isHidden
          ) {
            return false;
          }

          if (!search) {
            return true;
          }

          return [
            product.nameAr,
            product.productCode,
            product.barcode,
            product.category,
          ]
            .filter(Boolean)
            .some((value) =>
              String(value)
                .toLocaleLowerCase()
                .includes(search),
            );
        })
        .sort((left, right) => {
          const leftIntel =
            intelligenceByProduct.get(
              left.id,
            );

          const rightIntel =
            intelligenceByProduct.get(
              right.id,
            );

          const leftAttention =
            needsAttention(
              leftIntel,
            )
              ? 1
              : 0;

          const rightAttention =
            needsAttention(
              rightIntel,
            )
              ? 1
              : 0;

          if (
            leftAttention !==
            rightAttention
          ) {
            return (
              rightAttention -
              leftAttention
            );
          }

          return left.nameAr.localeCompare(
            right.nameAr,
            "ar",
          );
        });
    }, [
      products,
      intelligenceByProduct,
      query,
      filter,
    ]);

  const selectedProduct =
    products.find(
      (product) =>
        product.id ===
        selectedProductId,
    ) ?? null;

  const selectedValuation =
    selectedProduct
      ? valuationByProduct.get(
          selectedProduct.id,
        )
      : undefined;

  const selectedIntelligence =
    selectedProduct
      ? intelligenceByProduct.get(
          selectedProduct.id,
        )
      : undefined;

  const adjustmentPreview =
    useMemo(() => {
      if (
        !adjustment ||
        !selectedProduct
      ) {
        return null;
      }

      const next =
        Number(countedStock);

      if (
        !Number.isSafeInteger(
          next,
        ) ||
        next < 0
      ) {
        return {
          valid: false,
          nextStock: null,
          beforeEffective:
            effectiveQuantity(
              selectedProduct,
            ),
          afterEffective: null,
          effectiveIncrease:
            false,
        };
      }

      const predicted =
        productWithTargetStock(
          selectedProduct,
          adjustment,
          next,
        );

      const beforeEffective =
        effectiveQuantity(
          selectedProduct,
        );

      const afterEffective =
        effectiveQuantity(
          predicted,
        );

      return {
        valid: true,
        nextStock: next,
        beforeEffective,
        afterEffective,
        effectiveIncrease:
          beforeEffective !==
            null &&
          afterEffective !==
            null &&
          afterEffective >
            beforeEffective,
      };
    }, [
      adjustment,
      selectedProduct,
      countedStock,
    ]);

  const adjustmentNeedsCost =
    Boolean(
      adjustmentPreview
        ?.effectiveIncrease &&
        selectedValuation
          ?.initialized,
    );

  const adjustmentCostMismatch =
    Boolean(
      adjustmentPreview &&
        adjustmentPreview.valid &&
        selectedValuation
          ?.initialized &&
        !selectedValuation
          .stockMatchesAccounting &&
        adjustmentPreview
          .beforeEffective !==
          adjustmentPreview
            .afterEffective,
    );

  function openAdjustment(
    target: AdjustmentTarget,
  ) {
    setAdjustment(target);
    setCountedStock(
      String(
        target.currentStock,
      ),
    );
    setCostMode("");
    setNewUnitCost("");
    setMessage("");
    setError("");
  }

  function closeAdjustment() {
    if (saving) {
      return;
    }

    setAdjustment(null);
    setCountedStock("");
    setCostMode("");
    setNewUnitCost("");
  }

  async function saveAdjustment(
    event: FormEvent,
  ) {
    event.preventDefault();

    if (
      !adjustment ||
      !selectedProduct ||
      !adjustmentPreview?.valid ||
      adjustmentPreview.nextStock ===
        null
    ) {
      setError(
        "أدخل رصيد جرد صحيح",
      );
      return;
    }

    if (
      adjustmentCostMismatch
    ) {
      setError(
        "كمية محاسبة التكلفة لا تطابق المخزون الحالي. صحح المطابقة من تقييم المخزون قبل تعديل الكمية.",
      );
      return;
    }

    const costInput:
      | {
          costMode:
            | "same"
            | "new";
          unitCostMinor?: number;
        }
      | Record<string, never> =
      {};

    if (adjustmentNeedsCost) {
      if (!costMode) {
        setError(
          "زادت الكمية الفعلية. حدد طريقة تكلفة الكمية الجديدة.",
        );
        return;
      }

      if (
        costMode === "new"
      ) {
        const unitCostMinor =
          parseMoneyMinor(
            newUnitCost,
          );

        if (
          unitCostMinor === null
        ) {
          setError(
            "أدخل تكلفة صحيحة للقطعة الجديدة",
          );
          return;
        }

        Object.assign(
          costInput,
          {
            costMode:
              "new" as const,
            unitCostMinor,
          },
        );
      } else {
        Object.assign(
          costInput,
          {
            costMode:
              "same" as const,
          },
        );
      }
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const updated =
        adjustment.kind ===
        "general"
          ? await setPosGeneralStock(
              token,
              selectedProduct.id,
              {
                amount:
                  adjustmentPreview
                    .nextStock,
                ...costInput,
              },
            )
          : await setPosVariantStock(
              token,
              selectedProduct.id,
              {
                color:
                  adjustment.color ??
                  "",
                size:
                  adjustment.size ??
                  "",
                amount:
                  adjustmentPreview
                    .nextStock,
                ...costInput,
              },
            );

      setProducts(
        (current) =>
          current.map(
            (product) =>
              product.id ===
              updated.id
                ? updated
                : product,
          ),
      );

      setMessage(
        "تم حفظ تسوية المخزون وتسجيل الحركة في بطاقة الصنف.",
      );

      setAdjustment(null);
      setCountedStock("");
      setCostMode("");
      setNewUnitCost("");

      await loadData();
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setError(
        errorMessage(caught),
      );
    } finally {
      setSaving(false);
    }
  }

  const totalProducts =
    products.length;

  const outOfStock =
    products.filter(
      (product) =>
        (
          intelligenceByProduct.get(
            product.id,
          )?.currentQuantity ??
          effectiveQuantity(product)
        ) === 0,
    ).length;

  const attention =
    products.filter(
      (product) =>
        needsAttention(
          intelligenceByProduct.get(
            product.id,
          ),
        ),
    ).length;

  const costMismatch =
    valuation.filter(
      (entry) =>
        entry.initialized &&
        !entry
          .stockMatchesAccounting,
    ).length;

  function buildPhysicalCountSheet(): A4ReportOptions {
    const rows = displayedProducts.flatMap(
      (product) => {
        const variants =
          product.colorVariants.flatMap(
            (variant) =>
              variant.sizes.map(
                (size) => [
                  product.productCode ??
                    "—",
                  product.nameAr,
                  product.category,
                  variant.color,
                  size.size,
                  size.stock ??
                    "غير متتبع",
                  "",
                  "",
                  "",
                ],
              ),
          );

        if (variants.length > 0) {
          return variants;
        }

        return [[
          product.productCode ??
            "—",
          product.nameAr,
          product.category,
          "—",
          "—",
          product.stock ??
            "غير متتبع",
          "",
          "",
          "",
        ]];
      },
    );

    const filterLabel =
      filter === "attention"
        ? "يحتاج انتباه"
        : filter === "out"
          ? "نافد"
          : filter === "hidden"
            ? "مخفي"
            : "الكل";

    return {
      title: "ورقة الجرد الفعلي للمخزون",
      subtitle:
        "تُعبأ الكمية المعدودة والفرق يدويًا أثناء الجرد",
      period: `فلتر: ${filterLabel}${query.trim() ? ` · بحث: ${query.trim()}` : ""}`,
      orientation: "landscape",
      summary: [
        {
          label: "عدد الموديلات",
          value:
            displayedProducts.length,
        },
        {
          label: "عدد أسطر الجرد",
          value: rows.length,
        },
      ],
      sections: [
        {
          title: "ورقة العد",
          headers: [
            "الكود",
            "الصنف",
            "التصنيف",
            "اللون",
            "المقاس",
            "كمية النظام",
            "الكمية المعدودة",
            "الفرق",
            "ملاحظات",
          ],
          rows,
        },
      ],
    };
  }

  function printPhysicalCountSheet() {
    printA4Report(
      buildPhysicalCountSheet(),
    );
  }

  function exportPhysicalCountSheet() {
    exportReportAsExcel(
      "physical-stock-count.xls",
      buildPhysicalCountSheet(),
    );
  }

  return (
    <section className="sales-return-page lk-inventory-refresh lk-inventory-stock">
      <header className="sales-return-header">
        <div>
          <h1>
            مركز إدارة المخزون
          </h1>
          <p>
            راقب الرصيد الفعلي لكل موديل ولون ومقاس، ونفّذ تسوية جرد آمنة مع تحديث بطاقة الصنف ومحاسبة التكلفة.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="secondary-button"
            disabled={loading}
            onClick={printPhysicalCountSheet}
          >
            🖨️ ورقة جرد A4
          </button>

          <button
            type="button"
            className="secondary-button"
            disabled={loading}
            onClick={exportPhysicalCountSheet}
          >
            📊 Excel
          </button>

          <a
            className="primary-button"
            href="/inventory/stock-check"
          >
            فحص سريع بالباركود
          </a>
        </div>
      </header>

      <article className="sales-return-invoice">
        <div className="sales-return-summary-grid">
          <div>
            <span>
              الأصناف
            </span>
            <strong>
              {totalProducts}
            </strong>
          </div>

          <div>
            <span>
              نافد حاليًا
            </span>
            <strong>
              {outOfStock}
            </strong>
          </div>

          <div>
            <span>
              يحتاج انتباه
            </span>
            <strong>
              {attention}
            </strong>
          </div>

          <div>
            <span>
              فرق تكلفة/كمية
            </span>
            <strong>
              {costMismatch}
            </strong>
          </div>
        </div>
      </article>

      <article className="sales-return-search-panel">
        <div
          className="sales-return-search-form"
        >
          <label className="sales-return-field">
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
              onKeyDown={
                handleInventorySearchKeyDown
              }
              placeholder="اسم، كود، باركود أو تصنيف..."
            />
          </label>

          <label className="sales-return-field">
            <span>
              الحالة
            </span>
            <select
              value={filter}
              onChange={(event) =>
                setFilter(
                  event.target
                    .value as StockFilter,
                )
              }
            >
              <option value="all">
                الكل
              </option>
              <option value="attention">
                يحتاج انتباه
              </option>
              <option value="out">
                نافد
              </option>
              <option value="hidden">
                مخفي
              </option>
            </select>
          </label>

          <button
            type="button"
            className="primary-button"
            onClick={() =>
              void loadData()
            }
            disabled={loading}
          >
            تحديث
          </button>
        </div>

        {error && (
          <div className="sales-return-error">
            {error}
          </div>
        )}

        {message && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 12,
              background:
                "rgba(22, 163, 74, .1)",
              fontWeight: 700,
            }}
          >
            {message}
          </div>
        )}
      </article>

      {selectedProduct &&
        createPortal(
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget &&
              !adjustment &&
              !saving
            ) {
              setSelectedProductId("");
            }
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            background:
              "rgba(15, 23, 42, .72)",
            display: "grid",
            placeItems: "center",
            padding: "76px 24px 24px",
          }}
        >
          <article
            role="dialog"
            aria-modal="true"
            aria-label="تفاصيل الصنف"
            className="sales-return-invoice lk-stock-dialog lk-stock-dialog--details"
            style={{
              width:
                "min(980px, 92vw)",
              maxHeight: "78vh",
              overflowY: "auto",
              margin: 0,
              background:
                "var(--panel, #fff)",
              borderRadius: 20,
              border:
                "1px solid rgba(148,163,184,.35)",
              boxShadow:
                "0 28px 90px rgba(15,23,42,.48)",
            }}
          >
          <div
            className="sales-return-section-title"
            style={{
              position: "sticky",
              top: 0,
              zIndex: 2,
              background:
                "var(--panel, #fff)",
              paddingBottom: 12,
              borderBottom:
                "1px solid rgba(148,163,184,.25)",
            }}
          >
            <div>
              <h3>
                {selectedProduct.nameAr}
              </h3>
              <p dir="ltr">
                {selectedProduct.productCode ??
                  "—"}
              </p>
            </div>

            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <a
                href="/inventory/product-card"
                className="lk-stock-dialog-button lk-stock-dialog-button--secondary lk-stock-dialog-link"
                style={{
                  whiteSpace: "nowrap",
                }}
              >
                فتح بطاقة الصنف
              </a>

              <button
                type="button"
                className="lk-stock-dialog-button lk-stock-dialog-button--secondary"
                onClick={() => {
                  setAdjustment(null);
                  setSelectedProductId("");
                }}
                style={{
                  minWidth: 96,
                  whiteSpace: "nowrap",
                }}
              >
                إغلاق ✕
              </button>
            </div>
          </div>

          <div className="sales-return-summary-grid">
            <div>
              <span>
                الرصيد الفعلي
              </span>
              <strong>
                {selectedIntelligence
                  ?.currentQuantity ??
                  effectiveQuantity(
                    selectedProduct,
                  ) ??
                  "N/A"}
              </strong>
            </div>

            <div>
              <span>
                رصيد عام
              </span>
              <strong>
                {selectedProduct.stock ??
                  "غير متتبع"}
              </strong>
            </div>

            <div>
              <span>
                خطر المخزون
              </span>
              <strong>
                {riskLabel(
                  selectedIntelligence,
                )}
              </strong>
            </div>

            <div>
              <span>
                شراء مقترح
              </span>
              <strong>
                {selectedIntelligence
                  ?.suggestedReorderQuantity ??
                  0}
              </strong>
            </div>

            <div>
              <span>
                تكلفة مرجعية
              </span>
              <strong>
                {selectedValuation
                  ?.referenceUnitCostMinor !==
                null &&
                selectedValuation
                  ?.referenceUnitCostMinor !==
                  undefined
                  ? `${(
                      selectedValuation
                        .referenceUnitCostMinor /
                      100
                    ).toFixed(
                      2,
                    )} ₪`
                  : "N/A"}
              </strong>
            </div>

            <div>
              <span>
                مطابقة التكلفة
              </span>
              <strong>
                {!selectedValuation
                  ?.initialized
                  ? "غير مهيأة"
                  : selectedValuation
                      .stockMatchesAccounting
                    ? "مطابقة"
                    : "غير مطابقة"}
              </strong>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              marginTop: 16,
            }}
          >
            {(
              selectedProduct.stock !==
                null ||
              selectedProduct
                .colorVariants.length ===
                0
            ) && (
              <button
                type="button"
                className="inventory-stock-action-button"
                onClick={() =>
                  openAdjustment({
                    productId:
                      selectedProduct.id,
                    kind:
                      "general",
                    currentStock:
                      selectedProduct.stock ??
                      0,
                  })
                }
              >
                تسوية الرصيد العام
              </button>
            )}

            {selectedProduct.stock ===
              null &&
              selectedProduct
                .colorVariants.length >
                0 && (
                <small>
                  هذا الموديل يعتمد مخزون اللون/المقاس؛ التسوية تتم من الجدول أدناه.
                </small>
              )}
          </div>

          {selectedProduct
            .colorVariants.length >
            0 && (
            <div
              className="sales-return-table-wrap"
              style={{
                marginTop: 18,
                overflowX: "hidden",
              }}
            >
              <table
                className="sales-return-table"
                style={{
                  minWidth: 0,
                  width: "100%",
                  tableLayout: "fixed",
                }}
              >
                <thead>
                  <tr>
                    <th>اللون</th>
                    <th>المقاس</th>
                    <th>المتوفر</th>
                    <th>الحالة</th>
                    <th>تسوية</th>
                  </tr>
                </thead>

                <tbody>
                  {selectedProduct.colorVariants.flatMap(
                    (variant) =>
                      variant.sizes.map(
                        (size) => (
                          <tr
                            key={`${variant.color}-${size.size}`}
                          >
                            <td>
                              {
                                variant.color
                              }
                            </td>
                            <td>
                              <strong>
                                {
                                  size.size
                                }
                              </strong>
                            </td>
                            <td>
                              <strong>
                                {size.stock ??
                                  "غير متتبع"}
                              </strong>
                            </td>
                            <td>
                              {(
                                size.stock ??
                                0
                              ) <= 0
                                ? "نافد"
                                : "متوفر"}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="inventory-stock-action-button inventory-stock-action-button--table"
                                onClick={() =>
                                  openAdjustment(
                                    {
                                      productId:
                                        selectedProduct.id,
                                      kind:
                                        "variant",
                                      color:
                                        variant.color,
                                      size:
                                        size.size,
                                      currentStock:
                                        size.stock ??
                                        0,
                                    },
                                  )
                                }
                              >
                                جرد
                              </button>
                            </td>
                          </tr>
                        ),
                      ),
                  )}
                </tbody>
              </table>
            </div>
          )}
          </article>
        </div>,
        document.body,
      )}


      <article className="sales-return-items-panel">
        <div className="sales-return-section-title">
          <div>
            <h3>
              رصيد المخزون
            </h3>
            <p>
              {loading
                ? "جاري تحميل المخزون…"
                : `${displayedProducts.length} صنف ظاهر`}
            </p>
          </div>
        </div>

        {!loading && (
          <div className="sales-return-table-wrap">
            <table className="sales-return-table">
              <thead>
                <tr>
                  <th>الصنف</th>
                  <th>الكود</th>
                  <th>الرصيد الفعلي</th>
                  <th>الحالة</th>
                  <th>اقتراح الشراء</th>
                  <th>التكلفة</th>
                  <th>إدارة</th>
                </tr>
              </thead>

              <tbody>
                {displayedProducts.map(
                  (product) => {
                    const intel =
                      intelligenceByProduct.get(
                        product.id,
                      );

                    const cost =
                      valuationByProduct.get(
                        product.id,
                      );

                    const quantity =
                      intel?.currentQuantity ??
                      effectiveQuantity(
                        product,
                      );

                    return (
                      <tr
                        key={
                          product.id
                        }
                      >
                        <td>
                          <div
                            style={{
                              display:
                                "flex",
                              alignItems:
                                "center",
                              gap: 10,
                              minWidth:
                                210,
                            }}
                          >
                            {product.image && (
                              <img
                                src={
                                  product.image
                                }
                                alt={
                                  product.nameAr
                                }
                                style={{
                                  width: 48,
                                  height: 48,
                                  objectFit:
                                    "contain",
                                  borderRadius:
                                    8,
                                }}
                              />
                            )}

                            <span>
                              <strong>
                                {
                                  product.nameAr
                                }
                              </strong>
                              <br />
                              <small>
                                {
                                  product.category
                                }
                                {product.isHidden
                                  ? " · مخفي"
                                  : ""}
                              </small>
                            </span>
                          </div>
                        </td>

                        <td dir="ltr">
                          {product.productCode ??
                            "—"}
                        </td>

                        <td>
                          <strong>
                            {quantity ??
                              "N/A"}
                          </strong>
                        </td>

                        <td>
                          {riskLabel(
                            intel,
                          )}
                        </td>

                        <td>
                          {(
                            intel
                              ?.suggestedReorderQuantity ??
                            0
                          ) > 0
                            ? `+${intel?.suggestedReorderQuantity} وحدة`
                            : "—"}
                        </td>

                        <td>
                          {!cost
                            ?.initialized
                            ? "غير مهيأة"
                            : cost
                                .stockMatchesAccounting
                              ? "متطابقة"
                              : "تحتاج مطابقة"}
                        </td>

                        <td>
                          <button
                            type="button"
                            className="inventory-stock-action-button inventory-stock-action-button--table"
                            onClick={() => {
                              setSelectedProductId(
                                product.id,
                              );
                              setAdjustment(
                                null,
                              );
                              setMessage(
                                "",
                              );
                            }}
                          >
                            فتح
                          </button>
                        </td>
                      </tr>
                    );
                  },
                )}

                {displayedProducts.length ===
                  0 && (
                  <tr>
                    <td
                      colSpan={7}
                      style={{
                        textAlign:
                          "center",
                        padding: 24,
                      }}
                    >
                      لا توجد أصناف مطابقة.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </article>

      {adjustment &&
        selectedProduct &&
        createPortal(
        <div
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 11000,
            background:
              "rgba(15, 23, 42, .78)",
            display: "grid",
            placeItems: "center",
            padding: "76px 24px 24px",
          }}
        >
          <article
            role="dialog"
            aria-modal="true"
            aria-label="تسوية جرد"
            className="sales-return-invoice lk-stock-dialog lk-stock-dialog--adjustment"
            style={{
              width:
                "min(700px, 92vw)",
              maxHeight: "78vh",
              overflowY: "auto",
              margin: 0,
              background:
                "var(--panel, #fff)",
              borderRadius: 20,
              border:
                "1px solid rgba(148,163,184,.35)",
              boxShadow:
                "0 28px 90px rgba(15,23,42,.5)",
            }}
          >
          <div className="sales-return-section-title">
            <div>
              <h3>
                تسوية جرد
              </h3>
              <p>
                {adjustment.kind ===
                "variant"
                  ? `${adjustment.color} / ${adjustment.size}`
                  : "الرصيد العام للموديل"}
              </p>
            </div>

            <button
              type="button"
              className="lk-stock-dialog-button lk-stock-dialog-button--secondary"
              onClick={
                closeAdjustment
              }
              disabled={saving}
            >
              إغلاق
            </button>
          </div>

          <form
            className="lk-stock-adjustment-form"
            onSubmit={
              saveAdjustment
            }
            style={{
              display: "grid",
              gap: 14,
            }}
          >
            <div className="sales-return-summary-grid">
              <div>
                <span>
                  الرصيد الحالي
                </span>
                <strong>
                  {
                    adjustment.currentStock
                  }
                </strong>
              </div>

              <div>
                <span>
                  الرصيد بعد الجرد
                </span>
                <strong>
                  {adjustmentPreview
                    ?.valid
                    ? adjustmentPreview
                        .nextStock
                    : "—"}
                </strong>
              </div>

              <div>
                <span>
                  الكمية الفعلية قبل
                </span>
                <strong>
                  {adjustmentPreview
                    ?.beforeEffective ??
                    "N/A"}
                </strong>
              </div>

              <div>
                <span>
                  الكمية الفعلية بعد
                </span>
                <strong>
                  {adjustmentPreview
                    ?.afterEffective ??
                    "N/A"}
                </strong>
              </div>
            </div>

            <label className="sales-return-field">
              <span>
                الكمية المعدودة فعليًا
              </span>
              <input
                type="number"
                min="0"
                step="1"
                value={
                  countedStock
                }
                onChange={(event) =>
                  setCountedStock(
                    event.target
                      .value,
                  )
                }
                disabled={saving}
                required
              />
            </label>

            {adjustmentCostMismatch && (
              <div className="sales-return-error">
                لا يمكن تغيير الكمية الفعلية قبل معالجة فرق كمية محاسبة التكلفة من تقرير تقييم المخزون.
              </div>
            )}

            {adjustmentPreview
              ?.effectiveIncrease &&
              !selectedValuation
                ?.initialized && (
                <div
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    background:
                      "rgba(245, 158, 11, .12)",
                  }}
                >
                  تكلفة هذا الصنف غير مهيأة؛ ستُحفظ التسوية لكن تقييم التكلفة سيبقى غير متتبع حتى إدخال التكلفة الافتتاحية.
                </div>
              )}

            {adjustmentNeedsCost && (
              <div
                className="lk-stock-cost-options"
                style={{
                  display: "grid",
                  gap: 10,
                  padding: 14,
                  border:
                    "1px solid rgba(127,127,127,.25)",
                  borderRadius: 12,
                }}
              >
                <strong>
                  تكلفة الكمية الجديدة
                </strong>
                <p
                  style={{
                    margin: 0,
                    opacity: 0.75,
                  }}
                >
                  لأن الجرد زاد الكمية الفعلية، لازم نحدد كيف تُقيّم الزيادة حتى يبقى تقييم المخزون صحيحًا.
                </p>

                <label>
                  <input
                    type="radio"
                    name="cost-mode"
                    checked={
                      costMode ===
                      "same"
                    }
                    onChange={() =>
                      setCostMode(
                        "same",
                      )
                    }
                  />{" "}
                  نفس التكلفة الحالية
                </label>

                <label>
                  <input
                    type="radio"
                    name="cost-mode"
                    checked={
                      costMode ===
                      "new"
                    }
                    onChange={() =>
                      setCostMode(
                        "new",
                      )
                    }
                  />{" "}
                  تكلفة جديدة
                </label>

                {costMode ===
                  "new" && (
                  <label className="sales-return-field">
                    <span>
                      تكلفة القطعة الجديدة ₪
                    </span>
                    <input
                      inputMode="decimal"
                      value={
                        newUnitCost
                      }
                      onChange={(
                        event,
                      ) =>
                        setNewUnitCost(
                          event.target
                            .value,
                        )
                      }
                      placeholder="0.00"
                    />
                  </label>
                )}
              </div>
            )}

            <div
              className="lk-stock-adjustment-actions"
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <button
                className="lk-stock-dialog-button lk-stock-dialog-button--primary"
                type="submit"
                disabled={
                  saving ||
                  adjustmentCostMismatch
                }
              >
                {saving
                  ? "جاري الحفظ…"
                  : "اعتماد تسوية الجرد"}
              </button>

              <button
                type="button"
                className="lk-stock-dialog-button lk-stock-dialog-button--secondary"
                onClick={
                  closeAdjustment
                }
                disabled={saving}
              >
                إلغاء
              </button>
            </div>
          </form>
          </article>
        </div>,
        document.body,
      )}
    </section>
  );
}
