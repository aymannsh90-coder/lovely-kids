import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";

import { usePosRuntime } from "../../app/pos-context";
import {
  ApiError,
  archivePosProduct,
  getOwnerInventoryValuationProducts,
  getPosAdminInventoryProducts,
  restorePosProduct,
  setPosProductVisibility,
  type OwnerInventoryValuationProduct,
  type PosAdminInventoryProduct,
} from "../../lib/api";
import {
  captureScannerKeyboardEvent,
  createScannerKeyboardBuffer,
} from "../../lib/scannerKeyboard";

type ProductFilter =
  | "all"
  | "offers"
  | "new"
  | "out"
  | "noQr"
  | "noCost"
  | "hidden"
  | "deleted";

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "حدث خطأ غير متوقع";
}

function stockNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : null;
}

function effectiveQuantity(product: PosAdminInventoryProduct) {
  const sizes = product.colorVariants.flatMap((variant) => variant.sizes);
  const variantTracked =
    sizes.length > 0 &&
    sizes.every(
      (entry) =>
        typeof entry.stock === "number" &&
        Number.isFinite(entry.stock),
    );

  const variantQuantity = variantTracked
    ? sizes.reduce((sum, entry) => sum + Math.max(0, entry.stock ?? 0), 0)
    : null;

  const generalQuantity = stockNumber(product.stock);

  if (generalQuantity !== null && variantQuantity !== null) {
    return Math.min(generalQuantity, variantQuantity);
  }

  return generalQuantity ?? variantQuantity;
}

export default function ProductManagementPage() {
  const navigate = useNavigate();
  const { token, user, clearAuthentication } = usePosRuntime();

  const [products, setProducts] = useState<PosAdminInventoryProduct[]>([]);
  const [valuation, setValuation] = useState<OwnerInventoryValuationProduct[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ProductFilter>("all");
  const [loading, setLoading] = useState(true);
  const [busyProductId, setBusyProductId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const scannerKeyboard = useRef(createScannerKeyboardBuffer());

  const canManage = user?.isAdmin === true || user?.isOwner === true;

  useEffect(() => {
    document.title = "الأصناف | Lovely Kids POS";
    void loadProducts();
  }, []);

  async function loadProducts() {
    setLoading(true);
    setError("");

    try {
      const [rows, valuationResult] =
        await Promise.all([
          getPosAdminInventoryProducts(token),
          user?.isOwner
            ? getOwnerInventoryValuationProducts(token)
            : Promise.resolve({ products: [] }),
        ]);

      setProducts(rows);
      setValuation(valuationResult.products);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        clearAuthentication();
        return;
      }

      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  function handleSearchKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement>,
  ) {
    if (event.nativeEvent.isComposing) {
      return;
    }

    const scannedValue = captureScannerKeyboardEvent(
      scannerKeyboard.current,
      event,
    );

    if (event.key === "Enter" && scannedValue) {
      event.preventDefault();
      setQuery(scannedValue);
    }
  }

  const activeProducts = useMemo(
    () => products.filter((product) => !product.deletedAt),
    [products],
  );

  const valuationByProduct = useMemo(
    () =>
      new Map(
        valuation.map((entry) => [
          String(entry.productId),
          entry,
        ]),
      ),
    [valuation],
  );

  const hasQr = (
    product: PosAdminInventoryProduct,
  ) =>
    [
      product.barcode,
      ...(product.additionalBarcodes ?? []).map(
        (entry) => entry.barcode,
      ),
    ].some((value) =>
      value?.trim().startsWith("LKQR-"),
    );

  const hasKnownCost = (
    product: PosAdminInventoryProduct,
  ) => {
    const cost = valuationByProduct.get(
      String(product.id),
    );

    return Boolean(
      cost?.initialized &&
      cost.referenceUnitCostMinor !== null,
    );
  };

  const counts = useMemo(() => {
    const now = Date.now();

    return {
      all: activeProducts.length,
      offers: activeProducts.filter(
        (product) => product.showInOffers,
      ).length,
      new: activeProducts.filter((product) => {
        const newUntil = product.newUntil
          ? new Date(product.newUntil).getTime()
          : null;

        return product.isNew === true && (!newUntil || newUntil > now);
      }).length,
      out: activeProducts.filter(
        (product) => effectiveQuantity(product) === 0,
      ).length,
      noQr: activeProducts.filter(
        (product) => !hasQr(product),
      ).length,
      noCost: user?.isOwner
        ? activeProducts.filter(
            (product) => !hasKnownCost(product),
          ).length
        : 0,
      hidden: activeProducts.filter((product) => product.isHidden).length,
      deleted: products.filter((product) => Boolean(product.deletedAt)).length,
    };
  }, [
    activeProducts,
    products,
    user?.isOwner,
    valuationByProduct,
  ]);

  const displayedProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const now = Date.now();

    return products
      .filter((product) => {
        if (filter === "deleted") {
          if (!product.deletedAt) return false;
        } else if (product.deletedAt) {
          return false;
        }

        if (filter === "offers" && !product.showInOffers) {
          return false;
        }

        if (filter === "new") {
          const newUntil = product.newUntil
            ? new Date(product.newUntil).getTime()
            : null;

          if (!product.isNew || (newUntil !== null && newUntil <= now)) {
            return false;
          }
        }

        if (filter === "out" && effectiveQuantity(product) !== 0) {
          return false;
        }

        if (filter === "noQr" && hasQr(product)) {
          return false;
        }

        if (
          filter === "noCost" &&
          (!user?.isOwner || hasKnownCost(product))
        ) {
          return false;
        }

        if (filter === "hidden" && !product.isHidden) {
          return false;
        }

        if (!normalizedQuery) {
          return true;
        }

        return [
          product.nameAr,
          product.name,
          product.productCode,
          product.barcode,
          ...(product.additionalBarcodes ?? []).map(
            (entry) => entry.barcode,
          ),
          product.category,
        ]
          .filter(Boolean)
          .some((value) =>
            String(value)
              .toLocaleLowerCase()
              .includes(normalizedQuery),
          );
      })
      .sort((left, right) => {
        const leftId = Number(left.id);
        const rightId = Number(right.id);

        if (Number.isFinite(leftId) && Number.isFinite(rightId)) {
          return rightId - leftId;
        }

        return right.nameAr.localeCompare(left.nameAr, "ar");
      });
  }, [
    products,
    query,
    filter,
    user?.isOwner,
    valuationByProduct,
  ]);

  async function updateVisibility(
    product: PosAdminInventoryProduct,
  ) {
    if (!canManage || product.deletedAt) return;

    setBusyProductId(product.id);
    setError("");
    setMessage("");

    try {
      const updated = await setPosProductVisibility(
        token,
        product.id,
        !product.isHidden,
      );

      setProducts((current) =>
        current.map((entry) =>
          entry.id === updated.id ? updated : entry,
        ),
      );

      setMessage(
        updated.isHidden
          ? "تم إخفاء الصنف من المتجر الإلكتروني."
          : "تم إظهار الصنف في المتجر الإلكتروني.",
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyProductId("");
    }
  }

  async function archiveProduct(
    product: PosAdminInventoryProduct,
  ) {
    if (!canManage || product.deletedAt) return;

    const accepted = window.confirm(
      `نقل "${product.nameAr}" إلى المحذوفات؟\nلن يتم حذفه نهائيًا وستبقى البيانات التاريخية محفوظة.`,
    );

    if (!accepted) return;

    setBusyProductId(product.id);
    setError("");
    setMessage("");

    try {
      const updated = await archivePosProduct(token, product.id);

      setProducts((current) =>
        current.map((entry) =>
          entry.id === updated.id ? updated : entry,
        ),
      );

      setMessage("تم نقل الصنف إلى المحذوفات.");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyProductId("");
    }
  }

  async function restoreProduct(product: PosAdminInventoryProduct) {
    if (!canManage || !product.deletedAt) return;

    setBusyProductId(product.id);
    setError("");
    setMessage("");

    try {
      const updated = await restorePosProduct(token, product.id);

      setProducts((current) =>
        current.map((entry) =>
          entry.id === updated.id ? updated : entry,
        ),
      );

      setMessage("تم استرجاع الصنف بنجاح.");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyProductId("");
    }
  }

  if (!canManage) {
    return (
      <section className="pos-products-page">
        <div className="pos-products-denied">
          <strong>غير مصرح</strong>
          <p>إدارة الأصناف متاحة للمالك والمديرين فقط.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="pos-products-page">
      <header className="pos-products-header">
        <div>
          <span className="pos-products-eyebrow">الأصناف والمخزون</span>
          <h1>الأصناف</h1>
          <p>
            إدارة المنتجات من نقطة البيع بنفس بيانات وآلية المتجر الإلكتروني.
          </p>
        </div>

        <div className="pos-products-header-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() => void loadProducts()}
            disabled={loading}
          >
            ↻ تحديث
          </button>

          <button
            className="primary-button pos-products-add-button"
            type="button"
            onClick={() => navigate("/inventory/products/new")}
          >
            + إضافة صنف
          </button>
        </div>
      </header>

      <article className="pos-products-toolbar">
        <label className="pos-products-search">
          <span>بحث بالاسم أو الكود أو الباركود</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            autoComplete="off"
            placeholder="اكتب أو امسح الباركود..."
          />
        </label>

        <div className="pos-products-filters" role="tablist">
          {([
            ["all", "الكل", counts.all],
            ["offers", "العروض", counts.offers],
            ["new", "الجديد", counts.new],
            ["out", "بدون كمية", counts.out],
            ["noQr", "بدون QR", counts.noQr],
            ...(user?.isOwner
              ? [["noCost", "بدون تكلفة", counts.noCost] as const]
              : []),
            ["hidden", "مخفي", counts.hidden],
            ["deleted", "المحذوفات", counts.deleted],
          ] satisfies ReadonlyArray<
            readonly [ProductFilter, string, number]
          >).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              className={filter === key ? "active" : ""}
              onClick={() => setFilter(key)}
            >
              {label} <strong>{count}</strong>
            </button>
          ))}
        </div>
      </article>

      {error && <div className="alert error-alert pos-products-alert">{error}</div>}
      {message && <div className="alert success-alert pos-products-alert">{message}</div>}

      <div className="pos-products-summary">
        <span>
          المعروض الآن: <strong>{displayedProducts.length}</strong>
        </span>
        <span>
          إجمالي الأصناف النشطة: <strong>{activeProducts.length}</strong>
        </span>
      </div>

      {loading ? (
        <div className="pos-products-empty">جاري تحميل الأصناف…</div>
      ) : displayedProducts.length === 0 ? (
        <div className="pos-products-empty">
          لا توجد أصناف مطابقة للبحث أو الفلتر الحالي.
        </div>
      ) : (
        <div className="pos-products-list">
          {displayedProducts.map((product) => {
            const quantity = effectiveQuantity(product);
            const busy = busyProductId === product.id;

            return (
              <article
                key={product.id}
                className={[
                  "pos-product-row",
                  product.deletedAt ? "is-deleted" : "",
                  product.isHidden ? "is-hidden" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div className="pos-product-image-shell">
                  {product.image ? (
                    <img src={product.image} alt={product.nameAr} />
                  ) : (
                    <span>👕</span>
                  )}
                </div>

                <div className="pos-product-main">
                  <div className="pos-product-title-line">
                    <h2>{product.nameAr}</h2>
                    {product.isNew && !product.deletedAt && (
                      <span className="pos-product-badge new">جديد</span>
                    )}
                    {product.isHidden && !product.deletedAt && (
                      <span className="pos-product-badge hidden">مخفي</span>
                    )}
                    {product.deletedAt && (
                      <span className="pos-product-badge deleted">محذوف</span>
                    )}
                  </div>

                  <div className="pos-product-meta">
                    <span>
                      كود الصنف: <strong dir="ltr">{product.productCode || "—"}</strong>
                    </span>
                    <span>
                      الباركود: <strong dir="ltr">{product.barcode || "—"}</strong>
                    </span>
                    <span>
                      السعر: <strong>{product.price.toFixed(2)} ₪</strong>
                    </span>
                    <span>
                      الكمية: <strong>{quantity ?? "غير متتبعة"}</strong>
                    </span>
                  </div>
                </div>

                <div className="pos-product-actions">
                  {!product.deletedAt ? (
                    <>
                      <button
                        type="button"
                        className="pos-product-action primary"
                        onClick={() =>
                          navigate(`/inventory/products/${product.id}/edit`)
                        }
                        disabled={busy}
                      >
                        ✎ تعديل
                      </button>

                      <button
                        type="button"
                        className="pos-product-action"
                        onClick={() =>
                          navigate(
                            `/inventory/products/new?copyFrom=${encodeURIComponent(product.id)}`,
                          )
                        }
                        disabled={busy}
                      >
                        ⧉ نسخ
                      </button>

                      <button
                        type="button"
                        className="pos-product-action"
                        onClick={() => void updateVisibility(product)}
                        disabled={busy}
                      >
                        {product.isHidden ? "◉ إظهار" : "◌ إخفاء"}
                      </button>

                      <button
                        type="button"
                        className="pos-product-action danger"
                        onClick={() => void archiveProduct(product)}
                        disabled={busy}
                      >
                        🗑 أرشفة
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="pos-product-action primary"
                      onClick={() => void restoreProduct(product)}
                      disabled={busy}
                    >
                      ↩ استرجاع
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
