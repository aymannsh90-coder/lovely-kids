import CustomerPicker from "./components/CustomerPicker";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { QRCodeSVG } from "qrcode.react";

import {
  captureScannerKeyboardEvent,
  createScannerKeyboardBuffer,
} from "./lib/scannerKeyboard";

import { printReceiptElementDirect } from "./lib/directReceiptPrint";

import {
  ApiError,
  createPosSale,
  createPosCustomerReceipt,
  getCurrentCashSession,
  getPosCustomers,
  getPosSaleCashCurrencies,
  lookupPosProductByBarcode,
  previewPosPromotions,
  searchPosProducts,
  type CashSession,
  type PosCustomer,
  type PosProductLookup,
  type PosSaleCashCurrency,
  type PosSaleResult,
  type PromotionPreviewResult,
} from "./lib/api";

interface CartLine {
  id: string;
  barcode: string;
  product: PosProductLookup;
  color: string | null;
  size: string | null;
  quantity: number;
  soldUnitPrice: string;
}

type LineField = "color" | "size" | "quantity" | "price";

interface SalePanelProps {
  token: string;
  session: CashSession;
  cashierName: string;
  onSessionChange: (session: CashSession) => void;
  onUnauthorized: () => void;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "حدث خطأ غير متوقع";
}

function createKey() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function moneyToMinor(value: string) {
  const amount = Number(value.trim().replace(",", "."));

  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  return Math.round(amount * 100);
}

function rateToMicros(
  value: string,
) {
  const normalized =
    value
      .trim()
      .replace(",", ".");

  const match =
    /^(\d+)(?:\.(\d{1,6}))?$/.exec(
      normalized,
    );

  if (!match) {
    return null;
  }

  const micros =
    Number(match[1]) *
      1_000_000 +
    Number(
      (match[2] ?? "")
        .padEnd(6, "0"),
    );

  return Number.isSafeInteger(
    micros,
  ) &&
    micros > 0
    ? micros
    : null;
}

function convertedMinor(
  currencyAmountMinor: number,
  rateMicros: number,
) {
  const rounded =
    (
      BigInt(
        currencyAmountMinor,
      ) *
        BigInt(
          rateMicros,
        ) +
      500_000n
    ) /
    1_000_000n;

  return Number(rounded);
}

function formatMinor(value: number) {
  const amount = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);

  return `${amount}\u00A0₪`;
}

function getColors(product: PosProductLookup) {
  return product.colorVariants.map((variant) => variant.color);
}

function getSizes(product: PosProductLookup, color: string | null) {
  if (product.colorVariants.length > 0) {
    const variant = product.colorVariants.find(
      (entry) => entry.color === color,
    );

    return variant?.sizes.map((entry) => entry.size) ?? [];
  }

  return product.sizes;
}

function getBarcodeForSelection(
  product: PosProductLookup,
  color: string | null,
  size: string | null,
) {
  const exactBarcode =
    product.barcodes?.find(
      (entry) =>
        entry.color === color &&
        entry.size === size,
    )?.barcode ?? null;

  if (exactBarcode) {
    return exactBarcode;
  }

  return product.primaryBarcode?.trim() ?? "";
}

function getLineAvailability(line: CartLine) {
  if (line.product.colorVariants.length > 0 && line.color) {
    const variant = line.product.colorVariants.find(
      (entry) => entry.color === line.color,
    );

    if (line.size) {
      const size = variant?.sizes.find((entry) => entry.size === line.size);

      return {
        stock: size?.stock ?? null,
        outOfStock: !!size?.outOfStock,
      };
    }
  }

  return {
    stock: line.product.stock,
    outOfStock: line.product.outOfStock,
  };
}

function selectionIsComplete(line: CartLine) {
  if (line.product.colorVariants.length > 0) {
    if (!line.color) return false;

    const sizes = getSizes(line.product, line.color);

    if (sizes.length > 0 && !line.size) {
      return false;
    }
  } else if (line.product.sizes.length > 0 && !line.size) {
    return false;
  }

  return true;
}

function bidiSafePromotionLabel(label: string) {
  return label.replace(
    /\d+\s*\+\s*\d+/g,
    (value) => `\u2066${value}\u2069`,
  );
}

type VisaBankProcessor = "arab" | "bop";

/** One visual component for regular sales and customer-balance settlement.
 * Keep payment state/dispatch owned by SalePanel so financial logic is unchanged.
 */
function VisaBankButton({
  bank,
  selected,
  onClick,
}: {
  bank: VisaBankProcessor;
  selected: boolean;
  onClick: () => void;
}) {
  const [logoSourceIndex, setLogoSourceIndex] = useState(0);
  const isArab = bank === "arab";
  const bankName = isArab ? "البنك العربي" : "بنك فلسطين";
  const bopLogoSources = [
    "https://www.sibos.com/sites/default/files/styles/large/public/partner_portal/2026-06/BankofPalestine-logo%202026.png?itok=SGYZ9J0q",
    "https://upload.wikimedia.org/wikipedia/commons/1/1c/Logo_de_Bank_of_Palestine.jpg",
  ];

  return (
    <button
      type="button"
      className={`sale-bank-visa-button sale-bank-visa-button--${bank}${selected ? " is-selected" : ""}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span className="sale-bank-visa-button__logo" aria-hidden="true">
        {isArab ? (
          <img src="/brand-arab-bank.svg" alt="" width={52} height={30} />
        ) : logoSourceIndex < bopLogoSources.length ? (
          <img
            src={bopLogoSources[logoSourceIndex]}
            alt=""
            width={29}
            height={29}
            onError={() => setLogoSourceIndex((index) => Math.min(index + 1, bopLogoSources.length))}
          />
        ) : (
          <span className="sale-bank-visa-button__logo-fallback">بنك فلسطين</span>
        )}
      </span>
      <span className="sale-bank-visa-button__label">فيزا {bankName}</span>
    </button>
  );
}

export default function SalePanel({
  token,
  session,
  cashierName,
  onSessionChange,
  onUnauthorized,
}: SalePanelProps) {
  const directReceiptRef = useRef<HTMLElement>(null);
  const printAfterSaleRef = useRef(false);

  async function handleDirectReceiptPrint() {
    const source = directReceiptRef.current;

    if (!source) {
      window.alert("تعذر تجهيز الإيصال للطباعة.");
      return;
    }

    try {
      await printReceiptElementDirect(source);
    } catch (caught) {
      window.alert(errorMessage(caught));
    }
  }

  const barcodeInput = useRef<HTMLInputElement>(null);

  const scannerKeyboard = useRef(
    createScannerKeyboardBuffer(),
  );

  const scannerSubmitValue = useRef<string | null>(
    null,
  );

  const idempotencyKey = useRef<string | null>(null);

  const settlementIdempotencyKey =
    useRef<string | null>(null);

  function focusBarcodeField() {
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        barcodeInput.current?.focus({ preventScroll: true });
        barcodeInput.current?.select();
      }, 0);
    });
  }

  function getLineField(lineId: string, field: LineField) {
    return document.querySelector<HTMLInputElement | HTMLSelectElement>(
      `[data-line-id="${lineId}"][data-line-field="${field}"]`,
    );
  }

  function focusLineField(lineId: string, field: LineField) {
    window.setTimeout(() => {
      const element = getLineField(lineId, field);

      if (!element || element.disabled) {
        focusBarcodeField();
        return;
      }

      element.focus();

      if (element instanceof HTMLInputElement) {
        element.select();
      }
    }, 0);
  }

  function moveAfterEnter(
    event: KeyboardEvent<HTMLElement>,
    lineId: string,
    nextField: LineField | "barcode",
  ) {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();

    if (nextField === "barcode") {
      focusBarcodeField();
      return;
    }

    focusLineField(lineId, nextField);
  }

  const [barcode, setBarcode] = useState("");

  const [searchResults, setSearchResults] = useState<PosProductLookup[]>([]);

  const [searchOpen, setSearchOpen] = useState(false);

  const [searchBusy, setSearchBusy] = useState(false);

  const [activeSearchIndex, setActiveSearchIndex] = useState(0);

  const [cart, setCart] = useState<CartLine[]>([]);

  const [
    promotionPreview,
    setPromotionPreview,
  ] = useState<PromotionPreviewResult | null>(null);

  const [
    promotionPreviewBusy,
    setPromotionPreviewBusy,
  ] = useState(false);

  const [
    promotionPreviewError,
    setPromotionPreviewError,
  ] = useState("");

  const [discountAmount, setDiscountAmount] = useState("");

  const [paidAmount, setPaidAmount] = useState("0.00");

  const [
    cashCurrencies,
    setCashCurrencies,
  ] = useState<
    PosSaleCashCurrency[]
  >([]);

  const [
    cashCurrencyCode,
    setCashCurrencyCode,
  ] = useState("ILS");

  const [
    cashExchangeRate,
    setCashExchangeRate,
  ] = useState("1");

  const [paymentMethod, setPaymentMethod] =
    useState<
      | "cash"
      | "card"
      | "credit"
      | "mixed"
    >("cash");

  const [
    cardProcessor,
    setCardProcessor,
  ] = useState<
    | "arab"
    | "bop"
    | null
  >(null);

  const [customers, setCustomers] =
    useState<PosCustomer[]>([]);

  const [
    customersBusy,
    setCustomersBusy,
  ] = useState(false);

  const [
    customersError,
    setCustomersError,
  ] = useState("");

  const [
    selectedCustomerId,
    setSelectedCustomerId,
  ] = useState("");

  const [customerName, setCustomerName] = useState("");

  const [customerPhone, setCustomerPhone] = useState("");

  const [
    settlementAmount,
    setSettlementAmount,
  ] = useState("0.00");

  const [
    settlementMethod,
    setSettlementMethod,
  ] = useState<
    | "cash"
    | "card"
  >("cash");

  const [
    settlementCardProcessor,
    setSettlementCardProcessor,
  ] = useState<
    | "arab"
    | "bop"
    | null
  >(null);

  const [notes, setNotes] = useState("");

  const [lookupBusy, setLookupBusy] = useState(false);

  const [saleBusy, setSaleBusy] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [lastSale, setLastSale] = useState<PosSaleResult | null>(null);

  useEffect(() => {
    if (!lastSale || !printAfterSaleRef.current) {
      return;
    }

    printAfterSaleRef.current = false;

    const frame = window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        void handleDirectReceiptPrint();
      }, 0);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [lastSale]);

  const subtotalMinor = useMemo(
    () =>
      cart.reduce((total, line) => {
        const price = moneyToMinor(line.soldUnitPrice) ?? 0;

        return total + price * line.quantity;
      }, 0),
    [cart],
  );

  useEffect(() => {
    if (cart.length === 0) {
      setPromotionPreview(null);
      setPromotionPreviewError("");
      setPromotionPreviewBusy(false);
      return;
    }

    let cancelled = false;

    const timer = window.setTimeout(() => {
      const previewItems = cart.map((line) => ({
        key: line.id,
        productId: line.product.productId,
        quantity: line.quantity,
        unitPriceMinor:
          moneyToMinor(line.soldUnitPrice) ?? 0,
      }));

      setPromotionPreviewBusy(true);
      setPromotionPreviewError("");

      void previewPosPromotions(
        token,
        previewItems,
      )
        .then((result) => {
          if (cancelled) return;
          setPromotionPreview(result);
        })
        .catch((caught) => {
          if (cancelled) return;

          if (
            caught instanceof ApiError &&
            caught.status === 401
          ) {
            onUnauthorized();
            return;
          }

          setPromotionPreview(null);
          setPromotionPreviewError(
            errorMessage(caught),
          );
        })
        .finally(() => {
          if (!cancelled) {
            setPromotionPreviewBusy(false);
          }
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    cart,
    token,
    onUnauthorized,
  ]);

  const promotionDiscountMinor =
    promotionPreview?.totalDiscountMinor ?? 0;

  const promotionLineByKey =
    useMemo(
      () =>
        new Map(
          (promotionPreview?.lines ?? []).map(
            (line) => [
              line.key,
              line,
            ],
          ),
        ),
      [promotionPreview],
    );

  const discountMinor = moneyToMinor(discountAmount) ?? 0;

  const totalMinor = Math.max(
    0,
    subtotalMinor -
      promotionDiscountMinor -
      discountMinor,
  );

  const tenderPaidMinor =
    moneyToMinor(
      paidAmount,
    ) ?? 0;

  const selectedCashCurrency =
    useMemo(
      () =>
        cashCurrencies.find(
          (currency) =>
            currency.code ===
            cashCurrencyCode,
        ) ?? null,
      [
        cashCurrencies,
        cashCurrencyCode,
      ],
    );

  const cashRateMicros =
    cashCurrencyCode === "ILS"
      ? 1_000_000
      : rateToMicros(
          cashExchangeRate,
        );

  const paidMinor =
    paymentMethod === "cash" &&
    cashCurrencyCode !== "ILS" &&
    cashRateMicros
      ? convertedMinor(
          tenderPaidMinor,
          cashRateMicros,
        )
      : tenderPaidMinor;

  const changeMinor =
    Math.max(
      0,
      paidMinor - totalMinor,
    );

  const accountDueMinor =
    paymentMethod === "credit"
      ? totalMinor
      : paymentMethod === "mixed"
        ? Math.max(
            0,
            totalMinor -
              paidMinor,
          )
        : 0;

  useEffect(() => {
    barcodeInput.current?.focus();
  }, []);

  useEffect(() => {
    if (
      paymentMethod === "credit"
    ) {
      setCashCurrencyCode(
        "ILS",
      );
      setCashExchangeRate(
        "1",
      );
      setPaidAmount("0.00");

      setSettlementAmount(
        (totalMinor / 100).toFixed(2),
      );

      return;
    }

    if (
      paymentMethod === "mixed"
    ) {
      setCashCurrencyCode(
        "ILS",
      );
      setCashExchangeRate(
        "1",
      );
      setPaidAmount("0.00");
      return;
    }

    if (
      paymentMethod === "card"
    ) {
      setCashCurrencyCode(
        "ILS",
      );
      setCashExchangeRate(
        "1",
      );
      setPaidAmount(
        (totalMinor / 100).toFixed(2),
      );
      return;
    }

    if (
      cashCurrencyCode ===
        "ILS"
    ) {
      setPaidAmount(
        (totalMinor / 100).toFixed(2),
      );
    }
  }, [
    totalMinor,
    paymentMethod,
    cashCurrencyCode,
  ]);

  const customerIdFromQuery =
    new URLSearchParams(
      window.location.search,
    ).get("customerId");

  const accountFromQuery =
    new URLSearchParams(
      window.location.search,
    ).get("account") === "1";

  useEffect(() => {
    if (
      !customerIdFromQuery ||
      customers.length === 0
    ) {
      return;
    }

    const customer =
      customers.find(
        (item) =>
          String(item.id) ===
          customerIdFromQuery,
      );

    if (!customer) {
      return;
    }

    setSelectedCustomerId(
      String(customer.id),
    );

    setCustomerName(
      customer.name,
    );

    setCustomerPhone(
      customer.phone ?? "",
    );

    if (accountFromQuery) {
      setPaymentMethod(
        "credit",
      );
    }
  }, [
    customerIdFromQuery,
    accountFromQuery,
    customers,
  ]);

  useEffect(() => {
    let active = true;

    setCustomersBusy(true);
    setCustomersError("");

    void getPosCustomers(
      token,
      {
        status: "active",
      },
    )
      .then((response) => {
        if (!active) {
          return;
        }

        setCustomers(
          response.results,
        );
      })
      .catch((caught) => {
        if (!active) {
          return;
        }

        if (
          caught instanceof ApiError &&
          caught.status === 401
        ) {
          onUnauthorized();
          return;
        }

        setCustomersError(
          errorMessage(caught),
        );
      })
      .finally(() => {
        if (active) {
          setCustomersBusy(false);
        }
      });

    return () => {
      active = false;
    };
  }, [
    token,
    onUnauthorized,
  ]);

  useEffect(() => {
    let active = true;

    void getPosSaleCashCurrencies(
      token,
    )
      .then((response) => {
        if (!active) {
          return;
        }

        setCashCurrencies(
          response.currencies,
        );

        const defaultCurrency =
          response.currencies.find(
            (currency) =>
              currency.code ===
              response.defaultCurrencyCode,
          ) ??
          response.currencies.find(
            (currency) =>
              currency.code ===
              "ILS",
          ) ??
          null;

        if (
          defaultCurrency &&
          cashCurrencyCode ===
            "ILS"
        ) {
          setCashCurrencyCode(
            defaultCurrency.code,
          );
          setCashExchangeRate(
            defaultCurrency.latestRate
              ? String(
                  defaultCurrency.latestRate,
                )
              : "1",
          );
        }
      })
      .catch((caught) => {
        if (!active) {
          return;
        }

        if (
          caught instanceof ApiError &&
          caught.status === 401
        ) {
          onUnauthorized();
        }
      });

    return () => {
      active = false;
    };
  }, [
    token,
    onUnauthorized,
  ]);

  function clearProductSearch() {
    setSearchResults([]);
    setSearchOpen(false);
    setSearchBusy(false);
    setActiveSearchIndex(0);
  }

  function addProductToCart(product: PosProductLookup) {
    const colors = getColors(product);

    const color =
      product.mappedColor ?? (colors.length === 1 ? colors[0] : null);

    const sizes = getSizes(product, color);

    const size = product.mappedSize ?? (sizes.length === 1 ? sizes[0] : null);

    const needsColor = colors.length > 0 && !color;

    const needsSize = !needsColor && sizes.length > 0 && !size;

    const selectionComplete = !needsColor && !needsSize;

    const existingIndex = selectionComplete
      ? cart.findIndex(
          (line) =>
            line.product.productId === product.productId &&
            line.barcode === (product.barcode ?? "") &&
            line.color === color &&
            line.size === size,
        )
      : -1;

    let focusTarget: {
      lineId: string;
      field: LineField;
    } | null = null;

    if (existingIndex >= 0) {
      const existingLine = cart[existingIndex];

      setCart(
        cart.map((line, index) =>
          index === existingIndex
            ? {
                ...line,
                quantity: line.quantity + 1,
              }
            : line,
        ),
      );

      setMessage(`تمت زيادة كمية ${product.nameAr}`);

      focusTarget = {
        lineId: existingLine.id,
        field: "quantity",
      };
    } else {
      const lineId = createKey();

      setCart([
        ...cart,
        {
          id: lineId,
          barcode: product.barcode ?? "",
          product,
          color,
          size,
          quantity: 1,
          soldUnitPrice: product.websiteUnitPrice.toFixed(2),
        },
      ]);

      setMessage(`تمت إضافة ${product.nameAr}`);

      if (needsColor) {
        focusTarget = {
          lineId,
          field: "color",
        };
      } else if (needsSize) {
        focusTarget = {
          lineId,
          field: "size",
        };
      }
    }

    setBarcode("");
    setError("");
    clearProductSearch();

    if (focusTarget) {
      focusLineField(focusTarget.lineId, focusTarget.field);
    } else {
      focusBarcodeField();
    }
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
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

      scannerSubmitValue.current =
        scannedValue;

      setBarcode(scannedValue);
      clearProductSearch();

      event.currentTarget.form?.requestSubmit();
      return;
    }

    if (event.key === "ArrowDown" && searchResults.length > 0) {
      event.preventDefault();

      setActiveSearchIndex((current) => (current + 1) % searchResults.length);

      return;
    }

    if (event.key === "ArrowUp" && searchResults.length > 0) {
      event.preventDefault();

      setActiveSearchIndex(
        (current) =>
          (current - 1 + searchResults.length) % searchResults.length,
      );

      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      clearProductSearch();
      return;
    }

    if (
      event.key === "Enter" &&
      searchOpen &&
      searchResults[activeSearchIndex]
    ) {
      event.preventDefault();

      addProductToCart(searchResults[activeSearchIndex]);
    }
  }

  async function handleBarcode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const scannerValue =
      scannerSubmitValue.current;

    scannerSubmitValue.current = null;

    const value = (
      scannerValue ?? barcode
    ).trim();

    if (!value) {
      setError("أدخل الباركود أو الكود أو اسم الصنف");

      focusBarcodeField();
      return;
    }

    if (searchOpen && searchResults[activeSearchIndex]) {
      addProductToCart(searchResults[activeSearchIndex]);

      return;
    }

    setLookupBusy(true);
    setError("");
    setMessage("");
    clearProductSearch();

    try {
      const product = await lookupPosProductByBarcode(token, value);

      addProductToCart(product);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        onUnauthorized();
        return;
      }

      if (caught instanceof ApiError && caught.status === 404) {
        setSearchBusy(true);

        try {
          const result = await searchPosProducts(token, value);

          setSearchResults(result.results);

          setActiveSearchIndex(0);

          setSearchOpen(result.results.length > 0);

          if (result.results.length === 0) {
            setError("لم يتم العثور على أصناف مطابقة");
          } else {
            setMessage(
              `تم العثور على ${result.results.length} صنف، اختر الصنف المطلوب`,
            );
          }
        } catch (searchError) {
          if (searchError instanceof ApiError && searchError.status === 401) {
            onUnauthorized();
            return;
          }

          setError(errorMessage(searchError));
        } finally {
          setSearchBusy(false);
        }
      } else {
        setError(errorMessage(caught));
      }
    } finally {
      setLookupBusy(false);
      focusBarcodeField();
    }
  }

  function updateLine(id: string, patch: Partial<CartLine>) {
    setCart((current) =>
      current.map((line) =>
        line.id === id
          ? {
              ...line,
              ...patch,
            }
          : line,
      ),
    );
  }

  function updateVariantSelection(id: string, patch: Partial<CartLine>) {
    const currentLine = cart.find((line) => line.id === id);

    if (!currentLine) {
      return id;
    }

    const updatedLine: CartLine = {
      ...currentLine,
      ...patch,
    };

    const duplicate = selectionIsComplete(updatedLine)
      ? cart.find(
          (line) =>
            line.id !== id &&
            line.barcode === updatedLine.barcode &&
            line.color === updatedLine.color &&
            line.size === updatedLine.size,
        )
      : undefined;

    if (duplicate) {
      setCart(
        cart
          .filter((line) => line.id !== id)
          .map((line) =>
            line.id === duplicate.id
              ? {
                  ...line,
                  quantity: line.quantity + updatedLine.quantity,
                }
              : line,
          ),
      );

      setMessage("تم دمج البند مع نفس اللون والمقاس");

      return duplicate.id;
    }

    setCart(cart.map((line) => (line.id === id ? updatedLine : line)));

    return id;
  }

  function changeColor(line: CartLine, colorValue: string) {
    const color = colorValue || null;

    const sizes = getSizes(line.product, color);

    const size =
      sizes.length === 1
        ? sizes[0]
        : null;

    const targetId = updateVariantSelection(line.id, {
      color,
      size,
      barcode: getBarcodeForSelection(
        line.product,
        color,
        size,
      ),
    });

    focusLineField(targetId, sizes.length > 1 ? "size" : "quantity");
  }

  function changeSize(line: CartLine, sizeValue: string) {
    const size = sizeValue || null;

    const targetId = updateVariantSelection(line.id, {
      size,
      barcode: getBarcodeForSelection(
        line.product,
        line.color,
        size,
      ),
    });

    focusLineField(targetId, "quantity");
  }

  // AUTO_CUSTOMER_ACCOUNT_SELECTION
  // Choosing a registered customer automatically prepares
  // the invoice as a full customer-account sale.
  useEffect(() => {
    if (!selectedCustomerId) {
      return;
    }

    const customer =
      customers.find(
        (item) =>
          String(item.id) ===
          selectedCustomerId,
      );

    if (!customer) {
      return;
    }

    setCustomerName(
      customer.name,
    );

    setCustomerPhone(
      customer.phone ?? "",
    );

    setPaymentMethod(
      "credit",
    );
    setCardProcessor(
      null,
    );
  }, [
    selectedCustomerId,
    customers,
  ]);

  async function completeSale(
    settlement?: {
      amount: string;
      method:
        | "cash"
        | "card";
    },
    printAfter = false,
  ) {
    setError("");
    setMessage("");

    if (cart.length === 0) {
      setError("أضف صنفًا واحدًا على الأقل");
      return;
    }

    for (const line of cart) {
      if (!selectionIsComplete(line)) {
        setError(`اختر اللون والمقاس للمنتج ${line.product.nameAr}`);
        return;
      }

      const price = moneyToMinor(line.soldUnitPrice);

      if (price === null) {
        setError(`سعر بيع ${line.product.nameAr} غير صالح`);
        return;
      }

      if (
        !Number.isSafeInteger(line.quantity) ||
        line.quantity < 1 ||
        line.quantity > 99
      ) {
        setError(`كمية ${line.product.nameAr} غير صالحة`);
        return;
      }

      const availability = getLineAvailability(line);

      if (
        availability.outOfStock ||
        (availability.stock !== null && line.quantity > availability.stock)
      ) {
        setError(`الكمية المطلوبة من ${line.product.nameAr} غير متوفرة`);
        return;
      }
    }

    if (
      discountMinor >
      subtotalMinor -
        promotionDiscountMinor
    ) {
      setError(
        "الخصم اليدوي أكبر من صافي الفاتورة بعد عروض المتجر",
      );
      return;
    }


    if (
      (
        paymentMethod === "credit" ||
        paymentMethod === "mixed"
      ) &&
      !selectedCustomerId
    ) {
      setError(
        "يجب اختيار زبون للبيع على الحساب",
      );
      return;
    }

    if (
      paymentMethod === "cash" &&
      cashCurrencyCode !== "ILS"
    ) {
      if (
        !selectedCashCurrency ||
        !selectedCashCurrency.cashAccountId
      ) {
        setError(
          "صندوق العملة المختارة غير متاح.",
        );
        return;
      }

      if (
        !selectedCashCurrency.cashSessionId ||
        selectedCashCurrency.cashSessionBusinessDate !==
          session.businessDate
      ) {
        setError(
          `يجب فتح جلسة صندوق ${cashCurrencyCode} لليوم الحالي أولًا.`,
        );
        return;
      }

      if (!cashRateMicros) {
        setError(
          "أدخل سعر صرف صحيحًا للعملة المختارة.",
        );
        return;
      }

      if (tenderPaidMinor <= 0) {
        setError(
          "أدخل المبلغ المستلم بالعملة الأجنبية.",
        );
        return;
      }
    }

    if (
      paymentMethod === "cash" &&
      paidMinor < totalMinor
    ) {
      setError(
        "المبلغ المدفوع أقل من قيمة الفاتورة",
      );
      return;
    }

    if (
      paymentMethod === "card" &&
      !cardProcessor
    ) {
      setError(
        "اختر ماكينة الفيزا: البنك العربي أو بنك فلسطين",
      );
      return;
    }

    if (
      paymentMethod === "card" &&
      paidMinor !== totalMinor
    ) {
      setError(
        "مبلغ الفيزا يجب أن يساوي قيمة الفاتورة",
      );
      return;
    }

    if (
      paymentMethod === "credit" &&
      paidMinor !== 0
    ) {
      setError(
        "البيع الآجل يجب أن يكون بدون دفعة",
      );
      return;
    }

    if (
      paymentMethod === "mixed" &&
      (
        paidMinor <= 0 ||
        paidMinor >= totalMinor
      )
    ) {
      setError(
        "أدخل دفعة نقدية أكبر من صفر وأقل من قيمة الفاتورة",
      );
      return;
    }

    if (settlement) {
      if (
        paymentMethod !==
          "credit" ||
        !selectedCustomerId
      ) {
        setError(
          "التسديد المباشر متاح فقط لفاتورة زبون على الحساب",
        );
        return;
      }

      const settleMinor =
        moneyToMinor(
          settlement.amount,
        );

      if (
        settleMinor === null ||
        settleMinor <= 0
      ) {
        setError(
          "قيمة التسديد غير صالحة",
        );
        return;
      }

      if (
        settlement.method ===
          "cash" &&
        !session
      ) {
        setError(
          "يجب فتح الصندوق لتسجيل دفعة نقدية",
        );
        return;
      }

      if (
        settlement.method ===
          "card" &&
        !settlementCardProcessor
      ) {
        setError(
          "اختر ماكينة الفيزا لتسديد حساب الزبون",
        );
        return;
      }
    }

    const confirmed = window.confirm(
      `إتمام البيع بقيمة ${formatMinor(totalMinor)} وخصم المخزون؟`,
    );

    if (!confirmed) return;

    const requestKey = idempotencyKey.current ?? `pos_${createKey()}`;

    idempotencyKey.current = requestKey;
    setSaleBusy(true);

    try {
      const result = await createPosSale(token, {
        registerKey: session.registerKey,

        idempotencyKey: requestKey,
        paymentMethod,
        cardProcessor:
          paymentMethod === "card"
            ? cardProcessor ??
              undefined
            : undefined,

        cashCurrencyCode:
          paymentMethod === "cash"
            ? cashCurrencyCode
            : "ILS",

        cashExchangeRate:
          paymentMethod === "cash" &&
          cashCurrencyCode !== "ILS"
            ? cashExchangeRate.trim()
            : undefined,

        discountAmount: discountAmount.trim(),

        paidAmount: paidAmount.trim(),

        customerId:
          selectedCustomerId
            ? Number(
                selectedCustomerId,
              )
            : undefined,

        customerName: customerName.trim() || undefined,

        customerPhone: customerPhone.trim() || undefined,

        notes: notes.trim() || undefined,

        items: cart.map((line) => ({
          productId: line.product.productId,
          barcode: line.barcode || undefined,
          quantity: line.quantity,

          soldUnitPrice: line.soldUnitPrice.trim(),

          color: line.color ?? undefined,

          size: line.size ?? undefined,
        })),
      });

      if (settlement) {
        const receiptKey =
          settlementIdempotencyKey.current ??
          `customer_receipt_${createKey()}`;

        settlementIdempotencyKey.current =
          receiptKey;

        await createPosCustomerReceipt(
          token,
          Number(
            selectedCustomerId,
          ),
          {
            amount:
              settlement.amount,

            paymentMethod:
              settlement.method,

            cardProcessor:
              settlement.method ===
                "card"
                ? settlementCardProcessor ??
                  undefined
                : undefined,

            registerKey:
              session.registerKey,

            notes:
              `تسديد مع الفاتورة ${result.sale.publicId}`,

            idempotencyKey:
              receiptKey,
          },
        );

        settlementIdempotencyKey.current =
          null;
      }

      idempotencyKey.current = null;
      printAfterSaleRef.current = printAfter;
      setLastSale(result);
      setCart([]);
      setDiscountAmount("");
      setCashCurrencyCode("ILS");
      setCashExchangeRate("1");
      setPaymentMethod("cash");
      setCardProcessor(null);
      setSelectedCustomerId("");
      setSettlementAmount("0.00");
      setSettlementMethod("cash");
      setSettlementCardProcessor(
        null,
      );
      setCustomerName("");
      setCustomerPhone("");
      setNotes("");

      setMessage(
        result.alreadyCreated
          ? "تم تحميل الفاتورة المحفوظة دون تكرار الخصم."
          : `تم حفظ الفاتورة ${result.sale.publicId} وخصم المخزون.`,
      );

      const current = await getCurrentCashSession(token, session.registerKey);

      if (current.session) {
        onSessionChange(current.session);
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        onUnauthorized();
        return;
      }

      setError(errorMessage(caught));
    } finally {
      setSaleBusy(false);
    }
  }

  useEffect(() => {
    function handleSaleShortcut(event: globalThis.KeyboardEvent) {
      const isSaveShortcut =
        event.key === "F3";
      const isPrintShortcut =
        event.key === "F4";

      if (
        (!isSaveShortcut && !isPrintShortcut) ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }

      event.preventDefault();

      if (saleBusy || cart.length === 0) {
        return;
      }

      if (isPrintShortcut) {
        if (paymentMethod === "credit") {
          return;
        }

        void completeSale(undefined, true);
        return;
      }

      void completeSale();
    }

    window.addEventListener(
      "keydown",
      handleSaleShortcut,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleSaleShortcut,
      );
    };
  }, [
    saleBusy,
    cart.length,
    paymentMethod,
    completeSale,
  ]);

  return (
    <>
      <section className="sale-panel" id="pos-sale">
        <div className="sale-workspace-main">
        <div className="panel-heading">
          <div className="panel-icon">🧾</div>

          <div>
            <h2>فاتورة مبيعات</h2>
            <p>امسح الباركود ثم راجع الكمية والسعر قبل إتمام البيع.</p>
          </div>
        </div>

        <form className="barcode-form" onSubmit={handleBarcode}>
          <label>
            <span>مسح الباركود أو البحث بالكود أو اسم الصنف</span>

            <input
              ref={barcodeInput}
              dir="ltr"
              autoComplete="off"
              value={barcode}
              onChange={(event) => {
                setBarcode(event.target.value);

                if (searchOpen) {
                  clearProductSearch();
                }
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="امسح الباركود أو اكتب الكود أو اسم الصنف"
              disabled={lookupBusy}
            />
          </label>

          <button
            className="primary-button"
            type="submit"
            disabled={lookupBusy}
          >
            {lookupBusy ? "جاري البحث…" : "بحث / إضافة"}
          </button>
        </form>

        <div className="sale-main-items-region">
        {(searchBusy || searchOpen) && (
          <section className="pos-product-search-panel">
            <header>
              <div>
                <strong>نتائج البحث</strong>

                <span>استخدم الأسهم ثم Enter للاختيار</span>
              </div>

              <button type="button" onClick={clearProductSearch}>
                إغلاق
              </button>
            </header>

            {searchBusy ? (
              <div className="pos-search-loading">جاري البحث عن الأصناف…</div>
            ) : (
              <div className="pos-product-search-results">
                {searchResults.map((product, index) => (
                  <button
                    className={index === activeSearchIndex ? "is-active" : ""}
                    type="button"
                    key={`${product.productId}-${product.barcode}`}
                    onMouseEnter={() => setActiveSearchIndex(index)}
                    onClick={() => addProductToCart(product)}
                  >
                    <img src={product.image} alt="" />

                    <div className="pos-search-product-info">
                      <strong>{product.nameAr}</strong>

                      <div>
                        <span>الكود: {product.productCode ?? "—"}</span>

                        <span dir="ltr">
                          {product.barcode ?? "بدون باركود"}
                        </span>
                      </div>
                    </div>

                    <div className="pos-search-product-side">
                      <strong>
                        {formatMinor(product.websiteUnitPriceMinor)}
                      </strong>

                      <span
                        className={product.outOfStock ? "out-of-stock" : ""}
                      >
                        {product.outOfStock
                          ? "غير متوفر"
                          : `المخزون: ${product.stock ?? "غير محدد"}`}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {error && <div className="alert error-alert sale-alert">{error}</div>}

        {message && (
          <div className="alert success-alert sale-alert">{message}</div>
        )}

        {cart.length === 0 ? (
          <div className="empty-cart">
            <span className="empty-cart-icon" aria-hidden="true">🛒</span>
            <strong>لم تتم إضافة أصناف إلى الفاتورة بعد</strong>
            <small>امسح الباركود أو ابحث عن المنتج في الأعلى لبدء البيع.</small>
          </div>
        ) : (
          <div className="document-items-table-wrap">
            <table className="document-items-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>الباركود</th>
                  <th>الكود</th>
                  <th>اسم الصنف</th>
                  <th>اللون</th>
                  <th>المقاس</th>
                  <th>الكمية</th>
                  <th>سعر البيع</th>
                  <th>المجموع</th>
                  <th>حذف</th>
                </tr>
              </thead>

              <tbody>
                {cart.map((line, index) => {
                  const colors = getColors(line.product);

                  const sizes = getSizes(line.product, line.color);

                  const availability = getLineAvailability(line);

                  const lineTotal =
                    (moneyToMinor(line.soldUnitPrice) ?? 0) * line.quantity;

                  return (
                    <tr
                      className={
                        selectionIsComplete(line)
                          ? ""
                          : "document-row-incomplete"
                      }
                      key={line.id}
                    >
                      <td className="document-row-number">{index + 1}</td>

                      <td className="document-barcode-cell" dir="ltr">
                        {line.barcode}
                      </td>

                      <td className="document-code-cell">
                        {line.product.productCode ?? "—"}
                      </td>

                      <td className="document-product-cell">
                        <img src={line.product.image} alt="" />

                        <div>
                          <strong>{line.product.nameAr}</strong>

                          <small>
                            المخزون: {availability.stock ?? "غير محدد"}
                          </small>

                          {(() => {
                            const promoLine =
                              promotionLineByKey.get(
                                line.id,
                              );

                            const names = [
                              ...new Set(
                                (promoLine?.allocations ?? []).map(
                                  (allocation) =>
                                    bidiSafePromotionLabel(allocation.promotionName),
                                ),
                              ),
                            ];

                            return names.length > 0 ? (
                              <small
                                style={{
                                  fontWeight: 800,
                                }}
                              >
                                🎁 {names.join(" + ")}
                              </small>
                            ) : null;
                          })()}
                        </div>
                      </td>

                      <td className="document-control-cell">
                        {colors.length > 0 ? (
                          <select
                            data-line-id={line.id}
                            data-line-field="color"
                            value={line.color ?? ""}
                            onChange={(event) =>
                              changeColor(line, event.target.value)
                            }
                          >
                            <option value="">اختر اللون</option>

                            {colors.map((color) => (
                              <option key={color} value={color}>
                                {color}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="document-empty-value">—</span>
                        )}
                      </td>

                      <td className="document-control-cell">
                        {sizes.length > 0 ? (
                          <select
                            data-line-id={line.id}
                            data-line-field="size"
                            value={line.size ?? ""}
                            onChange={(event) =>
                              changeSize(line, event.target.value)
                            }
                          >
                            <option value="">اختر المقاس</option>

                            {sizes.map((size) => (
                              <option key={size} value={size}>
                                {size}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="document-empty-value">—</span>
                        )}
                      </td>

                      <td className="document-control-cell document-quantity-cell">
                        <input
                          data-line-id={line.id}
                          data-line-field="quantity"
                          dir="ltr"
                          type="number"
                          min="1"
                          max="99"
                          step="1"
                          value={line.quantity}
                          onFocus={(event) => event.currentTarget.select()}
                          onChange={(event) =>
                            updateLine(line.id, {
                              quantity: Number(event.target.value),
                            })
                          }
                          onKeyDown={(event) =>
                            moveAfterEnter(event, line.id, "price")
                          }
                        />
                      </td>

                      <td className="document-control-cell document-price-cell">
                        <div className="document-money-input">
                          <input
                            data-line-id={line.id}
                            data-line-field="price"
                            dir="ltr"
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.soldUnitPrice}
                            onFocus={(event) => event.currentTarget.select()}
                            onChange={(event) =>
                              updateLine(line.id, {
                                soldUnitPrice: event.target.value,
                              })
                            }
                            onKeyDown={(event) =>
                              moveAfterEnter(event, line.id, "barcode")
                            }
                          />

                          <span>₪</span>
                        </div>
                      </td>

                      <td className="document-total-cell">
                        {formatMinor(lineTotal)}
                      </td>

                      <td className="document-remove-cell">
                        <button
                          type="button"
                          aria-label={`حذف ${line.product.nameAr}`}
                          onClick={() =>
                            setCart((current) =>
                              current.filter((item) => item.id !== line.id),
                            )
                          }
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        </div>
        <div className="sale-checkout sale-customer-checkout">
          <div className="sale-customer-fields">
            <CustomerPicker
              customers={customers}
              value={selectedCustomerId}
              fallbackName={customerName}
              loading={customersBusy}
              disabled={saleBusy}
              error={customersError}
              label="اسم الزبون"
              placeholder="بدون حساب زبون"
              onChange={(customer) => {
                if (!customer) {
                  setSelectedCustomerId("");
                  setCustomerName("");
                  setCustomerPhone("");

                  return;
                }

                setSelectedCustomerId(
                  String(customer.id),
                );

                setCustomerName(
                  customer.name,
                );

                setCustomerPhone(
                  customer.phone ?? "",
                );
              }}
            />

            <label>
              <span>هاتف الزبون</span>

              <input
                dir="ltr"
                value={customerPhone}
                readOnly
                placeholder="يظهر بعد اختيار الزبون"
              />
            </label>

            <label className="sale-notes">
              <span>
                ملاحظات
                <small> اختياري</small>
              </span>

              <textarea
                rows={2}
                maxLength={1000}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>
          </div>
        </div>
        </div>

        <div className="sale-checkout sale-payment-checkout">
          <div className="sale-summary">
            <div className="sale-summary-heading">
              <div>
                <strong>ملخص الفاتورة</strong>
                <small>المبالغ وطريقة الدفع</small>
              </div>
              <span className="sale-summary-heading-icon" aria-hidden="true">🧾</span>
            </div>

            <div>
              <span>مجموع الأصناف</span>
              <strong>{formatMinor(subtotalMinor)}</strong>
            </div>

            {promotionPreviewBusy && (
              <div>
                <span>العروض</span>
                <strong>جاري الاحتساب…</strong>
              </div>
            )}

            {promotionDiscountMinor > 0 && (
              <>
                {(promotionPreview?.promotions ?? []).map(
                  (promotion) => (
                    <div
                      key={promotion.promotionId}
                    >
                      <span>
                        خصم {bidiSafePromotionLabel(promotion.publicLabel)}
                      </span>

                      <strong>
                        -{formatMinor(
                          promotion.discountMinor,
                        )}
                      </strong>
                    </div>
                  ),
                )}
              </>
            )}

            {(promotionPreview?.entitlements ?? [])
              .filter(
                (item) =>
                  item.remainingRewardQuantity >
                    0 ||
                  (
                    item.nextBundleRemainingQuantity ??
                    0
                  ) > 0 ||
                  (
                    item.thresholdRemainingMinor ??
                    0
                  ) > 0 ||
                  item.earnedRewardQuantity > 0,
              )
              .map((item) => {
                const thresholdRemaining =
                  item.thresholdRemainingMinor;

                const spendGift =
                  item.spendThresholdMinor !==
                    undefined ||
                  thresholdRemaining !==
                    undefined;

                return (
                  <div
                    key={`entitlement-${item.promotionId}`}
                  >
                    <span>
                      🎁 {bidiSafePromotionLabel(item.promotionName)}
                    </span>

                    <strong>
                      {spendGift
                        ? item.earnedRewardQuantity > 0
                          ? "استحق هدية واحدة — اختيار الهدية يتم من قائمة هدايا العرض"
                          : `باقي ${formatMinor(thresholdRemaining ?? 0)} للحصول على هدية`
                        : `أضف ${item.nextBundleRemainingQuantity ?? item.remainingRewardQuantity} قطعة للاستفادة`}
                    </strong>
                  </div>
                );
              })}

            {promotionPreviewError && (
              <div>
                <span>العروض</span>
                <strong>
                  {promotionPreviewError}
                </strong>
              </div>
            )}

            <label>
              <span>الخصم اليدوي</span>

              <div className="money-input">
                <input
                  dir="ltr"
                  type="number"
                  min="0"
                  step="0.01"
                  value={discountAmount}
                  placeholder="0.00"
                  onFocus={(event) =>
                    event.currentTarget.select()
                  }
                  onChange={(event) => setDiscountAmount(event.target.value)}
                />

                <span>₪</span>
              </div>
            </label>

            <div className="sale-grand-total">
              <span>الإجمالي النهائي</span>
              <strong>{formatMinor(totalMinor)}</strong>
            </div>

            <div className="customer-account-summary">
              <span>
                حساب الزبون
              </span>

              <strong>
                {selectedCustomerId
                  ? customerName ||
                    "زبون محدد"
                  : "غير محدد"}
              </strong>

              {selectedCustomerId && (
                <small>
                  الرصيد الحالي:
                  {" "}
                  {formatMinor(
                    customers.find(
                      (customer) =>
                        String(
                          customer.id,
                        ) ===
                        selectedCustomerId,
                    )?.balanceMinor ??
                      0,
                  )}
                </small>
              )}
            </div>

            <div className="sale-payment-methods">
              <span>طريقة الدفع</span>

              <div className="sale-payment-method-grid">
                <div className="sale-payment-method-row">
                  <button
                    type="button"
                    className={
                      paymentMethod ===
                      "cash"
                        ? "primary-button"
                        : "secondary-button"
                    }
                    onClick={() => {
                      setPaymentMethod(
                        "cash",
                      );
                      setCardProcessor(
                        null,
                      );
                    }}
                  >
                    💵 نقدي
                  </button>

                  <button
                    type="button"
                    className={
                      paymentMethod ===
                      "credit"
                        ? "primary-button"
                        : "secondary-button"
                    }
                    onClick={() => {
                      setPaymentMethod(
                        "credit",
                      );
                      setCardProcessor(
                        null,
                      );
                    }}
                  >
                    🧾 آجل
                  </button>
                </div>

                <div className="sale-payment-method-row">
                  <VisaBankButton
                    bank="arab"
                    selected={paymentMethod === "card" && cardProcessor === "arab"}
                    onClick={() => {
                      setPaymentMethod("card");
                      setCardProcessor("arab");
                    }}
                  />
                  <VisaBankButton
                    bank="bop"
                    selected={paymentMethod === "card" && cardProcessor === "bop"}
                    onClick={() => {
                      setPaymentMethod("card");
                      setCardProcessor("bop");
                    }}
                  />
                </div>
              </div>
            </div>

            {paymentMethod ===
              "cash" && (
              <div
                style={{
                  display: "grid",
                  gap: 8,
                }}
              >
                <label>
                  <span>
                    عملة الدفع
                  </span>

                  <select
                    value={
                      cashCurrencyCode
                    }
                    disabled={
                      saleBusy
                    }
                    onChange={(
                      event,
                    ) => {
                      const code =
                        event.target
                          .value;

                      const currency =
                        cashCurrencies.find(
                          (item) =>
                            item.code ===
                            code,
                        ) ??
                        null;

                      setCashCurrencyCode(
                        code,
                      );

                      if (
                        code === "ILS"
                      ) {
                        setCashExchangeRate(
                          "1",
                        );
                        setPaidAmount(
                          (
                            totalMinor /
                            100
                          ).toFixed(
                            2,
                          ),
                        );
                        return;
                      }

                      setCashExchangeRate(
                        currency
                          ?.latestRate
                          ? String(
                              currency.latestRate,
                            )
                          : "",
                      );

                      setPaidAmount(
                        "",
                      );
                    }}
                  >
                    <option value="ILS">
                      ₪ شيكل — الافتراضي
                    </option>

                    {cashCurrencies
                      .filter(
                        (currency) =>
                          currency.code !==
                          "ILS",
                      )
                      .map(
                        (currency) => (
                          <option
                            key={
                              currency.code
                            }
                            value={
                              currency.code
                            }
                          >
                            {
                              currency.symbol
                            }{" "}
                            {
                              currency.nameAr
                            }{" "}
                            —{" "}
                            {currency.cashSessionId
                              ? "الصندوق مفتوح"
                              : "الصندوق مغلق"}
                          </option>
                        ),
                      )}
                  </select>
                </label>

                {cashCurrencyCode !==
                  "ILS" && (
                  <>
                    <label>
                      <span>
                        سعر الصرف — 1{" "}
                        {
                          cashCurrencyCode
                        }{" "}
                        = كم ₪
                      </span>

                      <input
                        dir="ltr"
                        type="number"
                        min="0.000001"
                        step="0.000001"
                        value={
                          cashExchangeRate
                        }
                        disabled={
                          saleBusy
                        }
                        onFocus={(
                          event,
                        ) =>
                          event.currentTarget.select()
                        }
                        onChange={(
                          event,
                        ) =>
                          setCashExchangeRate(
                            event.target
                              .value,
                          )
                        }
                      />
                    </label>

                    {selectedCashCurrency &&
                      !selectedCashCurrency.cashSessionId && (
                      <small
                        style={{
                          color:
                            "#b91c1c",
                        }}
                      >
                        جلسة صندوق{" "}
                        {
                          cashCurrencyCode
                        }{" "}
                        مغلقة. افتحها من
                        البنوك والصناديق قبل
                        البيع.
                      </small>
                    )}
                  </>
                )}
              </div>
            )}

            <label>
              <span>
                {paymentMethod ===
                "mixed"
                  ? "الدفعة النقدية"
                  : paymentMethod ===
                      "cash" &&
                    cashCurrencyCode !==
                      "ILS"
                    ? `المبلغ المستلم ${cashCurrencyCode}`
                    : "المبلغ المدفوع"}
              </span>

              <div className="money-input">
                <input
                  dir="ltr"
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    paidAmount
                  }
                  onFocus={(event) =>
                    event.currentTarget.select()
                  }
                  disabled={
                    paymentMethod ===
                      "card" ||
                    paymentMethod ===
                      "credit"
                  }
                  onChange={(
                    event,
                  ) =>
                    setPaidAmount(
                      event.target
                        .value,
                    )
                  }
                />

                <span>
                  {paymentMethod ===
                    "cash" &&
                  cashCurrencyCode !==
                    "ILS"
                    ? selectedCashCurrency
                        ?.symbol ??
                      cashCurrencyCode
                    : "₪"}
                </span>
              </div>
            </label>

            {paymentMethod ===
              "cash" &&
              cashCurrencyCode !==
                "ILS" &&
              cashRateMicros && (
              <div
                style={{
                  display:
                    "grid",
                  gap: 3,
                  fontSize: 12,
                }}
              >
                <span>
                  قيمة المستلم بالشيكل:{" "}
                  <b>
                    {formatMinor(
                      paidMinor,
                    )}
                  </b>
                </span>
                <span>
                  الباقي سيُرد من صندوق
                  الشيكل:{" "}
                  <b>
                    {formatMinor(
                      changeMinor,
                    )}
                  </b>
                </span>
              </div>
            )}

            <div>
              <span>
                {accountDueMinor > 0
                  ? "المتبقي على الحساب"
                  : "الباقي للزبون"}
              </span>

              <strong>
                {formatMinor(
                  accountDueMinor > 0
                    ? accountDueMinor
                    : changeMinor,
                )}
              </strong>
            </div>

            {paymentMethod === "credit" &&
              selectedCustomerId && (
              <div className="customer-account-credit-box">
                <strong>
                  فاتورة على حساب الزبون
                </strong>

                <p
                  style={{
                    margin:
                      "7px 0 12px",
                    fontSize: 13,
                  }}
                >
                  الفاتورة تنزل كاملة
                  على الحساب. يمكنك
                  حفظها بدون دفع أو
                  حفظها وتسجيل سند قبض
                  مباشرة.
                </p>

                <label>
                  <span>
                    قيمة التسديد الآن
                  </span>

                  <div className="money-input">
                    <input
                      dir="ltr"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={
                        settlementAmount
                      }
                      onFocus={(event) =>
                        event.currentTarget.select()
                      }
                      onChange={(
                        event,
                      ) =>
                        setSettlementAmount(
                          event.target
                            .value,
                        )
                      }
                    />

                    <span>₪</span>
                  </div>
                </label>

                <div
                  style={{
                    marginTop: 12,
                  }}
                >
                  <span>
                    طريقة التسديد
                  </span>

                  <div
                    style={{
                      display:
                        "flex",
                      gap: 8,
                      marginTop: 7,
                      flexWrap:
                        "wrap",
                    }}
                  >
                    <button
                      type="button"
                      className={
                        settlementMethod ===
                        "cash"
                          ? "primary-button"
                          : "secondary-button"
                      }
                      onClick={() => {
                        setSettlementMethod(
                          "cash",
                        );
                        setSettlementCardProcessor(
                          null,
                        );
                      }}
                    >
                      💵 كاش
                    </button>

                    <VisaBankButton
                      bank="arab"
                      selected={settlementMethod === "card" && settlementCardProcessor === "arab"}
                      onClick={() => {
                        setSettlementMethod("card");
                        setSettlementCardProcessor("arab");
                      }}
                    />
                    <VisaBankButton
                      bank="bop"
                      selected={settlementMethod === "card" && settlementCardProcessor === "bop"}
                      onClick={() => {
                        setSettlementMethod("card");
                        setSettlementCardProcessor("bop");
                      }}
                    />
                  </div>
                </div>

                <div
                  style={{
                    display:
                      "flex",
                    gap: 8,
                    marginTop: 14,
                    flexWrap:
                      "wrap",
                  }}
                >
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={
                      saleBusy ||
                      cart.length === 0
                    }
                    onClick={() =>
                      void completeSale()
                    }
                  >
                    {saleBusy
                      ? "جاري الحفظ…"
                      : (
                        <>
                          <span>حفظ الفاتورة</span>
                          <kbd className="sale-shortcut-key">F3</kbd>
                        </>
                      )}
                  </button>

                  <button
                    className="primary-button"
                    type="button"
                    disabled={
                      saleBusy ||
                      cart.length === 0 ||
                      (
                        settlementMethod ===
                          "cash" &&
                        !session
                      ) ||
                      (
                        settlementMethod ===
                          "card" &&
                        !settlementCardProcessor
                      )
                    }
                    onClick={() =>
                      void completeSale(
                        {
                          amount:
                            settlementAmount,
                          method:
                            settlementMethod,
                        },
                      )
                    }
                  >
                    {saleBusy
                      ? "جاري الحفظ والتسديد…"
                      : "حفظ وتسديد"}
                  </button>
                </div>
              </div>
            )}

            {paymentMethod !== "credit" && (
              <div className="complete-sale-actions">
                <button
                  className="primary-button complete-sale-button complete-sale-print-button"
                  type="button"
                  aria-keyshortcuts="F4"
                  title="اختصار الطباعة: F4"
                  disabled={saleBusy || cart.length === 0}
                  onClick={() => void completeSale(undefined, true)}
                >
                  <span
                    className="sale-print-icon"
                    aria-hidden="true"
                  >
                    🖨️
                  </span>

                  <span className="sale-print-button-label">
                    <span>
                      {saleBusy
                        ? "جاري الحفظ والطباعة…"
                        : "إتمام البيع + طباعة فاتورة حرارية"}
                    </span>

                    {!saleBusy && (
                      <kbd className="sale-shortcut-key sale-shortcut-key-print">
                        F4
                      </kbd>
                    )}
                  </span>
                </button>

                <button
                  className="secondary-button complete-sale-button complete-sale-no-print-button"
                  type="button"
                  aria-keyshortcuts="F3"
                  title="اختصار الحفظ: F3"
                  disabled={saleBusy || cart.length === 0}
                  onClick={() => void completeSale()}
                >
                  {saleBusy
                    ? "جاري حفظ البيع…"
                    : (
                      <>
                        <span>إتمام البيع</span>
                        <kbd className="sale-shortcut-key">F3</kbd>
                      </>
                    )}
                </button>
              </div>
            )}
          </div>
        </div>

        {lastSale && (
          <div className="last-sale-actions">
            <div>
              <strong>آخر فاتورة: {lastSale.sale.publicId}</strong>

              <span>الإجمالي: {formatMinor(lastSale.sale.totalMinor)}</span>

              {lastSale.sale.cashTender &&
              lastSale.sale.cashTender.currencyCode !== "ILS" && (
              <span dir="ltr">
                دفع نقدي:{" "}
                {(
                  lastSale.sale.cashTender.currencyAmountMinor /
                  100
                ).toFixed(2)}{" "}
                {lastSale.sale.cashTender.currencyCode}
                {" × "}
                {(
                  lastSale.sale.cashTender.exchangeRateMicros /
                  1_000_000
                ).toFixed(6)}
              </span>
            )}

            {lastSale.sale.accountDueMinor > 0 && (
                <span>
                  متبقي على الحساب:
                  {" "}
                  {formatMinor(
                    lastSale.sale.accountDueMinor,
                  )}
                </span>
              )}
            </div>

            <button
              className="secondary-button"
              type="button"
              onClick={() => void handleDirectReceiptPrint()}
            >
              طباعة الإيصال مباشرة
            </button>
          </div>
        )}
      </section>

      {lastSale && (
        <section ref={directReceiptRef} className="receipt-print-area" dir="rtl">
          <header className="receipt-header">
            <img className="receipt-logo" src="/lovely-kids-receipt-logo.png" alt="Lovely Kids" />
            <span>لملابس الأطفال وتجهيز المواليد</span>
            <span>نابلس - المركز التجاري - شارع عمر المختار</span>
            <span dir="ltr">09-2376808</span>
          </header>

          <div className="receipt-divider" />

          <div className="receipt-info">
            <span>
              رقم الفاتورة:
              <b dir="ltr"> {lastSale.sale.publicId}</b>
            </span>

            <span>
              التاريخ والوقت:{" "}
              {new Intl.DateTimeFormat("ar-PS", {
                dateStyle: "short",
                timeStyle: "short",
                timeZone: "Asia/Hebron",
              }).format(new Date(lastSale.sale.createdAt))}
            </span>

            <span>الزبون: {lastSale.sale.customerName ||
                (lastSale.sale.paymentMethod === "card"
                  ? "زبون فيزا"
                  : lastSale.sale.paymentMethod === "credit" ||
                      lastSale.sale.paymentMethod === "mixed"
                    ? "زبون على الحساب"
                    : "زبون نقدي")}</span>

            <span>
              طريقة الدفع: {
                lastSale.sale.paymentMethod === "card"
                  ? lastSale.sale.cardProcessor === "arab"
                    ? "فيزا البنك العربي"
                    : lastSale.sale.cardProcessor === "bop"
                      ? "فيزا بنك فلسطين"
                      : "فيزا"
                  : lastSale.sale.paymentMethod === "credit"
                    ? "آجل"
                    : lastSale.sale.paymentMethod === "mixed"
                      ? "دفعة نقدية + حساب"
                      : "نقدي"
              }
            </span>

            {lastSale.sale.accountDueMinor > 0 && (
              <span>
                المتبقي على الحساب:
                {" "}
                {formatMinor(
                  lastSale.sale.accountDueMinor,
                )}
              </span>
            )}
          </div>

          <div className="receipt-divider" />

          <table className="receipt-items-table">
            <thead>
              <tr>
                <th>#</th>
                <th>الصنف</th>
                <th>الكود</th>
                <th>الكمية</th>
                <th>السعر</th>
              </tr>
            </thead>

            <tbody>
              {lastSale.items.map((item, index) => (
                <tr key={item.id}>
                  <td>{index + 1}</td>

                  <td>{item.productNameAr.trim().split(/\s+/)[0] || "صنف"}</td>

                  <td dir="ltr">{item.productCode?.trim() || item.barcode?.trim() || "—"}</td>

                  <td>{item.quantity}</td>

                  <td dir="ltr">
                    {(
                      lastSale.sale.promotionDiscountMinor > 0
                        ? (
                            item.lineTotalMinor +
                            item.promotionDiscountMinor
                          ) /
                          100
                        : item.lineTotal
                    ).toFixed(2)} ₪
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="receipt-divider" />

          <div className="receipt-totals">
            <div>
              <span>مجموع الأصناف</span>

              <strong>{lastSale.sale.subtotal.toFixed(2)} ₪</strong>
            </div>

            {lastSale.sale.promotionDiscountMinor > 0 ? (
              <>
                {lastSale.sale.itemDiscountMinor > 0 && (
                  <div>
                    <span>خصم الأصناف</span>

                    <strong>
                      -{lastSale.sale.itemDiscount.toFixed(2)} ₪
                    </strong>
                  </div>
                )}

                {lastSale.promotions.length > 0 ? (
                  lastSale.promotions.map((promotion) => (
                    <div
                      key={`direct-receipt-promotion-${promotion.promotionId ?? "snapshot"}-${promotion.promotionName}`}
                    >
                      <span>
                        خصم عرض {bidiSafePromotionLabel(promotion.publicLabel)}
                      </span>

                      <strong>
                        -{(promotion.discountMinor / 100).toFixed(2)} ₪
                      </strong>
                    </div>
                  ))
                ) : (
                  <div>
                    <span>خصم العرض</span>

                    <strong>
                      -{lastSale.sale.promotionDiscount.toFixed(2)} ₪
                    </strong>
                  </div>
                )}

                {lastSale.sale.invoiceDiscountMinor > 0 && (
                  <div>
                    <span>خصم يدوي</span>

                    <strong>
                      -{lastSale.sale.invoiceDiscount.toFixed(2)} ₪
                    </strong>
                  </div>
                )}
              </>
            ) : (
              lastSale.sale.discountMinor > 0 && (
                <div>
                  <span>قيمة الخصم</span>

                  <strong>{lastSale.sale.discount.toFixed(2)} ₪</strong>
                </div>
              )
            )}

            <div className="receipt-total">
              <span>الإجمالي النهائي</span>

              <strong>{lastSale.sale.total.toFixed(2)} ₪</strong>
            </div>

            <div>
              <span>المدفوع</span>

              <strong>
                {lastSale.sale.cashTender &&
                lastSale.sale.cashTender.currencyCode !== "ILS"
                  ? `${(
                      lastSale.sale.cashTender.currencyAmountMinor /
                      100
                    ).toFixed(2)} ${lastSale.sale.cashTender.currencyCode}`
                  : `${lastSale.sale.paid.toFixed(2)} ₪`}
              </strong>
            </div>

            {lastSale.sale.cashTender &&
              lastSale.sale.cashTender.currencyCode !== "ILS" && (
              <div>
                <span>قيمة المستلم بالشيكل</span>

                <strong>
                  {(
                    lastSale.sale.cashTender.baseReceivedMinor /
                    100
                  ).toFixed(2)} ₪
                </strong>
              </div>
            )}

            <div>
              <span>الباقي</span>

              <strong>{lastSale.sale.change.toFixed(2)} ₪</strong>
            </div>
          </div>

          <div className="receipt-invoice-barcode">
            <QRCodeSVG
              value={lastSale.sale.publicId}
              size={96}
              level="M"
              aria-label={`رمز QR للفاتورة ${lastSale.sale.publicId}`}
            />
          </div>

          <footer className="receipt-footer">
            <strong>شكرًا لتسوقكم من Lovely Kids</strong>

            <b className="receipt-exchange-reminder">
              يرجى الاحتفاظ بالفاتورة لإتمام عملية التبديل.
            </b>

            <span>الاستبدال بالبضاعة السليمة حسب سياسة المتجر</span>
          </footer>

      <div className="receipt-social-qrs" aria-label="روابط Lovely Kids">
        <div className="receipt-social-qr-item">
          <QRCodeSVG
            value="https://www.facebook.com/lovely.kids.nablus1"
            size={112}
            level="M"
            aria-label="فيسبوك Lovely Kids"
          />
          <span>فيسبوك</span>
        </div>

        <div className="receipt-social-qr-item">
          <QRCodeSVG
            value="https://wa.me/97292376808"
            size={112}
            level="M"
            aria-label="واتساب Lovely Kids"
          />
          <span>واتساب</span>
        </div>

        <div className="receipt-social-qr-item">
          <QRCodeSVG
            value="https://lovelykids.net"
            size={112}
            level="M"
            aria-label="متجر Lovely Kids الإلكتروني"
          />
          <span>المتجر الإلكتروني</span>
        </div>
      </div>

        </section>
      )}
    </>
  );
}
