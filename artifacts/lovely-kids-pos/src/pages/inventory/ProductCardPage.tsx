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
  getPosProductCard,
  lookupPosProductByBarcode,
  searchPosProducts,
  type PosInventoryMovement,
  type PosProductCardResult,
  type PosProductLookup,
} from "../../lib/api";
import {
  captureScannerKeyboardEvent,
  createScannerKeyboardBuffer,
} from "../../lib/scannerKeyboard";

type CardScope =
  | "all"
  | "color"
  | "variant";

type VariantChoice = {
  key: string;
  color: string;
  size: string;
  stock: number | null;
};

const movementLabels: Record<
  PosInventoryMovement["movementType"],
  string
> = {
  purchase: "شراء",
  purchase_void: "إلغاء شراء",
  pos_sale: "بيع POS",
  pos_sale_void: "إلغاء بيع",
  pos_sale_edit: "تعديل فاتورة بيع",
  pos_sale_return: "مرتجع بيع",
  pos_sale_return_void: "إلغاء مرتجع بيع",
  online_order: "طلب إلكتروني",
  online_order_cancel: "إلغاء طلب إلكتروني",
  online_order_restore: "إعادة تفعيل طلب إلكتروني",
  online_order_edit: "تعديل طلب إلكتروني",
  adjustment: "تسوية مخزون",
};

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "حدث خطأ غير متوقع";
}

function normalizeArabicDigits(
  value: string,
) {
  const arabic =
    "٠١٢٣٤٥٦٧٨٩";

  const persian =
    "۰۱۲۳۴۵۶۷۸۹";

  return value
    .replace(
      /[٠-٩]/g,
      (char) =>
        String(
          arabic.indexOf(char),
        ),
    )
    .replace(
      /[۰-۹]/g,
      (char) =>
        String(
          persian.indexOf(char),
        ),
    );
}

function normalizeSearchInput(
  value: string,
) {
  return normalizeArabicDigits(
    value,
  ).trim();
}

function stockNumber(
  value: number | null | undefined,
) {
  return typeof value === "number" &&
    Number.isFinite(value)
    ? value
    : null;
}

function variantKey(
  color: string,
  size: string,
) {
  return JSON.stringify([
    color,
    size,
  ]);
}

function formatDateTime(
  value: string,
) {
  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return value;
  }

  return new Intl.DateTimeFormat(
    "ar-PS",
    {
      dateStyle: "short",
      timeStyle: "short",
    },
  ).format(date);
}

function signedQuantity(
  value: number,
) {
  return value > 0
    ? `+${value}`
    : String(value);
}

function formatUnitCost(minor: number) {
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100)} ₪`;
}

function OwnerValueBox({
  label,
  value,
  detail,
  background,
  border,
  color,
}: {
  label: string;
  value: string;
  detail: string;
  background: string;
  border: string;
  color: string;
}) {
  return (
    <div
      style={{
        minWidth: 0,
        padding: "16px 18px",
        borderRadius: 14,
        border: `2px solid ${border}`,
        background,
        boxShadow: "0 4px 12px rgba(51,35,71,.08)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <span style={{ color, fontSize: 15, fontWeight: 800 }}>
        {label}
      </span>
      <strong
        dir="ltr"
        style={{
          color,
          fontSize: 26,
          fontWeight: 900,
          textAlign: "right",
          lineHeight: 1.35,
        }}
      >
        {value}
      </strong>
      <small
        style={{ color, fontSize: 12, opacity: 0.85, fontWeight: 600 }}
      >
        {detail}
      </small>
    </div>
  );
}

function movementSourceHref(
  movement: PosInventoryMovement,
) {
  if (
    movement.sourceType ===
      "pos_sale" &&
    movement.sourcePublicId
  ) {
    return (
      "/sales/invoice-check?publicId=" +
      encodeURIComponent(
        movement.sourcePublicId,
      )
    );
  }

  return null;
}

export default function ProductCardPage() {
  const {
    token,
    user,
    clearAuthentication,
  } = usePosRuntime();

  const inputRef =
    useRef<HTMLInputElement>(
      null,
    );

  const scannerKeyboard =
    useRef(
      createScannerKeyboardBuffer(),
    );

  const [query, setQuery] =
    useState("");

  const [results, setResults] =
    useState<
      PosProductLookup[]
    >([]);

  const [card, setCard] =
    useState<
      PosProductCardResult | null
    >(null);

  const [scope, setScope] =
    useState<CardScope>("all");

  const [
    selectedVariantKey,
    setSelectedVariantKey,
  ] = useState("");

  const [selectedColor, setSelectedColor] = useState("");

  const [busy, setBusy] =
    useState(false);

  const [error, setError] =
    useState("");

  useEffect(() => {
    document.title =
      "بطاقة الصنف | Lovely Kids POS";

    window.setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
  }, []);

  const variantChoices =
    useMemo<VariantChoice[]>(() => {
      if (!card) {
        return [];
      }

      return card.product
        .colorVariants
        .flatMap(
          (variant) =>
            variant.sizes.map(
              (sizeEntry) => ({
                key: variantKey(
                  variant.color,
                  sizeEntry.size,
                ),
                color:
                  variant.color,
                size:
                  sizeEntry.size,
                stock:
                  stockNumber(
                    sizeEntry.stock,
                  ),
              }),
            ),
        );
    }, [card]);

  const colorChoices = useMemo(() => {
    if (!card) return [];
    return card.product.colorVariants.map((variant) => {
      const stocks = variant.sizes.map((size) => stockNumber(size.stock));
      return {
        color: variant.color,
        stock: stocks.length > 0 && stocks.every((v) => v !== null)
          ? stocks.reduce((sum, v) => sum + (v ?? 0), 0)
          : null,
      };
    });
  }, [card]);

  const selectedColorChoice =
    colorChoices.find((choice) => choice.color === selectedColor) ?? null;

  const selectedVariant =
    useMemo(
      () =>
        variantChoices.find(
          (item) =>
            item.key ===
            selectedVariantKey,
        ) ?? null,
      [
        variantChoices,
        selectedVariantKey,
      ],
    );

  const modelStock =
    useMemo(() => {
      if (!card) {
        return null;
      }

      const directStock =
        stockNumber(
          card.product.stock,
        );

      if (directStock !== null) {
        return directStock;
      }

      const variantStocks =
        card.product
          .colorVariants
          .flatMap(
            (variant) =>
              variant.sizes
                .map(
                  (entry) =>
                    stockNumber(
                      entry.stock,
                    ),
                )
                .filter(
                  (
                    value,
                  ): value is number =>
                    value !== null,
                ),
          );

      if (!variantStocks.length) {
        return null;
      }

      return variantStocks.reduce(
        (total, value) =>
          total + value,
        0,
      );
    }, [card]);

  const currentStock =
    scope === "variant"
      ? selectedVariant?.stock ?? null
      : scope === "color"
        ? selectedColorChoice?.stock ?? null
        : modelStock;

  const activeScopeLabel =
    scope === "variant" && selectedVariant
      ? `اللون: ${selectedVariant.color} · النمرة: ${selectedVariant.size}`
      : scope === "color" && selectedColorChoice
        ? `اللون: ${selectedColorChoice.color} · كل النمر`
        : "الموديل كامل بجميع الألوان والنمر";

  const inventoryValueMinor =
    card?.cost && currentStock !== null
      ? card.cost.unitCostMinor * currentStock
      : null;

  const costDescription = !card?.cost
    ? "لم تُسجّل تكلفة لهذا الموديل"
    : [
        card.cost.basis === "reference" ? "تكلفة مرجعية" : "متوسط التكلفة المحاسبي",
        card.cost.quality === "estimated" ? "تقديرية" :
          card.cost.quality === "mixed" ? "تكلفة مختلطة" : null,
        !card.cost.stockMatchesAccounting ? "فرق بين المخزون والمحاسبة" : null,
      ].filter(Boolean).join(" · ");

  const visibleMovements = useMemo(() => {
    if (!card) return [];
    if (scope === "all") return card.movements;
    if (scope === "color") {
      return selectedColorChoice
        ? card.movements.filter((movement) => movement.color === selectedColorChoice.color)
        : [];
    }
    return selectedVariant
      ? card.movements.filter((movement) =>
          movement.color === selectedVariant.color && movement.size === selectedVariant.size)
      : [];
  }, [card, scope, selectedColorChoice, selectedVariant]);

  const totals =
    useMemo(() => {
      let purchases = 0;
      let posSales = 0;
      let returns = 0;
      let onlineSales = 0;

      for (
        const movement
        of visibleMovements
      ) {
        switch (
          movement.movementType
        ) {
          case "purchase":
          case "purchase_void":
            purchases +=
              movement.quantityDelta;
            break;

          case "pos_sale":
          case "pos_sale_void":
          case "pos_sale_edit":
            posSales -=
              movement.quantityDelta;
            break;

          case "pos_sale_return":
          case "pos_sale_return_void":
            returns +=
              movement.quantityDelta;
            break;

          case "online_order":
          case "online_order_cancel":
          case "online_order_restore":
          case "online_order_edit":
            onlineSales -=
              movement.quantityDelta;
            break;

          default:
            break;
        }
      }

      return {
        purchases,
        posSales,
        returns,
        onlineSales,
      };
    }, [visibleMovements]);

  function restoreInputFocus() {
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 100);
  }

  function handleApiError(
    caught: unknown,
  ) {
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
  }

  async function openCard(
    product: PosProductLookup,
  ) {
    setBusy(true);
    setError("");
    setResults([]);

    try {
      const response =
        await getPosProductCard(
          token,
          product.productId,
        );

      setCard(response);

      const exactVariant =
        response.product
          .colorVariants
          .flatMap(
            (variant) =>
              variant.sizes.map(
                (sizeEntry) => ({
                  key:
                    variantKey(
                      variant.color,
                      sizeEntry.size,
                    ),
                  color:
                    variant.color,
                  size:
                    sizeEntry.size,
                }),
              ),
          )
          .find(
            (item) =>
              item.color ===
                product.mappedColor &&
              item.size ===
                product.mappedSize,
          );

      if (exactVariant) {
        setSelectedVariantKey(exactVariant.key);
        setSelectedColor(exactVariant.color);
        setScope("variant");
      } else if (
        product.mappedColor &&
        response.product.colorVariants.some((item) => item.color === product.mappedColor)
      ) {
        setSelectedVariantKey("");
        setSelectedColor(product.mappedColor);
        setScope("color");
      } else {
        setSelectedVariantKey("");
        setSelectedColor("");
        setScope("all");
      }
    } catch (caught) {
      handleApiError(caught);
    } finally {
      setBusy(false);
      restoreInputFocus();
    }
  }

  async function scanBarcode(
    rawBarcode: string,
  ) {
    const value =
      normalizeSearchInput(
        rawBarcode,
      );

    if (!value) {
      return;
    }

    setQuery(value);
    setBusy(true);
    setError("");
    setResults([]);

    try {
      const product =
        await lookupPosProductByBarcode(
          token,
          value,
        );

      await openCard(product);
    } catch (caught) {
      handleApiError(caught);
      setBusy(false);
      restoreInputFocus();
    }
  }

  async function search(
    rawQuery: string,
  ) {
    const value =
      normalizeSearchInput(
        rawQuery,
      );

    if (!value) {
      setError(
        "أدخل اسم الصنف أو الكود أو الباركود",
      );
      return;
    }

    setQuery(value);
    setBusy(true);
    setError("");
    setResults([]);

    try {
      const response =
        await searchPosProducts(
          token,
          value,
          15,
        );

      if (
        response.results.length ===
        0
      ) {
        setCard(null);
        setError(
          "لم يتم العثور على صنف مطابق",
        );
        return;
      }

      if (
        response.results.length ===
        1
      ) {
        await openCard(
          response.results[0],
        );
        return;
      }

      setResults(
        response.results,
      );
    } catch (caught) {
      handleApiError(caught);
    } finally {
      setBusy(false);
      restoreInputFocus();
    }
  }

  function handleKeyDown(
    event:
      KeyboardEvent<HTMLInputElement>,
  ) {
    if (
      event.nativeEvent.isComposing
    ) {
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

      void scanBarcode(
        scannedValue,
      );
    }
  }

  function handleSubmit(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    void search(query);
  }

  function selectAllProduct() {
    setScope("all");
  }

  function selectColorMode() {
    if (!colorChoices.length) return;
    const preferredColor = selectedVariant?.color || selectedColor;
    const validColor = colorChoices.some((item) => item.color === preferredColor)
      ? preferredColor
      : colorChoices[0].color;
    setSelectedColor(validColor);
    setScope("color");
  }

  function selectVariantMode() {
    if (!variantChoices.length) return;
    const sameColor = variantChoices.find((item) => item.color === selectedColor);
    const nextVariant = selectedVariant ?? sameColor ?? variantChoices[0];
    setSelectedVariantKey(nextVariant.key);
    setSelectedColor(nextVariant.color);
    setScope("variant");
  }

  return (
    <section className="sales-return-page">
      <header className="sales-return-header">
        <div>
          <h1>بطاقة الصنف</h1>
          <p>
            ابحث بالاسم أو كود الصنف أو امسح الباركود،
            ثم اعرض حركة الموديل كامل أو لون ونمرة محددين.
          </p>
        </div>
      </header>

      <article className="sales-return-search-panel">
        <form
          className="sales-return-search-form"
          onSubmit={handleSubmit}
        >
          <label className="sales-return-field">
            <span>
              اسم / كود / باركود
            </span>

            <input
              ref={inputRef}
              autoFocus
              autoComplete="off"
              value={query}
              onChange={(event) =>
                setQuery(
                  normalizeArabicDigits(
                    event.target.value,
                  ),
                )
              }
              onKeyDown={handleKeyDown}
              placeholder="ابحث أو امسح الباركود..."
              disabled={busy}
            />
          </label>

          <button
            className="primary-button"
            type="submit"
            disabled={busy}
          >
            {busy
              ? "جاري البحث…"
              : "بحث"}
          </button>
        </form>

        <p
          style={{
            margin:
              "10px 0 0",
            fontSize: 13,
            opacity: 0.72,
          }}
        >
          قارئ الباركود يعمل حتى لو كانت لغة لوحة المفاتيح عربية.
        </p>

        {error && (
          <div className="sales-return-error">
            {error}
          </div>
        )}
      </article>

      {results.length > 1 && (
        <article className="sales-return-invoice">
          <div className="sales-return-section-title">
            <div>
              <h3>
                نتائج البحث
              </h3>
              <span>
                اختر الصنف المطلوب
              </span>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gap: 10,
            }}
          >
            {results.map(
              (product) => (
                <button
                  key={
                    product.productId
                  }
                  type="button"
                  onClick={() =>
                    void openCard(
                      product,
                    )
                  }
                  style={{
                    width: "100%",
                    display:
                      "grid",
                    gridTemplateColumns:
                      "64px 1fr auto",
                    gap: 12,
                    alignItems:
                      "center",
                    textAlign:
                      "right",
                    border:
                      "1px solid rgba(127,127,127,.25)",
                    borderRadius:
                      12,
                    padding: 10,
                    cursor:
                      "pointer",
                    background:
                      "var(--panel, white)",
                    color:
                      "inherit",
                  }}
                >
                  {product.image ? (
                    <img
                      src={
                        product.image
                      }
                      alt={
                        product.nameAr
                      }
                      style={{
                        width: 64,
                        height: 64,
                        objectFit:
                          "contain",
                        borderRadius:
                          10,
                      }}
                    />
                  ) : (
                    <span />
                  )}

                  <span>
                    <strong>
                      {
                        product.nameAr
                      }
                    </strong>
                    <br />
                    <small dir="ltr">
                      {product.productCode ??
                        "—"}
                    </small>
                  </span>

                  <span>
                    فتح البطاقة
                  </span>
                </button>
              ),
            )}
          </div>
        </article>
      )}

      {card && (
        <>
          <article className="sales-return-invoice">
            <div className="sales-return-section-title">
              <div>
                <h3>
                  {card.product.nameAr}
                </h3>

                <strong dir="ltr">
                  {card.product
                    .productCode ??
                    "—"}
                </strong>
              </div>

              <span className="return-status available">
                الرصيد الحالي:{" "}
                {currentStock ??
                  "—"}
              </span>
            </div>

            {card.product.image && (
              <div
                style={{
                  display: "flex",
                  justifyContent:
                    "center",
                  marginBottom: 20,
                }}
              >
                <img
                  src={
                    card.product.image
                  }
                  alt={
                    card.product.nameAr
                  }
                  style={{
                    width: 180,
                    maxWidth:
                      "100%",
                    maxHeight:
                      220,
                    objectFit:
                      "contain",
                    borderRadius:
                      14,
                  }}
                />
              </div>
            )}

            <div
              style={{
                display: "flex",
                alignItems:
                  "center",
                gap: 8,
                flexWrap:
                  "wrap",
                marginBottom: 16,
                padding:
                  "10px 12px",
                border:
                  "1px solid rgba(127,127,127,.22)",
                borderRadius: 10,
              }}
            >
              <strong>
                {card.suppliers.length ===
                1
                  ? "المورد:"
                  : "الموردون:"}
              </strong>

              {card.suppliers.length >
              0 ? (
                card.suppliers.map(
                  (supplier) => (
                    <span
                      key={
                        supplier.id
                      }
                      style={{
                        padding:
                          "4px 9px",
                        borderRadius:
                          999,
                        background:
                          "rgba(127,127,127,.10)",
                      }}
                    >
                      {supplier.name}
                    </span>
                  ),
                )
              ) : (
                <span>
                  لا يوجد مورد مسجل
                </span>
              )}
            </div>

            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                marginBottom: 16,
              }}
            >
              <button
                type="button"
                className={
                  scope === "all"
                    ? "primary-button"
                    : undefined
                }
                onClick={
                  selectAllProduct
                }
                style={{
                  padding:
                    "10px 16px",
                  borderRadius: 10,
                  cursor:
                    "pointer",
                }}
              >
                كل الصنف
              </button>

              <button
                type="button"
                className={scope === "color" ? "primary-button" : undefined}
                onClick={selectColorMode}
                disabled={colorChoices.length === 0}
                style={{
                  padding: "10px 16px",
                  borderRadius: 10,
                  cursor: colorChoices.length ? "pointer" : "not-allowed",
                }}
              >
                لون كامل
              </button>

              <button
                type="button"
                className={
                  scope ===
                  "variant"
                    ? "primary-button"
                    : undefined
                }
                onClick={
                  selectVariantMode
                }
                disabled={
                  variantChoices.length ===
                  0
                }
                style={{
                  padding:
                    "10px 16px",
                  borderRadius: 10,
                  cursor:
                    variantChoices.length
                      ? "pointer"
                      : "not-allowed",
                }}
              >
                لون + نمرة
              </button>
            </div>

            {scope === "color" && colorChoices.length > 0 && (
              <label className="sales-return-field" style={{ marginBottom: 18 }}>
                <span>اختر اللون (كل النمر)</span>
                <select
                  value={selectedColor}
                  onChange={(event) => {
                    setSelectedColor(event.target.value);
                    setSelectedVariantKey("");
                  }}
                  style={{ width: "100%", padding: "11px 12px", borderRadius: 10 }}
                >
                  {colorChoices.map((choice) => (
                    <option key={choice.color} value={choice.color}>
                      {choice.color} — المخزون: {choice.stock ?? "—"}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {scope ===
              "variant" &&
              variantChoices.length >
                0 && (
                <label
                  className="sales-return-field"
                  style={{
                    marginBottom: 18,
                  }}
                >
                  <span>
                    اختر اللون والنمرة
                  </span>

                  <select
                    value={
                      selectedVariantKey
                    }
                    onChange={(event) => {
                      setSelectedVariantKey(event.target.value);
                      const choice = variantChoices.find((v) => v.key === event.target.value);
                      if (choice) setSelectedColor(choice.color);
                    }}
                    style={{
                      width:
                        "100%",
                      padding:
                        "11px 12px",
                      borderRadius:
                        10,
                    }}
                  >
                    {variantChoices.map(
                      (variant) => (
                        <option
                          key={
                            variant.key
                          }
                          value={
                            variant.key
                          }
                        >
                          {
                            variant.color
                          }{" "}
                          —{" "}
                          {
                            variant.size
                          }{" "}
                          — المخزون:{" "}
                          {variant.stock ??
                            "—"}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              )}

            {user?.isOwner && (
              <div style={{ marginBottom: 20 }}>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 10,
                    color: "#9d1762",
                    fontWeight: 800,
                  }}
                >
                  <span>ملخص الأسعار وقيمة المخزون · الأونر فقط</span>
                  <small style={{ fontWeight: 700 }}>{activeScopeLabel}</small>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: 12,
                  }}
                >
                  <OwnerValueBox
                    label="سعر البيع المسجل للقطعة"
                    value={formatUnitCost(card.product.websiteUnitPriceMinor)}
                    detail="سعر البيع الحالي للموديل"
                    background="#fce8f4"
                    border="#e31b87"
                    color="#921456"
                  />
                  <OwnerValueBox
                    label="تكلفة القطعة"
                    value={card.cost
                      ? formatUnitCost(card.cost.unitCostMinor)
                      : "غير مسجلة"}
                    detail={costDescription}
                    background="#fff4d9"
                    border="#e6aa2d"
                    color="#875008"
                  />
                  <OwnerValueBox
                    label="قيمة المتوفر بسعر التكلفة"
                    value={inventoryValueMinor !== null
                      ? formatUnitCost(inventoryValueMinor)
                      : "غير متاحة"}
                    detail={currentStock === null
                      ? "لا يمكن تحديد كمية المخزون لهذا الاختيار"
                      : card.cost
                        ? `${currentStock} قطعة × تكلفة القطعة · ${activeScopeLabel}`
                        : "التكلفة غير مسجلة"}
                    background="#e3f8f3"
                    border="#169c88"
                    color="#066857"
                  />
                </div>
                {card.cost && !card.cost.stockMatchesAccounting && (
                  <p
                    style={{
                      margin: "10px 2px 0",
                      color: "#a04715",
                      fontWeight: 700,
                      fontSize: 13,
                    }}
                  >
                    تنبيه: يوجد فرق بين الكمية الفعلية والكمية المحاسبية؛
                    قيمة المخزون المعروضة تقديرية حتى تتم المطابقة.
                  </p>
                )}
                <p style={{ margin: "9px 2px 0", fontSize: 12, opacity: 0.8 }}>
                  تكلفة الوحدة محفوظة على مستوى الموديل، وتُستخدم لحساب
                  قيمة اللون أو النمرة حسب المخزون المحدد.
                </p>
              </div>
            )}

            <div className="sales-return-summary-grid">
              <div>
                <span>
                  الرصيد الحالي
                </span>
                <strong>
                  {currentStock ??
                    "—"}
                </strong>
              </div>



              <div>
                <span>
                  شراء صافي
                </span>
                <strong>
                  {totals.purchases}
                </strong>
              </div>

              <div>
                <span>
                  مبيعات POS صافي
                </span>
                <strong>
                  {totals.posSales}
                </strong>
              </div>

              <div>
                <span>
                  مرتجعات صافي
                </span>
                <strong>
                  {totals.returns}
                </strong>
              </div>

              <div>
                <span>
                  طلبات إلكترونية صافي
                </span>
                <strong>
                  {totals.onlineSales}
                </strong>
              </div>

              <div>
                <span>
                  عدد الحركات
                </span>
                <strong>
                  {
                    visibleMovements.length
                  }
                </strong>
              </div>
            </div>
          </article>

          <article className="sales-return-invoice">
            <div className="sales-return-section-title">
              <div>
                <h3>
                  سجل حركة المخزون
                </h3>

                <span>
                  {scope === "all"
                    ? "كل الصنف"
                    : selectedVariant
                      ? `${selectedVariant.color} / ${selectedVariant.size}`
                      : "لون + نمرة"}
                </span>
              </div>
            </div>

            {visibleMovements.length ===
            0 ? (
              <p>
                لا توجد حركات مسجلة لهذا الاختيار.
              </p>
            ) : (
              <div
                style={{
                  overflowX:
                    "auto",
                }}
              >
                <table
                  style={{
                    width:
                      "100%",
                    borderCollapse:
                      "collapse",
                    minWidth:
                      760,
                  }}
                >
                  <thead>
                    <tr>
                      <th>
                        التاريخ
                      </th>
                      <th>
                        الحركة
                      </th>
                      <th>
                        اللون
                      </th>
                      <th>
                        النمرة
                      </th>
                      <th>
                        الكمية
                      </th>
                      <th>
                        الرصيد بعد
                      </th>
                      <th>
                        المرجع
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {visibleMovements.map(
                      (
                        movement,
                      ) => {
                        const href =
                          movementSourceHref(
                            movement,
                          );

                        const balanceAfter =
                          scope ===
                          "variant"
                            ? movement.variantStockAfter
                            : movement.generalStockAfter;

                        return (
                          <tr
                            key={
                              movement.id
                            }
                          >
                            <td>
                              {formatDateTime(
                                movement.occurredAt,
                              )}
                            </td>

                            <td>
                              {
                                movementLabels[
                                  movement
                                    .movementType
                                ]
                              }
                            </td>

                            <td>
                              {movement.color ??
                                "—"}
                            </td>

                            <td>
                              {movement.size ??
                                "—"}
                            </td>

                            <td
                              dir="ltr"
                              style={{
                                fontWeight:
                                  800,
                              }}
                            >
                              {signedQuantity(
                                movement.quantityDelta,
                              )}
                            </td>

                            <td
                              dir="ltr"
                            >
                              {balanceAfter ??
                                "—"}
                            </td>

                            <td>
                              {href ? (
                                <a
                                  href={
                                    href
                                  }
                                >
                                  {movement.sourcePublicId ??
                                    "فتح الفاتورة"}
                                </a>
                              ) : (
                                movement.sourcePublicId ??
                                "—"
                              )}
                            </td>
                          </tr>
                        );
                      },
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <p
              style={{
                marginTop: 16,
                fontSize: 13,
                opacity: 0.7,
              }}
            >
              تغطية سجل POS التاريخي تبدأ من
              30/07/2026. الطلبات الإلكترونية التاريخية
              السابقة لتفعيل بطاقة الصنف لم يتم إنشاء
              حركات افتراضية لها، والحركات الإلكترونية
              الجديدة تُسجل من 24/09/2026.
            </p>
          </article>
        </>
      )}
    </section>
  );
}
