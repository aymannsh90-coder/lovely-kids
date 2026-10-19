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
  discardOpenPosPurchaseDraft,
  getCurrentCashSession,
  getLatestPosPurchase,
  getOpenPosPurchaseDraft,
  getPosPurchaseByPublicId,
  savePosPurchaseDraft,
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

const INVENTORY_PURCHASE_HANDOFF_KEY =
  "lovely_kids_inventory_purchase_handoff_v1";

const INVENTORY_PURCHASE_HANDOFF_VERSION =
  2;

const INVENTORY_PURCHASE_HANDOFF_MAX_AGE_MS =
  10 * 60 * 1000;

type InventoryPurchaseHandoff = {
  version: number;
  handoffId: string;
  createdAt: string;
  mode: "product" | "variant";
  productId: string;
  productCode: string;
  barcode: string;
  color: string;
  size: string;
  quantity: number;
  unitCost: string;
};

function parseInventoryPurchaseHandoff(
  raw: string | null,
): InventoryPurchaseHandoff | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      raw,
    ) as Partial<InventoryPurchaseHandoff>;

    const createdAtMs =
      typeof parsed.createdAt ===
      "string"
        ? Date.parse(parsed.createdAt)
        : NaN;

    const age =
      Date.now() - createdAtMs;

    if (
      parsed.version !==
        INVENTORY_PURCHASE_HANDOFF_VERSION ||
      typeof parsed.handoffId !==
        "string" ||
      !parsed.handoffId ||
      typeof parsed.createdAt !==
        "string" ||
      !Number.isFinite(createdAtMs) ||
      age < -60_000 ||
      age >
        INVENTORY_PURCHASE_HANDOFF_MAX_AGE_MS ||
      (
        parsed.mode !== "product" &&
        parsed.mode !== "variant"
      ) ||
      typeof parsed.productId !==
        "string" ||
      typeof parsed.productCode !==
        "string" ||
      typeof parsed.barcode !==
        "string" ||
      typeof parsed.color !==
        "string" ||
      typeof parsed.size !==
        "string" ||
      typeof parsed.quantity !==
        "number" ||
      typeof parsed.unitCost !==
        "string"
    ) {
      return null;
    }

    return {
      version: parsed.version,
      handoffId:
        parsed.handoffId,
      createdAt:
        parsed.createdAt,
      mode: parsed.mode,
      productId:
        parsed.productId,
      productCode:
        parsed.productCode,
      barcode:
        parsed.barcode,
      color:
        parsed.color,
      size:
        parsed.size,
      quantity:
        parsed.quantity,
      unitCost:
        parsed.unitCost,
    };
  } catch {
    return null;
  }
}

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

function lineSelectionComplete(_line: PurchaseLine) {
  return true;
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
  const {
    token,
    session,
    setSession,
    clearAuthentication,
  } = usePosRuntime();

  const searchInput = useRef<HTMLInputElement>(null);
  const requestKey = useRef<string | null>(null);
  const inventoryPrefillHandled =
    useRef(false);

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

  useEffect(() => {
    if (
      inventoryPrefillHandled.current ||
      !PURCHASE_API_ENABLED
    ) {
      return;
    }

    const url = new URL(
      window.location.href,
    );

    const fromInventoryUrl =
      url.searchParams.get("source") ===
      "inventory-intelligence";

    if (!fromInventoryUrl) {
      try {
        const raw =
          window.sessionStorage.getItem(
            INVENTORY_PURCHASE_HANDOFF_KEY,
          );

        if (
          raw &&
          !parseInventoryPurchaseHandoff(
            raw,
          )
        ) {
          window.sessionStorage.removeItem(
            INVENTORY_PURCHASE_HANDOFF_KEY,
          );
        }
      } catch {
        // Ignore storage cleanup failures.
      }

      return;
    }

    const urlHandoffId =
      url.searchParams.get(
        "handoffId",
      ) ?? "";

    let stored:
      InventoryPurchaseHandoff | null =
      null;

    try {
      const raw =
        window.sessionStorage.getItem(
          INVENTORY_PURCHASE_HANDOFF_KEY,
        );

      const parsed =
        parseInventoryPurchaseHandoff(
          raw,
        );

      if (
        parsed &&
        urlHandoffId &&
        parsed.handoffId ===
          urlHandoffId
      ) {
        stored = parsed;
      } else if (raw) {
        window.sessionStorage.removeItem(
          INVENTORY_PURCHASE_HANDOFF_KEY,
        );
      }
    } catch {
      stored = null;
    }

    const handoffMode =
      url.searchParams.get(
        "handoffMode",
      ) === "variant"
        ? "variant"
        : (
            stored?.mode ??
            "product"
          );

    const productId =
      url.searchParams.get(
        "productId",
      ) ??
      stored?.productId ??
      "";

    const productCode =
      url.searchParams.get(
        "productCode",
      ) ??
      stored?.productCode ??
      "";

    const barcode =
      url.searchParams.get(
        "barcode",
      ) ??
      stored?.barcode ??
      "";

    const expectedColor =
      url.searchParams.get(
        "color",
      ) ??
      stored?.color ??
      "";

    const expectedSize =
      url.searchParams.get(
        "size",
      ) ??
      stored?.size ??
      "";

    const rawQuantity = Number(
      url.searchParams.get(
        "quantity",
      ) ??
        stored?.quantity ??
        1,
    );

    const quantity =
      Number.isSafeInteger(
        rawQuantity,
      ) &&
      rawQuantity > 0
        ? Math.min(
            rawQuantity,
            99_999,
          )
        : 1;

    const rawUnitCost =
      url.searchParams.get(
        "unitCost",
      ) ??
      stored?.unitCost ??
      "";

    const unitCost =
      moneyToMinor(
        rawUnitCost,
      ) === null
        ? "0.00"
        : rawUnitCost;

    const searchValue =
      productCode || barcode;

    if (
      !productId &&
      !searchValue
    ) {
      setError(
        "اقتراح الشراء لا يحتوي على معرّف صالح للصنف.",
      );
      return;
    }

    if (
      handoffMode ===
        "variant" &&
      (
        !productId ||
        !barcode ||
        !expectedColor ||
        !expectedSize
      )
    ) {
      setError(
        "تم إيقاف تجهيز الشراء: بيانات اللون/المقاس غير مكتملة.",
      );
      return;
    }

    inventoryPrefillHandled.current =
      true;

    void (async () => {
      setLookupBusy(true);
      setError("");
      setMessage("");

      try {
        let product:
          | PosProductLookup
          | null = null;

        if (
          handoffMode ===
          "variant"
        ) {
          const direct =
            await lookupPosProductByBarcode(
              token,
              barcode,
            );

          const exactMatch =
            direct.productId ===
              productId &&
            direct.mappedColor ===
              expectedColor &&
            direct.mappedSize ===
              expectedSize &&
            (
              direct.barcode ===
                barcode ||
              direct.primaryBarcode ===
                barcode ||
              (
                direct.barcodes?.some(
                  (entry) =>
                    entry.barcode ===
                    barcode &&
                    entry.color ===
                    expectedColor &&
                    entry.size ===
                    expectedSize,
                ) ?? false
              )
            );

          if (!exactMatch) {
            setError(
              `تم إيقاف تجهيز الشراء لأن الباركود لا يطابق الـVariant المطلوب: ${expectedColor} / ${expectedSize}. لم تتم إضافة أي صنف.`,
            );
            return;
          }

          product = direct;
        } else {
          if (barcode) {
            try {
              const direct =
                await lookupPosProductByBarcode(
                  token,
                  barcode,
                );

              if (
                !productId ||
                direct.productId ===
                  productId
              ) {
                product =
                  direct;
              }
            } catch (caught) {
              if (
                caught instanceof
                  ApiError &&
                caught.status ===
                  401
              ) {
                throw caught;
              }
            }
          }

          if (
            !product &&
            searchValue
          ) {
            const result =
              await searchPosProducts(
                token,
                searchValue,
                25,
              );

            product =
              result.results.find(
                (candidate) =>
                  candidate.productId ===
                  productId,
              ) ??
              result.results.find(
                (candidate) =>
                  Boolean(
                    productCode,
                  ) &&
                  candidate.productCode ===
                    productCode,
              ) ??
              result.results.find(
                (candidate) =>
                  Boolean(
                    barcode,
                  ) &&
                  (
                    candidate.barcode ===
                      barcode ||
                    candidate.primaryBarcode ===
                      barcode ||
                    (
                      candidate.barcodes?.some(
                        (entry) =>
                          entry.barcode ===
                          barcode,
                      ) ?? false
                    )
                  ),
              ) ??
              (
                result.results
                  .length === 1
                  ? result
                      .results[0]
                  : null
              );

            if (!product) {
              setQuery(
                searchValue,
              );
              setSearchResults(
                result.results,
              );
              setSearchOpen(
                result.results
                  .length > 0,
              );

              setError(
                result.results
                  .length > 0
                  ? "وجدنا أكثر من صنف. اختر الصنف الصحيح لإكمال اقتراح الشراء."
                  : "تعذر العثور على الصنف المقترح من ذكاء المخزون.",
              );

              inventoryPrefillHandled.current =
                false;
              return;
            }
          }
        }

        if (!product) {
          setError(
            "تعذر تحميل الصنف المقترح من ذكاء المخزون.",
          );
          inventoryPrefillHandled.current =
            false;
          return;
        }

        addProduct(
          product,
          quantity,
          unitCost,
          handoffMode ===
            "variant"
            ? {
                barcode,
                color:
                  expectedColor,
                size:
                  expectedSize,
              }
            : undefined,
        );

        setNotes((current) =>
          current.trim()
            ? current
            : "اقتراح شراء من ذكاء المخزون — راجع المورد والكمية والتكلفة قبل حفظ الفاتورة.",
        );

        setMessage(
          handoffMode ===
            "variant"
            ? `تم تجهيز ${product.nameAr} — ${expectedColor} / ${expectedSize} — بكمية ${quantity}. راجع المورد والتكلفة ثم احفظ الفاتورة فقط عند الاعتماد.`
            : `تم تجهيز ${product.nameAr} بكمية ${quantity}. راجع المورد والتكلفة ثم احفظ الفاتورة فقط عند الاعتماد.`,
        );

        try {
          window.sessionStorage.removeItem(
            INVENTORY_PURCHASE_HANDOFF_KEY,
          );
        } catch {
          // The successful URL cleanup below is enough.
        }

        [
          "source",
          "handoffVersion",
          "handoffId",
          "handoffMode",
          "productId",
          "productCode",
          "barcode",
          "color",
          "size",
          "quantity",
          "unitCost",
        ].forEach((key) =>
          url.searchParams.delete(
            key,
          ),
        );

        window.history.replaceState(
          {},
          "",
          `${url.pathname}${
            url.search
          }${url.hash}`,
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

        inventoryPrefillHandled.current =
          false;

        setError(
          `تعذر تجهيز اقتراح الشراء: ${errorMessage(
            caught,
          )}`,
        );
      } finally {
        setLookupBusy(false);
      }
    })();
    // One-time handoff from Inventory Intelligence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function loadSuppliers() {
    setSuppliersBusy(true);
    setError("");

    try {
      const result = await getPosSuppliers(token, {
        status: "active",
      });

      setSuppliers(result.results);

      if (result.results.length === 1) {
        const onlySupplierId =
          result.results[0]?.id ?? "";

        setSupplierId(onlySupplierId);

        if (onlySupplierId) {
          void loadOpenDraft(onlySupplierId);
        }
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

  function addProduct(
    product: PosProductLookup,
    initialQuantity = 1,
    initialUnitCost = "",
    forcedVariant?: {
      barcode: string;
      color: string;
      size: string;
    },
  ) {
    const quantityToAdd = Math.max(
      1,
      Math.min(
        99_999,
        Math.trunc(initialQuantity),
      ),
    );

    setLines((current) => {
      const existing = current.find(
        (line) =>
          line.product.productId === product.productId,
      );

      if (existing) {
        return current.map((line) =>
          line.id === existing.id
            ? {
                ...line,
                quantity: Math.min(
                  99_999,
                  line.quantity + quantityToAdd,
                ),
                unitCost:
                  initialUnitCost.trim()
                    ? initialUnitCost
                    : line.unitCost,
              }
            : line,
        );
      }

      return [
        ...current,
        {
          id: createKey(),
          barcode:
            forcedVariant?.barcode ??
            product.barcode ??
            "",
          product,
          color: null,
          size: null,
          quantity: quantityToAdd,
          freeQuantity: 0,
          unitCost: initialUnitCost,
          lineDiscount: "0.00",
        },
      ];
    });

    setQuery("");
    clearSearchResults();
    setError("");
    setMessage(`تمت إضافة ${product.nameAr} إلى فاتورة المشتريات المفتوحة`);

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

  function validateInvoice(
    options?: {
      allowUnknownCost?: boolean;
    },
  ) {
    const allowUnknownCost =
      options?.allowUnknownCost === true;

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
    let hasUnknownCost = false;

    for (const line of lines) {
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

      const rawUnitCost =
        line.unitCost.trim();

      const discountMinor = moneyToMinor(
        line.lineDiscount,
      );

      if (discountMinor === null) {
        return `خصم ${line.product.nameAr} غير صالح`;
      }

      if (!rawUnitCost) {
        if (!allowUnknownCost) {
          return `تكلفة ${line.product.nameAr} غير مدخلة`;
        }

        if (discountMinor !== 0) {
          return `لا يمكن إدخال خصم للمنتج ${line.product.nameAr} قبل إدخال تكلفته`;
        }

        hasUnknownCost = true;
        continue;
      }

      const unitCostMinor =
        moneyToMinor(rawUnitCost);

      if (unitCostMinor === null) {
        return `تكلفة ${line.product.nameAr} غير صالحة`;
      }

      const lineGross =
        unitCostMinor * line.quantity;

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
    const strictPaidMinor =
      moneyToMinor(paid);

    if (invoiceDiscountMinor === null) {
      return "خصم الفاتورة غير صالح";
    }

    if (strictPaidMinor === null) {
      return "المبلغ المدفوع غير صالح";
    }

    if (hasUnknownCost) {
      if (invoiceDiscountMinor !== 0) {
        return "أكمل تكاليف الأصناف قبل إدخال خصم على الفاتورة.";
      }

      if (
        paymentMethod !== "credit" ||
        strictPaidMinor !== 0
      ) {
        return "المسودة التي تحتوي تكلفة غير مدخلة تُحفظ آجل بدون دفعة حتى اكتمال التكلفة.";
      }

      return null;
    }

    if (invoiceDiscountMinor > gross - discounts) {
      return "خصم الفاتورة أكبر من صافي الأصناف";
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

  async function loadOpenDraft(
    rawSupplierId: string,
  ) {
    const targetSupplierId =
      rawSupplierId.trim();

    if (!targetSupplierId) {
      return;
    }

    try {
      const result = await getOpenPosPurchaseDraft(
        token,
        targetSupplierId,
        "main",
      );

      if (result) {
        applyStoredPurchase(result);
        setMessage(
          `تم استرجاع فاتورة المشتريات المفتوحة ${result.purchase.publicId}.`,
        );
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
    }
  }

  async function handleSupplierChange(
    nextSupplierId: string,
  ) {
    if (nextSupplierId === supplierId) {
      return;
    }

    if (
      lines.length > 0 ||
      savedPurchase?.purchase.status === "draft"
    ) {
      const confirmed = window.confirm(
        "سيتم ترك بيانات المورد الحالي محفوظة كما هي وفتح مسودة المورد الجديد إن وجدت. أي تعديلات غير محفوظة على الشاشة ستُفقد. هل تريد المتابعة؟",
      );

      if (!confirmed) {
        return;
      }
    }

    setSupplierId(nextSupplierId);
    setSupplierInvoiceNumber("");
    setNotes("");
    setLines([]);
    setPaymentMethod("credit");
    setInvoiceDiscount("0.00");
    setPaid("0.00");
    setSavedPurchase(null);
    setError("");
    setMessage("");
    clearSearchResults();
    requestKey.current = null;

    if (nextSupplierId) {
      await loadOpenDraft(nextSupplierId);
    }
  }

  async function handleSaveDraft() {
    if (!PURCHASE_WRITES_ENABLED) {
      setError("حفظ مسودة المشتريات غير مفعل.");
      return;
    }

    const validationError =
      validateInvoice({
        allowUnknownCost: true,
      });

    if (validationError) {
      setError(validationError);
      return;
    }

    setInvoiceBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await savePosPurchaseDraft(
        token,
        {
          supplierId,
          draftPublicId:
            savedPurchase?.purchase.status === "draft"
              ? savedPurchase.purchase.publicId
              : undefined,
          draftUpdatedAt:
            savedPurchase?.purchase.status === "draft"
              ? savedPurchase.purchase.updatedAt
              : undefined,
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
          })),
        },
      );

      setSavedPurchase(result);
      setMessage(
        `تم حفظ المسودة ${result.purchase.publicId}. لا يوجد أي قيد مالي حتى اعتماد الفاتورة.`,
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

  async function refreshCashSession() {
    const current = await getCurrentCashSession(
      token,
      session?.registerKey ?? "main",
    );

    setSession(current.session);
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
        "سيتم تسجيل الفاتورة محاسبيًا على حساب المورد دون تعديل مخزون المتجر.",
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
      const draftForApproval =
        await savePosPurchaseDraft(
          token,
          {
            supplierId,
            draftPublicId:
              savedPurchase?.purchase.status === "draft"
                ? savedPurchase.purchase.publicId
                : undefined,
            draftUpdatedAt:
              savedPurchase?.purchase.status === "draft"
                ? savedPurchase.purchase.updatedAt
                : undefined,
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
            })),
          },
        );

      setSavedPurchase(
        draftForApproval,
      );

      const result = await createPosPurchase(token, {
        supplierId,
        idempotencyKey,
        draftPublicId:
          draftForApproval.purchase.publicId,
        draftUpdatedAt:
          draftForApproval.purchase.updatedAt,
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
        })),
      });

      requestKey.current = null;
      setSavedPurchase(result);

      await refreshCashSession();

      if (printAfterSave) {
        window.setTimeout(() => {
          printPurchaseA4();
        }, 100);
      }

      setMessage(
        result.alreadyCreated
          ? `تم تحميل الفاتورة ${result.purchase.publicId} دون تكرارها.`
          : `تم حفظ الفاتورة ${result.purchase.publicId} محاسبيًا دون تعديل مخزون المتجر.`,
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
        unitCost:
          item.unitCost === null
            ? ""
            : item.unitCost.toFixed(2),
        lineDiscount: item.lineDiscount.toFixed(2),
      })),
    );

    setSavedPurchase(result);
    setError("");
    setMessage(
      result.purchase.status === "draft"
        ? `تم فتح المسودة ${result.purchase.publicId} ويمكنك متابعة تعديلها.`
        : `تم فتح الفاتورة ${result.purchase.publicId}.`,
    );
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

  async function loadLatestPurchase() {
    setInvoiceBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await getLatestPosPurchase(
        token,
        warehouseKey,
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

      if (
        caught instanceof ApiError &&
        caught.status === 404
      ) {
        setError("لا توجد فواتير مشتريات محفوظة.");
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
        "سيتم عكس الأثر المحاسبي للفاتورة.",
        "الفواتير القديمة التي سبق أن أثرت على المخزون سيتم عكس أثرها القديم تلقائيًا.",
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

      try {
        const refreshed = await getPosPurchaseByPublicId(
          token,
          result.purchase.publicId,
        );

        setSavedPurchase(refreshed);
      } catch {
        // الفاتورة أُلغيت بنجاح؛ فشل تحديث التنقل لا يلغي العملية.
      }

      await refreshCashSession();

      setMessage(
        `تم حذف الفاتورة ${result.purchase.publicId} وعكس أثرها المحاسبي.`,
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

  async function resetInvoice() {
    if (
      savedPurchase?.purchase.status === "draft"
    ) {
      const confirmed = window.confirm(
        "سيتم إلغاء المسودة المفتوحة وبدء فاتورة جديدة. هل تريد المتابعة؟",
      );

      if (!confirmed) {
        return;
      }

      try {
        await discardOpenPosPurchaseDraft(
          token,
          savedPurchase.purchase.supplierId,
          warehouseKey,
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
        return;
      }
    }

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
            تسجيل فاتورة المورد والحسابات المالية دون
            تعديل مخزون المتجر.
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
              : savedPurchase.purchase.status === "draft"
                ? `مسودة مفتوحة — ${savedPurchase.purchase.publicId}`
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
          onClick={() => void resetInvoice()}
        >
          فاتورة جديدة
        </button>

        <button
          type="button"
          disabled={
            invoiceBusy ||
            Boolean(
              savedPurchase &&
                !savedPurchase.navigation?.previousPublicId,
            )
          }
          onClick={() => {
            if (!savedPurchase) {
              void loadLatestPurchase();
              return;
            }

            const target =
              savedPurchase.navigation?.previousPublicId;

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
          type="button"
          disabled={
            invoiceBusy ||
            !PURCHASE_WRITES_ENABLED ||
            (savedPurchase !== null &&
              savedPurchase.purchase.status !== "draft")
          }
          onClick={() => void handleSaveDraft()}
        >
          {invoiceBusy ? "جاري الحفظ…" : "حفظ المسودة"}
        </button>

        <button
          className="is-primary-action"
          type="button"
          disabled={
            invoiceBusy ||
            !PURCHASE_WRITES_ENABLED ||
            (savedPurchase !== null &&
              savedPurchase.purchase.status !== "draft")
          }
          onClick={() => void handleSaveInvoice()}
        >
          {invoiceBusy ? "جاري الاعتماد…" : "اعتماد الفاتورة"}
        </button>

        <button
          type="button"
          disabled={
            invoiceBusy ||
            !PURCHASE_WRITES_ENABLED ||
            (savedPurchase !== null &&
              savedPurchase.purchase.status !== "draft")
          }
          onClick={() => void handleSaveInvoice(true)}
        >
          <span aria-hidden="true">🖨️</span>
          اعتماد وطباعة A4
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
              savedPurchase.purchase.status === "voided" ||
              savedPurchase.purchase.status === "draft"
            }
            onClick={() => void handleVoidInvoice()}
          >
            {savedPurchase.purchase.status === "voided"
              ? "الفاتورة محذوفة"
              : savedPurchase.purchase.status === "draft"
                ? "المسودة غير معتمدة"
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
        disabled={
          invoiceBusy ||
          (savedPurchase !== null &&
            savedPurchase.purchase.status !== "draft")
        }
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
                    void handleSupplierChange(
                      event.target.value,
                    )
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
                        مخزون المتجر للعرض فقط:{" "}
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
                  <td colSpan={10}>
                    امسح باركود صنف أو استخدم البحث
                    لإضافته.
                  </td>
                </tr>
              ) : (
                lines.map((line, index) => {
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
