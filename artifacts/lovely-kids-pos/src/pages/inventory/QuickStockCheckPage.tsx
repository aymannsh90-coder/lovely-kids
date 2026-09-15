import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { usePosRuntime } from "../../app/pos-context";
import {
  ApiError,
  lookupPosProductByBarcode,
  type PosProductLookup,
  type PosSizeStock,
} from "../../lib/api";
import {
  captureScannerKeyboardEvent,
  createScannerKeyboardBuffer,
} from "../../lib/scannerKeyboard";

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "حدث خطأ غير متوقع";
}

function stockValue(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

export default function QuickStockCheckPage() {
  const {
    token,
    clearAuthentication,
  } = usePosRuntime();

  const inputRef = useRef<HTMLInputElement>(null);

  const scannerKeyboard = useRef(
    createScannerKeyboardBuffer(),
  );

  const [barcode, setBarcode] = useState("");
  const [product, setProduct] =
    useState<PosProductLookup | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "فحص سريع للمخزون | Lovely Kids POS";

    window.setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
  }, []);

  async function lookup(rawBarcode: string) {
    const value = rawBarcode.trim();

    if (!value) {
      setError("امسح باركود الصنف");
      return;
    }

    setBusy(true);
    setError("");
    setProduct(null);

    try {
      const result =
        await lookupPosProductByBarcode(
          token,
          value,
        );

      setBarcode(value);
      setProduct(result);
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setError(errorMessage(caught));
    } finally {
      setBusy(false);

      window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 100);
    }
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
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

      setBarcode(scannedValue);
      void lookup(scannedValue);
    }
  }

  function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    void lookup(barcode);
  }

  const scannedStock = useMemo(() => {
    if (!product) {
      return null;
    }

    if (
      product.mappedColor &&
      product.mappedSize
    ) {
      const variant =
        product.colorVariants.find(
          (entry) =>
            entry.color ===
            product.mappedColor,
        );

      const size =
        variant?.sizes.find(
          (entry) =>
            entry.size ===
            product.mappedSize,
        );

      return stockValue(size?.stock);
    }

    if (product.mappedSize) {
      const values =
        product.colorVariants
          .map((variant) =>
            variant.sizes.find(
              (entry) =>
                entry.size ===
                product.mappedSize,
            ),
          )
          .map((entry) =>
            stockValue(entry?.stock),
          )
          .filter(
            (value): value is number =>
              value !== null,
          );

      if (values.length) {
        return values.reduce(
          (total, value) =>
            total + value,
          0,
        );
      }
    }

    if (product.mappedColor) {
      const variant =
        product.colorVariants.find(
          (entry) =>
            entry.color ===
            product.mappedColor,
        );

      const values =
        variant?.sizes
          .map((entry) =>
            stockValue(entry.stock),
          )
          .filter(
            (value): value is number =>
              value !== null,
          ) ?? [];

      if (values.length) {
        return values.reduce(
          (total, value) =>
            total + value,
          0,
        );
      }
    }

    return stockValue(product.stock);
  }, [product]);

  const modelTotal = useMemo(() => {
    if (!product) {
      return null;
    }

    const variantStocks =
      product.colorVariants.flatMap(
        (variant) =>
          variant.sizes
            .map((entry) =>
              stockValue(entry.stock),
            )
            .filter(
              (value): value is number =>
                value !== null,
            ),
      );

    if (variantStocks.length) {
      return variantStocks.reduce(
        (total, value) =>
          total + value,
        0,
      );
    }

    return stockValue(product.stock);
  }, [product]);

  const currentColorTotal = useMemo(() => {
    if (!product?.mappedColor) {
      return null;
    }

    const variant = product.colorVariants.find(
      (entry) => entry.color === product.mappedColor,
    );

    if (!variant) {
      return null;
    }

    const stocks = variant.sizes
      .map((entry) => stockValue(entry.stock))
      .filter((value): value is number => value !== null);

    if (!stocks.length) {
      return null;
    }

    return stocks.reduce(
      (total, value) => total + value,
      0,
    );
  }, [product]);

  const displayVariants = useMemo(() => {
    if (!product) {
      return [];
    }

    if (product.mappedColor) {
      return product.colorVariants.filter(
        (variant) =>
          variant.color ===
          product.mappedColor,
      );
    }

    return product.colorVariants;
  }, [product]);

  return (
    <section className="sales-return-page">
      <header className="sales-return-header">
        <div>
          <h1>فحص سريع للمخزون</h1>
          <p>
            امسح باركود الصنف لمعرفة مخزون المقاس وإجمالي الموديل فورًا.
          </p>
        </div>
      </header>

      <article className="sales-return-search-panel">
        <form
          className="sales-return-search-form"
          onSubmit={handleSubmit}
        >
          <label className="sales-return-field">
            <span>باركود الصنف</span>

            <input
              ref={inputRef}
              dir="ltr"
              autoFocus
              autoComplete="off"
              value={barcode}
              onChange={(event) =>
                setBarcode(event.target.value)
              }
              onKeyDown={handleKeyDown}
              placeholder="امسح الباركود..."
              disabled={busy}
            />
          </label>

          <button
            className="primary-button"
            type="submit"
            disabled={busy}
          >
            {busy
              ? "جاري الفحص…"
              : "فحص المخزون"}
          </button>
        </form>

        {error && (
          <div className="sales-return-error">
            {error}
          </div>
        )}
      </article>

      {product && (
        <>
          <article className="sales-return-invoice">
            <div className="sales-return-section-title">
              <div>
                <h3>{product.nameAr}</h3>
                <strong dir="ltr">
                  {product.productCode ?? "—"}
                </strong>
              </div>

              <span className="return-status available">
                متوفر بالمخزون
              </span>
            </div>

            {product.image && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  marginBottom: 20,
                }}
              >
                <img
                  src={product.image}
                  alt={product.nameAr}
                  style={{
                    width: 220,
                    maxWidth: "100%",
                    maxHeight: 260,
                    objectFit: "contain",
                    borderRadius: 14,
                  }}
                />
              </div>
            )}

            <div className="sales-return-summary-grid">
              <div>
                <span>اللون</span>
                <strong>
                  {product.mappedColor ?? "—"}
                </strong>
              </div>

              <div>
                <span>المقاس الممسوح</span>
                <strong>
                  {product.mappedSize ?? "—"}
                </strong>
              </div>

              <div>
                <span>متبقي من المقاس</span>
                <strong>
                  {scannedStock ?? "غير محدد"} قطعة
                </strong>
              </div>

              <div>
                <span>إجمالي اللون الحالي</span>
                <strong>
                  {currentColorTotal ?? "غير محدد"} قطعة
                </strong>
              </div>

              <div>
                <span>إجمالي الموديل كامل</span>
                <strong>
                  {modelTotal ?? "غير محدد"} قطعة
                </strong>
              </div>

              <div>
                <span>الباركود</span>
                <strong dir="ltr">
                  {barcode}
                </strong>
              </div>
            </div>
          </article>

          {displayVariants.length > 0 && (
            <article className="sales-return-items-panel">
              <div className="sales-return-section-title">
                <div>
                  <h3>توزيع المقاسات</h3>
                  <p>
                    الكميات الحالية للموديل حسب اللون والمقاس.
                  </p>
                </div>
              </div>

              <div className="sales-return-table-wrap">
                <table className="sales-return-table">
                  <thead>
                    <tr>
                      <th>اللون</th>
                      <th>المقاس</th>
                      <th>المتوفر</th>
                    </tr>
                  </thead>

                  <tbody>
                    {displayVariants.flatMap(
                      (variant) =>
                        variant.sizes.map(
                          (
                            size: PosSizeStock,
                          ) => (
                            <tr
                              key={`${variant.color}-${size.size}`}
                            >
                              <td>
                                {variant.color}
                              </td>

                              <td>
                                <strong>
                                  {size.size}
                                </strong>
                              </td>

                              <td>
                                <strong>
                                  {size.stock ??
                                    "غير محدد"}
                                </strong>
                              </td>
                            </tr>
                          ),
                        ),
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          )}
        </>
      )}
    </section>
  );
}
