import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { usePosRuntime } from "../../app/pos-context";
import PurchaseA4Invoice from "../../components/PurchaseA4Invoice";
import {
  ApiError,
  createPosPurchase,
  getPosPurchaseByPublicId,
  voidPosPurchase,
  getPosSuppliers,
  lookupPosProductByBarcode,
  searchPosProducts,
  type PosProductLookup,
  type PosPurchaseResult,
  type PosSupplier,
} from "../../lib/api";
import { formatMinor } from "../../lib/format";

const PURCHASE_API_ENABLED =
  import.meta.env.VITE_PURCHASE_API_ENABLED === "true";

const PURCHASE_WRITES_ENABLED =
  PURCHASE_API_ENABLED &&
  import.meta.env.VITE_PURCHASE_WRITES === "true";

type PaymentMethod = "cash" | "credit" | "mixed";

interface PurchaseLine {
  id: string;
  barcode: string;
  product: PosProductLookup;
  color: string | null;
  size: string | null;
  quantity: number;
  freeQuantity: number;
  unitCost: string;
  lineDiscount: string;
}

function createKey() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function localBusinessDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;

  return new Date(now.getTime() - offset)
    .toISOString()
    .slice(0, 10);
}

function moneyToMinor(value: string) {
  const normalized = value.trim();

  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) {
    return null;
  }

  const [whole, fraction = ""] = normalized.split(".");
  const result =
    Number(whole) * 100 +
    Number(fraction.padEnd(2, "0"));

  return Number.isSafeInteger(result) ? result : null;
}

function safeMoneyToMinor(value: string) {
  return moneyToMinor(value) ?? 0;
}

function getColors(product: PosProductLookup) {
  return product.colorVariants.map((variant) => variant.color);
}

function getSizes(
  product: PosProductLookup,
  color: string | null,
) {
  if (product.colorVariants.length === 0) {
    return product.sizes;
  }

  if (!color) {
    return [];
  }

  return (
    product.colorVariants.find(
      (variant) => variant.color === color,
    )?.sizes.map((size) => size.size) ?? []
  );
}

function lineSelectionComplete(line: PurchaseLine) {
  const colors = getColors(line.product);

  if (colors.length > 0 && !line.color) {
    return false;
  }

  const sizes = getSizes(line.product, line.color);

  return sizes.length === 0 || Boolean(line.size);
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "حدث خطأ غير متوقع";
}

function printPurchaseA4() {
  document.body.dataset.printMode = "purchase-a4";

  const pageStyle = document.createElement("style");
  pageStyle.id = "purchase-a4-page-style";
  pageStyle.textContent =
    "@page { size: A4 portrait; margin: 12mm; }";

  document.head.appendChild(pageStyle);

  const cleanup = () => {
    delete document.body.dataset.printMode;
    document
      .getElementById("purchase-a4-page-style")
      ?.remove();
  };

  window.addEventListener("afterprint", cleanup, {
    once: true,
  });

  window.print();
}

export default function PurchaseInvoicePage() {
  const { token, clearAuthentication } = usePosRuntime();

  const searchInput = useRef<HTMLInputElement>(null);
  const requestKey = useRef<string | null>(null);

  const [suppliers, setSuppliers] = useState<PosSupplier[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] =
    useState("");

  const [businessDate, setBusinessDate] =
    useState(localBusinessDate);
  const [warehouseKey, setWarehouseKey] = useState("main");
  const [notes, setNotes] = useState("");

  const [query, setQuery] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] =
    useState<PosProductLookup[]>([]);
  const [activeSearchIndex, setActiveSearchIndex] =
    useState(0);

  const [lines, setLines] = useState<PurchaseLine[]>([]);

  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>("credit");
  const [invoiceDiscount, setInvoiceDiscount] =
    useState("0.00");
  const [paid, setPaid] = useState("0.00");

  const [suppliersBusy, setSuppliersBusy] = useState(false);
  const [invoiceBusy, setInvoiceBusy] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [savedPurchase, setSavedPurchase] =
    useState<PosPurchaseResult | null>(null);

  const paidQuantity = useMemo(
    () =>
      lines.reduce(
        (total, line) => total + line.quantity,
        0,
      ),
    [lines],
  );

  const freeQuantity = useMemo(
    () =>
      lines.reduce(
        (total, line) => total + line.freeQuantity,
        0,
      ),
    [lines],
  );

  const grossMinor = useMemo(
    () =>
      lines.reduce(
        (total, line) =>
          total +
          safeMoneyToMinor(line.unitCost) * line.quantity,
        0,
      ),
    [lines],
  );

  const lineDiscountMinor = useMemo(
    () =>
      lines.reduce(
        (total, line) =>
          total + safeMoneyToMinor(line.lineDiscount),
        0,
      ),
    [lines],
  );

  const netItemsMinor = Math.max(
    0,
    grossMinor - lineDiscountMinor,
  );

  const totalMinor = Math.max(
    0,
    netItemsMinor - safeMoneyToMinor(invoiceDiscount),
  );

  const paidMinor = safeMoneyToMinor(paid);
  const dueMinor = Math.max(0, totalMinor - paidMinor);

  const selectedSupplier = suppliers.find(
    (supplier) => supplier.id === supplierId,
  );

  useEffect(() => {
    if (PURCHASE_API_ENABLED) {
      void loadSuppliers();
    }
  }, [token]);

  useEffect(() => {
    if (paymentMethod === "cash") {
      setPaid((totalMinor / 100).toFixed(2));
    }

    if (paymentMethod === "credit") {
      setPaid("0.00");
    }
  }, [paymentMethod, totalMinor]);

  async function loadSuppliers() {
    setSuppliersBusy(true);
    setError("");

    try {
      const result = await getPosSuppliers(token, {
        status: "active",
      });

      setSuppliers(result.results);

      if (result.results.length === 1) {
        setSupplierId(result.results[0]?.id ?? "");
      }
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
      setSuppliersBusy(false);
    }
  }

  function clearSearchResults() {
    setSearchOpen(false);
    setSearchResults([]);
    setActiveSearchIndex(0);
  }

  function updateLine(
    lineId: string,
    changes: Partial<PurchaseLine>,
  ) {
    setLines((current) =>
      current.map((line) =>
        line.id === lineId
          ? { ...line, ...changes }
          : line,
      ),
    );
  }

  function changeColor(
    line: PurchaseLine,
    nextColor: string,
  ) {
    const color = nextColor || null;
    const sizes = getSizes(line.product, color);

    updateLine(line.id, {
      color,
      size:
        line.product.mappedSize ??
        (sizes.length === 1 ? sizes[0] : null),
    });
  }

  function addProduct(product: PosProductLookup) {
    const colors = getColors(product);

    const color =
      product.mappedColor ??
      (colors.length === 1 ? colors[0] : null);

    const sizes = getSizes(product, color);

    const size =
      product.mappedSize ??
      (sizes.length === 1 ? sizes[0] : null);

    setLines((current) => [
      ...current,
      {
        id: createKey(),
        barcode: product.barcode ?? "",
        product,
        color,
        size,
        quantity: 1,
        freeQuantity: 0,
        unitCost: "0.00",
        lineDiscount: "0.00",
      },
    ]);

    setQuery("");
    clearSearchResults();
    setError("");
    setMessage(`تمت إضافة ${product.nameAr}`);

    window.setTimeout(() => {
      searchInput.current?.focus();
    }, 0);
  }

  async function searchProducts(value: string) {
    const result = await searchPosProducts(
      token,
      value,
      20,
    );

    if (result.results.length === 0) {
      setError("لم يتم العثور على صنف مطابق.");
      clearSearchResults();
      return;
    }

    if (result.results.length === 1) {
      const product = result.results[0];

      if (product) {
        addProduct(product);
      }

      return;
    }

    setSearchResults(result.results);
    setSearchOpen(true);
    setActiveSearchIndex(0);
  }

  async function handleProductSearch(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const value = query.trim();

    if (!value) {
      setError("امسح الباركود أو أدخل اسم أو كود الصنف.");
      return;
    }

    setLookupBusy(true);
    setError("");
    setMessage("");

    try {
      try {
        const product = await lookupPosProductByBarcode(
          token,
          value,
        );

        addProduct(product);
      } catch (caught) {
        if (
          caught instanceof ApiError &&
          caught.status === 401
        ) {
          clearAuthentication();
          return;
        }

        await searchProducts(value);
      }
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
      setLookupBusy(false);
    }
  }

  function handleSearchKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
  ) {
    if (!searchOpen || searchResults.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSearchIndex((current) =>
        Math.min(
          current + 1,
          searchResults.length - 1,
        ),
      );
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSearchIndex((current) =>
        Math.max(current - 1, 0),
      );
    }

    if (event.key === "Enter") {
      event.preventDefault();

      const product = searchResults[activeSearchIndex];

      if (product) {
        addProduct(product);
      }
    }

    if (event.key === "Escape") {
      clearSearchResults();
    }
  }

  function validateInvoice() {
    if (!supplierId) {
      return "اختر المورد.";
    }

    if (!businessDate) {
      return "أدخل تاريخ الفاتورة.";
    }

    if (lines.length === 0) {
      return "أضف صنفًا واحدًا على الأقل.";
    }

    let gross = 0;
    let discounts = 0;

    for (const line of lines) {
      if (!lineSelectionComplete(line)) {
        return `اختر اللون والمقاس للمنتج ${line.product.nameAr}`;
      }

      if (
        !Number.isSafeInteger(line.quantity) ||
        line.quantity < 1 ||
        line.quantity > 99_999
      ) {
        return `كمية ${line.product.nameAr} غير صالحة`;
      }

      if (
        !Number.isSafeInteger(line.freeQuantity) ||
        line.freeQuantity < 0 ||
        line.freeQuantity > 99_999 ||
        line.quantity + line.freeQuantity > 99_999
      ) {
        return `الكمية المجانية للمنتج ${line.product.nameAr} غير صالحة`;
      }

      const unitCostMinor = moneyToMinor(line.unitCost);
      const discountMinor = moneyToMinor(
        line.lineDiscount,
      );

      if (unitCostMinor === null) {
        return `تكلفة ${line.product.nameAr} غير صالحة`;
      }

      if (discountMinor === null) {
        return `خصم ${line.product.nameAr} غير صالح`;
      }

      const lineGross = unitCostMinor * line.quantity;

      if (
        !Number.isSafeInteger(lineGross) ||
        discountMinor > lineGross
      ) {
        return `قيمة أو خصم ${line.product.nameAr} غير صالح`;
      }

      gross += lineGross;
      discounts += discountMinor;
    }

    const invoiceDiscountMinor =
      moneyToMinor(invoiceDiscount);
    const strictPaidMinor = moneyToMinor(paid);

    if (invoiceDiscountMinor === null) {
      return "خصم الفاتورة غير صالح";
    }

    if (invoiceDiscountMinor > gross - discounts) {
      return "خصم الفاتورة أكبر من صافي الأصناف";
    }

    if (strictPaidMinor === null) {
      return "المبلغ المدفوع غير صالح";
    }

    const finalTotal =
      gross - discounts - invoiceDiscountMinor;

    if (strictPaidMinor > finalTotal) {
      return "المبلغ المدفوع أكبر من قيمة الفاتورة";
    }

    if (
      paymentMethod === "cash" &&
      strictPaidMinor !== finalTotal
    ) {
      return "الفاتورة النقدية يجب دفعها كاملة";
    }

    if (
      paymentMethod === "credit" &&
      strictPaidMinor !== 0
    ) {
      return "الفاتورة الآجلة لا تحتوي دفعة نقدية";
    }

    if (
      paymentMethod === "mixed" &&
      (strictPaidMinor <= 0 ||
        strictPaidMinor >= finalTotal)
    ) {
      return "الدفع المختلط يحتاج دفعة جزئية";
    }

    return null;
  }

  async function handleSaveInvoice(
    printAfterSave = false,
  ) {
    if (!PURCHASE_WRITES_ENABLED) {
      setError(
        "حفظ المشتريات محمي حتى نشر Worker وتفعيل الكتابة.",
      );
      return;
    }

    const validationError = validateInvoice();

    if (validationError) {
      setError(validationError);
      return;
    }

    const confirmed = window.confirm(
      [
        `المورد: ${selectedSupplier?.name ?? "—"}`,
        `قيمة الفاتورة: ${formatMinor(totalMinor)}`,
        `إجمالي المستلم: ${paidQuantity + freeQuantity}`,
        "",
        "سيتم زيادة المخزون وتسجيل الفاتورة.",
        "هل تريد المتابعة؟",
      ].join("\n"),
    );

    if (!confirmed) {
      return;
    }

    const idempotencyKey =
      requestKey.current ??
      `pos_purchase_${createKey()}`;

    requestKey.current = idempotencyKey;

    setInvoiceBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await createPosPurchase(token, {
        supplierId,
        idempotencyKey,
        supplierInvoiceNumber:
          supplierInvoiceNumber.trim() || undefined,
        businessDate,
        warehouseKey,
        currencyCode: "ILS",
        paymentMethod,
        invoiceDiscount,
        paid,
        notes: notes.trim() || undefined,
        items: lines.map((line) => ({
          productId: line.product.productId,
          barcode: line.barcode || undefined,
          quantity: line.quantity,
          freeQuantity: line.freeQuantity,
          unitCost: line.unitCost,
          lineDiscount: line.lineDiscount,
          color: line.color ?? undefined,
          size: line.size ?? undefined,
        })),
      });

      requestKey.current = null;
      setSavedPurchase(result);

      if (printAfterSave) {
        window.setTimeout(() => {
          printPurchaseA4();
        }, 100);
      }

      setMessage(
        result.alreadyCreated
          ? `تم تحميل الفاتورة ${result.purchase.publicId} دون تكرارها.`
          : `تم حفظ الفاتورة ${result.purchase.publicId} وزيادة المخزون.`,
      );
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
      setInvoiceBusy(false);
    }
  }

  function applyStoredPurchase(result: PosPurchaseResult) {
    setSupplierId(result.purchase.supplierId);
    setSupplierInvoiceNumber(
      result.purchase.supplierInvoiceNumber ?? "",
    );
    setBusinessDate(result.purchase.businessDate);
    setWarehouseKey(result.purchase.warehouseKey);
    setNotes(result.purchase.notes ?? "");

    if (
      result.purchase.paymentMethod === "cash" ||
      result.purchase.paymentMethod === "credit" ||
      result.purchase.paymentMethod === "mixed"
    ) {
      setPaymentMethod(result.purchase.paymentMethod);
    }

    setInvoiceDiscount(result.purchase.discount.toFixed(2));
    setPaid(result.purchase.paid.toFixed(2));

    setLines(
      result.purchase.items.map((item) => ({
        id: item.id,
        barcode: item.barcode ?? "",
        product: {
          productId: item.productId ?? `saved-${item.id}`,
          barcode: item.barcode,
          productCode: item.productCode,
          nameAr: item.productNameAr,
          image: item.productImage ?? "",
          websiteUnitPrice: 0,
          websiteUnitPriceMinor: 0,
          mappedColor: item.color,
          mappedSize: item.size,
          sizes: [],
          colorVariants: [],
          stock: item.generalStockAfter,
          outOfStock: false,
        },
        color: item.color,
        size: item.size,
        quantity: item.quantity,
        freeQuantity: item.freeQuantity,
        unitCost: item.unitCost.toFixed(2),
        lineDiscount: item.lineDiscount.toFixed(2),
      })),
    );

    setSavedPurchase(result);
    setError("");
    setMessage(`تم فتح الفاتورة ${result.purchase.publicId}.`);
    clearSearchResults();
    requestKey.current = null;
  }

  async function loadStoredPurchase(rawPublicId: string) {
    const publicId = rawPublicId.trim().toUpperCase();

    if (!publicId) {
      return;
    }

    setInvoiceBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await getPosPurchaseByPublicId(
        token,
        publicId,
      );

      applyStoredPurchase(result);
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
      setInvoiceBusy(false);
    }
  }

  function handleOpenPurchaseInvoice() {
    const value = window.prompt(
      "أدخل رقم فاتورة المشتريات",
      savedPurchase?.purchase.publicId ?? "",
    );

    if (!value?.trim()) {
      return;
    }

    void loadStoredPurchase(value);
  }

  async function handleVoidInvoice() {
    const current = savedPurchase;

    if (!current || current.purchase.status === "voided") {
      return;
    }

    if (!PURCHASE_WRITES_ENABLED) {
      setError("حذف فواتير المشتريات غير مفعل.");
      return;
    }

    const enteredReason = window.prompt(
      "أدخل سبب حذف فاتورة المشتريات:",
    );

    if (enteredReason === null) {
      return;
    }

    const reason = enteredReason.trim();

    if (!reason) {
      setError("يجب إدخال سبب حذف الفاتورة.");
      return;
    }

    const confirmed = window.confirm(
      [
        `سيتم حذف الفاتورة: ${current.purchase.publicId}`,
        `المورد: ${current.purchase.supplier.name}`,
        "",
        "سيتم خصم الكميات التي أضافتها من المخزون.",
        "ستبقى الفاتورة محفوظة في السجل بحالة محذوفة.",
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
      const result = await voidPosPurchase(token, {
        publicId: current.purchase.publicId,
        reason,
      });

      setSavedPurchase(result);

      setMessage(
        `تم حذف الفاتورة ${result.purchase.publicId} وعكس كمياتها من المخزون.`,
      );
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
      setInvoiceBusy(false);
    }
  }

  function resetInvoice() {
    setSupplierInvoiceNumber("");
    setBusinessDate(localBusinessDate());
    setWarehouseKey("main");
    setNotes("");
    setQuery("");
    setLines([]);
    setPaymentMethod("credit");
    setInvoiceDiscount("0.00");
    setPaid("0.00");
    setSavedPurchase(null);
    setError("");
    setMessage("");
    clearSearchResults();
    requestKey.current = null;
  }

  return (
    <section className="accounting-invoice-page purchase-invoice-page">
      <header className="accounting-invoice-titlebar">
        <div>
          <span>المشتريات والموردون</span>
          <h1>فاتورة مشتريات</h1>
          <p>
            تسجيل البضاعة المستلمة وزيادة المخزون حسب
            اللون والمقاس.
          </p>
        </div>

        <strong
          className={[
            "accounting-invoice-draft-badge",
            savedPurchase?.purchase.status === "voided"
              ? "is-voided"
              : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {savedPurchase
            ? savedPurchase.purchase.status === "voided"
              ? `محذوفة — ${savedPurchase.purchase.publicId}`
              : savedPurchase.purchase.publicId
            : PURCHASE_WRITES_ENABLED
              ? "مسودة فاتورة جديدة"
              : "واجهة تطوير — الحفظ محمي"}
        </strong>
      </header>

      <div className="accounting-invoice-toolbar">
        <button
          type="button"
          disabled={invoiceBusy}
          onClick={resetInvoice}
        >
          فاتورة جديدة
        </button>

        <button
          type="button"
          disabled={
            invoiceBusy ||
            !savedPurchase?.navigation?.previousPublicId
          }
          onClick={() => {
            const target =
              savedPurchase?.navigation?.previousPublicId;

            if (target) {
              void loadStoredPurchase(target);
            }
          }}
        >
          <span aria-hidden="true">←</span>
          السابق
        </button>

        <button
          type="button"
          disabled={invoiceBusy}
          onClick={handleOpenPurchaseInvoice}
        >
          <span aria-hidden="true">🔎</span>
          فتح فاتورة
        </button>

        <button
          type="button"
          disabled={
            invoiceBusy ||
            !savedPurchase?.navigation?.nextPublicId
          }
          onClick={() => {
            const target =
              savedPurchase?.navigation?.nextPublicId;

            if (target) {
              void loadStoredPurchase(target);
            }
          }}
        >
          <span aria-hidden="true">→</span>
          التالي
        </button>

        <button
          className="is-primary-action"
          type="button"
          disabled={
            invoiceBusy ||
            !PURCHASE_WRITES_ENABLED ||
            savedPurchase !== null
          }
          onClick={() => void handleSaveInvoice()}
        >
          {invoiceBusy ? "جاري الحفظ…" : "حفظ الفاتورة"}
        </button>

        <button
          type="button"
          disabled={
            invoiceBusy ||
            !PURCHASE_WRITES_ENABLED ||
            savedPurchase !== null
          }
          onClick={() => void handleSaveInvoice(true)}
        >
          <span aria-hidden="true">🖨️</span>
          حفظ وطباعة A4
        </button>

        <button
          type="button"
          disabled={invoiceBusy || !savedPurchase}
          onClick={printPurchaseA4}
        >
          <span aria-hidden="true">👁️</span>
          معاينة / طباعة A4
        </button>

        <button
          type="button"
          disabled={invoiceBusy}
          onClick={() => window.history.back()}
        >
          <span aria-hidden="true">↩</span>
          رجوع
        </button>

        {savedPurchase && (
          <button
            className="is-danger-action"
            type="button"
            disabled={
              invoiceBusy ||
              !PURCHASE_WRITES_ENABLED ||
              savedPurchase.purchase.status === "voided"
            }
            onClick={() => void handleVoidInvoice()}
          >
            {savedPurchase.purchase.status === "voided"
              ? "الفاتورة محذوفة"
              : invoiceBusy
                ? "جاري الحذف…"
                : "حذف الفاتورة"}
          </button>
        )}
      </div>

      {savedPurchase?.purchase.status === "voided" && (
        <div className="alert purchase-voided-alert">
          <strong>فاتورة محذوفة</strong>
          <span>
            السبب: {savedPurchase.purchase.voidReason ?? "—"}
          </span>
          <span>
            تاريخ الحذف:{" "}
            {savedPurchase.purchase.voidedAt
              ? new Date(
                  savedPurchase.purchase.voidedAt,
                ).toLocaleString("ar-PS")
              : "—"}
          </span>
        </div>
      )}

      {!PURCHASE_API_ENABLED && (
        <div className="alert supplier-protection-alert">
          واجهة فاتورة المشتريات جاهزة للمعاينة.
          الموردون والحفظ محميان حتى نشر Worker المشتريات.
        </div>
      )}

      <fieldset
        className="purchase-invoice-fieldset"
        disabled={invoiceBusy || savedPurchase !== null}
      >
        <section className="accounting-invoice-information">
          <div className="accounting-invoice-card">
            <h2>بيانات الفاتورة</h2>

            <div className="accounting-fields-grid">
              <label>
                <span>رقم الفاتورة الداخلي</span>
                <input
                  dir="ltr"
                  value={
                    savedPurchase?.purchase.publicId ??
                    "تلقائي عند الحفظ"
                  }
                  readOnly
                />
              </label>

              <label>
                <span>تاريخ الفاتورة</span>
                <input
                  type="date"
                  value={businessDate}
                  onChange={(event) =>
                    setBusinessDate(event.target.value)
                  }
                />
              </label>

              <label>
                <span>المستودع</span>
                <select
                  value={warehouseKey}
                  onChange={(event) =>
                    setWarehouseKey(event.target.value)
                  }
                >
                  <option value="main">
                    المستودع الرئيسي
                  </option>
                </select>
              </label>

              <label>
                <span>طريقة الدفع</span>
                <select
                  value={paymentMethod}
                  onChange={(event) =>
                    setPaymentMethod(
                      event.target.value as PaymentMethod,
                    )
                  }
                >
                  <option value="credit">آجل</option>
                  <option value="cash">نقدي</option>
                  <option value="mixed">مختلط</option>
                </select>
              </label>
            </div>
          </div>

          <div className="accounting-invoice-card">
            <h2>بيانات المورد</h2>

            <div className="accounting-fields-grid">
              <label className="accounting-wide-field">
                <span>المورد *</span>
                <select
                  value={supplierId}
                  disabled={
                    suppliersBusy || !PURCHASE_API_ENABLED
                  }
                  onChange={(event) =>
                    setSupplierId(event.target.value)
                  }
                >
                  <option value="">
                    {suppliersBusy
                      ? "جاري التحميل…"
                      : "اختر المورد"}
                  </option>

                  {suppliers.map((supplier) => (
                    <option
                      value={supplier.id}
                      key={supplier.id}
                    >
                      {supplier.code} — {supplier.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>رقم فاتورة المورد</span>
                <input
                  dir="ltr"
                  placeholder="اختياري"
                  value={supplierInvoiceNumber}
                  onChange={(event) =>
                    setSupplierInvoiceNumber(
                      event.target.value,
                    )
                  }
                />
              </label>

              <label className="accounting-wide-field">
                <span>ملاحظات</span>
                <input
                  value={notes}
                  onChange={(event) =>
                    setNotes(event.target.value)
                  }
                />
              </label>
            </div>
          </div>
        </section>

        <section className="accounting-item-entry">
          <form
            className="accounting-item-form"
            onSubmit={handleProductSearch}
          >
            <label>
              <span>الباركود أو كود الصنف</span>
              <input
                ref={searchInput}
                dir="ltr"
                autoComplete="off"
                placeholder="امسح الباركود أو اكتب اسم الصنف"
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
              {lookupBusy
                ? "جاري البحث…"
                : "بحث / إضافة"}
            </button>
          </form>

          <div className="accounting-entry-feedback">
            {error && (
              <span className="is-error">{error}</span>
            )}

            {!error && message && (
              <span className="is-success">{message}</span>
            )}
          </div>

          {searchOpen && (
            <section className="accounting-search-panel">
              <header>
                <strong>نتائج البحث</strong>

                <button
                  type="button"
                  onClick={clearSearchResults}
                >
                  إغلاق
                </button>
              </header>

              <div className="accounting-search-results">
                {searchResults.map((product, index) => (
                  <button
                    className={
                      index === activeSearchIndex
                        ? "is-active"
                        : ""
                    }
                    type="button"
                    key={`${product.productId}-${product.barcode}`}
                    onClick={() => addProduct(product)}
                  >
                    <img src={product.image} alt="" />

                    <div>
                      <strong>{product.nameAr}</strong>
                      <span>
                        الكود: {product.productCode ?? "—"}
                      </span>
                    </div>

                    <aside>
                      <span>
                        المخزون:{" "}
                        {product.stock ?? "غير محدد"}
                      </span>
                    </aside>
                  </button>
                ))}
              </div>
            </section>
          )}
        </section>

        <div className="accounting-invoice-table-wrap">
          <table className="accounting-invoice-table purchase-invoice-table">
            <thead>
              <tr>
                <th>#</th>
                <th>الباركود</th>
                <th>رقم الصنف</th>
                <th>اسم الصنف</th>
                <th>اللون</th>
                <th>المقاس</th>
                <th>الكمية</th>
                <th>مجاني</th>
                <th>تكلفة الوحدة</th>
                <th>الخصم</th>
                <th>المجموع</th>
                <th>حذف</th>
              </tr>
            </thead>

            <tbody>
              {lines.length === 0 ? (
                <tr className="accounting-empty-row">
                  <td colSpan={12}>
                    امسح باركود صنف أو استخدم البحث
                    لإضافته.
                  </td>
                </tr>
              ) : (
                lines.map((line, index) => {
                  const colors = getColors(line.product);
                  const sizes = getSizes(
                    line.product,
                    line.color,
                  );

                  const lineTotal = Math.max(
                    0,
                    safeMoneyToMinor(line.unitCost) *
                      line.quantity -
                      safeMoneyToMinor(
                        line.lineDiscount,
                      ),
                  );

                  return (
                    <tr
                      className={
                        lineSelectionComplete(line)
                          ? ""
                          : "is-incomplete"
                      }
                      key={line.id}
                    >
                      <td>{index + 1}</td>
                      <td dir="ltr">{line.barcode}</td>
                      <td>
                        {line.product.productCode ?? "—"}
                      </td>

                      <td className="accounting-product-cell">
                        <img src={line.product.image} alt="" />
                        <strong>{line.product.nameAr}</strong>
                      </td>

                      <td>
                        {savedPurchase ? (
                          line.color ?? "—"
                        ) : colors.length > 0 ? (
                          <select
                            value={line.color ?? ""}
                            onChange={(event) =>
                              changeColor(
                                line,
                                event.target.value,
                              )
                            }
                          >
                            <option value="">
                              اختر اللون
                            </option>

                            {colors.map((color) => (
                              <option
                                value={color}
                                key={color}
                              >
                                {color}
                              </option>
                            ))}
                          </select>
                        ) : (
                          "—"
                        )}
                      </td>

                      <td>
                        {savedPurchase ? (
                          line.size ?? "—"
                        ) : sizes.length > 0 ? (
                          <select
                            value={line.size ?? ""}
                            onChange={(event) =>
                              updateLine(line.id, {
                                size:
                                  event.target.value ||
                                  null,
                              })
                            }
                          >
                            <option value="">
                              اختر المقاس
                            </option>

                            {sizes.map((size) => (
                              <option
                                value={size}
                                key={size}
                              >
                                {size}
                              </option>
                            ))}
                          </select>
                        ) : (
                          "—"
                        )}
                      </td>

                      <td>
                        <input
                          type="number"
                          min="1"
                          max="99999"
                          value={line.quantity}
                          onChange={(event) =>
                            updateLine(line.id, {
                              quantity: Math.max(
                                1,
                                Number(event.target.value) ||
                                  1,
                              ),
                            })
                          }
                        />
                      </td>

                      <td>
                        <input
                          type="number"
                          min="0"
                          max="99999"
                          value={line.freeQuantity}
                          onChange={(event) =>
                            updateLine(line.id, {
                              freeQuantity: Math.max(
                                0,
                                Number(event.target.value) ||
                                  0,
                              ),
                            })
                          }
                        />
                      </td>

                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unitCost}
                          onChange={(event) =>
                            updateLine(line.id, {
                              unitCost: event.target.value,
                            })
                          }
                        />
                      </td>

                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.lineDiscount}
                          onChange={(event) =>
                            updateLine(line.id, {
                              lineDiscount:
                                event.target.value,
                            })
                          }
                        />
                      </td>

                      <td dir="ltr">
                        {formatMinor(lineTotal)}
                      </td>

                      <td>
                        <button
                          className="accounting-remove-line"
                          type="button"
                          onClick={() =>
                            setLines((current) =>
                              current.filter(
                                (item) =>
                                  item.id !== line.id,
                              ),
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
                  onChange={(event) =>
                    setPaymentMethod(
                      event.target.value as PaymentMethod,
                    )
                  }
                >
                  <option value="credit">آجل</option>
                  <option value="cash">نقدي</option>
                  <option value="mixed">مختلط</option>
                </select>
              </label>

              <label>
                <span>المبلغ المدفوع</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={paid}
                  disabled={paymentMethod !== "mixed"}
                  onChange={(event) =>
                    setPaid(event.target.value)
                  }
                />
              </label>

              <label>
                <span>المبلغ المستحق</span>
                <strong dir="ltr">
                  {formatMinor(dueMinor)}
                </strong>
              </label>
            </div>
          </div>

          <div className="accounting-invoice-totals">
            <div>
              <span>الكمية المدفوعة</span>
              <strong>{paidQuantity}</strong>
            </div>

            <div>
              <span>الكمية المجانية</span>
              <strong>{freeQuantity}</strong>
            </div>

            <div>
              <span>صافي الأصناف</span>
              <strong dir="ltr">
                {formatMinor(netItemsMinor)}
              </strong>
            </div>

            <label>
              <span>خصم الفاتورة</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={invoiceDiscount}
                onChange={(event) =>
                  setInvoiceDiscount(event.target.value)
                }
              />
            </label>

            <div className="accounting-final-total">
              <span>الإجمالي النهائي</span>
              <strong dir="ltr">
                {formatMinor(totalMinor)}
              </strong>
            </div>
          </div>
        </section>
      </fieldset>

      {savedPurchase && (
        <PurchaseA4Invoice result={savedPurchase} />
      )}
    </section>
  );
}
