import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Link } from "react-router-dom";

import { usePosRuntime } from "../../app/pos-context";
import {
  ApiError,
  createManualOnlineOrder,
  getManualOrderSettings,
  lookupPosProductByBarcode,
  searchPosProducts,
  type ManualOnlineOrderResult,
  type ManualOrderSettings,
  type ManualOrderShippingZone,
  type PosProductLookup,
} from "../../lib/api";
import {
  playMobileScanSound,
  unlockMobileScanSound,
} from "../../lib/mobile-scan-sound";

interface ManualOrderLine {
  id: string;
  barcode: string;
  product: PosProductLookup;
  color: string | null;
  size: string | null;
  quantity: number;
}

const FALLBACK_SHIPPING_ZONES: ManualOrderShippingZone[] = [
  {
    label: "الضفة الغربية",
    cost: 20,
  },
  {
    label: "القدس",
    cost: 30,
  },
  {
    label: "أراضي الـ48",
    cost: 70,
  },
];

function createKey() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function formatMoney(value: number) {
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} ₪`;
}

function barcodeCharacterFromPhysicalKey(
  code: string,
  shift: boolean,
): string | null {
  if (/^Key[A-Z]$/.test(code)) {
    const letter = code.slice(3);
    return shift
      ? letter
      : letter.toLowerCase();
  }

  if (/^Digit[0-9]$/.test(code)) {
    const digit = code.slice(5);
    const shifted: Record<string, string> = {
      "0": ")",
      "1": "!",
      "2": "@",
      "3": "#",
      "4": "$",
      "5": "%",
      "6": "^",
      "7": "&",
      "8": "*",
      "9": "(",
    };

    return shift
      ? shifted[digit] ?? digit
      : digit;
  }

  if (/^Numpad[0-9]$/.test(code)) {
    return code.slice(6);
  }

  const punctuation: Record<
    string,
    [string, string]
  > = {
    Minus: ["-", "_"],
    Equal: ["=", "+"],
    BracketLeft: ["[", "{"],
    BracketRight: ["]", "}"],
    Backslash: ["\\", "|"],
    Semicolon: [";", ":"],
    Quote: ["'", "\""],
    Comma: [",", "<"],
    Period: [".", ">"],
    Slash: ["/", "?"],
    Backquote: ["`", "~"],
    NumpadAdd: ["+", "+"],
    NumpadSubtract: ["-", "-"],
    NumpadMultiply: ["*", "*"],
    NumpadDivide: ["/", "/"],
    NumpadDecimal: [".", "."],
  };

  const pair = punctuation[code];

  if (!pair) {
    return null;
  }

  return shift
    ? pair[1]
    : pair[0];
}

function getColors(product: PosProductLookup) {
  return product.colorVariants.map(
    (variant) => variant.color,
  );
}

function getSizes(
  product: PosProductLookup,
  color: string | null,
) {
  if (product.colorVariants.length > 0) {
    const variant =
      product.colorVariants.find(
        (entry) =>
          entry.color === color,
      );

    return (
      variant?.sizes.map(
        (entry) => entry.size,
      ) ?? []
    );
  }

  return product.sizes;
}

function selectionIsComplete(
  line: ManualOrderLine,
) {
  const colors =
    getColors(line.product);

  if (
    colors.length > 0 &&
    !line.color
  ) {
    return false;
  }

  const sizes =
    getSizes(
      line.product,
      line.color,
    );

  return (
    sizes.length === 0 ||
    !!line.size
  );
}

function getLineAvailability(
  line: ManualOrderLine,
) {
  if (
    line.product.colorVariants.length >
      0 &&
    line.color
  ) {
    const variant =
      line.product.colorVariants.find(
        (entry) =>
          entry.color === line.color,
      );

    if (line.size) {
      const size =
        variant?.sizes.find(
          (entry) =>
            entry.size === line.size,
        );

      return {
        stock:
          size?.stock ?? null,
        outOfStock:
          !!size?.outOfStock,
      };
    }
  }

  return {
    stock: line.product.stock,
    outOfStock:
      line.product.outOfStock,
  };
}

function errorMessage(
  error: unknown,
) {
  return error instanceof Error
    ? error.message
    : "حدث خطأ غير متوقع";
}

function storeDate() {
  try {
    const parts =
      new Intl.DateTimeFormat(
        "en-US",
        {
          timeZone:
            "Asia/Hebron",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        },
      ).formatToParts(
        new Date(),
      );

    const values =
      Object.fromEntries(
        parts.map(
          (part) => [
            part.type,
            part.value,
          ],
        ),
      );

    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return new Date()
      .toISOString()
      .slice(0, 10);
  }
}

function shippingCostForPreview(
  settings: ManualOrderSettings | null,
  zone: ManualOrderShippingZone | null,
  subtotal: number,
) {
  if (!zone) return 0;

  if (
    settings
      ?.shippingPromotionEnabled !==
      true
  ) {
    return zone.cost;
  }

  const threshold =
    settings
      .shippingPromotionThreshold;

  if (
    typeof threshold !==
      "number" ||
    subtotal < threshold
  ) {
    return zone.cost;
  }

  const today =
    storeDate();

  const startDate =
    settings
      .shippingPromotionStartDate
      ?.trim();

  const endDate =
    settings
      .shippingPromotionEndDate
      ?.trim();

  if (
    startDate &&
    today < startDate
  ) {
    return zone.cost;
  }

  if (
    endDate &&
    today > endDate
  ) {
    return zone.cost;
  }

  return typeof zone.promoCost ===
    "number"
    ? zone.promoCost
    : zone.cost;
}

export default function ManualOnlineOrderPage() {
  const {
    token,
    user,
    clearAuthentication,
  } = usePosRuntime();

  const barcodeInputRef =
    useRef<HTMLInputElement>(
      null,
    );

  const idempotencyKeyRef =
    useRef<string | null>(
      null,
    );

  const [
    customerName,
    setCustomerName,
  ] = useState("");

  const [
    customerPhone,
    setCustomerPhone,
  ] = useState("");

  const [
    customerAddress,
    setCustomerAddress,
  ] = useState("");

  const [
    shippingZone,
    setShippingZone,
  ] = useState("");

  const [
    notes,
    setNotes,
  ] = useState("");

  const [
    settings,
    setSettings,
  ] =
    useState<ManualOrderSettings | null>(
      null,
    );

  const [
    cart,
    setCart,
  ] =
    useState<ManualOrderLine[]>(
      [],
    );

  const [
    barcode,
    setBarcode,
  ] = useState("");

  const barcodeValueRef =
    useRef("");

  const [
    searchResults,
    setSearchResults,
  ] =
    useState<PosProductLookup[]>(
      [],
    );

  const [
    lookupBusy,
    setLookupBusy,
  ] = useState(false);

  const [
    submitBusy,
    setSubmitBusy,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState("");

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    lastOrder,
    setLastOrder,
  ] =
    useState<ManualOnlineOrderResult | null>(
      null,
    );

  useEffect(() => {
    document.title =
      "إنشاء طلب يدوي | Lovely Kids POS";

    void unlockMobileScanSound();

    getManualOrderSettings()
      .then((result) => {
        setSettings(result);

        const zones =
          Array.isArray(
            result.shippingZones,
          ) &&
          result.shippingZones
            .length > 0
            ? result.shippingZones
            : FALLBACK_SHIPPING_ZONES;

        setShippingZone(
          (current) =>
            current ||
            zones[0]?.label ||
            "",
        );
      })
      .catch(() => {
        setSettings({
          shippingZones:
            FALLBACK_SHIPPING_ZONES,
        });

        setShippingZone(
          (current) =>
            current ||
            FALLBACK_SHIPPING_ZONES[
              0
            ].label,
        );
      });

    window.setTimeout(
      () =>
        barcodeInputRef.current
          ?.focus(),
      100,
    );
  }, []);

  const shippingZones =
    useMemo(() => {
      const configured =
        settings?.shippingZones;

      if (
        Array.isArray(
          configured,
        ) &&
        configured.length > 0
      ) {
        return configured;
      }

      return FALLBACK_SHIPPING_ZONES;
    }, [settings]);

  const selectedZone =
    useMemo(
      () =>
        shippingZones.find(
          (zone) =>
            zone.label ===
            shippingZone,
        ) ?? null,
      [
        shippingZones,
        shippingZone,
      ],
    );

  const subtotal =
    useMemo(
      () =>
        cart.reduce(
          (sum, line) =>
            sum +
            line.product
              .websiteUnitPrice *
              line.quantity,
          0,
        ),
      [cart],
    );

  const itemCount =
    useMemo(
      () =>
        cart.reduce(
          (sum, line) =>
            sum +
            line.quantity,
          0,
        ),
      [cart],
    );

  const previewShippingCost =
    shippingZone ===
    "استلام من المحل"
      ? 0
      : shippingCostForPreview(
          settings,
          selectedZone,
          subtotal,
        );

  const previewTotal =
    subtotal +
    previewShippingCost;

  function refocusBarcode() {
    window.setTimeout(
      () => {
        barcodeInputRef.current
          ?.focus();
        barcodeInputRef.current
          ?.select();
      },
      50,
    );
  }

  function addProductToCart(
    product: PosProductLookup,
  ) {
    const colors =
      getColors(product);

    const color =
      product.mappedColor ??
      (
        colors.length === 1
          ? colors[0]
          : null
      );

    const sizes =
      getSizes(
        product,
        color,
      );

    const size =
      product.mappedSize ??
      (
        sizes.length === 1
          ? sizes[0]
          : null
      );

    const productBarcode =
      product.barcode ?? "";

    const existing =
      cart.find(
        (line) =>
          line.product.productId ===
            product.productId &&
          line.barcode ===
            productBarcode &&
          line.color === color &&
          line.size === size,
      );

    const candidate: ManualOrderLine = {
      id:
        existing?.id ??
        createKey(),
      barcode: productBarcode,
      product,
      color,
      size,
      quantity:
        (existing?.quantity ?? 0) +
        1,
    };

    const availability =
      getLineAvailability(
        candidate,
      );

    if (
      availability.outOfStock ||
      (
        availability.stock !==
          null &&
        candidate.quantity >
          availability.stock
      )
    ) {
      setError(
        `لا يمكن إضافة ${product.nameAr}: الكمية المتوفرة ${availability.stock ?? 0} فقط.`,
      );
      setMessage("");
      barcodeValueRef.current = "";
      setBarcode("");
      refocusBarcode();
      return;
    }

    setCart(
      (current) => {
        const existingIndex =
          current.findIndex(
            (line) =>
              line.product
                .productId ===
                product.productId &&
              line.barcode ===
                productBarcode &&
              line.color === color &&
              line.size === size,
          );

        if (
          existingIndex >= 0
        ) {
          return current.map(
            (line, index) =>
              index ===
              existingIndex
                ? {
                    ...line,
                    quantity:
                      line.quantity +
                      1,
                  }
                : line,
          );
        }

        return [
          ...current,
          candidate,
        ];
      },
    );

    void playMobileScanSound();

    if (
      "vibrate" in navigator
    ) {
      navigator.vibrate(60);
    }

    setMessage(
      `تمت إضافة ${product.nameAr}`,
    );

    setError("");
    setSearchResults([]);
    barcodeValueRef.current = "";
    setBarcode("");
    refocusBarcode();
  }

  async function lookupAndAdd(
    rawValue: string,
  ) {
    const value =
      rawValue.trim();

    if (!value) {
      return;
    }

    setLookupBusy(true);
    setError("");
    setMessage("");

    try {
      const product =
        await lookupPosProductByBarcode(
          token,
          value,
        );

      addProductToCart(
        product,
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

      if (
        caught instanceof
          ApiError &&
        caught.status === 404
      ) {
        try {
          const result =
            await searchPosProducts(
              token,
              value,
              10,
            );

          if (
            result.results
              .length === 1
          ) {
            addProductToCart(
              result.results[0],
            );
          } else if (
            result.results
              .length > 1
          ) {
            setSearchResults(
              result.results,
            );

            setMessage(
              "وجدت أكثر من صنف، اختر المطلوب.",
            );
          } else {
            setError(
              "الباركود غير موجود.",
            );
          }
        } catch (
          searchError
        ) {
          if (
            searchError instanceof
              ApiError &&
            searchError.status ===
              401
          ) {
            clearAuthentication();
            return;
          }

          setError(
            errorMessage(
              searchError,
            ),
          );
        }
      } else {
        setError(
          errorMessage(caught),
        );
      }
    } finally {
      setLookupBusy(false);
    }
  }

  function submitBarcodeValue(
    rawValue: string,
  ) {
    const value =
      rawValue.trim();

    if (!value) {
      setError(
        "امسح الباركود بفرد الباركود.",
      );
      refocusBarcode();
      return;
    }

    if (lookupBusy) {
      return;
    }

    void lookupAndAdd(
      value,
    );
  }

  function handleBarcodeSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    submitBarcodeValue(
      barcodeValueRef.current ||
        barcode,
    );
  }

  function handleBarcodeKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement>,
  ) {
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    ) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();

      submitBarcodeValue(
        barcodeValueRef.current ||
          barcode,
      );
      return;
    }

    if (event.key === "Backspace") {
      event.preventDefault();

      const next =
        barcodeValueRef.current.slice(
          0,
          -1,
        );

      barcodeValueRef.current =
        next;
      setBarcode(next);
      return;
    }

    const character =
      barcodeCharacterFromPhysicalKey(
        event.code,
        event.shiftKey,
      );

    if (character === null) {
      return;
    }

    event.preventDefault();

    const next =
      barcodeValueRef.current +
      character;

    barcodeValueRef.current =
      next;
    setBarcode(next);
  }

  function changeColor(
    line: ManualOrderLine,
    value: string,
  ) {
    const color =
      value || null;

    const sizes =
      getSizes(
        line.product,
        color,
      );

    setCart(
      (current) =>
        current.map(
          (item) =>
            item.id === line.id
              ? {
                  ...item,
                  color,
                  size:
                    sizes.length ===
                    1
                      ? sizes[0]
                      : null,
                }
              : item,
        ),
    );
  }

  function changeSize(
    lineId: string,
    value: string,
  ) {
    setCart(
      (current) =>
        current.map(
          (line) =>
            line.id === lineId
              ? {
                  ...line,
                  size:
                    value ||
                    null,
                }
              : line,
        ),
    );
  }

  function changeQuantity(
    lineId: string,
    change: number,
  ) {
    const line =
      cart.find(
        (item) =>
          item.id === lineId,
      );

    if (!line) {
      return;
    }

    const availability =
      getLineAvailability(line);

    const maximum =
      availability.stock ===
      null
        ? 99
        : Math.max(
            0,
            Math.min(
              99,
              availability.stock,
            ),
          );

    const requested =
      line.quantity + change;

    if (
      change > 0 &&
      (
        availability.outOfStock ||
        requested > maximum
      )
    ) {
      setError(
        `لا يمكن زيادة ${line.product.nameAr}: الكمية المتوفرة ${availability.stock ?? 0} فقط.`,
      );
      setMessage("");
      refocusBarcode();
      return;
    }

    setCart(
      (current) =>
        current.map(
          (item) =>
            item.id === lineId
              ? {
                  ...item,
                  quantity:
                    Math.max(
                      1,
                      Math.min(
                        99,
                        requested,
                      ),
                    ),
                }
              : item,
        ),
    );

    setError("");
    refocusBarcode();
  }

  function removeLine(
    lineId: string,
  ) {
    setCart(
      (current) =>
        current.filter(
          (line) =>
            line.id !== lineId,
        ),
    );

    refocusBarcode();
  }

  async function createOrder() {
    setError("");
    setMessage("");

    if (
      !customerName.trim()
    ) {
      setError(
        "أدخل اسم الزبون.",
      );
      return;
    }

    if (
      !customerPhone.trim()
    ) {
      setError(
        "أدخل رقم هاتف الزبون.",
      );
      return;
    }

    if (
      !shippingZone
    ) {
      setError(
        "اختر منطقة التوصيل.",
      );
      return;
    }

    if (
      shippingZone !==
        "استلام من المحل" &&
      !customerAddress.trim()
    ) {
      setError(
        "أدخل عنوان التوصيل.",
      );
      return;
    }

    if (
      cart.length === 0
    ) {
      setError(
        "امسح صنفًا واحدًا على الأقل.",
      );
      refocusBarcode();
      return;
    }

    for (
      const line of cart
    ) {
      if (
        !selectionIsComplete(
          line,
        )
      ) {
        setError(
          `اختر اللون والمقاس للمنتج ${line.product.nameAr}.`,
        );
        return;
      }

      const availability =
        getLineAvailability(
          line,
        );

      if (
        availability
          .outOfStock ||
        (
          availability
            .stock !==
            null &&
          line.quantity >
            availability.stock
        )
      ) {
        setError(
          `الكمية المطلوبة من ${line.product.nameAr} غير متوفرة.`,
        );
        return;
      }
    }

    const confirmed =
      window.confirm(
        `إنشاء طلب توصيل للزبون ${customerName.trim()} بعدد ${itemCount} قطعة؟\nسيتم خصم المخزون وتطبيق عروض المتجر تلقائيًا.`,
      );

    if (!confirmed) {
      return;
    }

    const requestKey =
      idempotencyKeyRef
        .current ??
      `manual_order_${createKey()}`;

    idempotencyKeyRef.current =
      requestKey;

    setSubmitBusy(true);

    try {
      const result =
        await createManualOnlineOrder(
          token,
          {
            idempotencyKey:
              requestKey,
            customerName:
              customerName.trim(),
            customerPhone:
              customerPhone.trim(),
            customerAddress:
              shippingZone ===
              "استلام من المحل"
                ? "استلام من المحل"
                : customerAddress.trim(),
            notes:
              notes.trim() ||
              undefined,
            shippingZone,
            totalPrice:
              Math.round(
                previewTotal,
              ),
            shippingCost:
              Math.round(
                previewShippingCost,
              ),
            paymentMethod:
              "cod",
            items:
              cart.map(
                (line) => ({
                  id:
                    line.product
                      .productId,
                  name:
                    line.product
                      .nameAr,
                  price:
                    line.product
                      .websiteUnitPrice,
                  quantity:
                    line.quantity,
                  image:
                    line.product
                      .image ||
                    undefined,
                  color:
                    line.color ||
                    undefined,
                  size:
                    line.size ||
                    undefined,
                }),
              ),
          },
        );

      idempotencyKeyRef.current =
        null;

      setLastOrder(
        result,
      );

      setCart([]);
      setSearchResults([]);
      barcodeValueRef.current = "";
      setBarcode("");
      setCustomerName("");
      setCustomerPhone("");
      setCustomerAddress("");
      setNotes("");

      setMessage(
        `تم إنشاء الطلب #${result.id} بنجاح وخصم المخزون.`,
      );

      refocusBarcode();
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
        errorMessage(caught),
      );
    } finally {
      setSubmitBusy(false);
    }
  }

  return (
    <main
      className="mobile-pos-page manual-order-page"
      dir="rtl"
    >
      <div className="mobile-pos-shell manual-order-shell">
        <header className="mobile-pos-header">
          <div>
            <strong>Lovely Kids</strong>
            <span>إنشاء طلب يدوي</span>
          </div>

          <div className="mobile-pos-header-actions">
            <span className="mobile-pos-online">
              ● {user?.name ?? "الإدارة"}
            </span>

            <Link to="/sales/mobile">
              رجوع
            </Link>
          </div>
        </header>

        <section className="manual-order-customer-card">
          <div className="manual-order-section-title">
            <div>
              <strong>بيانات الزبون</strong>
              <small>
                طلب واتساب بنفس آلية طلب المتجر الإلكتروني
              </small>
            </div>
          </div>

          <div className="manual-order-fields">
            <label>
              <span>اسم الزبون</span>
              <input
                value={customerName}
                onChange={(event) =>
                  setCustomerName(
                    event.target.value,
                  )
                }
                autoComplete="name"
                placeholder="الاسم"
              />
            </label>

            <label>
              <span>رقم الهاتف</span>
              <input
                dir="ltr"
                value={customerPhone}
                onChange={(event) =>
                  setCustomerPhone(
                    event.target.value,
                  )
                }
                inputMode="tel"
                autoComplete="tel"
                placeholder="05..."
              />
            </label>

            <label className="manual-order-field-wide">
              <span>منطقة التوصيل</span>
              <select
                value={shippingZone}
                onChange={(event) =>
                  setShippingZone(
                    event.target.value,
                  )
                }
              >
                {shippingZones.map(
                  (zone) => (
                    <option
                      value={zone.label}
                      key={zone.label}
                    >
                      {zone.label} — {zone.cost} ₪
                    </option>
                  ),
                )}

                <option value="استلام من المحل">
                  استلام من المحل
                </option>
              </select>
            </label>

            {shippingZone !==
              "استلام من المحل" && (
              <label className="manual-order-field-wide">
                <span>عنوان التوصيل</span>
                <textarea
                  value={customerAddress}
                  onChange={(event) =>
                    setCustomerAddress(
                      event.target.value,
                    )
                  }
                  rows={2}
                  placeholder="المدينة / المنطقة / الشارع / تفاصيل العنوان"
                />
              </label>
            )}

            <label className="manual-order-field-wide">
              <span>ملاحظات</span>
              <textarea
                value={notes}
                onChange={(event) =>
                  setNotes(
                    event.target.value,
                  )
                }
                rows={2}
                placeholder="اختياري"
              />
            </label>
          </div>
        </section>

        <section className="mobile-pos-scan-card manual-order-scan-card">
          <div className="manual-order-section-title">
            <div>
              <strong>إضافة الأصناف</strong>
              <small>
                امسح الباركود بالفرد ثم اضغط Enter تلقائيًا
              </small>
            </div>
            <span>🔫</span>
          </div>

          <form
            className="mobile-pos-search manual-order-barcode-form"
            onSubmit={
              handleBarcodeSubmit
            }
          >
            <input
              ref={barcodeInputRef}
              dir="ltr"
              value={barcode}
              onChange={(event) => {
                const value =
                  event.target.value;

                barcodeValueRef.current =
                  value;
                setBarcode(value);
              }}
              onKeyDown={
                handleBarcodeKeyDown
              }
              placeholder="امسح الباركود هنا"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              lang="en"
              inputMode="text"
            />

            <button
              type="submit"
              disabled={lookupBusy}
            >
              {lookupBusy
                ? "..."
                : "إضافة"}
            </button>
          </form>

          <small className="manual-order-barcode-hint">
            يعمل فرد الباركود حتى لو كانت لوحة مفاتيح ويندوز عربية. بعد كل إضافة يرجع المؤشر تلقائيًا للخانة، ومسح نفس القطعة مرة ثانية يزيد الكمية.
          </small>

          {searchResults.length >
            0 && (
            <div className="mobile-pos-search-results">
              {searchResults.map(
                (product) => (
                  <button
                    type="button"
                    key={`${product.productId}-${product.barcode ?? ""}`}
                    onClick={() =>
                      addProductToCart(
                        product,
                      )
                    }
                  >
                    <span>
                      {product.nameAr}
                    </span>

                    <strong>
                      {formatMoney(
                        product.websiteUnitPrice,
                      )}
                    </strong>
                  </button>
                ),
              )}
            </div>
          )}
        </section>

        {error && (
          <div className="mobile-pos-alert mobile-pos-error">
            {error}
          </div>
        )}

        {message && (
          <div className="mobile-pos-alert mobile-pos-success">
            {message}
          </div>
        )}

        {lastOrder && (
          <section className="mobile-pos-last-sale">
            <div className="mobile-pos-last-sale-icon">
              ✓
            </div>

            <div>
              <strong>
                تم إنشاء الطلب #{lastOrder.id}
              </strong>
              <span>
                الحالة: {lastOrder.status}
              </span>
            </div>

            <strong>
              {formatMoney(
                lastOrder.totalPrice,
              )}
            </strong>
          </section>
        )}

        <section className="mobile-pos-cart">
          <div className="mobile-pos-cart-title">
            <strong>الأصناف</strong>
            <span>
              {itemCount} قطعة
            </span>
          </div>

          {cart.length === 0 ? (
            <div className="mobile-pos-empty-cart">
              <span>🔫</span>
              <strong>
                لم يتم مسح أصناف بعد
              </strong>
              <small>
                مرّر فرد الباركود على أول قطعة
              </small>
            </div>
          ) : (
            <div className="mobile-pos-cart-lines">
              {cart.map(
                (line) => {
                  const colors =
                    getColors(
                      line.product,
                    );

                  const sizes =
                    getSizes(
                      line.product,
                      line.color,
                    );

                  const availability =
                    getLineAvailability(
                      line,
                    );

                  return (
                    <article
                      className="mobile-pos-line"
                      key={line.id}
                    >
                      <div className="mobile-pos-line-top">
                        <div>
                          <strong>
                            {line.product.nameAr}
                          </strong>

                          <small dir="ltr">
                            {line.barcode ||
                              line.product.productCode ||
                              line.product.productId}
                          </small>
                        </div>

                        <button
                          className="mobile-pos-remove"
                          type="button"
                          onClick={() =>
                            removeLine(
                              line.id,
                            )
                          }
                          aria-label={`حذف ${line.product.nameAr}`}
                        >
                          ×
                        </button>
                      </div>

                      {(colors.length >
                        0 ||
                        sizes.length >
                          0) && (
                        <div className="mobile-pos-variants">
                          {colors.length >
                            0 && (
                            <select
                              value={
                                line.color ??
                                ""
                              }
                              onChange={(
                                event,
                              ) =>
                                changeColor(
                                  line,
                                  event
                                    .target
                                    .value,
                                )
                              }
                            >
                              <option value="">
                                اختر اللون
                              </option>

                              {colors.map(
                                (
                                  color,
                                ) => (
                                  <option
                                    key={
                                      color
                                    }
                                    value={
                                      color
                                    }
                                  >
                                    {color}
                                  </option>
                                ),
                              )}
                            </select>
                          )}

                          {sizes.length >
                            0 && (
                            <select
                              value={
                                line.size ??
                                ""
                              }
                              onChange={(
                                event,
                              ) =>
                                changeSize(
                                  line.id,
                                  event
                                    .target
                                    .value,
                                )
                              }
                            >
                              <option value="">
                                اختر المقاس
                              </option>

                              {sizes.map(
                                (
                                  size,
                                ) => (
                                  <option
                                    key={
                                      size
                                    }
                                    value={
                                      size
                                    }
                                  >
                                    {size}
                                  </option>
                                ),
                              )}
                            </select>
                          )}
                        </div>
                      )}

                      <div className="mobile-pos-line-bottom">
                        <div className="manual-order-line-price">
                          <span>
                            سعر المتجر
                          </span>
                          <strong>
                            {formatMoney(
                              line
                                .product
                                .websiteUnitPrice,
                            )}
                          </strong>

                          {availability.stock !==
                            null && (
                            <small>
                              متوفر: {availability.stock}
                            </small>
                          )}
                        </div>

                        <div className="mobile-pos-quantity">
                          <button
                            type="button"
                            onClick={() =>
                              changeQuantity(
                                line.id,
                                -1,
                              )
                            }
                          >
                            −
                          </button>

                          <span>
                            {line.quantity}
                          </span>

                          <button
                            type="button"
                            onClick={() =>
                              changeQuantity(
                                line.id,
                                1,
                              )
                            }
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                },
              )}
            </div>
          )}
        </section>

        <footer className="mobile-pos-checkout manual-order-checkout">
          <div className="mobile-pos-checkout-details">
            <div className="mobile-pos-checkout-row">
              <span>
                مجموع الأصناف
              </span>
              <strong>
                {formatMoney(
                  subtotal,
                )}
              </strong>
            </div>

            <div className="mobile-pos-checkout-row">
              <span>
                التوصيل المبدئي
              </span>
              <strong>
                {formatMoney(
                  previewShippingCost,
                )}
              </strong>
            </div>

            <div className="mobile-pos-final-total">
              <span>
                إجمالي مبدئي
              </span>
              <strong>
                {formatMoney(
                  previewTotal,
                )}
              </strong>
            </div>

            <small className="manual-order-total-note">
              عند الإنشاء يثبت السيرفر السعر النهائي ويطبق عروض الأصناف وعرض التوصيل بنفس آلية المتجر.
            </small>
          </div>

          <button
            type="button"
            disabled={
              submitBusy ||
              cart.length === 0
            }
            onClick={() =>
              void createOrder()
            }
          >
            {submitBusy
              ? "جاري إنشاء الطلب..."
              : "إنشاء الطلب"}
          </button>
        </footer>
      </div>
    </main>
  );
}
