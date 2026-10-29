import CustomerPicker from "../../components/CustomerPicker";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useSearchParams } from "react-router-dom";

import { usePosRuntime } from "../../app/pos-context";
import SaleReceipt from "../../components/SaleReceipt";
import { printReceiptElementDirect } from "../../lib/directReceiptPrint";
import {
  captureScannerKeyboardEvent,
  createScannerKeyboardBuffer,
} from "../../lib/scannerKeyboard";
import {
  ApiError,
  createPosSale,
  createPosCustomerReceipt,
  getCurrentCashSession,
  getPosCustomers,
  getPosSaleByPublicId,
  lookupPosProductByBarcode,
  searchPosProducts,
  updatePosSale,
  voidPosSale,
  type PosCustomer,
  type PosProductLookup,
  type PosSaleResult,
} from "../../lib/api";

const ACCOUNTING_WRITES_ENABLED =
  import.meta.env.VITE_ACCOUNTING_INVOICE_WRITES === "true";

const PRODUCT_IMAGE_PLACEHOLDER =
  "/mobile-pos-icon-192.png";

type InvoiceSettlement = {
  amountMinor: number;
  method: "cash" | "card";
  cardProcessor: "arab" | "bop" | null;
};

interface InvoiceLine {
  id: string;
  barcode: string;
  product: PosProductLookup;
  color: string | null;
  size: string | null;
  quantity: number;
  unitPrice: string;
  discount: string;
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

function getLocalDateTimeValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;

  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

function toLocalDateTimeValue(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return getLocalDateTimeValue();
  }

  const offset = date.getTimezoneOffset() * 60_000;

  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function parseMoneyInput(value: string) {
  const normalized = value.trim().replace(",", ".");

  if (!normalized) {
    return null;
  }

  const amount = Number(normalized);

  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  const minor = Math.round(amount * 100);

  if (
    Math.abs(minor / 100 - amount) > 0.000001 ||
    !Number.isSafeInteger(minor) ||
    minor > 2_000_000_000
  ) {
    return null;
  }

  return minor;
}

function moneyToMinor(value: string) {
  return parseMoneyInput(value) ?? 0;
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
    if (!color) {
      return [];
    }

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
  const barcodes =
    product.barcodes ?? [];

  const exactMapping =
    barcodes.find(
      (entry) =>
        entry.color === color &&
        entry.size === size,
    );

  if (exactMapping) {
    return exactMapping.barcode;
  }

  const partialMapping =
    barcodes.find(
      (entry) =>
        entry.color === color &&
        entry.size === null,
    ) ??
    barcodes.find(
      (entry) =>
        entry.color === null &&
        entry.size === size,
    );

  if (partialMapping) {
    return partialMapping.barcode;
  }

  return product.primaryBarcode ?? "";
}

function getLineStock(line: InvoiceLine) {
  if (line.product.colorVariants.length > 0 && line.color) {
    const variant = line.product.colorVariants.find(
      (entry) => entry.color === line.color,
    );

    if (line.size) {
      return (
        variant?.sizes.find((entry) => entry.size === line.size)?.stock ?? null
      );
    }
  }

  return line.product.stock;
}

function selectionIsComplete(line: InvoiceLine) {
  const colors = getColors(line.product);

  if (colors.length > 0 && !line.color) {
    return false;
  }

  const sizes = getSizes(line.product, line.color);

  if (sizes.length > 0 && !line.size) {
    return false;
  }

  return true;
}

function toStoredInvoiceLine(
  item: PosSaleResult["items"][number],
): InvoiceLine {
  const exactStock = item.variantStockAfter ?? item.generalStockAfter;

  const colorVariants = item.color
    ? [
        {
          color: item.color,
          hex: "#000000",
          sizes: item.size
            ? [
                {
                  size: item.size,
                  stock: item.variantStockAfter,
                  outOfStock:
                    item.variantStockAfter !== null &&
                    item.variantStockAfter <= 0,
                },
              ]
            : [],
        },
      ]
    : [];

  const product: PosProductLookup = {
    productId: item.productId ?? `stored-${item.id}`,
    barcode: item.barcode ?? "",
    primaryBarcode: item.barcode ?? null,
    barcodes: [],
    productCode: item.productCode,
    nameAr: item.productNameAr,
    image: item.productImage ?? "",
    websiteUnitPrice: item.websiteUnitPrice,
    websiteUnitPriceMinor: item.websiteUnitPriceMinor,
    mappedColor: item.color,
    mappedSize: item.size,
    sizes: !item.color && item.size ? [item.size] : [],
    colorVariants,
    stock: item.generalStockAfter,
    outOfStock: exactStock !== null && exactStock <= 0,
  };

  return {
    id: `stored-${item.id}`,
    barcode: item.barcode ?? "",
    product,
    color: item.color,
    size: item.size,
    quantity: item.quantity,
    unitPrice: item.soldUnitPrice.toFixed(2),
    discount: (item.lineDiscount ?? 0).toFixed(2),
  };
}

export default function SalesInvoicePage() {
  const { token, session, setSession, clearAuthentication } = usePosRuntime();

  const [searchParams, setSearchParams] = useSearchParams();

  const requestedPublicId =
    searchParams.get("publicId")?.trim().toUpperCase() ?? "";

  const searchInput = useRef<HTMLInputElement>(null);
  const tableWrap = useRef<HTMLDivElement>(null);
  const lastTouchedLineId = useRef<string | null>(null);

  const createIdempotencyKey = useRef<string | null>(null);
  const editIdempotencyKey = useRef<string | null>(null);

  const [revealVersion, setRevealVersion] = useState(0);

  const [invoiceDateTime, setInvoiceDateTime] = useState(getLocalDateTimeValue);
  const [invoiceType, setInvoiceType] = useState("cash");
  const [warehouse, setWarehouse] = useState("main");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  const [
    selectedCustomerId,
    setSelectedCustomerId,
  ] = useState<number | null>(null);

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

  const [representative, setRepresentative] = useState("");
  const [notes, setNotes] = useState("");

  const [query, setQuery] = useState("");

  const scannerKeyboard = useRef(
    createScannerKeyboardBuffer(),
  );

  const scannerSubmitValue = useRef<string | null>(
    null,
  );

  const openInvoiceInputRef =
    useRef<HTMLInputElement>(null);

  const openInvoiceScannerKeyboard = useRef(
    createScannerKeyboardBuffer(),
  );

  const [openInvoiceDialog, setOpenInvoiceDialog] =
    useState(false);

  const [openInvoiceValue, setOpenInvoiceValue] =
    useState("");

  const [lookupBusy, setLookupBusy] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<PosProductLookup[]>([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);

  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [invoiceDiscount, setInvoiceDiscount] = useState("0.00");
  const [paidAmount, setPaidAmount] = useState("0.00");

  const [paidAmountAuto, setPaidAmountAuto] = useState(true);

  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [costCenter, setCostCenter] = useState("general");

  const [settlementOpen, setSettlementOpen] = useState(false);
  const [settlementKind, setSettlementKind] = useState<"full" | "partial">("full");
  const [settlementAmount, setSettlementAmount] = useState("0.00");
  const [settlementMethod, setSettlementMethod] = useState<"cash" | "card">("cash");
  const [settlementCardProcessor, setSettlementCardProcessor] =
    useState<"arab" | "bop" | null>(null);
  const [pendingInvoiceSettlement, setPendingInvoiceSettlement] = useState<{
    publicId: string;
    customerId: number;
    settlement: InvoiceSettlement;
  } | null>(null);
  const [linkedReceipt, setLinkedReceipt] = useState<{
    publicId: string;
    amountMinor: number;
    method: "cash" | "card";
  } | null>(null);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [loadedSale, setLoadedSale] = useState<PosSaleResult | null>(null);

  const [editMode, setEditMode] = useState(false);
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const receiptRef = useRef<HTMLElement>(null);
  const printAfterSaveRef = useRef(false);

  useEffect(() => {
    if (requestedPublicId) {
      void loadStoredInvoice(requestedPublicId);
    }
  }, [requestedPublicId]);

  useEffect(() => {
    let active = true;

    setCustomersBusy(true);
    setCustomersError("");

    void getPosCustomers(
      token,
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
          clearAuthentication();
          return;
        }

        setCustomersError(
          caught instanceof Error
            ? caught.message
            : "تعذر تحميل الزبائن",
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
    clearAuthentication,
  ]);

  useEffect(() => {
    const lineId = lastTouchedLineId.current;
    const container = tableWrap.current;

    if (!lineId || !container) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const row = container.querySelector<HTMLTableRowElement>(
        `[data-invoice-line-id="${lineId}"]`,
      );

      if (!row) {
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const visibleTop = containerRect.top + 34;
      const visibleBottom = containerRect.bottom - 5;

      if (rowRect.bottom > visibleBottom) {
        container.scrollBy({
          top: rowRect.bottom - visibleBottom + 7,
          behavior: "smooth",
        });
      } else if (rowRect.top < visibleTop) {
        container.scrollBy({
          top: rowRect.top - visibleTop - 7,
          behavior: "smooth",
        });
      }

      const colorField = row.querySelector<HTMLSelectElement>(
        '[data-invoice-field="color"]',
      );

      const sizeField = row.querySelector<HTMLSelectElement>(
        '[data-invoice-field="size"]',
      );

      const quantityField = row.querySelector<HTMLInputElement>(
        '[data-invoice-field="quantity"]',
      );

      const focusTarget =
        colorField && !colorField.disabled && !colorField.value
          ? colorField
          : sizeField && !sizeField.disabled && !sizeField.value
            ? sizeField
            : quantityField;

      focusTarget?.focus();

      if (focusTarget instanceof HTMLInputElement) {
        focusTarget.select();
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [revealVersion]);

  const totalQuantity = useMemo(
    () => lines.reduce((total, line) => total + line.quantity, 0),
    [lines],
  );

  const itemsTotalMinor = useMemo(
    () =>
      lines.reduce(
        (total, line) => total + moneyToMinor(line.unitPrice) * line.quantity,
        0,
      ),
    [lines],
  );

  const lineDiscountMinor = useMemo(
    () => lines.reduce((total, line) => total + moneyToMinor(line.discount), 0),
    [lines],
  );

  const subtotalMinor = Math.max(0, itemsTotalMinor - lineDiscountMinor);

  const invoiceDiscountMinor = moneyToMinor(invoiceDiscount);

  const finalTotalMinor = Math.max(0, subtotalMinor - invoiceDiscountMinor);

  const paidMinor = moneyToMinor(paidAmount);
  const changeMinor = Math.max(0, paidMinor - finalTotalMinor);
  const customerDueMinor = paymentMethod === "credit" ?
    finalTotalMinor : Math.max(0, finalTotalMinor - paidMinor);

  useEffect(() => {
    if (!paidAmountAuto || loadedSale !== null || paymentMethod !== "cash") {
      return;
    }

    setPaidAmount((finalTotalMinor / 100).toFixed(2));
  }, [finalTotalMinor, loadedSale, paidAmountAuto, paymentMethod]);

  const invoiceLocked = invoiceBusy || (loadedSale !== null && !editMode);

  function focusSearch() {
    window.setTimeout(() => {
      searchInput.current?.focus();
      searchInput.current?.select();
    }, 0);
  }

  function clearSearchResults() {
    setSearchResults([]);
    setSearchOpen(false);
    setSearchBusy(false);
    setActiveSearchIndex(0);
  }

  function updateLine(lineId: string, patch: Partial<InvoiceLine>) {
    setLines((current) =>
      current.map((line) =>
        line.id === lineId ? { ...line, ...patch } : line,
      ),
    );
  }

  function changeColor(line: InvoiceLine, colorValue: string) {
    const color = colorValue || null;
    const sizes = getSizes(line.product, color);

    const size =
      sizes.length === 1 ? sizes[0] : null;

    updateLine(line.id, {
      color,
      size,
      barcode:
        getBarcodeForSelection(
          line.product,
          color,
          size,
        ),
    });
  }

  function changeSize(
    line: InvoiceLine,
    sizeValue: string,
  ) {
    const size =
      sizeValue || null;

    updateLine(line.id, {
      size,
      barcode:
        getBarcodeForSelection(
          line.product,
          line.color,
          size,
        ),
    });
  }

  function addProduct(product: PosProductLookup) {
    const colors = getColors(product);

    const color =
      product.mappedColor ?? (colors.length === 1 ? colors[0] : null);

    const sizes = getSizes(product, color);

    const size = product.mappedSize ?? (sizes.length === 1 ? sizes[0] : null);

    const complete =
      (colors.length === 0 || !!color) && (sizes.length === 0 || !!size);

    const existingIndex = complete
      ? lines.findIndex(
          (line) =>
            line.product.productId === product.productId &&
            line.barcode === (product.barcode ?? "") &&
            line.color === color &&
            line.size === size,
        )
      : -1;

    let touchedLineId: string;

    if (existingIndex >= 0) {
      touchedLineId = lines[existingIndex].id;

      setLines(
        lines.map((line, index) =>
          index === existingIndex
            ? {
                ...line,
                quantity: Math.min(99, line.quantity + 1),
              }
            : line,
        ),
      );
    } else {
      touchedLineId = createKey();

      setLines([
        ...lines,
        {
          id: touchedLineId,
          barcode: product.barcode ?? "",
          product,
          color,
          size,
          quantity: 1,
          unitPrice: product.websiteUnitPrice.toFixed(2),
          discount: "0.00",
        },
      ]);
    }

    lastTouchedLineId.current = touchedLineId;
    setRevealVersion((current) => current + 1);

    setQuery("");
    setError("");
    setMessage(`تمت إضافة ${product.nameAr} إلى الفاتورة`);
    clearSearchResults();
    focusSearch();
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

      setQuery(scannedValue);
      clearSearchResults();

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
      clearSearchResults();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();

      if (searchOpen && searchResults[activeSearchIndex]) {
        addProduct(searchResults[activeSearchIndex]);
        return;
      }

      event.currentTarget.form?.requestSubmit();
    }
  }

  async function handleProductSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const scannerValue =
      scannerSubmitValue.current;

    scannerSubmitValue.current = null;

    const value = (
      scannerValue ?? query
    ).trim();

    if (!value) {
      setError("أدخل الباركود أو الكود أو اسم الصنف");
      focusSearch();
      return;
    }

    if (searchOpen && searchResults[activeSearchIndex]) {
      addProduct(searchResults[activeSearchIndex]);
      return;
    }

    setLookupBusy(true);
    setError("");
    setMessage("");
    clearSearchResults();

    try {
      const product = await lookupPosProductByBarcode(token, value);

      addProduct(product);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        clearAuthentication();
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
            clearAuthentication();
            return;
          }

          setError(
            searchError instanceof Error
              ? searchError.message
              : "تعذر البحث عن الأصناف",
          );
        } finally {
          setSearchBusy(false);
        }

        return;
      }

      setError(
        caught instanceof Error ? caught.message : "تعذر البحث عن الصنف",
      );
    } finally {
      setLookupBusy(false);
    }
  }

  function validateInvoiceForSave() {
    if (!session) {
      return "يجب فتح يوم الصندوق قبل حفظ الفاتورة";
    }

    if (invoiceType !== "cash") {
      return "نوع الفاتورة غير مدعوم حاليًا";
    }

    if (
      loadedSale === null &&
      paymentMethod !== "cash" &&
      paymentMethod !== "credit"
    ) {
      return "المتاح من شاشة الفاتورة: نقدي أو على حساب الزبون";
    }

    if (
      loadedSale === null &&
      paymentMethod === "credit" &&
      !selectedCustomerId
    ) {
      return "اختر الزبون أولًا للبيع على الحساب";
    }

    if (
      loadedSale !== null &&
      loadedSale.sale.paymentMethod ===
        "credit" &&
      editMode
    ) {
      return "تعديل فاتورة آجل محفوظة غير متاح من هذه الشاشة حاليًا";
    }

    if (
      loadedSale !== null &&
      paymentMethod !== loadedSale.sale.paymentMethod
    ) {
      return "لا يمكن تغيير طريقة الدفع أثناء تعديل الفاتورة";
    }

    if (lines.length === 0) {
      return "يجب إضافة صنف واحد على الأقل";
    }

    let grossMinor = 0;
    let itemDiscountTotalMinor = 0;

    for (const line of lines) {
      if (!selectionIsComplete(line)) {
        return `اختر اللون والمقاس للمنتج ${line.product.nameAr}`;
      }

      if (
        !Number.isSafeInteger(line.quantity) ||
        line.quantity < 1 ||
        line.quantity > 99
      ) {
        return `كمية ${line.product.nameAr} يجب أن تكون بين 1 و99`;
      }

      const unitPriceMinor = parseMoneyInput(line.unitPrice);

      if (unitPriceMinor === null) {
        return `سعر بيع ${line.product.nameAr} غير صالح`;
      }

      const discountMinor = parseMoneyInput(line.discount);

      if (discountMinor === null) {
        return `خصم ${line.product.nameAr} غير صالح`;
      }

      const lineGrossMinor = unitPriceMinor * line.quantity;

      if (
        !Number.isSafeInteger(lineGrossMinor) ||
        lineGrossMinor > 2_000_000_000
      ) {
        return `قيمة ${line.product.nameAr} تتجاوز الحد المسموح`;
      }

      if (discountMinor > lineGrossMinor) {
        return `خصم ${line.product.nameAr} أكبر من قيمة الصنف`;
      }

      if (!editMode) {
        const stock = getLineStock(line);

        if (stock !== null && line.quantity > stock) {
          return `الكمية المطلوبة من ${line.product.nameAr} غير متوفرة`;
        }

        if (line.product.outOfStock) {
          return `المنتج ${line.product.nameAr} نافد من المخزون`;
        }
      }

      grossMinor += lineGrossMinor;
      itemDiscountTotalMinor += discountMinor;
    }

    const strictInvoiceDiscountMinor = parseMoneyInput(invoiceDiscount);

    if (strictInvoiceDiscountMinor === null) {
      return "خصم الفاتورة غير صالح";
    }

    const itemsNetMinor = grossMinor - itemDiscountTotalMinor;

    if (strictInvoiceDiscountMinor > itemsNetMinor) {
      return "خصم الفاتورة أكبر من صافي قيمة الأصناف";
    }

    const strictPaidMinor = parseMoneyInput(paidAmount);

    if (strictPaidMinor === null) {
      return "المبلغ المدفوع غير صالح";
    }

    if (
      paymentMethod === "credit" &&
      strictPaidMinor !== 0
    ) {
      return "البيع على حساب الزبون يجب أن يكون بدون دفعة";
    }

    const totalMinor = itemsNetMinor - strictInvoiceDiscountMinor;

    if (
      paymentMethod !== "credit" &&
      strictPaidMinor < totalMinor
    ) {
      return "المبلغ المدفوع أقل من قيمة الفاتورة";
    }

    return null;
  }

  function getInvoiceRequestItems() {
    return lines.map((line) => ({
      productId: line.product.productId,
      barcode: line.barcode.trim() || undefined,
      quantity: line.quantity,
      soldUnitPrice: line.unitPrice.trim(),
      lineDiscount: line.discount.trim(),
      color: line.color ?? undefined,
      size: line.size ?? undefined,
    }));
  }

  async function refreshCashSession() {
    if (!session) {
      return;
    }

    const current = await getCurrentCashSession(token, session.registerKey);

    setSession(current.session);
  }

  async function handleEditInvoice() {
    const sale = loadedSale?.sale;

    if (!sale || sale.status !== "completed" || invoiceBusy || editMode) {
      return;
    }

    if (
      sale.paymentMethod ===
      "card"
    ) {
      setError(
        "تعديل فاتورة فيزا غير متاح حاليًا حتى لا يختلف حساب الفيزا الوسيط عن قيمة الفاتورة. ألغِ الفاتورة وأعد إصدارها بالطريقة الصحيحة.",
      );
      return;
    }

    if (
      sale.cashTender &&
      sale.cashTender.currencyCode !==
        "ILS"
    ) {
      setError(
        "تعديل فاتورة مدفوعة بعملة أجنبية غير متاح؛ ألغِ الفاتورة وأعد إصدارها حتى يبقى صندوق العملة وسعر الصرف صحيحين.",
      );
      return;
    }

    setInvoiceBusy(true);
    setError("");
    setMessage("");

    try {
      const refreshedLines = await Promise.all(
        lines.map(async (line) => {
          if (!line.barcode.trim()) {
            return line;
          }

          const product = await lookupPosProductByBarcode(
            token,
            line.barcode,
          );

          return {
            ...line,
            product,
            color: line.color ?? product.mappedColor,
            size: line.size ?? product.mappedSize,
          };
        }),
      );

      setLines(refreshedLines);
      setEditMode(true);
      editIdempotencyKey.current = null;

      setMessage(
        `الفاتورة ${sale.publicId} مفتوحة للتعديل. لم يتم حفظ أي تغيير بعد.`,
      );

      focusSearch();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        clearAuthentication();
        return;
      }

      setError(
        caught instanceof Error ? caught.message : "تعذر فتح الفاتورة للتعديل",
      );
    } finally {
      setInvoiceBusy(false);
    }
  }

  function handleCancelEdit() {
    const publicId = loadedSale?.sale.publicId;

    if (!publicId || invoiceBusy) {
      return;
    }

    editIdempotencyKey.current = null;
    setEditMode(false);

    void loadStoredInvoice(publicId);
  }

  async function postCustomerInvoiceReceipt(
    invoicePublicId: string,
    customerId: number,
    settlement: InvoiceSettlement,
  ) {
    const response = await createPosCustomerReceipt(
      token,
      customerId,
      {
        amount: (settlement.amountMinor / 100).toFixed(2),
        paymentMethod: settlement.method,
        ...(settlement.method === "card" && settlement.cardProcessor
          ? { cardProcessor: settlement.cardProcessor }
          : {}),
        registerKey: session?.registerKey ?? "main",
        notes: `تسديد فاتورة المبيعات ${invoicePublicId}`,
        // One initial collection per invoice. Retrying never issues a second receipt.
        idempotencyKey: `pos_invoice_initial_receipt:${invoicePublicId}`,
      },
    );

    if (
      response.voucher.amountMinor !== settlement.amountMinor ||
      response.voucher.paymentMethod !== settlement.method ||
      response.voucher.status !== "posted"
    ) {
      throw new Error(
        "سند القبض المرتبط بهذه الفاتورة لا يطابق الدفعة المطلوبة؛ راجع سندات الزبون قبل أي محاولة جديدة.",
      );
    }

    setPendingInvoiceSettlement(null);
    setLinkedReceipt({
      publicId: response.voucher.publicId,
      amountMinor: response.voucher.amountMinor,
      method: settlement.method,
    });
    setMessage(
      `تم حفظ الفاتورة ${invoicePublicId} على حساب الزبون، وتسجيل سند قبض ${response.voucher.publicId} بمبلغ ${formatMinor(settlement.amountMinor)}.`,
    );
    try {
      await refreshCashSession();
    } catch {
      // Receipt has already posted; cash session display can refresh separately.
    }
  }

  async function retryPendingInvoiceSettlement() {
    if (!pendingInvoiceSettlement || invoiceBusy) {
      return;
    }

    setInvoiceBusy(true);
    setError("");
    try {
      await postCustomerInvoiceReceipt(
        pendingInvoiceSettlement.publicId,
        pendingInvoiceSettlement.customerId,
        pendingInvoiceSettlement.settlement,
      );
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        clearAuthentication();
        return;
      }

      setError(
        `الفاتورة ${pendingInvoiceSettlement.publicId} محفوظة كآجل. لم نتأكد من سند القبض: ${caught instanceof Error ? caught.message : "حدث خطأ"}. استخدم إعادة محاولة السند، ولا تنشئ فاتورة أخرى.`,
      );
    } finally {
      setInvoiceBusy(false);
    }
  }

  function openSettlementDialog() {
    if (!ACCOUNTING_WRITES_ENABLED || invoiceBusy || editMode || loadedSale) {
      return;
    }

    const validationError = validateInvoiceForSave();
    if (validationError) {
      setError(validationError);
      return;
    }

    if (!selectedCustomerId || paymentMethod !== "credit") {
      setError("اختر زبونًا مسجّلًا لحفظ الفاتورة على حسابه ثم تسديدها");
      return;
    }

    if (finalTotalMinor <= 0) {
      setError("قيمة الفاتورة يجب أن تكون أكبر من صفر لإصدار سند قبض");
      return;
    }

    setSettlementKind("full");
    setSettlementAmount((finalTotalMinor / 100).toFixed(2));
    setSettlementMethod("cash");
    setSettlementCardProcessor(null);
    setSettlementOpen(true);
    setError("");
  }

  function confirmSettlementDialog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const amountMinor = settlementKind === "full"
      ? finalTotalMinor
      : parseMoneyInput(settlementAmount);

    if (
      amountMinor === null ||
      amountMinor <= 0 ||
      amountMinor > finalTotalMinor ||
      (settlementKind === "partial" && amountMinor >= finalTotalMinor)
    ) {
      setError("الدفعة الجزئية يجب أن تكون أكبر من صفر وأقل من قيمة الفاتورة؛ اختر كامل المبلغ للدفع الكامل");
      return;
    }

    if (settlementMethod === "card" && !settlementCardProcessor) {
      setError("اختر ماكينة الفيزا لتسجيل سند القبض");
      return;
    }

    setSettlementOpen(false);
    void handleSaveInvoice(false, {
      amountMinor,
      method: settlementMethod,
      cardProcessor: settlementMethod === "card"
        ? settlementCardProcessor
        : null,
    });
  }

  async function handleSaveInvoice(
    printAfterSave = false,
    settlement: InvoiceSettlement | null = null,
  ) {
    if (!ACCOUNTING_WRITES_ENABLED) {
      setError("الحفظ محمي حاليًا حتى تشغيل الـMigration وتجهيز بيئة الاختبار");
      return;
    }

    if (loadedSale && !editMode) {
      setError("اضغط تعديل أولًا لتغيير الفاتورة المحفوظة");
      return;
    }

    const validationError = validateInvoiceForSave();

    if (validationError) {
      setError(validationError);
      return;
    }

    if (!session) {
      setError("جلسة الصندوق غير متاحة");
      return;
    }

    const commonInput = {
      registerKey: session.registerKey,
      paymentMethod:
        loadedSale?.sale.paymentMethod === "card"
          ? ("card" as const)
          : ("cash" as const),
      discountAmount: invoiceDiscount.trim(),
      paidAmount: paidAmount.trim(),
      customerId:
        selectedCustomerId ?? undefined,
      customerName: customerName.trim() || undefined,
      customerPhone: customerPhone.trim() || undefined,
      notes: notes.trim() || undefined,
      items: getInvoiceRequestItems(),
    };

    setError("");
    setMessage("");

    try {
      setInvoiceBusy(true);

      if (loadedSale && editMode) {
        const reason = window.prompt(
          `أدخل سبب تعديل الفاتورة ${loadedSale.sale.publicId}`,
          "",
        );

        if (!reason?.trim()) {
          return;
        }

        const confirmed = window.confirm(
          [
            `سيتم حفظ التعديل على الفاتورة ${loadedSale.sale.publicId} بنفس الرقم.`,
            `القيمة الجديدة: ${formatMinor(finalTotalMinor)}`,
            "سيتم تعديل فرق المخزون ورصيد الصندوق وتسجيل مراجعة محاسبية.",
            "",
            "هل تريد المتابعة؟",
          ].join("\n"),
        );

        if (!confirmed) {
          return;
        }

        const requestKey =
          editIdempotencyKey.current ?? `pos_edit_${createKey()}`;

        editIdempotencyKey.current = requestKey;

        const result = await updatePosSale(token, {
          ...commonInput,
          publicId: loadedSale.sale.publicId,
          idempotencyKey: requestKey,
          expectedUpdatedAt: loadedSale.sale.updatedAt,
          reason: reason.trim(),
        });

        editIdempotencyKey.current = null;

        const refreshed = await getPosSaleByPublicId(
          token,
          result.sale.publicId,
        );

        setLoadedSale(refreshed);

        printAfterSaveRef.current = printAfterSave;

        setLines(refreshed.items.map(toStoredInvoiceLine));

        setInvoiceDiscount(
          (
            refreshed.sale.invoiceDiscount ??
            refreshed.sale.discount ??
            0
          ).toFixed(2),
        );

        setPaidAmount(refreshed.sale.paid.toFixed(2));

        lastTouchedLineId.current = null;
        setEditMode(false);

        setMessage(
          result.alreadyUpdated
            ? `تم تحميل التعديل المحفوظ مسبقًا للفاتورة ${result.sale.publicId}.`
            : `تم حفظ تعديل الفاتورة ${result.sale.publicId} — المراجعة رقم ${result.revisionNumber}.`,
        );

        await refreshCashSession();
        return;
      }

      const confirmed = window.confirm(
        [
          `سيتم حفظ فاتورة جديدة بقيمة ${formatMinor(finalTotalMinor)}.`,
          paymentMethod === "credit"
            ? "سيتم خصم الكميات من المخزون وإضافة كامل قيمة الفاتورة إلى حساب الزبون."
            : "سيتم خصم الكميات من المخزون وإضافة القيمة إلى الصندوق.",
          "",
          "هل تريد المتابعة؟",
        ].join("\n"),
      );

      if (!confirmed) {
        return;
      }

      const requestKey =
        createIdempotencyKey.current ?? `pos_invoice_${createKey()}`;

      createIdempotencyKey.current = requestKey;

      const result =
        await createPosSale(
          token,
          {
            registerKey:
              session.registerKey,

            idempotencyKey:
              requestKey,

            paymentMethod:
              paymentMethod ===
              "credit"
                ? "credit"
                : "cash",

            discountAmount:
              invoiceDiscount.trim(),

            paidAmount:
              paymentMethod ===
              "credit"
                ? "0.00"
                : paidAmount.trim(),

            customerId:
              selectedCustomerId ??
              undefined,

            customerName:
              customerName.trim() ||
              undefined,

            customerPhone:
              customerPhone.trim() ||
              undefined,

            notes:
              notes.trim() ||
              undefined,

            items:
              getInvoiceRequestItems(),
          },
        );

      createIdempotencyKey.current = null;
      setLoadedSale(result);

      printAfterSaveRef.current = printAfterSave;

      setEditMode(false);

      setSearchParams(
        {
          publicId: result.sale.publicId,
        },
        {
          replace: true,
        },
      );

      setMessage(
        result.alreadyCreated
          ? `تم تحميل الفاتورة المحفوظة ${result.sale.publicId} دون تكرار العملية.`
          : `تم حفظ الفاتورة ${result.sale.publicId} وخصم المخزون.`,
      );

      if (settlement && selectedCustomerId) {
        setPendingInvoiceSettlement({
          publicId: result.sale.publicId,
          customerId: selectedCustomerId,
          settlement,
        });

        try {
          await postCustomerInvoiceReceipt(
            result.sale.publicId,
            selectedCustomerId,
            settlement,
          );
        } catch (receiptError) {
          if (receiptError instanceof ApiError && receiptError.status === 401) {
            clearAuthentication();
            return;
          }

          setError(
            `تم حفظ الفاتورة ${result.sale.publicId} على حساب الزبون وخصم المخزون، لكن لم نؤكد سند القبض: ${receiptError instanceof Error ? receiptError.message : "حدث خطأ"}. أعد محاولة سند القبض فقط، ولا تنشئ فاتورة ثانية.`,
          );
          setMessage("");
        }
      }

      try {
        await refreshCashSession();
      } catch {
        // A secondary refresh failure must not obscure a committed invoice.
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        clearAuthentication();
        return;
      }

      setError(
        caught instanceof Error
          ? caught.message
          : loadedSale
            ? "تعذر حفظ تعديل الفاتورة"
            : "تعذر حفظ الفاتورة",
      );
    } finally {
      setInvoiceBusy(false);
    }
  }

  async function loadStoredInvoice(rawPublicId: string) {
    const publicId = rawPublicId.trim().toUpperCase();

    if (!publicId) {
      setError("أدخل رقم الفاتورة");
      return;
    }

    setInvoiceBusy(true);
    setError("");
    setMessage("");
    clearSearchResults();

    try {
      const response = await getPosSaleByPublicId(token, publicId);

      setLoadedSale(response);
      setEditMode(false);

      createIdempotencyKey.current = null;
      editIdempotencyKey.current = null;

      setInvoiceDateTime(toLocalDateTimeValue(response.sale.createdAt));

      setInvoiceType("cash");
      setWarehouse("main");

      setCustomerName(response.sale.customerName ?? "");

      setSelectedCustomerId(
        response.sale.customerId
          ? Number(
              response.sale.customerId,
            )
          : null,
      );

      setCustomerPhone(response.sale.customerPhone ?? "");

      setRepresentative("");
      setNotes(response.sale.notes ?? "");

      setQuery("");
      setLines(response.items.map(toStoredInvoiceLine));

      lastTouchedLineId.current = null;

      setInvoiceDiscount(
        (response.sale.invoiceDiscount ?? response.sale.discount ?? 0).toFixed(
          2,
        ),
      );

      setPaidAmountAuto(false);
      setPaidAmount(response.sale.paid.toFixed(2));

      setPaymentMethod(response.sale.paymentMethod);
      setCostCenter("general");

      setMessage(
        response.sale.status === "voided"
          ? `تم تحميل الفاتورة ${response.sale.publicId} — الفاتورة ملغاة`
          : `تم تحميل الفاتورة ${response.sale.publicId} للعرض`,
      );
    } catch (caught) {
      setLoadedSale(null);
      setLines([]);

      if (caught instanceof ApiError && caught.status === 401) {
        clearAuthentication();
        return;
      }

      setError(
        caught instanceof Error ? caught.message : "تعذر تحميل الفاتورة",
      );
    } finally {
      setInvoiceBusy(false);
    }
  }

  function openStoredInvoice(publicId: string) {
    setSearchParams(
      {
        publicId: publicId.trim().toUpperCase(),
      },
      {
        replace: true,
      },
    );
  }

  useEffect(() => {
    if (!printAfterSaveRef.current || !loadedSale) {
      return;
    }

    printAfterSaveRef.current = false;

    const timer = window.setTimeout(() => {
      void printLoadedSaleDirect();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadedSale]);

  async function printLoadedSaleDirect() {
    if (!loadedSale) {
      setError("لا توجد فاتورة جاهزة للطباعة.");
      return;
    }

    try {
      setError("");

      let receiptSale = loadedSale;

      if (loadedSale.sale.customerId) {
        receiptSale = await getPosSaleByPublicId(
          token,
          loadedSale.sale.publicId,
        );

        setLoadedSale(receiptSale);

        await new Promise<void>((resolve) =>
          window.requestAnimationFrame(() =>
            window.requestAnimationFrame(() => resolve()),
          ),
        );
      }

      const source = receiptRef.current;

      if (!source) {
        throw new Error("لا توجد فاتورة جاهزة للطباعة.");
      }

      await printReceiptElementDirect(source);
      setMessage(`تم إرسال الفاتورة ${receiptSale.sale.publicId} إلى الطابعة.`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "تعذر إرسال الفاتورة إلى الطابعة",
      );
    }
  }

  function submitOpenInvoice(rawValue: string) {
    const publicId =
      rawValue.trim().toUpperCase();

    if (!publicId) {
      setError("أدخل رقم الفاتورة");
      openInvoiceInputRef.current?.focus();
      return;
    }

    setOpenInvoiceDialog(false);
    setOpenInvoiceValue("");

    if (publicId === requestedPublicId) {
      void loadStoredInvoice(publicId);
      return;
    }

    openStoredInvoice(publicId);
  }

  function handleOpenInvoice() {
    setOpenInvoiceValue(
      loadedSale?.sale.publicId ?? "",
    );
    setOpenInvoiceDialog(true);

    window.setTimeout(() => {
      openInvoiceInputRef.current?.focus();
      openInvoiceInputRef.current?.select();
    }, 0);
  }

  function handleOpenInvoiceScannerKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
  ) {
    if (event.nativeEvent.isComposing) {
      return;
    }

    const scannedValue =
      captureScannerKeyboardEvent(
        openInvoiceScannerKeyboard.current,
        event,
      );

    if (
      event.key === "Enter" &&
      scannedValue
    ) {
      event.preventDefault();
      setOpenInvoiceValue(scannedValue);
      submitOpenInvoice(scannedValue);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setOpenInvoiceDialog(false);
    }
  }

  function handleCopyInvoice() {
    if (!loadedSale) {
      return;
    }

    const sourcePublicId = loadedSale.sale.publicId;

    setLoadedSale(null);
    setPaidAmountAuto(true);
    setEditMode(false);
    setLinkedReceipt(null);
    setPendingInvoiceSettlement(null);

    createIdempotencyKey.current = null;
    editIdempotencyKey.current = null;

    setSearchParams(
      {},
      {
        replace: true,
      },
    );

    setInvoiceDateTime(getLocalDateTimeValue());

    if (selectedCustomerId) {
      setPaymentMethod("credit");
      setPaidAmountAuto(false);
      setPaidAmount("0.00");
    }

    setLines((current) =>
      current.map((line) => ({
        ...line,
        id: createKey(),
      })),
    );

    lastTouchedLineId.current = null;

    setError("");
    setMessage(
      `تم نسخ الفاتورة ${sourcePublicId} إلى مسودة جديدة. الأصل لم يتغير.`,
    );

    clearSearchResults();
    focusSearch();
  }

  async function handleVoidInvoice() {
    const sale = loadedSale?.sale;

    if (!ACCOUNTING_WRITES_ENABLED) {
      setError("إلغاء الفاتورة محمي حاليًا حتى تجهيز بيئة الاختبار");
      return;
    }

    if (!sale || sale.status !== "completed" || editMode) {
      return;
    }

    const reason = window.prompt(
      `أدخل سبب إلغاء الفاتورة ${sale.publicId}`,
      "",
    );

    if (!reason?.trim()) {
      return;
    }

    const confirmed = window.confirm(
      [
        `سيتم إلغاء الفاتورة ${sale.publicId}.`,
        `القيمة: ${formatMinor(sale.totalMinor)}`,
        sale.paymentMethod === "card"
          ? "سيُعاد المخزون ويُعكس قيد مبيعات الفيزا من حساب ماكينة الفيزا الأصلية."
          : "سيُعاد المخزون ويُطرح صافي الفاتورة من المبيعات والصندوق.",
        "ستبقى الفاتورة محفوظة وتحمل حالة ملغاة.",
        "",
        "هل تريد المتابعة؟",
      ].join("\n"),
    );

    if (!confirmed) {
      return;
    }

    setInvoiceBusy(true);
    setError("");
    setMessage("");

    try {
      const response = await voidPosSale(token, {
        publicId: sale.publicId,
        reason: reason.trim(),
      });

      setLoadedSale(response);
      setEditMode(false);

      await refreshCashSession();

      setMessage(`تم إلغاء الفاتورة ${response.sale.publicId} وإعادة مخزونها.`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        clearAuthentication();
        return;
      }

      setError(
        caught instanceof Error ? caught.message : "تعذر إلغاء الفاتورة",
      );
    } finally {
      setInvoiceBusy(false);
    }
  }

  function hasUnsavedInvoiceChanges() {
    if (editMode) {
      return true;
    }

    if (loadedSale) {
      return false;
    }

    return (
      lines.length > 0 ||
      customerName.trim().length > 0 ||
      customerPhone.trim().length > 0 ||
      representative.trim().length > 0 ||
      notes.trim().length > 0 ||
      invoiceDiscount !== "0.00"
    );
  }

  function resetInvoiceForm() {
    setLoadedSale(null);
    setSettlementOpen(false);
    setPendingInvoiceSettlement(null);
    setLinkedReceipt(null);
    setPaidAmountAuto(true);
    setEditMode(false);

    createIdempotencyKey.current = null;
    editIdempotencyKey.current = null;

    setSearchParams(
      {},
      {
        replace: true,
      },
    );

    setInvoiceDateTime(getLocalDateTimeValue());
    setInvoiceType("cash");
    setWarehouse("main");
    setSelectedCustomerId(null);
    setCustomerName("");
    setCustomerPhone("");
    setRepresentative("");
    setNotes("");
    setQuery("");
    setLines([]);
    lastTouchedLineId.current = null;
    setInvoiceDiscount("0.00");
    setPaidAmount("0.00");
    setPaymentMethod("cash");
    setCostCenter("general");
    setError("");
    setMessage("");
    clearSearchResults();
    focusSearch();
  }

  function handleNewInvoice() {
    if (invoiceBusy) {
      return;
    }

    if (pendingInvoiceSettlement) {
      setError("الفاتورة محفوظة، لكن سند القبض بحاجة لتأكيد. أعد محاولة سند القبض قبل الانتقال لفاتورة أخرى.");
      return;
    }

    if (
      hasUnsavedInvoiceChanges() &&
      !window.confirm(
        "توجد تغييرات غير محفوظة. هل تريد تركها وفتح فاتورة جديدة؟",
      )
    ) {
      return;
    }

    resetInvoiceForm();
  }

  function handleUndoInvoice() {
    if (invoiceBusy || !hasUnsavedInvoiceChanges()) {
      return;
    }

    if (editMode) {
      if (
        !window.confirm(
          `هل تريد إلغاء التعديلات غير المحفوظة على الفاتورة ${
            loadedSale?.sale.publicId ?? ""
          }؟`,
        )
      ) {
        return;
      }

      handleCancelEdit();
      return;
    }

    if (
      !window.confirm(
        "هل تريد مسح التغييرات غير المحفوظة من الفاتورة الجديدة؟",
      )
    ) {
      return;
    }

    resetInvoiceForm();
  }

  useEffect(() => {
    function handleInvoiceShortcut(event: globalThis.KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        settlementOpen ||
        openInvoiceDialog
      ) {
        return;
      }

      if (
        event.key === "F3" &&
        !invoiceBusy &&
        ACCOUNTING_WRITES_ENABLED &&
        !(loadedSale && !editMode)
      ) {
        event.preventDefault();
        void handleSaveInvoice();
        return;
      }

      if (event.key === "F6" && !invoiceBusy) {
        event.preventDefault();
        handleNewInvoice();
        return;
      }

      if (
        event.key === "F7" &&
        !invoiceBusy &&
        hasUnsavedInvoiceChanges()
      ) {
        event.preventDefault();
        handleUndoInvoice();
        return;
      }

      if (
        event.key === "F4" &&
        !invoiceBusy &&
        !editMode &&
        ACCOUNTING_WRITES_ENABLED &&
        loadedSale?.sale.status === "completed"
      ) {
        event.preventDefault();
        void handleVoidInvoice();
      }
    }

    window.addEventListener("keydown", handleInvoiceShortcut);

    return () => {
      window.removeEventListener("keydown", handleInvoiceShortcut);
    };
  });

  return (
    <section className="accounting-invoice-page sales-invoice-scroll-page">
      <header className="accounting-invoice-titlebar">
        <div>
          <span>الفواتير</span>
          <h1>فاتورة مبيعات</h1>
          <p>اختر الزبون، أضف الأصناف، ثم احفظ على حسابه أو احفظ مع إصدار سند قبض كامل أو جزئي.</p>
        </div>

        <span
          className={[
            "accounting-invoice-draft-badge",
            loadedSale?.sale.status === "voided"
              ? "is-voided"
              : loadedSale
                ? "is-stored"
                : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {invoiceBusy
            ? "جاري تحميل الفاتورة…"
            : loadedSale?.sale.status === "voided"
              ? "فاتورة ملغاة — للعرض فقط"
              : editMode
                ? "فاتورة محفوظة — قيد التعديل"
                : loadedSale
                  ? "فاتورة محفوظة — للعرض فقط"
                  : ACCOUNTING_WRITES_ENABLED
                    ? "مسودة فاتورة جديدة"
                    : "واجهة تطوير — الكتابة محمية"}
        </span>
      </header>

      {loadedSale?.sale.status === "voided" && (
        <div className="accounting-voided-invoice-notice">
          <strong>هذه الفاتورة ملغاة</strong>

          <span>
            {loadedSale.sale.voidReason
              ? `سبب الإلغاء: ${loadedSale.sale.voidReason}`
              : "لم يُسجل سبب الإلغاء"}
          </span>
        </div>
      )}

      <div className="accounting-invoice-toolbar">
        <button
          type="button"
          disabled={invoiceBusy}
          onClick={handleNewInvoice}
        >
          <span aria-hidden="true">＋</span>
          جديد
          <kbd>F6</kbd>
        </button>

        <button
          className="is-primary-action"
          type="button"
          disabled={
            invoiceBusy ||
            !ACCOUNTING_WRITES_ENABLED ||
            (loadedSale !== null && !editMode)
          }
          title={
            ACCOUNTING_WRITES_ENABLED
              ? undefined
              : "الحفظ محمي حتى تشغيل Migration وتجهيز الاختبار"
          }
          onClick={() => {
            void handleSaveInvoice();
          }}
        >
          <span aria-hidden="true">💾</span>
          {editMode ? "حفظ التعديل" : "حفظ"}
          <kbd>F3</kbd>
        </button>

        <button
          type="button"
          className="accounting-save-settle-action"
          disabled={
            invoiceBusy ||
            !ACCOUNTING_WRITES_ENABLED ||
            !!loadedSale ||
            editMode ||
            !selectedCustomerId
          }
          title={selectedCustomerId ? "إصدار فاتورة آجل مع سند قبض للدفعة" : "اختر زبونًا مسجّلًا أولًا"}
          onClick={openSettlementDialog}
        >
          <span aria-hidden="true">₪</span>
          حفظ وتسديد
        </button>

        <button
          type="button"
          disabled={invoiceBusy || !hasUnsavedInvoiceChanges()}
          onClick={handleUndoInvoice}
        >
          <span aria-hidden="true">↶</span>
          تراجع
          <kbd>F7</kbd>
        </button>

        <button
          className="is-danger-action"
          type="button"
          disabled={
            invoiceBusy ||
            editMode ||
            !ACCOUNTING_WRITES_ENABLED ||
            !loadedSale ||
            loadedSale.sale.status !== "completed" ||
            !!linkedReceipt ||
            !!pendingInvoiceSettlement
          }
          title={linkedReceipt || pendingInvoiceSettlement
            ? "اعكس سند القبض المرتبط أولًا، قبل إلغاء الفاتورة"
            : undefined}
          onClick={() => {
            void handleVoidInvoice();
          }}
        >
          <span aria-hidden="true">✕</span>
          إلغاء الفاتورة
          <kbd>F4</kbd>
        </button>

        <button
          type="button"
          disabled={
            invoiceBusy ||
            editMode ||
            !loadedSale?.navigation?.previousPublicId
          }
          onClick={() => {
            const target = loadedSale?.navigation?.previousPublicId;

            if (target) {
              openStoredInvoice(target);
            }
          }}
        >
          <span aria-hidden="true">←</span>
          السابق
        </button>

        <button
          type="button"
          disabled={invoiceBusy || editMode}
          onClick={handleOpenInvoice}
        >
          <span aria-hidden="true">🔎</span>
          فتح فاتورة
        </button>

        <button
          type="button"
          disabled={
            invoiceBusy ||
            editMode ||
            !loadedSale?.navigation?.nextPublicId
          }
          onClick={() => {
            const target = loadedSale?.navigation?.nextPublicId;

            if (target) {
              openStoredInvoice(target);
            }
          }}
        >
          <span aria-hidden="true">→</span>
          التالي
        </button>

        <button
          type="button"
          disabled={
            invoiceBusy ||
            editMode ||
            !loadedSale ||
            loadedSale.sale.status !== "completed" ||
            loadedSale.sale.paymentMethod === "card" ||
            (
              loadedSale.sale.cashTender !== null &&
              loadedSale.sale.cashTender.currencyCode !== "ILS"
            )
          }
          onClick={() => {
            void handleEditInvoice();
          }}
        >
          <span aria-hidden="true">✎</span>
          تعديل
        </button>

        <button
          type="button"
          disabled={invoiceBusy || editMode || !loadedSale}
          onClick={handleCopyInvoice}
        >
          <span aria-hidden="true">⧉</span>
          نسخ
        </button>

        <button
          type="button"
          disabled={invoiceBusy || (editMode && !loadedSale)}
          onClick={() => {
            if (loadedSale && !editMode) {
              void printLoadedSaleDirect();
              return;
            }

            void handleSaveInvoice(true);
          }}
        >
          <span aria-hidden="true">🖨️</span>
          {loadedSale && !editMode ? "طباعة" : "حفظ وطباعة"}
        </button>

        <button type="button" disabled>
          <span aria-hidden="true">👁️</span>
          معاينة الطباعة
        </button>
      </div>

      {pendingInvoiceSettlement && loadedSale?.sale.publicId === pendingInvoiceSettlement.publicId && (
        <div className="accounting-settlement-notice is-pending" role="alert">
          <strong>الفاتورة محفوظة على حساب الزبون، وسند القبض يحتاج تأكيدًا.</strong>
          <span>لا تحفظ فاتورة ثانية. أعد محاولة سند القبض بنفس المفتاح لمنع التكرار.</span>
          <button type="button" disabled={invoiceBusy} onClick={() => void retryPendingInvoiceSettlement()}>
            {invoiceBusy ? "جاري التحقق…" : "إعادة محاولة سند القبض"}
          </button>
        </div>
      )}
      {linkedReceipt && loadedSale && (
        <div className="accounting-settlement-notice is-complete" role="status">
          <strong>سند قبض معتمد: {linkedReceipt.publicId}</strong>
          <span>المقبوض {formatMinor(linkedReceipt.amountMinor)} — المتبقي من الفاتورة {formatMinor(Math.max(0, loadedSale.sale.totalMinor - linkedReceipt.amountMinor))}. البيع مسجل على حساب الزبون، والقبض حركة مستقلة.</span>
        </div>
      )}

      <fieldset
        className="accounting-invoice-lockable"
        disabled={invoiceLocked}
      >
        <section className="accounting-invoice-information">
          <div className="accounting-invoice-card">
            <h2>بيانات الفاتورة</h2>

            <div className="accounting-fields-grid">
              <label>
                <span>رقم الفاتورة</span>
                <input
                  dir="ltr"
                  value={loadedSale?.sale.publicId ?? "تلقائي عند الحفظ"}
                  readOnly
                />
              </label>

              <label>
                <span>التاريخ والوقت</span>
                <input
                  type="datetime-local"
                  value={invoiceDateTime}
                  onChange={(event) => setInvoiceDateTime(event.target.value)}
                />
              </label>

              <label>
                <span>نوع الفاتورة</span>
                <select
                  value={invoiceType}
                  onChange={(event) => setInvoiceType(event.target.value)}
                >
                  <option value="cash">فاتورة مبيعات</option>
                </select>
              </label>

              <label>
                <span>المستودع</span>
                <select
                  value={warehouse}
                  onChange={(event) => setWarehouse(event.target.value)}
                >
                  <option value="main">المستودع الرئيسي</option>
                </select>
              </label>
            </div>
          </div>

          <div className="accounting-invoice-card">
            <h2>بيانات الزبون</h2>

            <div className="accounting-fields-grid">
              <div className="accounting-wide-field">
                <CustomerPicker
                  customers={
                    customers
                  }
                  value={
                    selectedCustomerId
                  }
                  fallbackName={
                    customerName
                  }
                  loading={
                    customersBusy
                  }
                  disabled={
                    invoiceBusy ||
                    loadedSale !==
                      null
                  }
                  error={
                    customersError
                  }
                  label="اسم الزبون"
                  placeholder="بدون حساب زبون"
                  onChange={(
                    customer,
                  ) => {
                    if (!customer) {
                      setSelectedCustomerId(null);
                      setCustomerName("");
                      setCustomerPhone("");
                      if (!loadedSale) {
                        setPaymentMethod("cash");
                        setPaidAmountAuto(true);
                        setPaidAmount((finalTotalMinor / 100).toFixed(2));
                      }
                      return;
                    }

                    setSelectedCustomerId(
                      customer.id,
                    );

                    setCustomerName(
                      customer.name,
                    );

                    setCustomerPhone(
                      customer.phone ??
                        "",
                    );

                    // Registered customer invoices are recognized as receivables.
                    // Any immediate cash/card payment is recorded by a receipt voucher.
                    if (!loadedSale) {
                      setPaymentMethod("credit");
                      setPaidAmountAuto(false);
                      setPaidAmount("0.00");
                    }
                  }}
                />
              </div>

              {!loadedSale && (
                <p className="accounting-customer-credit-hint accounting-wide-field">
                  {selectedCustomerId
                    ? "✓ الزبون مسجّل: عند الحفظ تُضاف الفاتورة لذمته. استخدم «حفظ وتسديد» لإصدار سند قبض فوري."
                    : "اختر زبونًا مسجّلًا لربط الفاتورة بذمته، أو اترك الحقل فارغًا لبيع نقدي عادي."}
                </p>
              )}
              <label>
                <span>رقم الهاتف</span>
                <input
                  dir="ltr"
                  inputMode="tel"
                  value={customerPhone}
                  readOnly
                  placeholder="يظهر بعد اختيار الزبون"
                />
              </label>

              <label>
                <span>المندوب</span>
                <input
                  placeholder="اختياري"
                  value={representative}
                  onChange={(event) => setRepresentative(event.target.value)}
                />
              </label>

              <label className="accounting-wide-field">
                <span>ملاحظات الفاتورة</span>
                <input
                  placeholder="ملاحظات اختيارية"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </label>
            </div>
          </div>
        </section>

        <section className="accounting-item-entry">
          <form className="accounting-item-form" onSubmit={handleProductSearch}>
            <label>
              <span>الباركود أو كود الصنف</span>
              <input
                ref={searchInput}
                dir="ltr"
                autoComplete="off"
                placeholder="امسح الباركود أو اكتب كود أو اسم الصنف"
                value={query}
                disabled={lookupBusy}
                onChange={(event) => {
                  setQuery(event.target.value);

                  if (searchOpen) {
                    clearSearchResults();
                  }
                }}
                onKeyDown={handleSearchKeyDown}
              />
            </label>

            <button type="submit" disabled={lookupBusy}>
              {lookupBusy ? "جاري البحث…" : "بحث / إضافة"}
            </button>
          </form>

          <div className="accounting-entry-feedback">
            {error && <span className="is-error">{error}</span>}

            {!error && message && <span className="is-success">{message}</span>}

            {!error && !message && (
              <small>
                {ACCOUNTING_WRITES_ENABLED
                  ? "راجع بيانات الفاتورة ثم اضغط حفظ."
                  : "البحث والإضافة متاحان، والكتابة محمية حتى تجهيز بيئة الاختبار."}
              </small>
            )}
          </div>

          {(searchBusy || searchOpen) && (
            <section className="accounting-search-panel">
              <header>
                <div>
                  <strong>نتائج البحث</strong>
                  <span>استخدم الأسهم ثم Enter أو اضغط على الصنف</span>
                </div>

                <button type="button" onClick={clearSearchResults}>
                  إغلاق
                </button>
              </header>

              {searchBusy ? (
                <div className="accounting-search-loading">
                  جاري البحث عن الأصناف…
                </div>
              ) : (
                <div className="accounting-search-results">
                  {searchResults.map((product, index) => (
                    <button
                      className={index === activeSearchIndex ? "is-active" : ""}
                      type="button"
                      key={`${product.productId}-${product.barcode}`}
                      onMouseEnter={() => setActiveSearchIndex(index)}
                      onClick={() => addProduct(product)}
                    >
                      <img
                        src={product.image || PRODUCT_IMAGE_PLACEHOLDER}
                        alt=""
                        onError={(event) => {
                          event.currentTarget.onerror = null;
                          event.currentTarget.src = PRODUCT_IMAGE_PLACEHOLDER;
                        }}
                      />

                      <div>
                        <strong>{product.nameAr}</strong>

                        <span>
                          الكود: {product.productCode ?? "—"} · الباركود:{" "}
                          <b dir="ltr">{product.barcode ?? "بدون باركود"}</b>
                        </span>
                      </div>

                      <aside>
                        <strong>
                          {formatMinor(product.websiteUnitPriceMinor)}
                        </strong>

                        <span>المخزون: {product.stock ?? "غير محدد"}</span>
                      </aside>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
        </section>

        <div ref={tableWrap} className="accounting-invoice-table-wrap">
          <table className="accounting-invoice-table">
            <thead>
              <tr>
                <th>#</th>
                <th>الباركود</th>
                <th>رقم الصنف</th>
                <th>اسم الصنف</th>
                <th>اللون</th>
                <th>المقاس</th>
                <th>الوحدة</th>
                <th>الكمية</th>
                <th>سعر الوحدة</th>
                <th>الخصم</th>
                <th>المجموع</th>
                <th>حذف</th>
              </tr>
            </thead>

            <tbody>
              {lines.length === 0 ? (
                <tr className="accounting-empty-row">
                  <td colSpan={12}>
                    امسح باركود صنف أو استخدم البحث لإضافته إلى الفاتورة.
                  </td>
                </tr>
              ) : (
                lines.map((line, index) => {
                  const colors = getColors(line.product);
                  const sizes = getSizes(line.product, line.color);
                  const stock = getLineStock(line);

                  const lineTotalMinor = Math.max(
                    0,
                    moneyToMinor(line.unitPrice) * line.quantity -
                      moneyToMinor(line.discount),
                  );

                  return (
                    <tr
                      data-invoice-line-id={line.id}
                      className={[
                        selectionIsComplete(line) ? "" : "is-incomplete",
                        line.id === lastTouchedLineId.current
                          ? "is-last-touched"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={line.id}
                    >
                      <td>{index + 1}</td>

                      <td dir="ltr">{line.barcode}</td>

                      <td>{line.product.productCode ?? "—"}</td>

                      <td className="accounting-product-cell">
                        <img
                          src={
                            line.product.image ||
                            PRODUCT_IMAGE_PLACEHOLDER
                          }
                          alt=""
                          onError={(event) => {
                            event.currentTarget.onerror = null;
                            event.currentTarget.src =
                              PRODUCT_IMAGE_PLACEHOLDER;
                          }}
                        />

                        <div>
                          <strong>{line.product.nameAr}</strong>
                          <small>المخزون: {stock ?? "غير محدد"}</small>
                        </div>
                      </td>

                      <td>
                        {colors.length > 0 ? (
                          <select
                            data-invoice-field="color"
                            value={line.color ?? ""}
                            onChange={(event) =>
                              changeColor(line, event.target.value)
                            }
                          >
                            <option value="">اختر اللون</option>

                            {colors.map((color) => (
                              <option value={color} key={color}>
                                {color}
                              </option>
                            ))}
                          </select>
                        ) : (
                          "—"
                        )}
                      </td>

                      <td>
                        {sizes.length > 0 ? (
                          <select
                            data-invoice-field="size"
                            value={line.size ?? ""}
                            onChange={(event) =>
                              changeSize(
                                line,
                                event.target.value,
                              )
                            }
                          >
                            <option value="">اختر المقاس</option>

                            {sizes.map((size) => (
                              <option value={size} key={size}>
                                {size}
                              </option>
                            ))}
                          </select>
                        ) : (
                          "—"
                        )}
                      </td>

                      <td>قطعة</td>

                      <td>
                        <input
                          data-invoice-field="quantity"
                          dir="ltr"
                          type="number"
                          min="1"
                          max="99"
                          step="1"
                          value={line.quantity}
                          onFocus={(event) => event.currentTarget.select()}
                          onChange={(event) =>
                            updateLine(line.id, {
                              quantity: Math.max(
                                1,
                                Number(event.target.value) || 1,
                              ),
                            })
                          }
                        />
                      </td>

                      <td>
                        <input
                          dir="ltr"
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unitPrice}
                          onFocus={(event) => event.currentTarget.select()}
                          onChange={(event) =>
                            updateLine(line.id, {
                              unitPrice: event.target.value,
                            })
                          }
                        />
                      </td>

                      <td>
                        <input
                          dir="ltr"
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.discount}
                          onFocus={(event) => event.currentTarget.select()}
                          onChange={(event) =>
                            updateLine(line.id, {
                              discount: event.target.value,
                            })
                          }
                        />
                      </td>

                      <td className="accounting-line-total" dir="ltr">
                        {formatMinor(lineTotalMinor)}
                      </td>

                      <td>
                        <button
                          className="accounting-remove-line"
                          type="button"
                          aria-label={`حذف ${line.product.nameAr}`}
                          onClick={() =>
                            setLines((current) =>
                              current.filter((item) => item.id !== line.id),
                            )
                          }
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <section className="accounting-invoice-bottom">
          <div className="accounting-payment-section">
            <h2>الدفع والتسديد</h2>

            <div className="accounting-payment-grid">
              <label>
                <span>طريقة الدفع</span>
                <select
                  value={paymentMethod}
                  disabled={loadedSale !== null || selectedCustomerId !== null}
                  onChange={(event) => {
                    const next =
                      event.target
                        .value;

                    setPaymentMethod(
                      next,
                    );

                    if (
                      next ===
                      "credit"
                    ) {
                      setPaidAmountAuto(
                        false,
                      );
                      setPaidAmount(
                        "0.00",
                      );
                    } else if (
                      next ===
                      "cash"
                    ) {
                      setPaidAmountAuto(
                        true,
                      );
                      setPaidAmount(
                        (
                          finalTotalMinor /
                          100
                        ).toFixed(
                          2,
                        ),
                      );
                    }
                  }}
                >
                  <option value="cash">
                    نقدي — بدون حساب زبون
                  </option>

                  <option value="credit">
                    آجل — حساب الزبون
                  </option>

                  <option
                    value="card"
                    disabled
                  >
                    {loadedSale?.sale.cardProcessor ===
                    "arab"
                      ? "فيزا البنك العربي — تعديل غير متاح"
                      : loadedSale?.sale.cardProcessor ===
                          "bop"
                        ? "فيزا بنك فلسطين — تعديل غير متاح"
                        : "فيزا — تعديل غير متاح"}
                  </option>

                  <option
                    value="mixed"
                    disabled
                  >
                    دفع مختلط — قريبًا
                  </option>
                </select>
              </label>

              <label>
                <span>{paymentMethod === "credit" ? "المبلغ المدفوع: عبر سند قبض منفصل" : "المبلغ المدفوع"}</span>
                <div className="accounting-money-input">
                  <input
                    dir="ltr"
                    type="number"
                    min="0"
                    step="0.01"
                    value={paidAmount}
                    disabled={
                      paymentMethod ===
                      "credit"
                    }
                    onChange={(event) => {
                      setPaidAmountAuto(false);
                      setPaidAmount(event.target.value);
                    }}
                  />
                  <span>₪</span>
                </div>
              </label>

              <label>
                <span>مركز التكلفة</span>
                <select
                  value={costCenter}
                  onChange={(event) => setCostCenter(event.target.value)}
                >
                  <option value="general">عام</option>
                </select>
              </label>
            </div>
          </div>

          <div className="accounting-invoice-totals">
            <div>
              <span>مجموع الكميات</span>
              <strong>{totalQuantity}</strong>
            </div>

            <div>
              <span>مجموع الأصناف</span>
              <strong dir="ltr">{formatMinor(subtotalMinor)}</strong>
            </div>

            <label>
              <span>خصم الفاتورة</span>
              <div className="accounting-money-input">
                <input
                  dir="ltr"
                  type="number"
                  min="0"
                  step="0.01"
                  value={invoiceDiscount}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setInvoiceDiscount(event.target.value)}
                />
                <span>₪</span>
              </div>
            </label>

            <div className="accounting-final-total">
              <span>الإجمالي النهائي</span>
              <strong dir="ltr">{formatMinor(finalTotalMinor)}</strong>
            </div>

            <div>
              <span>{paymentMethod === "credit" ? "قيمة الفاتورة على حساب الزبون" : "الباقي للزبون"}</span>
              <strong dir="ltr">{formatMinor(paymentMethod === "credit" ? customerDueMinor : changeMinor)}</strong>
            </div>
          </div>
        </section>
      </fieldset>

      {loadedSale ? (
        <SaleReceipt
          result={loadedSale}
          receiptRef={receiptRef}
        />
      ) : null}

      {settlementOpen && (
        <div
          className="accounting-settlement-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !invoiceBusy) {
              setSettlementOpen(false);
            }
          }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="accounting-settlement-heading"
            className="accounting-settlement-dialog"
            onSubmit={confirmSettlementDialog}
          >
            <header>
              <span className="accounting-settlement-dialog-icon" aria-hidden="true">₪</span>
              <div>
                <h2 id="accounting-settlement-heading">حفظ الفاتورة وتسديدها</h2>
                <p>ستُحفظ الفاتورة على حساب {customerName}، ثم يُسجّل سند قبض للدفعة.</p>
              </div>
            </header>
            <div className="accounting-settlement-total">
              <span>إجمالي الفاتورة</span>
              <strong dir="ltr">{formatMinor(finalTotalMinor)}</strong>
            </div>
            <fieldset>
              <legend>قيمة التسديد</legend>
              <label className="accounting-settlement-radio">
                <input type="radio" name="invoice-settlement-kind" checked={settlementKind === "full"}
                  onChange={() => setSettlementKind("full")}/>
                كامل المبلغ — {formatMinor(finalTotalMinor)}
              </label>
              <label className="accounting-settlement-radio">
                <input type="radio" name="invoice-settlement-kind" checked={settlementKind === "partial"}
                  onChange={() => { setSettlementKind("partial"); setSettlementAmount(""); }}/>
                دفعة جزئية
              </label>
              {settlementKind === "partial" && (
                <label className="accounting-settlement-amount">
                  مبلغ الدفعة (₪)
                  <input type="number" dir="ltr" min="0.01" max={(finalTotalMinor / 100).toFixed(2)}
                    step="0.01" required autoFocus value={settlementAmount}
                    onChange={(event) => setSettlementAmount(event.target.value)}/>
                </label>
              )}
            </fieldset>
            <fieldset>
              <legend>طريقة القبض</legend>
              <div className="accounting-settlement-methods">
                <label><input type="radio" name="invoice-settlement-method" checked={settlementMethod === "cash"}
                  onChange={() => { setSettlementMethod("cash"); setSettlementCardProcessor(null); }}/>
                  نقدي — الصندوق
                </label>
                <label><input type="radio" name="invoice-settlement-method"
                  checked={settlementMethod === "card" && settlementCardProcessor === "arab"}
                  onChange={() => { setSettlementMethod("card"); setSettlementCardProcessor("arab"); }}/>
                  فيزا البنك العربي
                </label>
                <label><input type="radio" name="invoice-settlement-method"
                  checked={settlementMethod === "card" && settlementCardProcessor === "bop"}
                  onChange={() => { setSettlementMethod("card"); setSettlementCardProcessor("bop"); }}/>
                  فيزا بنك فلسطين
                </label>
              </div>
            </fieldset>
            <div className="accounting-settlement-balance">
              <span>المتبقي على الزبون بعد الدفعة</span>
              <strong dir="ltr">{formatMinor(Math.max(0, finalTotalMinor - (
                settlementKind === "full" ? finalTotalMinor : (parseMoneyInput(settlementAmount) ?? 0)
              )))}</strong>
            </div>
            {error && <p role="alert" className="accounting-settlement-error">{error}</p>}
            <footer>
              <button type="submit" className="accounting-save-settle-action" disabled={invoiceBusy}>
                حفظ الفاتورة وإنشاء سند قبض
              </button>
              <button type="button" disabled={invoiceBusy} onClick={() => { setSettlementOpen(false); setError(""); }}>
                رجوع دون حفظ
              </button>
            </footer>
          </form>
        </div>
      )}

      {openInvoiceDialog && (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setOpenInvoiceDialog(false);
            }
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 12000,
            display: "grid",
            placeItems: "center",
            padding: 24,
            background: "rgba(15, 23, 42, .62)",
          }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-label="فتح فاتورة"
            onSubmit={(event) => {
              event.preventDefault();
              submitOpenInvoice(openInvoiceValue);
            }}
            style={{
              width: "min(520px, 94vw)",
              background: "#fff",
              borderRadius: 18,
              padding: 20,
              boxShadow: "0 24px 80px rgba(15,23,42,.35)",
              display: "grid",
              gap: 14,
            }}
          >
            <div>
              <strong style={{ fontSize: 18 }}>
                فتح فاتورة
              </strong>
              <div style={{ marginTop: 4, color: "#64748b", fontSize: 12 }}>
                امسح باركود الفاتورة أو اكتب رقمها. يعمل فرد الباركود مع لوحة عربية أو إنجليزية.
              </div>
            </div>

            <input
              ref={openInvoiceInputRef}
              dir="ltr"
              value={openInvoiceValue}
              onChange={(event) =>
                setOpenInvoiceValue(event.target.value)
              }
              onKeyDown={
                handleOpenInvoiceScannerKeyDown
              }
              autoComplete="off"
              spellCheck={false}
              placeholder="POS-YYYYMMDD-XXXXXXXXXXXX"
              style={{
                minHeight: 48,
                border: "1px solid #cbd5e1",
                borderRadius: 10,
                padding: "0 12px",
                font: "inherit",
              }}
            />

            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "flex-start",
              }}
            >
              <button type="submit">
                فتح الفاتورة
              </button>

              <button
                type="button"
                onClick={() =>
                  setOpenInvoiceDialog(false)
                }
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
