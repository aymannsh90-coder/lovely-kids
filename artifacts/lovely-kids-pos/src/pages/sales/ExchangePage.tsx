import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  useNavigate,
  useSearchParams,
} from "react-router-dom";

import { usePosRuntime } from "../../app/pos-context";
import ExchangeReceipt from "../../components/ExchangeReceipt";
import { voidPosExchange } from "../../lib/api";
import {
  ApiError,
  createOnlineOrderExchange,
  createPosExchange,
  getOnlineOrderExchangePreview,
  getOnlineOrderExchangeStatus,
  receiveOnlineExchangeReturn,
  getPosExchangeByPublicId,
  getPosExchangePreview,
  lookupPosProductByBarcode,
  quotePosExchange,
  searchPosProducts,
  type OnlineExchangeDeliveryDiscountMode,
  type OnlineOrderExchangePreviewResult,
  type OnlineOrderExchangeResult,
  type PosExchangeCreateInput,
  type PosExchangeCreateResult,
  type PosExchangePreviewResult,
  type PosExchangeQuoteResult,
  type PosExchangeSettlementType,
  type PosProductLookup,
} from "../../lib/api";
import { printReceiptElementDirect } from "../../lib/directReceiptPrint";
import {
  captureScannerKeyboardEvent,
  createScannerKeyboardBuffer,
} from "../../lib/scannerKeyboard";

type ExchangeMode =
  | "with_receipt"
  | "no_receipt"
  | "online_order";

interface ExchangeNewLine {
  id: string;
  barcode: string;
  product: PosProductLookup;
  color: string | null;
  size: string | null;
  quantity: number;
  soldUnitPrice: string;
}

interface ExchangeNoReceiptReturnLine {
  id: string;
  barcode: string;
  product: PosProductLookup;
  color: string | null;
  size: string | null;
  quantity: number;
  returnUnitPrice: string;
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
  const amount =
    Number(value.trim().replace(",", "."));

  if (
    !Number.isFinite(amount) ||
    amount < 0
  ) {
    return null;
  }

  return Math.round(amount * 100);
}

function getColors(
  product: PosProductLookup,
) {
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

function variantSelectionComplete(
  product: PosProductLookup,
  color: string | null,
  size: string | null,
) {
  if (
    product.colorVariants.length > 0
  ) {
    if (!color) {
      return false;
    }

    const sizes =
      getSizes(
        product,
        color,
      );

    if (
      sizes.length > 0 &&
      !size
    ) {
      return false;
    }
  } else if (
    product.sizes.length > 0 &&
    !size
  ) {
    return false;
  }

  return true;
}

function newLineSelectionComplete(
  line: ExchangeNewLine,
) {
  return variantSelectionComplete(
    line.product,
    line.color,
    line.size,
  );
}

function noReceiptLineSelectionComplete(
  line: ExchangeNoReceiptReturnLine,
) {
  return variantSelectionComplete(
    line.product,
    line.color,
    line.size,
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "حدث خطأ غير متوقع";
}

function formatMoney(valueMinor: number) {
  return new Intl.NumberFormat("ar-PS", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 2,
  }).format(valueMinor / 100);
}

export default function ExchangePage() {
  const {
    token,
    session,
    clearAuthentication,
  } = usePosRuntime();

  const navigate =
    useNavigate();

  const [searchParams] =
    useSearchParams();

  const historyPublicId =
    (
      searchParams.get(
        "publicId",
      ) ?? ""
    )
      .trim()
      .toUpperCase();

  const historyDate =
    (searchParams.get("date") ?? "").trim();

  const invoiceInputRef =
    useRef<HTMLInputElement>(null);

  const exchangeReceiptRef =
    useRef<HTMLElement>(null);

  const invoiceScannerKeyboard = useRef(
    createScannerKeyboardBuffer(),
  );

  const barcodeScannerKeyboard = useRef(
    createScannerKeyboardBuffer(),
  );

  const noReceiptInputRef =
    useRef<HTMLInputElement>(null);

  const noReceiptScannerKeyboard = useRef(
    createScannerKeyboardBuffer(),
  );

  const noReceiptScannerSubmitValue =
    useRef<string | null>(null);

  const newItemInputRef =
    useRef<HTMLInputElement>(null);

  const newItemScannerKeyboard = useRef(
    createScannerKeyboardBuffer(),
  );

  const newItemScannerSubmitValue =
    useRef<string | null>(null);

  const exchangeCreateInFlight =
    useRef(false);

  const exchangeExecutionKey =
    useRef<string | null>(null);

  const exchangeExecutionSignature =
    useRef<string | null>(null);

  const onlineExchangeExecutionKey =
    useRef<string | null>(null);

  const [onlineOrderInput, setOnlineOrderInput] =
    useState("");

  const [onlinePreview, setOnlinePreview] =
    useState<OnlineOrderExchangePreviewResult | null>(
      null,
    );

  const [onlineQuantities, setOnlineQuantities] =
    useState<Record<number, number>>({});

  const [onlineSearchBusy, setOnlineSearchBusy] =
    useState(false);

  const [onlineError, setOnlineError] =
    useState("");

  const [
    onlineReplacementMode,
    setOnlineReplacementMode,
  ] = useState<"system_created" | "existing_order">(
    "system_created",
  );

  const [
    onlineReplacementOrderId,
    setOnlineReplacementOrderId,
  ] = useState("");

  const [
    onlineDeliveryDiscountMode,
    setOnlineDeliveryDiscountMode,
  ] = useState<OnlineExchangeDeliveryDiscountMode>(
    "none",
  );

  const [
    onlineManualDeliveryDiscount,
    setOnlineManualDeliveryDiscount,
  ] = useState("0");

  const [onlineNotes, setOnlineNotes] =
    useState("");

  const [onlineCreateBusy, setOnlineCreateBusy] =
    useState(false);

  const [onlineCreateError, setOnlineCreateError] =
    useState("");

  const [onlineResult, setOnlineResult] =
    useState<OnlineOrderExchangeResult | null>(
      null,
    );

  const [onlineStatusBusy, setOnlineStatusBusy] =
    useState(false);

  const [onlineReceiveBusy, setOnlineReceiveBusy] =
    useState(false);

  const [onlineReceiveError, setOnlineReceiveError] =
    useState("");

  const [onlineReceiveMessage, setOnlineReceiveMessage] =
    useState("");

  const [mode, setMode] =
    useState<ExchangeMode>(
      session
        ? "with_receipt"
        : "online_order",
    );

  const [customerName, setCustomerName] =
    useState("");

  const [
    historyLoadBusy,
    setHistoryLoadBusy,
  ] = useState(false);

  const [
    historyLoadError,
    setHistoryLoadError,
  ] = useState("");

  const [invoiceInput, setInvoiceInput] =
    useState("");

  const [barcodeInput, setBarcodeInput] =
    useState("");

  const [preview, setPreview] =
    useState<PosExchangePreviewResult | null>(
      null,
    );

  const [quantities, setQuantities] =
    useState<Record<string, number>>({});

  const [searchBusy, setSearchBusy] =
    useState(false);

  const [error, setError] =
    useState("");

  const [
    noReceiptInput,
    setNoReceiptInput,
  ] = useState("");

  const [
    noReceiptSearchResults,
    setNoReceiptSearchResults,
  ] = useState<PosProductLookup[]>([]);

  const [
    noReceiptSearchOpen,
    setNoReceiptSearchOpen,
  ] = useState(false);

  const [
    noReceiptSearchBusy,
    setNoReceiptSearchBusy,
  ] = useState(false);

  const [
    noReceiptLookupBusy,
    setNoReceiptLookupBusy,
  ] = useState(false);

  const [
    activeNoReceiptSearchIndex,
    setActiveNoReceiptSearchIndex,
  ] = useState(0);

  const [
    noReceiptMessage,
    setNoReceiptMessage,
  ] = useState("");

  const [
    noReceiptError,
    setNoReceiptError,
  ] = useState("");

  const [
    noReceiptCart,
    setNoReceiptCart,
  ] = useState<
    ExchangeNoReceiptReturnLine[]
  >([]);

  const [newItemInput, setNewItemInput] =
    useState("");

  const [
    newItemSearchResults,
    setNewItemSearchResults,
  ] = useState<PosProductLookup[]>([]);

  const [
    newItemSearchOpen,
    setNewItemSearchOpen,
  ] = useState(false);

  const [
    newItemSearchBusy,
    setNewItemSearchBusy,
  ] = useState(false);

  const [
    newItemLookupBusy,
    setNewItemLookupBusy,
  ] = useState(false);

  const [
    activeNewItemSearchIndex,
    setActiveNewItemSearchIndex,
  ] = useState(0);

  const [
    newItemMessage,
    setNewItemMessage,
  ] = useState("");

  const [
    newItemError,
    setNewItemError,
  ] = useState("");

  const [newCart, setNewCart] =
    useState<ExchangeNewLine[]>([]);

  const [
    newInvoiceDiscount,
    setNewInvoiceDiscount,
  ] = useState("0.00");

  const [
    settlementType,
    setSettlementType,
  ] = useState<PosExchangeSettlementType>(
    "cash",
  );

  const [quote, setQuote] =
    useState<PosExchangeQuoteResult | null>(
      null,
    );

  const [
    quoteSignature,
    setQuoteSignature,
  ] = useState("");

  const [quoteBusy, setQuoteBusy] =
    useState(false);

  const [quoteError, setQuoteError] =
    useState("");

  const [createBusy, setCreateBusy] =
    useState(false);

  const [createError, setCreateError] =
    useState("");

  const [
    createdExchangePublicId,
    setCreatedExchangePublicId,
  ] = useState<string | null>(null);

  const [
    createdExchangeWasExisting,
    setCreatedExchangeWasExisting,
  ] = useState(false);

  const [
    createdExchangeResult,
    setCreatedExchangeResult,
  ] = useState<
    PosExchangeCreateResult | null
  >(null);

  const [printBusy, setPrintBusy] =
    useState(false);

  const [printError, setPrintError] =
    useState("");

  const [printMessage, setPrintMessage] =
    useState("");

  const [voidBusy, setVoidBusy] =
    useState(false);

  const [voidError, setVoidError] =
    useState("");

  const [voidMessage, setVoidMessage] =
    useState("");

  const [
    exchangeVoided,
    setExchangeVoided,
  ] = useState(false);

  const selectedItems = useMemo(() => {
    if (!preview) {
      return [];
    }

    return preview.items
      .map((item) => ({
        item,
        quantity:
          quantities[item.id] ?? 0,
      }))
      .filter(
        ({ quantity }) => quantity > 0,
      );
  }, [preview, quantities]);

  const selectedPieces = useMemo(
    () =>
      selectedItems.reduce(
        (total, entry) =>
          total + entry.quantity,
        0,
      ),
    [selectedItems],
  );

  const selectedGrossMinor = useMemo(
    () =>
      selectedItems.reduce(
        (total, entry) =>
          total +
          entry.item.soldUnitPriceMinor *
            entry.quantity,
        0,
      ),
    [selectedItems],
  );

  const noReceiptReturnMinor =
    useMemo(
      () =>
        noReceiptCart.reduce(
          (total, line) => {
            const price =
              moneyToMinor(
                line.returnUnitPrice,
              ) ?? 0;

            return (
              total +
              price * line.quantity
            );
          },
          0,
        ),
      [noReceiptCart],
    );

  const newItemsGrossMinor =
    useMemo(
      () =>
        newCart.reduce(
          (total, line) => {
            const price =
              moneyToMinor(
                line.soldUnitPrice,
              ) ?? 0;

            return (
              total +
              price * line.quantity
            );
          },
          0,
        ),
      [newCart],
    );

  const quoteInputSignature =
    useMemo(
      () =>
        JSON.stringify({
          mode,

          registerKey:
            session?.registerKey ??
            null,

          originalSalePublicId:
            preview?.sale.publicId ??
            null,

          receiptReturns:
            selectedItems.map(
              ({ item, quantity }) => ({
                id: item.id,
                quantity,
              }),
            ),

          noReceiptReturns:
            noReceiptCart.map(
              (line) => ({
                productId:
                  line.product.productId,
                barcode:
                  line.barcode,
                color:
                  line.color,
                size:
                  line.size,
                quantity:
                  line.quantity,
                returnUnitPrice:
                  line.returnUnitPrice,
              }),
            ),

          newItems:
            newCart.map(
              (line) => ({
                productId:
                  line.product.productId,
                barcode:
                  line.barcode,
                color:
                  line.color,
                size:
                  line.size,
                quantity:
                  line.quantity,
                soldUnitPrice:
                  line.soldUnitPrice,
              }),
            ),

          newInvoiceDiscount,
          settlementType,
        }),
      [
        mode,
        session?.registerKey,
        preview?.sale.publicId,
        selectedItems,
        noReceiptCart,
        newCart,
        newInvoiceDiscount,
        settlementType,
      ],
    );

  const registerKey =
    session?.registerKey ?? "";

  const activeQuote =
    quote &&
    quoteSignature ===
      quoteInputSignature
      ? quote
      : null;

  function buildQuoteInput(
    idempotencyKey =
      `quote:${createKey()}`,
  ): PosExchangeCreateInput {
    if (!session) {
      throw new Error(
        "افتح جلسة الصندوق لاستخدام تبديل نقاط البيع",
      );
    }

    const discountMinor =
      moneyToMinor(
        newInvoiceDiscount,
      );

    if (discountMinor === null) {
      throw new Error(
        "خصم الأصناف الجديدة غير صالح",
      );
    }

    if (newCart.length < 1) {
      throw new Error(
        "أضف صنفًا جديدًا واحدًا على الأقل",
      );
    }

    for (const line of newCart) {
      if (
        !newLineSelectionComplete(
          line,
        )
      ) {
        throw new Error(
          `أكمل اللون والنمرة للصنف ${line.product.nameAr}`,
        );
      }

      if (
        moneyToMinor(
          line.soldUnitPrice,
        ) === null
      ) {
        throw new Error(
          `سعر الصنف الجديد ${line.product.nameAr} غير صالح`,
        );
      }
    }

    const newItems =
      newCart.map(
        (line) => ({
          productId:
            line.product.productId,

          barcode:
            line.barcode ||
            line.product.barcode ||
            null,

          quantity:
            line.quantity,

          soldUnitPrice:
            line.soldUnitPrice,

          lineDiscount: 0,

          color:
            line.color,

          size:
            line.size,
        }),
      );

    const common = {
      registerKey,

      idempotencyKey,

      settlementType,

      newItems,

      newInvoiceDiscount:
        newInvoiceDiscount.trim() ||
        "0",

      customerName:
        customerName.trim() ||
        undefined,
    };

    if (
      mode === "with_receipt"
    ) {
      if (!preview) {
        throw new Error(
          "امسح الفاتورة الأصلية أولًا",
        );
      }

      if (
        selectedItems.length < 1
      ) {
        throw new Error(
          "اختر صنفًا مرتجعًا واحدًا على الأقل من الفاتورة",
        );
      }

      return {
        ...common,

        sourceType:
          "pos_sale",

        originalSalePublicId:
          preview.sale.publicId,

        returnItems:
          selectedItems.map(
            ({ item, quantity }) => ({
              originalSaleItemId:
                item.id,
              quantity,
            }),
          ),
      };
    }

    if (
      noReceiptCart.length < 1
    ) {
      throw new Error(
        "أضف صنفًا مرتجعًا واحدًا على الأقل",
      );
    }

    for (
      const line of
      noReceiptCart
    ) {
      if (
        !noReceiptLineSelectionComplete(
          line,
        )
      ) {
        throw new Error(
          `أكمل اللون والنمرة للصنف المرتجع ${line.product.nameAr}`,
        );
      }

      if (
        moneyToMinor(
          line.returnUnitPrice,
        ) === null
      ) {
        throw new Error(
          `قيمة المرتجع للصنف ${line.product.nameAr} غير صالحة`,
        );
      }
    }

    return {
      ...common,

      sourceType:
        "pos_no_receipt",

      returnItems:
        noReceiptCart.map(
          (line) => ({
            productId:
              line.product.productId,

            barcode:
              line.barcode ||
              line.product.barcode ||
              null,

            quantity:
              line.quantity,

            returnUnitPrice:
              line.returnUnitPrice,

            color:
              line.color,

            size:
              line.size,
          }),
        ),
    };
  }

  async function handleQuoteExchange() {
    let input:
      PosExchangeCreateInput;

    try {
      input =
        buildQuoteInput();
    } catch (caught) {
      setQuoteError(
        errorMessage(caught),
      );

      return;
    }

    setQuoteBusy(true);
    setQuoteError("");

    const requestedSignature =
      quoteInputSignature;

    try {
      const result =
        await quotePosExchange(
          token,
          input,
        );

      if (
        !result.validationOnly ||
        !result.quote
      ) {
        throw new Error(
          "تعذر استلام معاينة التبديل من الخادم",
        );
      }

      setQuote(
        result.quote,
      );

      setQuoteSignature(
        requestedSignature,
      );
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setQuoteError(
        errorMessage(caught),
      );
    } finally {
      setQuoteBusy(false);
    }
  }

  async function handleCreateExchange() {
    if (
      exchangeCreateInFlight.current ||
      createBusy
    ) {
      return;
    }

    if (createdExchangePublicId) {
      return;
    }

    if (!activeQuote) {
      setCreateError(
        "يجب حساب فرق التبديل واعتماد المعاينة الحالية قبل التنفيذ",
      );
      return;
    }

    let executionKey =
      exchangeExecutionKey.current;

    if (
      !executionKey ||
      exchangeExecutionSignature.current !==
        quoteInputSignature
    ) {
      executionKey =
        `exchange:${createKey()}`;

      exchangeExecutionKey.current =
        executionKey;

      exchangeExecutionSignature.current =
        quoteInputSignature;
    }

    let baseInput:
      PosExchangeCreateInput;

    try {
      baseInput =
        buildQuoteInput(
          executionKey,
        );
    } catch (caught) {
      setCreateError(
        errorMessage(caught),
      );
      return;
    }

    const input:
      PosExchangeCreateInput = {
        ...baseInput,

        validationOnly: false,

        expectedQuote: {
          returnNetMinor:
            activeQuote.returnNetMinor,

          newNetMinor:
            activeQuote.newNetMinor,

          settlementAmountMinor:
            activeQuote
              .settlementAmountMinor,
        },
      };

    exchangeCreateInFlight.current =
      true;

    setCreateBusy(true);
    setCreateError("");
    setQuoteError("");

    try {
      const result =
        await createPosExchange(
          token,
          input,
        );

      if (
        result.validationOnly ||
        !result.exchange
      ) {
        throw new Error(
          "لم يتم إنشاء فاتورة التبديل",
        );
      }

      setCreatedExchangePublicId(
        result.exchange.publicId,
      );

      setCreatedExchangeWasExisting(
        result.alreadyCreated,
      );

      setCreatedExchangeResult(
        result,
      );

      setPrintError("");
      setPrintMessage("");
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
        caught.status === 409
      ) {
        setQuote(null);
        setQuoteSignature("");

        exchangeExecutionKey.current =
          null;

        exchangeExecutionSignature.current =
          null;

        setCreateError(
          `${errorMessage(
            caught,
          )} — احسب فرق التبديل من جديد قبل التنفيذ.`,
        );

        return;
      }

      setCreateError(
        errorMessage(caught),
      );
    } finally {
      exchangeCreateInFlight.current =
        false;

      setCreateBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    if (!historyPublicId) {
      return;
    }

    setHistoryLoadBusy(true);
    setHistoryLoadError("");

    void getPosExchangeByPublicId(
      token,
      historyPublicId,
    )
      .then((result) => {
        if (
          cancelled ||
          !result.exchange
        ) {
          return;
        }

        setCreatedExchangePublicId(
          result.exchange.publicId,
        );

        setCreatedExchangeWasExisting(
          false,
        );

        setCreatedExchangeResult(
          result,
        );

        setCustomerName(
          result.exchange.customerName ?? "",
        );

        setExchangeVoided(
          result.exchange.status ===
            "voided",
        );

        setPrintError("");
        setPrintMessage("");
        setVoidError("");
        setVoidMessage("");

        window.setTimeout(() => {
          document
            .getElementById(
              "exchange-result-actions",
            )
            ?.scrollIntoView({
              behavior:
                "smooth",
              block:
                "center",
            });
        }, 0);
      })
      .catch((caught) => {
        if (cancelled) {
          return;
        }

        if (
          caught instanceof
            ApiError &&
          caught.status === 401
        ) {
          clearAuthentication();
          return;
        }

        setHistoryLoadError(
          errorMessage(caught),
        );
      })
      .finally(() => {
        if (!cancelled) {
          setHistoryLoadBusy(
            false,
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    token,
    historyPublicId,
  ]);

  async function handlePrintExchange() {
    const source =
      exchangeReceiptRef.current;

    if (
      !createdExchangeResult ||
      !createdExchangeResult.exchange ||
      !source
    ) {
      setPrintError(
        "لا توجد فاتورة تبديل جاهزة للطباعة",
      );
      return;
    }

    setPrintBusy(true);
    setPrintError("");
    setPrintMessage("");

    try {
      await printReceiptElementDirect(
        source,
      );

      setPrintMessage(
        `تم إرسال فاتورة التبديل ${createdExchangeResult.exchange.publicId} إلى الطابعة.`,
      );
    } catch (caught) {
      setPrintError(
        errorMessage(caught),
      );
    } finally {
      setPrintBusy(false);
    }
  }

  async function handleVoidExchange() {
    const exchange =
      createdExchangeResult?.exchange;

    if (!exchange) {
      setVoidError(
        "لا توجد فاتورة تبديل جاهزة للإلغاء",
      );
      return;
    }

    if (exchangeVoided) {
      setVoidMessage(
        "فاتورة التبديل ملغاة بالفعل.",
      );
      return;
    }

    const enteredReason =
      window.prompt(
        "أدخل سبب إلغاء فاتورة التبديل:",
      );

    if (enteredReason === null) {
      return;
    }

    const reason =
      enteredReason.trim();

    if (reason.length < 2) {
      setVoidError(
        "يجب إدخال سبب إلغاء فاتورة التبديل",
      );
      return;
    }

    const confirmed =
      window.confirm(
        [
          "تأكيد إلغاء فاتورة التبديل؟",
          "",
          `رقم الفاتورة: ${exchange.publicId}`,
          "",
          "سيتم عكس حركة المخزون والتكلفة وحركة الصندوق النقدية إن وجدت.",
        ].join("\n"),
      );

    if (!confirmed) {
      return;
    }

    setVoidBusy(true);
    setVoidError("");
    setVoidMessage("");

    try {
      const result =
        await voidPosExchange(
          token,
          {
            publicId:
              exchange.publicId,

            reason,
          },
        );

      setExchangeVoided(true);

      setCreatedExchangeResult(
        (current) =>
          current?.exchange
            ? {
                ...current,
                exchange: {
                  ...current.exchange,
                  status: "voided",
                  voidedAt:
                    result.exchange.voidedAt,
                  voidReason:
                    result.exchange.voidReason,
                },
              }
            : current,
      );

      setPrintError("");
      setPrintMessage("");

      setVoidMessage(
        result.alreadyVoided
          ? "فاتورة التبديل ملغاة مسبقًا."
          : "تم إلغاء فاتورة التبديل بنجاح.",
      );
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setVoidError(
        errorMessage(caught),
      );
    } finally {
      setVoidBusy(false);
    }
  }

  function renderOnlineOrderExchange() {
    const selectedPieces =
      onlinePreview?.items.reduce(
        (total, item) =>
          total +
          (
            onlineQuantities[
              item.lineNumber
            ] ?? 0
          ),
        0,
      ) ?? 0;

    const selectedGrossMinor =
      onlinePreview?.items.reduce(
        (total, item) =>
          total +
          item.soldUnitPriceMinor *
            (
              onlineQuantities[
                item.lineNumber
              ] ?? 0
            ),
        0,
      ) ?? 0;

    const exchange =
      onlineResult?.exchange ?? null;

    return (
      <>
        <article className="sales-return-search-panel">
          <div className="sales-return-section-title">
            <div>
              <h3>
                🌐 الطلب الأصلي من المتجر
              </h3>

              <p>
                أدخل رقم طلب المتجر الذي تم
                تسليمه للزبون، ثم اختر
                الأصناف التي سيعيدها.
              </p>
            </div>

            {(onlinePreview ||
              onlineOrderInput) && (
              <button
                type="button"
                className="secondary-button"
                disabled={
                  onlineSearchBusy ||
                  onlineCreateBusy
                }
                onClick={
                  resetOnlineExchange
                }
              >
                طلب آخر
              </button>
            )}
          </div>

          <form
            className="sales-return-search-form"
            onSubmit={
              handleOnlineOrderSearch
            }
          >
            <label className="sales-return-field">
              <span>
                رقم طلب المتجر
              </span>

              <input
                dir="ltr"
                inputMode="numeric"
                autoComplete="off"
                value={onlineOrderInput}
                placeholder="مثال: 1234"
                disabled={
                  onlineSearchBusy ||
                  Boolean(onlineResult)
                }
                onChange={(event) =>
                  setOnlineOrderInput(
                    event.target.value,
                  )
                }
              />
            </label>

            <button
              type="submit"
              className="primary-button"
              disabled={
                onlineSearchBusy ||
                Boolean(onlineResult)
              }
            >
              {onlineSearchBusy
                ? "جاري تحميل الطلب..."
                : "عرض الطلب"}
            </button>
          </form>

          {onlineError && (
            <p
              className="error-message"
              role="alert"
            >
              {onlineError}
            </p>
          )}
        </article>

        {onlinePreview && (
          <>
            <article className="sales-return-search-panel">
              <div className="sales-return-section-title">
                <div>
                  <h3>
                    الطلب #
                    <span dir="ltr">
                      {
                        onlinePreview
                          .order.id
                      }
                    </span>
                  </h3>

                  <p>
                    {
                      onlinePreview.order
                        .customerName
                    }
                    {" — "}
                    {
                      onlinePreview.order
                        .customerPhone
                    }
                  </p>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(150px, 1fr))",
                  gap: "12px",
                  padding: "16px",
                }}
              >
                <div>
                  <small>
                    إجمالي الطلب
                  </small>
                  <br />
                  <strong>
                    {formatMoney(
                      Math.round(
                        onlinePreview
                          .order.totalPrice *
                          100,
                      ),
                    )}
                  </strong>
                </div>

                <div>
                  <small>
                    مباع
                  </small>
                  <br />
                  <strong>
                    {
                      onlinePreview.summary
                        .soldQuantity
                    }
                    {" قطعة"}
                  </strong>
                </div>

                <div>
                  <small>
                    تم تبديله سابقًا
                  </small>
                  <br />
                  <strong>
                    {
                      onlinePreview.summary
                        .exchangedQuantity
                    }
                    {" قطعة"}
                  </strong>
                </div>

                <div>
                  <small>
                    متاح للتبديل
                  </small>
                  <br />
                  <strong>
                    {
                      onlinePreview.summary
                        .returnableQuantity
                    }
                    {" قطعة"}
                  </strong>
                </div>

                <div>
                  <small>
                    القيمة المتاحة
                  </small>
                  <br />
                  <strong>
                    {formatMoney(
                      onlinePreview.summary
                        .returnableValueMinor,
                    )}
                  </strong>
                </div>
              </div>
            </article>

            <article className="sales-return-search-panel">
              <div className="sales-return-section-title">
                <div>
                  <h3>
                    الأصناف القديمة
                  </h3>

                  <p>
                    حدد الكمية التي سيعيدها
                    الزبون من كل سطر.
                  </p>
                </div>
              </div>

              <div className="sales-return-table-wrap">
                <table className="sales-return-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>الصنف</th>
                      <th>اللون / المقاس</th>
                      <th>سعر البيع</th>
                      <th>مباع</th>
                      <th>تبديل سابق</th>
                      <th>متاح</th>
                      <th>كمية التبديل</th>
                      <th>القيمة</th>
                    </tr>
                  </thead>

                  <tbody>
                    {onlinePreview.items.map(
                      (item) => {
                        const quantity =
                          onlineQuantities[
                            item.lineNumber
                          ] ?? 0;

                        return (
                          <tr
                            key={
                              item.lineNumber
                            }
                          >
                            <td>
                              {
                                item.lineNumber
                              }
                            </td>

                            <td>
                              <div className="sales-return-product">
                                {item.productImage && (
                                  <img
                                    src={
                                      item.productImage
                                    }
                                    alt=""
                                  />
                                )}

                                <div>
                                  <strong>
                                    {
                                      item.productNameAr
                                    }
                                  </strong>

                                  <small dir="ltr">
                                    ID:{" "}
                                    {
                                      item.productId
                                    }
                                  </small>
                                </div>
                              </div>
                            </td>

                            <td>
                              <strong>
                                {item.color ??
                                  "—"}
                              </strong>
                              <br />
                              <small>
                                {item.size ??
                                  "—"}
                              </small>
                            </td>

                            <td>
                              {formatMoney(
                                item.soldUnitPriceMinor,
                              )}
                            </td>

                            <td>
                              {
                                item.soldQuantity
                              }
                            </td>

                            <td>
                              {
                                item.exchangedQuantity
                              }
                            </td>

                            <td>
                              {
                                item.returnableQuantity
                              }
                            </td>

                            <td>
                              <input
                                className="sales-return-quantity-input"
                                type="number"
                                inputMode="numeric"
                                min={0}
                                max={
                                  item.returnableQuantity
                                }
                                step={1}
                                value={
                                  quantity
                                }
                                disabled={
                                  Boolean(
                                    onlineResult,
                                  ) ||
                                  item.returnableQuantity ===
                                    0
                                }
                                onChange={(
                                  event,
                                ) =>
                                  updateOnlineQuantity(
                                    item.lineNumber,
                                    Number(
                                      event
                                        .target
                                        .value,
                                    ),
                                    item.returnableQuantity,
                                  )
                                }
                              />
                            </td>

                            <td>
                              <strong>
                                {formatMoney(
                                  item.soldUnitPriceMinor *
                                    quantity,
                                )}
                              </strong>
                            </td>
                          </tr>
                        );
                      },
                    )}
                  </tbody>
                </table>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent:
                    "space-between",
                  flexWrap: "wrap",
                  gap: "16px",
                  padding: "16px",
                }}
              >
                <div>
                  <small>
                    القطع المحددة
                  </small>
                  <br />
                  <strong>
                    {selectedPieces}
                  </strong>
                </div>

                <div>
                  <small>
                    القيمة قبل توزيع خصم
                    الفاتورة الأصلية
                  </small>
                  <br />
                  <strong>
                    {formatMoney(
                      selectedGrossMinor,
                    )}
                  </strong>
                </div>
              </div>
            </article>

            {!onlineResult && (
              <article className="sales-return-search-panel">
                <div className="sales-return-section-title">
                  <div>
                    <h3>
                      الطلب البديل
                    </h3>

                    <p>
                      إما إنشاء طلب جديد تلقائيًا
                      ثم تعديله، أو ربط طلب
                      موجود مسبقًا.
                    </p>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: "16px",
                    padding: "16px",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(2, minmax(0, 1fr))",
                      gap: "10px",
                    }}
                  >
                    <button
                      type="button"
                      className={
                        onlineReplacementMode ===
                        "system_created"
                          ? "primary-button"
                          : "secondary-button"
                      }
                      onClick={() => {
                        setOnlineReplacementMode(
                          "system_created",
                        );
                        setOnlineReplacementOrderId(
                          "",
                        );
                        onlineExchangeExecutionKey.current =
                          null;
                      }}
                    >
                      ➕ إنشاء طلب بديل جديد
                    </button>

                    <button
                      type="button"
                      className={
                        onlineReplacementMode ===
                        "existing_order"
                          ? "primary-button"
                          : "secondary-button"
                      }
                      onClick={() => {
                        setOnlineReplacementMode(
                          "existing_order",
                        );
                        onlineExchangeExecutionKey.current =
                          null;
                      }}
                    >
                      🔗 ربط طلب موجود
                    </button>
                  </div>

                  {onlineReplacementMode ===
                    "existing_order" && (
                    <label className="sales-return-field">
                      <span>
                        رقم الطلب البديل
                      </span>

                      <input
                        dir="ltr"
                        inputMode="numeric"
                        value={
                          onlineReplacementOrderId
                        }
                        placeholder="رقم الطلب الجديد"
                        onChange={(event) => {
                          setOnlineReplacementOrderId(
                            event.target.value,
                          );
                          onlineExchangeExecutionKey.current =
                            null;
                        }}
                      />
                    </label>
                  )}

                  <div>
                    <strong>
                      خصم التوصيل للزبون
                    </strong>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(4, minmax(0, 1fr))",
                        gap: "8px",
                        marginTop: "8px",
                      }}
                    >
                      {(
                        [
                          [
                            "none",
                            "بدون خصم",
                          ],
                          [
                            "half",
                            "نصف التوصيل",
                          ],
                          [
                            "full",
                            "توصيل مجاني",
                          ],
                          [
                            "manual",
                            "يدوي",
                          ],
                        ] as const
                      ).map(
                        ([
                          value,
                          label,
                        ]) => (
                          <button
                            key={value}
                            type="button"
                            className={
                              onlineDeliveryDiscountMode ===
                              value
                                ? "primary-button"
                                : "secondary-button"
                            }
                            onClick={() => {
                              setOnlineDeliveryDiscountMode(
                                value,
                              );
                              onlineExchangeExecutionKey.current =
                                null;
                            }}
                          >
                            {label}
                          </button>
                        ),
                      )}
                    </div>
                  </div>

                  {onlineDeliveryDiscountMode ===
                    "manual" && (
                    <label className="sales-return-field">
                      <span>
                        قيمة خصم التوصيل
                        اليدوي
                      </span>

                      <input
                        dir="ltr"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        value={
                          onlineManualDeliveryDiscount
                        }
                        onChange={(event) => {
                          setOnlineManualDeliveryDiscount(
                            event.target.value,
                          );
                          onlineExchangeExecutionKey.current =
                            null;
                        }}
                      />
                    </label>
                  )}

                  <label className="sales-return-field">
                    <span>
                      ملاحظات (اختياري)
                    </span>

                    <textarea
                      value={onlineNotes}
                      maxLength={1000}
                      rows={3}
                      onChange={(event) => {
                        setOnlineNotes(
                          event.target.value,
                        );
                        onlineExchangeExecutionKey.current =
                          null;
                      }}
                    />
                  </label>

                  {onlineCreateError && (
                    <p
                      className="error-message"
                      role="alert"
                    >
                      {onlineCreateError}
                    </p>
                  )}

                  <button
                    type="button"
                    className="primary-button"
                    disabled={
                      onlineCreateBusy ||
                      selectedPieces === 0
                    }
                    onClick={() =>
                      void handleCreateOnlineExchange()
                    }
                  >
                    {onlineCreateBusy
                      ? "جاري إنشاء التبديل..."
                      : onlineReplacementMode ===
                          "system_created"
                        ? "إنشاء عملية التبديل والطلب البديل"
                        : "ربط الطلب وتنفيذ عملية التبديل"}
                  </button>
                </div>
              </article>
            )}

            {onlineResult && exchange && (
              <article className="sales-return-search-panel">
                <div className="sales-return-section-title">
                  <div>
                    <h3>
                      ✅ تم إنشاء تبديل
                      الأونلاين
                    </h3>

                    <p>
                      رقم العملية:{" "}
                      <strong dir="ltr">
                        {
                          exchange.publicId
                        }
                      </strong>
                    </p>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fit, minmax(160px, 1fr))",
                    gap: "12px",
                    padding: "16px",
                  }}
                >
                  <div>
                    <small>
                      قيمة المرتجع الفعلية
                    </small>
                    <br />
                    <strong>
                      {formatMoney(
                        exchange.returnNetMinor,
                      )}
                    </strong>
                  </div>

                  <div>
                    <small>
                      قيمة أصناف الطلب البديل
                    </small>
                    <br />
                    <strong>
                      {formatMoney(
                        exchange.newNetMinor,
                      )}
                    </strong>
                  </div>

                  <div>
                    <small>
                      فرق البضاعة
                    </small>
                    <br />
                    <strong>
                      {formatMoney(
                        exchange.differenceMinor,
                      )}
                    </strong>
                  </div>

                  <div>
                    <small>
                      التوصيل الأساسي
                    </small>
                    <br />
                    <strong>
                      {formatMoney(
                        exchange.deliveryBaseChargeMinor,
                      )}
                    </strong>
                  </div>

                  <div>
                    <small>
                      خصم التوصيل
                    </small>
                    <br />
                    <strong>
                      {formatMoney(
                        exchange.deliveryDiscountMinor,
                      )}
                    </strong>
                  </div>

                  <div>
                    <small>
                      التوصيل على الزبون
                    </small>
                    <br />
                    <strong>
                      {formatMoney(
                        exchange.deliveryChargeMinor,
                      )}
                    </strong>
                  </div>

                  <div>
                    <small>
                      صافي التسوية مع شركة
                      التوصيل
                    </small>
                    <br />
                    <strong>
                      {formatMoney(
                        exchange.settlementAmountMinor,
                      )}
                    </strong>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: "10px",
                    padding:
                      "0 16px 16px",
                  }}
                >
                  <p>
                    الطلب الأصلي:{" "}
                    <strong dir="ltr">
                      #
                      {
                        exchange.originalOrderId
                      }
                    </strong>
                    {" — "}
                    الطلب البديل:{" "}
                    <strong dir="ltr">
                      #
                      {
                        exchange.replacementOrderId
                      }
                    </strong>
                  </p>

                  <p>
                    حالة الحساب:{" "}
                    <strong>
                      {exchange.financialCompletedAt
                        ? "✅ تم احتساب التبديل عند تسليم الطلب البديل"
                        : "⏳ بانتظار تسليم الطلب البديل"}
                    </strong>
                  </p>

                  <p>
                    حالة المرتجع:{" "}
                    <strong>
                      {exchange.returnReceivedAt
                        ? "✅ تم استلام الطرد المرتجع"
                        : exchange.financialCompletedAt
                          ? "🚚 مرتجع بالطريق"
                          : "⏳ بانتظار تسليم الطلب البديل"}
                    </strong>
                  </p>

                  {onlineReceiveError && (
                    <p
                      className="error-message"
                      role="alert"
                    >
                      {onlineReceiveError}
                    </p>
                  )}

                  {onlineReceiveMessage && (
                    <p>
                      {
                        onlineReceiveMessage
                      }
                    </p>
                  )}

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "10px",
                    }}
                  >
                    <button
                      type="button"
                      className="primary-button"
                      onClick={
                        handleOpenReplacementOrder
                      }
                    >
                      ✏️ تعديل الطلب الجديد
                    </button>

                    <button
                      type="button"
                      className="secondary-button"
                      disabled={
                        onlineStatusBusy
                      }
                      onClick={() =>
                        void handleRefreshOnlineStatus()
                      }
                    >
                      {onlineStatusBusy
                        ? "جاري التحديث..."
                        : "🔄 تحديث الحالة"}
                    </button>

                    {exchange.financialCompletedAt &&
                      !exchange.returnReceivedAt && (
                        <button
                          type="button"
                          className="primary-button"
                          disabled={
                            onlineReceiveBusy
                          }
                          onClick={() =>
                            void handleReceiveOnlineReturn()
                          }
                        >
                          {onlineReceiveBusy
                            ? "جاري الاستلام..."
                            : "📦 تم استلام الطرد"}
                        </button>
                      )}

                    <button
                      type="button"
                      className="secondary-button"
                      disabled={
                        onlineCreateBusy ||
                        onlineReceiveBusy
                      }
                      onClick={
                        resetOnlineExchange
                      }
                    >
                      تبديل أونلاين جديد
                    </button>
                  </div>
                </div>
              </article>
            )}
          </>
        )}
      </>
    );
  }

  function startNewExchange() {
    setCustomerName("");
    resetOnlineExchange();



  if (historyPublicId) {
      navigate(
        "/sales/exchange",
        { replace: true },
      );
    }

    exchangeCreateInFlight.current =
      false;

    exchangeExecutionKey.current =
      null;

    exchangeExecutionSignature.current =
      null;

    setInvoiceInput("");
    setBarcodeInput("");
    setPreview(null);
    setQuantities({});
    setError("");

    setNoReceiptInput("");
    setNoReceiptSearchResults([]);
    setNoReceiptSearchOpen(false);
    setNoReceiptSearchBusy(false);
    setNoReceiptLookupBusy(false);
    setActiveNoReceiptSearchIndex(0);
    setNoReceiptMessage("");
    setNoReceiptError("");
    setNoReceiptCart([]);

    setNewItemInput("");
    setNewItemSearchResults([]);
    setNewItemSearchOpen(false);
    setNewItemSearchBusy(false);
    setNewItemLookupBusy(false);
    setActiveNewItemSearchIndex(0);
    setNewItemMessage("");
    setNewItemError("");
    setNewCart([]);

    setNewInvoiceDiscount("0.00");
    setSettlementType("cash");

    setQuote(null);
    setQuoteSignature("");
    setQuoteBusy(false);
    setQuoteError("");

    setCreateBusy(false);
    setCreateError("");

    setCreatedExchangePublicId(null);
    setCreatedExchangeWasExisting(false);
    setCreatedExchangeResult(null);

    setPrintBusy(false);
    setPrintError("");
    setPrintMessage("");

    setVoidBusy(false);
    setVoidError("");
    setVoidMessage("");
    setExchangeVoided(false);

    window.setTimeout(() => {
      if (
        mode === "with_receipt"
      ) {
        invoiceInputRef.current?.focus();
      } else if (
        mode === "no_receipt"
      ) {
        noReceiptInputRef.current?.focus();
      }
    }, 0);
  }

  function resetReceiptExchange() {
    setInvoiceInput("");
    setBarcodeInput("");
    setPreview(null);
    setQuantities({});
    setError("");

    window.setTimeout(() => {
      invoiceInputRef.current?.focus();
    }, 0);
  }

  function changeMode(
    nextMode: ExchangeMode,
  ) {
    setMode(nextMode);
    resetOnlineExchange();

    setInvoiceInput("");
    setBarcodeInput("");
    setPreview(null);
    setQuantities({});
    setError("");

    setNoReceiptInput("");
    setNoReceiptSearchResults([]);
    setNoReceiptSearchOpen(false);
    setNoReceiptSearchBusy(false);
    setNoReceiptLookupBusy(false);
    setActiveNoReceiptSearchIndex(0);
    setNoReceiptMessage("");
    setNoReceiptError("");
    setNoReceiptCart([]);

    window.setTimeout(() => {
      if (
        nextMode === "with_receipt"
      ) {
        invoiceInputRef.current?.focus();
      } else {
        noReceiptInputRef.current?.focus();
      }
    }, 0);
  }

  function resetOnlineExchange() {
    onlineExchangeExecutionKey.current =
      null;

    setOnlineOrderInput("");
    setOnlinePreview(null);
    setOnlineQuantities({});
    setOnlineSearchBusy(false);
    setOnlineError("");

    setOnlineReplacementMode(
      "system_created",
    );
    setOnlineReplacementOrderId("");

    setOnlineDeliveryDiscountMode(
      "none",
    );
    setOnlineManualDeliveryDiscount(
      "0",
    );

    setOnlineNotes("");
    setOnlineCreateBusy(false);
    setOnlineCreateError("");
    setOnlineResult(null);

    setOnlineStatusBusy(false);
    setOnlineReceiveBusy(false);
    setOnlineReceiveError("");
    setOnlineReceiveMessage("");
  }

  function updateOnlineQuantity(
    lineNumber: number,
    requestedValue: number,
    maximum: number,
  ) {
    const normalized =
      Number.isFinite(requestedValue)
        ? Math.max(
            0,
            Math.min(
              maximum,
              Math.trunc(
                requestedValue,
              ),
            ),
          )
        : 0;

    setOnlineQuantities(
      (current) => ({
        ...current,
        [lineNumber]:
          normalized,
      }),
    );

    onlineExchangeExecutionKey.current =
      null;

    setOnlineCreateError("");
    setOnlineResult(null);
  }

  async function handleOnlineOrderSearch(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const orderId =
      Number(
        onlineOrderInput.trim(),
      );

    if (
      !Number.isSafeInteger(orderId) ||
      orderId <= 0
    ) {
      setOnlineError(
        "أدخل رقم طلب أونلاين صحيح",
      );
      return;
    }

    setOnlineSearchBusy(true);
    setOnlineError("");
    setOnlinePreview(null);
    setOnlineQuantities({});
    setOnlineResult(null);
    setOnlineCreateError("");
    setOnlineReceiveError("");
    setOnlineReceiveMessage("");
    onlineExchangeExecutionKey.current =
      null;

    try {
      const result =
        await getOnlineOrderExchangePreview(
          token,
          orderId,
        );

      setOnlinePreview(result);

      setOnlineQuantities(
        Object.fromEntries(
          result.items.map(
            (item) => [
              item.lineNumber,
              0,
            ],
          ),
        ),
      );
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setOnlineError(
        errorMessage(caught),
      );
    } finally {
      setOnlineSearchBusy(false);
    }
  }

  async function handleCreateOnlineExchange() {
    if (
      !onlinePreview ||
      onlineCreateBusy
    ) {
      return;
    }

    const returnItems =
      onlinePreview.items
        .map((item) => ({
          originalOrderLineNumber:
            item.lineNumber,
          quantity:
            onlineQuantities[
              item.lineNumber
            ] ?? 0,
        }))
        .filter(
          (item) =>
            item.quantity > 0,
        );

    if (returnItems.length === 0) {
      setOnlineCreateError(
        "اختر صنفًا واحدًا على الأقل للتبديل",
      );
      return;
    }

    let replacementOrderId:
      number | null = null;

    if (
      onlineReplacementMode ===
      "existing_order"
    ) {
      replacementOrderId =
        Number(
          onlineReplacementOrderId
            .trim(),
        );

      if (
        !Number.isSafeInteger(
          replacementOrderId,
        ) ||
        replacementOrderId <= 0
      ) {
        setOnlineCreateError(
          "أدخل رقم الطلب البديل بشكل صحيح",
        );
        return;
      }
    }

    let manualDeliveryDiscountMinor =
      0;

    if (
      onlineDeliveryDiscountMode ===
      "manual"
    ) {
      const parsed =
        moneyToMinor(
          onlineManualDeliveryDiscount,
        );

      if (
        parsed === null ||
        parsed % 100 !== 0
      ) {
        setOnlineCreateError(
          "خصم التوصيل اليدوي يجب أن يكون بمبلغ شيكل كامل",
        );
        return;
      }

      manualDeliveryDiscountMinor =
        parsed;
    }

    if (
      !onlineExchangeExecutionKey
        .current
    ) {
      onlineExchangeExecutionKey.current =
        `online-exchange:${createKey()}`;
    }

    setOnlineCreateBusy(true);
    setOnlineCreateError("");
    setOnlineReceiveError("");
    setOnlineReceiveMessage("");

    try {
      const result =
        await createOnlineOrderExchange(
          token,
          {
            idempotencyKey:
              onlineExchangeExecutionKey
                .current,

            originalOrderId:
              onlinePreview.order.id,

            replacementOrderId,

            returnItems,

            deliveryDiscountMode:
              onlineDeliveryDiscountMode,

            manualDeliveryDiscountMinor,

            notes:
              onlineNotes.trim() ||
              undefined,
          },
        );

      setOnlineResult(result);
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setOnlineCreateError(
        errorMessage(caught),
      );
    } finally {
      setOnlineCreateBusy(false);
    }
  }

  async function handleRefreshOnlineStatus() {
    const publicId =
      onlineResult?.exchange
        .publicId;

    if (
      !publicId ||
      onlineStatusBusy
    ) {
      return;
    }

    setOnlineStatusBusy(true);
    setOnlineCreateError("");
    setOnlineReceiveError("");
    setOnlineReceiveMessage("");

    try {
      const result =
        await getOnlineOrderExchangeStatus(
          token,
          publicId,
        );

      setOnlineResult(result);
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setOnlineCreateError(
        errorMessage(caught),
      );
    } finally {
      setOnlineStatusBusy(false);
    }
  }

  function handleOpenReplacementOrder() {
    const replacementOrderId =
      onlineResult?.exchange
        .replacementOrderId;

    if (!replacementOrderId) {
      setOnlineCreateError(
        "لا يوجد طلب بديل مرتبط",
      );
      return;
    }

    window.open(
      `https://lovelykids.net/admin/orders?orderId=${encodeURIComponent(
        replacementOrderId,
      )}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  async function handleReceiveOnlineReturn() {
    const exchange =
      onlineResult?.exchange;

    if (
      !exchange ||
      onlineReceiveBusy
    ) {
      return;
    }

    if (!exchange.financialCompletedAt) {
      setOnlineReceiveError(
        "يجب إنهاء وتسليم الطلب البديل أولًا قبل استلام المرتجع",
      );
      return;
    }

    if (exchange.returnReceivedAt) {
      setOnlineReceiveMessage(
        "الطرد المرتجع مستلم مسبقًا.",
      );
      return;
    }

    if (
      !window.confirm(
        "تأكيد استلام الطرد المرتجع وإرجاع الأصناف القديمة إلى المخزون؟",
      )
    ) {
      return;
    }

    setOnlineReceiveBusy(true);
    setOnlineReceiveError("");
    setOnlineReceiveMessage("");

    try {
      await receiveOnlineExchangeReturn(
        token,
        exchange.publicId,
      );

      const refreshed =
        await getOnlineOrderExchangeStatus(
          token,
          exchange.publicId,
        );

      setOnlineResult(refreshed);

      setOnlineReceiveMessage(
        "تم استلام الطرد وإرجاع الأصناف القديمة إلى المخزون بنجاح.",
      );
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setOnlineReceiveError(
        errorMessage(caught),
      );
    } finally {
      setOnlineReceiveBusy(false);
    }
  }

  function initializeQuantities(
    result: PosExchangePreviewResult,
    quickBarcode: string,
  ) {
    const next: Record<string, number> = {};

    for (const item of result.items) {
      next[item.id] =
        quickBarcode &&
        item.returnableQuantity > 0
          ? 1
          : 0;
    }

    setQuantities(next);
  }

  async function loadPreviewByPublicId(
    rawPublicId: string,
    rawBarcode = "",
  ) {
    const publicId =
      rawPublicId.trim().toUpperCase();

    const barcode =
      rawBarcode.trim();

    if (!publicId) {
      setError(
        "امسح QR الفاتورة أو أدخل رقمها",
      );

      invoiceInputRef.current?.focus();
      return;
    }

    setSearchBusy(true);
    setError("");
    setPreview(null);
    setQuantities({});

    try {
      const result =
        await getPosExchangePreview(
          token,
          publicId,
          barcode || undefined,
        );

      setPreview(result);

      setInvoiceInput(
        result.sale.publicId,
      );

      setBarcodeInput(barcode);

      initializeQuantities(
        result,
        barcode,
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
      setSearchBusy(false);
    }
  }

  function handleInvoiceScannerKeyDown(
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
        invoiceScannerKeyboard.current,
        event,
      );

    if (
      event.key === "Enter" &&
      scannedValue
    ) {
      event.preventDefault();

      setInvoiceInput(scannedValue);

      void loadPreviewByPublicId(
        scannedValue,
        barcodeInput,
      );
    }
  }

  function handleBarcodeScannerKeyDown(
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
        barcodeScannerKeyboard.current,
        event,
      );

    if (
      event.key === "Enter" &&
      scannedValue
    ) {
      event.preventDefault();

      setBarcodeInput(scannedValue);

      if (!invoiceInput.trim()) {
        setError(
          "امسح الفاتورة أولًا",
        );

        invoiceInputRef.current?.focus();
        return;
      }

      void loadPreviewByPublicId(
        invoiceInput,
        scannedValue,
      );
    }
  }

  async function handleSearch(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    await loadPreviewByPublicId(
      invoiceInput,
      barcodeInput,
    );
  }

  function updateQuantity(
    itemId: string,
    requestedValue: number,
    maximum: number,
  ) {
    const normalized =
      Number.isFinite(requestedValue)
        ? Math.max(
            0,
            Math.min(
              maximum,
              Math.trunc(
                requestedValue,
              ),
            ),
          )
        : 0;

    setQuantities(
      (current) => ({
        ...current,
        [itemId]: normalized,
      }),
    );
  }

  function selectAllReturnable() {
    if (!preview) {
      return;
    }

    setQuantities(
      Object.fromEntries(
        preview.items.map(
          (item) => [
            item.id,
            item.returnableQuantity,
          ],
        ),
      ),
    );
  }

  function clearSelection() {
    if (!preview) {
      return;
    }

    setQuantities(
      Object.fromEntries(
        preview.items.map(
          (item) => [
            item.id,
            0,
          ],
        ),
      ),
    );
  }

  function focusNoReceiptInput() {
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        noReceiptInputRef.current?.focus({
          preventScroll: true,
        });

        noReceiptInputRef.current?.select();
      }, 0);
    });
  }

  function clearNoReceiptSearch() {
    setNoReceiptSearchResults([]);
    setNoReceiptSearchOpen(false);
    setNoReceiptSearchBusy(false);
    setActiveNoReceiptSearchIndex(0);
  }

  function addNoReceiptProduct(
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

    const candidate:
      ExchangeNoReceiptReturnLine = {
        id: createKey(),
        barcode:
          product.barcode ?? "",
        product,
        color,
        size,
        quantity: 1,

        // السعر الحالي في المتجر هو
        // القيمة الافتراضية للمرتجع.
        returnUnitPrice:
          product.websiteUnitPrice
            .toFixed(2),
      };

    setNoReceiptCart(
      (current) => {
        if (
          noReceiptLineSelectionComplete(
            candidate,
          )
        ) {
          const duplicate =
            current.find(
              (line) =>
                line.product
                  .productId ===
                  product.productId &&
                line.barcode ===
                  candidate.barcode &&
                line.color ===
                  color &&
                line.size ===
                  size,
            );

          if (duplicate) {
            return current.map(
              (line) =>
                line.id ===
                duplicate.id
                  ? {
                      ...line,
                      quantity:
                        line.quantity +
                        1,
                    }
                  : line,
            );
          }
        }

        return [
          ...current,
          candidate,
        ];
      },
    );

    setNoReceiptInput("");
    setNoReceiptError("");
    setNoReceiptMessage(
      `تمت إضافة ${product.nameAr} للمرتجع`,
    );

    clearNoReceiptSearch();
    focusNoReceiptInput();
  }

  function handleNoReceiptScannerKeyDown(
    event:
      KeyboardEvent<HTMLInputElement>,
  ) {
    if (
      event.nativeEvent.isComposing
    ) {
      return;
    }

    // قراءة السكانر تعتمد على event.code
    // لذلك لغة لوحة المفاتيح لا تغيّر
    // الباركود المقروء.
    const scannedValue =
      captureScannerKeyboardEvent(
        noReceiptScannerKeyboard.current,
        event,
      );

    if (
      event.key === "Enter" &&
      scannedValue
    ) {
      event.preventDefault();

      noReceiptScannerSubmitValue.current =
        scannedValue;

      setNoReceiptInput(
        scannedValue,
      );

      clearNoReceiptSearch();

      event.currentTarget.form
        ?.requestSubmit();

      return;
    }

    if (
      event.key === "ArrowDown" &&
      noReceiptSearchResults.length >
        0
    ) {
      event.preventDefault();

      setActiveNoReceiptSearchIndex(
        (current) =>
          (
            current + 1
          ) %
          noReceiptSearchResults.length,
      );

      return;
    }

    if (
      event.key === "ArrowUp" &&
      noReceiptSearchResults.length >
        0
    ) {
      event.preventDefault();

      setActiveNoReceiptSearchIndex(
        (current) =>
          (
            current -
            1 +
            noReceiptSearchResults.length
          ) %
          noReceiptSearchResults.length,
      );

      return;
    }

    if (
      event.key === "Escape"
    ) {
      event.preventDefault();
      clearNoReceiptSearch();
      return;
    }

    if (
      event.key === "Enter" &&
      noReceiptSearchOpen &&
      noReceiptSearchResults[
        activeNoReceiptSearchIndex
      ]
    ) {
      event.preventDefault();

      addNoReceiptProduct(
        noReceiptSearchResults[
          activeNoReceiptSearchIndex
        ],
      );
    }
  }

  async function handleNoReceiptSearch(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const scannerValue =
      noReceiptScannerSubmitValue.current;

    noReceiptScannerSubmitValue.current =
      null;

    const value =
      (
        scannerValue ??
        noReceiptInput
      ).trim();

    if (!value) {
      setNoReceiptError(
        "أدخل باركود أو كود أو اسم الصنف المرتجع",
      );

      focusNoReceiptInput();
      return;
    }

    if (
      noReceiptSearchOpen &&
      noReceiptSearchResults[
        activeNoReceiptSearchIndex
      ]
    ) {
      addNoReceiptProduct(
        noReceiptSearchResults[
          activeNoReceiptSearchIndex
        ],
      );

      return;
    }

    setNoReceiptLookupBusy(true);
    setNoReceiptError("");
    setNoReceiptMessage("");
    clearNoReceiptSearch();

    try {
      const product =
        await lookupPosProductByBarcode(
          token,
          value,
        );

      addNoReceiptProduct(
        product,
      );
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
        setNoReceiptSearchBusy(true);

        try {
          const result =
            await searchPosProducts(
              token,
              value,
            );

          setNoReceiptSearchResults(
            result.results,
          );

          setActiveNoReceiptSearchIndex(
            0,
          );

          setNoReceiptSearchOpen(
            result.results.length > 0,
          );

          if (
            result.results.length === 0
          ) {
            setNoReceiptError(
              "لم يتم العثور على أصناف مطابقة",
            );
          } else {
            setNoReceiptMessage(
              `تم العثور على ${result.results.length} صنف، اختر الصنف المرتجع`,
            );
          }
        } catch (searchError) {
          if (
            searchError instanceof
              ApiError &&
            searchError.status === 401
          ) {
            clearAuthentication();
            return;
          }

          setNoReceiptError(
            errorMessage(
              searchError,
            ),
          );
        } finally {
          setNoReceiptSearchBusy(false);
        }
      } else {
        setNoReceiptError(
          errorMessage(caught),
        );
      }
    } finally {
      setNoReceiptLookupBusy(false);
      focusNoReceiptInput();
    }
  }

  function updateNoReceiptLine(
    id: string,
    patch:
      Partial<ExchangeNoReceiptReturnLine>,
  ) {
    setNoReceiptCart(
      (current) =>
        current.map(
          (line) =>
            line.id === id
              ? {
                  ...line,
                  ...patch,
                }
              : line,
        ),
    );
  }

  function changeNoReceiptColor(
    line:
      ExchangeNoReceiptReturnLine,
    colorValue: string,
  ) {
    const color =
      colorValue || null;

    const sizes =
      getSizes(
        line.product,
        color,
      );

    updateNoReceiptLine(
      line.id,
      {
        color,
        size:
          sizes.length === 1
            ? sizes[0]
            : null,
      },
    );
  }

  function removeNoReceiptLine(
    id: string,
  ) {
    setNoReceiptCart(
      (current) =>
        current.filter(
          (line) =>
            line.id !== id,
        ),
    );

    focusNoReceiptInput();
  }

  function focusNewItemInput() {
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        newItemInputRef.current?.focus({
          preventScroll: true,
        });

        newItemInputRef.current?.select();
      }, 0);
    });
  }

  function clearNewItemSearch() {
    setNewItemSearchResults([]);
    setNewItemSearchOpen(false);
    setNewItemSearchBusy(false);
    setActiveNewItemSearchIndex(0);
  }

  function addNewProductToCart(
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

    const candidate: ExchangeNewLine = {
      id: createKey(),
      barcode:
        product.barcode ?? "",
      product,
      color,
      size,
      quantity: 1,
      soldUnitPrice:
        product.websiteUnitPrice
          .toFixed(2),
    };

    setNewCart((current) => {
      if (
        newLineSelectionComplete(
          candidate,
        )
      ) {
        const duplicate =
          current.find(
            (line) =>
              line.product.productId ===
                product.productId &&
              line.barcode ===
                candidate.barcode &&
              line.color === color &&
              line.size === size,
          );

        if (duplicate) {
          return current.map(
            (line) =>
              line.id === duplicate.id
                ? {
                    ...line,
                    quantity:
                      line.quantity + 1,
                  }
                : line,
          );
        }
      }

      return [
        ...current,
        candidate,
      ];
    });

    setNewItemInput("");
    setNewItemError("");
    setNewItemMessage(
      `تمت إضافة ${product.nameAr}`,
    );

    clearNewItemSearch();
    focusNewItemInput();
  }

  function handleNewItemScannerKeyDown(
    event:
      KeyboardEvent<HTMLInputElement>,
  ) {
    if (
      event.nativeEvent.isComposing
    ) {
      return;
    }

    // مهم:
    // captureScannerKeyboardEvent يعتمد
    // على event.code وليس لغة الكيبورد.
    const scannedValue =
      captureScannerKeyboardEvent(
        newItemScannerKeyboard.current,
        event,
      );

    if (
      event.key === "Enter" &&
      scannedValue
    ) {
      event.preventDefault();

      newItemScannerSubmitValue.current =
        scannedValue;

      setNewItemInput(scannedValue);
      clearNewItemSearch();

      event.currentTarget.form
        ?.requestSubmit();

      return;
    }

    if (
      event.key === "ArrowDown" &&
      newItemSearchResults.length > 0
    ) {
      event.preventDefault();

      setActiveNewItemSearchIndex(
        (current) =>
          (
            current + 1
          ) %
          newItemSearchResults.length,
      );

      return;
    }

    if (
      event.key === "ArrowUp" &&
      newItemSearchResults.length > 0
    ) {
      event.preventDefault();

      setActiveNewItemSearchIndex(
        (current) =>
          (
            current -
            1 +
            newItemSearchResults.length
          ) %
          newItemSearchResults.length,
      );

      return;
    }

    if (
      event.key === "Escape"
    ) {
      event.preventDefault();
      clearNewItemSearch();
      return;
    }

    if (
      event.key === "Enter" &&
      newItemSearchOpen &&
      newItemSearchResults[
        activeNewItemSearchIndex
      ]
    ) {
      event.preventDefault();

      addNewProductToCart(
        newItemSearchResults[
          activeNewItemSearchIndex
        ],
      );
    }
  }

  async function handleNewItemSearch(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const scannerValue =
      newItemScannerSubmitValue.current;

    newItemScannerSubmitValue.current =
      null;

    const value =
      (
        scannerValue ??
        newItemInput
      ).trim();

    if (!value) {
      setNewItemError(
        "أدخل الباركود أو الكود أو اسم الصنف",
      );

      focusNewItemInput();
      return;
    }

    if (
      newItemSearchOpen &&
      newItemSearchResults[
        activeNewItemSearchIndex
      ]
    ) {
      addNewProductToCart(
        newItemSearchResults[
          activeNewItemSearchIndex
        ],
      );

      return;
    }

    setNewItemLookupBusy(true);
    setNewItemError("");
    setNewItemMessage("");
    clearNewItemSearch();

    try {
      const product =
        await lookupPosProductByBarcode(
          token,
          value,
        );

      addNewProductToCart(
        product,
      );
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
        setNewItemSearchBusy(true);

        try {
          const result =
            await searchPosProducts(
              token,
              value,
            );

          setNewItemSearchResults(
            result.results,
          );

          setActiveNewItemSearchIndex(0);

          setNewItemSearchOpen(
            result.results.length > 0,
          );

          if (
            result.results.length === 0
          ) {
            setNewItemError(
              "لم يتم العثور على أصناف مطابقة",
            );
          } else {
            setNewItemMessage(
              `تم العثور على ${result.results.length} صنف، اختر الصنف المطلوب`,
            );
          }
        } catch (searchError) {
          if (
            searchError instanceof
              ApiError &&
            searchError.status === 401
          ) {
            clearAuthentication();
            return;
          }

          setNewItemError(
            errorMessage(
              searchError,
            ),
          );
        } finally {
          setNewItemSearchBusy(false);
        }
      } else {
        setNewItemError(
          errorMessage(caught),
        );
      }
    } finally {
      setNewItemLookupBusy(false);
      focusNewItemInput();
    }
  }

  function updateNewLine(
    id: string,
    patch:
      Partial<ExchangeNewLine>,
  ) {
    setNewCart(
      (current) =>
        current.map(
          (line) =>
            line.id === id
              ? {
                  ...line,
                  ...patch,
                }
              : line,
        ),
    );
  }

  function changeNewLineColor(
    line: ExchangeNewLine,
    colorValue: string,
  ) {
    const color =
      colorValue || null;

    const sizes =
      getSizes(
        line.product,
        color,
      );

    updateNewLine(
      line.id,
      {
        color,
        size:
          sizes.length === 1
            ? sizes[0]
            : null,
      },
    );
  }

  function removeNewLine(
    id: string,
  ) {
    setNewCart(
      (current) =>
        current.filter(
          (line) =>
            line.id !== id,
        ),
    );

    focusNewItemInput();
  }

  if (historyPublicId) {
    return (
      <section
        className="sales-return-page"
        id="pos-sales-exchange"
      >
        <header className="sales-return-heading">
          <div className="panel-heading">
            <div className="panel-icon">
              🔄
            </div>

            <div>
              <h2>فاتورة تبديل محفوظة</h2>

              <p>
                عرض تفاصيل فاتورة التبديل السابقة وطباعتها.
              </p>
            </div>
          </div>

          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              navigate(
                `/sales/today${
                  /^\\d{4}-\\d{2}-\\d{2}$/.test(historyDate)
                    ? `?date=${encodeURIComponent(historyDate)}`
                    : ""
                }#pos-exchange-history`,
              )
            }
          >
            الرجوع إلى المبيعات والحركات
          </button>

          <div className="sales-return-session">
            <span>جلسة الصندوق</span>

            <strong dir="ltr">
              {session?.registerKey ??
              "لا تحتاج جلسة في تبديل الأونلاين"}
            </strong>
          </div>
        </header>

        {historyLoadBusy && (
          <div className="alert">
            جاري تحميل فاتورة التبديل...
          </div>
        )}

        {historyLoadError && (
          <div
            className="alert error-alert"
            role="alert"
          >
            {historyLoadError}
          </div>
        )}

        {!historyLoadBusy &&
          !historyLoadError &&
          createdExchangeResult?.exchange && (
            <>
              <article
                id="exchange-result-actions"
                className="sales-return-search-panel"
                style={{
                  padding: "18px",
                  textAlign: "center",
                }}
              >
                <h3>
                  فاتورة تبديل محفوظة
                </h3>

                <p>
                  رقم فاتورة التبديل:{" "}
                  <strong dir="ltr">
                    {
                      createdExchangeResult
                        .exchange.publicId
                    }
                  </strong>
                </p>

                {createdExchangeResult.exchange
                  .customerName && (
                  <p>
                    اسم الزبون:{" "}
                    <strong>
                      {
                        createdExchangeResult
                          .exchange.customerName
                      }
                    </strong>
                  </p>
                )}

                {exchangeVoided && (
                  <p>
                    <strong>
                      فاتورة التبديل ملغاة
                    </strong>
                  </p>
                )}

                {voidError && (
                  <p
                    className="error-message"
                    role="alert"
                  >
                    {voidError}
                  </p>
                )}

                {voidMessage && (
                  <p>{voidMessage}</p>
                )}

                {printError && (
                  <p
                    className="error-message"
                    role="alert"
                  >
                    {printError}
                  </p>
                )}

                {printMessage && (
                  <p>{printMessage}</p>
                )}

                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    gap: "10px",
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    type="button"
                    className="primary-button"
                    disabled={
                      printBusy ||
                      voidBusy
                    }
                    onClick={() =>
                      void handlePrintExchange()
                    }
                  >
                    {printBusy
                      ? "جاري الطباعة..."
                      : "طباعة مباشرة"}
                  </button>

                  {!exchangeVoided && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={
                        voidBusy ||
                        printBusy
                      }
                      onClick={() =>
                        void handleVoidExchange()
                      }
                    >
                      {voidBusy
                        ? "جاري الإلغاء..."
                        : "إلغاء فاتورة التبديل"}
                    </button>
                  )}

                  <button
                    type="button"
                    className="secondary-button"
                    disabled={
                      printBusy ||
                      voidBusy
                    }
                    onClick={startNewExchange}
                  >
                    تبديل جديد
                  </button>
                </div>
              </article>

              <ExchangeReceipt
                result={createdExchangeResult}
                receiptRef={exchangeReceiptRef}
                showOnScreen
              />
            </>
          )}
      </section>
    );
  }

  return (
    <section
      className="sales-return-page"
      id="pos-sales-exchange"
    >
      <header className="sales-return-heading">
        <div className="panel-heading">
          <div className="panel-icon">
            🔄
          </div>

          <div>
            <h2>فاتورة تبديل</h2>

            <p>
              تبديل أصناف مع فاتورة أو بدون
              فاتورة، مع احتساب فرق السعر
              وتحديث المخزون والصندوق.
            </p>
          </div>
        </div>

        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            navigate(
              `/sales/today${
                /^\d{4}-\d{2}-\d{2}$/.test(historyDate)
                  ? `?date=${encodeURIComponent(historyDate)}`
                  : ""
              }#pos-exchange-history`,
            )
          }
        >
          حركات التبديل السابقة
        </button>

        <div className="sales-return-session">
          <span>جلسة الصندوق</span>

          <strong dir="ltr">
            {session?.registerKey ??
              "لا تحتاج جلسة في تبديل الأونلاين"}
          </strong>
        </div>
      </header>

      {historyLoadBusy && (
        <div className="alert">
          جاري تحميل فاتورة
          التبديل...
        </div>
      )}

      {historyLoadError && (
        <div
          className="alert error-alert"
          role="alert"
        >
          {historyLoadError}
        </div>
      )}

      <article className="sales-return-search-panel">
        <div className="sales-return-section-title">
          <div>
            <h3>بيانات الزبون</h3>

            <p>
              اسم الزبون اختياري ويُحفظ مع فاتورة التبديل.
            </p>
          </div>
        </div>

        <div style={{ padding: "16px" }}>
          <label className="sales-return-field">
            <span>اسم الزبون (اختياري)</span>

            <input
              value={customerName}
              maxLength={150}
              autoComplete="off"
              placeholder="اسم الزبون"
              onChange={(event) =>
                setCustomerName(event.target.value)
              }
            />
          </label>
        </div>
      </article>

      <article className="sales-return-search-panel">
        <div className="sales-return-section-title">
          <div>
            <h3>نوع التبديل</h3>

            <p>
              اختر طريقة إدخال الأصناف
              القديمة.
            </p>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(3, minmax(0, 1fr))",
            gap: "12px",
            padding: "16px",
          }}
        >
          <button
            type="button"
            className={
              mode === "with_receipt"
                ? "primary-button"
                : "secondary-button"
            }
            disabled={!session}
            onClick={() =>
              changeMode(
                "with_receipt",
              )
            }
          >
            🧾 تبديل مع فاتورة
          </button>

          <button
            type="button"
            className={
              mode === "no_receipt"
                ? "primary-button"
                : "secondary-button"
            }
            disabled={!session}
            onClick={() =>
              changeMode(
                "no_receipt",
              )
            }
          >
            📦 تبديل بدون فاتورة
          </button>

          <button
            type="button"
            className={
              mode === "online_order"
                ? "primary-button"
                : "secondary-button"
            }
            onClick={() =>
              changeMode(
                "online_order",
              )
            }
          >
            🌐 تبديل طلب أونلاين
          </button>
        </div>
      </article>

      {mode === "with_receipt" ? (
        <>
          <article className="sales-return-search-panel">
            <div className="sales-return-section-title">
              <div>
                <h3>
                  الفاتورة الأصلية
                </h3>

                <p>
                  امسح QR الفاتورة أو أدخل
                  رقمها. ويمكن بعد ذلك مسح
                  باركود صنف لتحديده بسرعة.
                </p>
              </div>

              {(preview ||
                invoiceInput ||
                barcodeInput) && (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={searchBusy}
                  onClick={
                    resetReceiptExchange
                  }
                >
                  فاتورة جديدة
                </button>
              )}
            </div>

            <form
              className="sales-return-search-form"
              onSubmit={handleSearch}
            >
              <label className="sales-return-field">
                <span>
                  رقم أو QR الفاتورة
                </span>

                <input
                  ref={invoiceInputRef}
                  dir="ltr"
                  autoFocus
                  autoComplete="off"
                  value={invoiceInput}
                  onChange={(event) =>
                    setInvoiceInput(
                      event.target.value,
                    )
                  }
                  onKeyDown={
                    handleInvoiceScannerKeyDown
                  }
                  placeholder="POS-YYYYMMDD-XXXXXXXXXXXX"
                  disabled={searchBusy}
                />
              </label>

              <label className="sales-return-field">
                <span>
                  باركود الصنف
                  {" "}
                  (اختياري)
                </span>

                <input
                  dir="ltr"
                  autoComplete="off"
                  value={barcodeInput}
                  onChange={(event) =>
                    setBarcodeInput(
                      event.target.value,
                    )
                  }
                  onKeyDown={
                    handleBarcodeScannerKeyDown
                  }
                  placeholder="امسح باركود الصنف"
                  disabled={searchBusy}
                />
              </label>

              <button
                className="primary-button"
                type="submit"
                disabled={searchBusy}
              >
                {searchBusy
                  ? "جاري التحميل..."
                  : "عرض الفاتورة"}
              </button>
            </form>

            {error && (
              <p
                className="error-message"
                role="alert"
              >
                {error}
              </p>
            )}
          </article>

          {preview && (
            <>
              <article className="sales-return-search-panel">
                <div className="sales-return-section-title">
                  <div>
                    <h3>
                      الفاتورة
                      {" "}
                      <span dir="ltr">
                        {
                          preview.sale
                            .publicId
                        }
                      </span>
                    </h3>

                    <p>
                      تاريخ البيع:
                      {" "}
                      {
                        preview.sale
                          .businessDate
                      }
                      {preview.sale
                        .customerName
                        ? ` — ${preview.sale.customerName}`
                        : ""}
                    </p>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fit, minmax(160px, 1fr))",
                    gap: "12px",
                    padding: "16px",
                  }}
                >
                  <div>
                    <small>
                      إجمالي الفاتورة
                    </small>
                    <br />
                    <strong>
                      {formatMoney(
                        preview.sale
                          .totalMinor,
                      )}
                    </strong>
                  </div>

                  <div>
                    <small>
                      مرتجع سابق
                    </small>
                    <br />
                    <strong>
                      {
                        preview.summary
                          .returnedQuantity
                      }
                      {" قطعة"}
                    </strong>
                  </div>

                  <div>
                    <small>
                      تبديل سابق
                    </small>
                    <br />
                    <strong>
                      {
                        preview.summary
                          .exchangedQuantity
                      }
                      {" قطعة"}
                    </strong>
                  </div>

                  <div>
                    <small>
                      متاح للتبديل
                    </small>
                    <br />
                    <strong>
                      {
                        preview.summary
                          .returnableQuantity
                      }
                      {" قطعة"}
                    </strong>
                  </div>

                  <div>
                    <small>
                      القيمة التاريخية
                      المتبقية
                    </small>
                    <br />
                    <strong>
                      {formatMoney(
                        preview.summary
                          .returnableNetMinor,
                      )}
                    </strong>
                  </div>
                </div>
              </article>

              <article className="sales-return-search-panel">
                <div className="sales-return-section-title">
                  <div>
                    <h3>
                      الأصناف المرجعة
                    </h3>

                    <p>
                      اختر الكمية التي سيعيدها
                      الزبون من كل صنف.
                    </p>
                  </div>

                  {!preview.summary
                    .fullyConsumed && (
                    <div className="sales-return-selection-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={
                          selectAllReturnable
                        }
                      >
                        تحديد الكل
                      </button>

                      <button
                        className="secondary-button"
                        type="button"
                        onClick={
                          clearSelection
                        }
                      >
                        إلغاء التحديد
                      </button>
                    </div>
                  )}
                </div>

                <div className="sales-return-table-wrap">
                  <table className="sales-return-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>الصنف</th>
                        <th>
                          الكود والباركود
                        </th>
                        <th>
                          اللون والمقاس
                        </th>
                        <th>
                          سعر البيع
                        </th>
                        <th>مباع</th>
                        <th>
                          مرتجع سابق
                        </th>
                        <th>
                          تبديل سابق
                        </th>
                        <th>متاح</th>
                        <th>
                          كمية التبديل
                        </th>
                        <th>
                          القيمة قبل
                          الخصومات
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {preview.items.map(
                        (
                          item,
                          index,
                        ) => {
                          const selectedQuantity =
                            quantities[
                              item.id
                            ] ?? 0;

                          return (
                            <tr
                              key={
                                item.id
                              }
                            >
                              <td>
                                {index +
                                  1}
                              </td>

                              <td>
                                <div className="sales-return-product">
                                  {item.productImage && (
                                    <img
                                      src={
                                        item.productImage
                                      }
                                      alt=""
                                    />
                                  )}

                                  <div>
                                    <strong>
                                      {
                                        item.productNameAr
                                      }
                                    </strong>

                                    <small>
                                      سطر
                                      الفاتورة
                                      {" "}
                                      {
                                        item.lineNumber
                                      }
                                    </small>
                                  </div>
                                </div>
                              </td>

                              <td>
                                <strong dir="ltr">
                                  {item.productCode ??
                                    "—"}
                                </strong>

                                <small dir="ltr">
                                  {item.barcode ??
                                    "—"}
                                </small>
                              </td>

                              <td>
                                <strong>
                                  {item.color ??
                                    "—"}
                                </strong>

                                <small>
                                  {item.size ??
                                    "—"}
                                </small>
                              </td>

                              <td>
                                {formatMoney(
                                  item.soldUnitPriceMinor,
                                )}
                              </td>

                              <td>
                                {
                                  item.soldQuantity
                                }
                              </td>

                              <td>
                                {
                                  item.returnedQuantity
                                }
                              </td>

                              <td>
                                {
                                  item.exchangedQuantity
                                }
                              </td>

                              <td>
                                {
                                  item.returnableQuantity
                                }
                              </td>

                              <td>
                                <input
                                  className="sales-return-quantity-input"
                                  type="number"
                                  inputMode="numeric"
                                  min={0}
                                  max={
                                    item.returnableQuantity
                                  }
                                  step={1}
                                  value={
                                    selectedQuantity
                                  }
                                  disabled={
                                    item.returnableQuantity ===
                                    0
                                  }
                                  onChange={(
                                    event,
                                  ) =>
                                    updateQuantity(
                                      item.id,
                                      Number(
                                        event
                                          .target
                                          .value,
                                      ),
                                      item.returnableQuantity,
                                    )
                                  }
                                />
                              </td>

                              <td>
                                <strong>
                                  {formatMoney(
                                    item.soldUnitPriceMinor *
                                      selectedQuantity,
                                  )}
                                </strong>
                              </td>
                            </tr>
                          );
                        },
                      )}
                    </tbody>
                  </table>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent:
                      "space-between",
                    gap: "16px",
                    padding: "16px",
                  }}
                >
                  <div>
                    <small>
                      القطع المحددة
                    </small>
                    <br />
                    <strong>
                      {selectedPieces}
                    </strong>
                  </div>

                  <div>
                    <small>
                      القيمة قبل توزيع
                      الخصومات التاريخية
                    </small>
                    <br />
                    <strong>
                      {formatMoney(
                        selectedGrossMinor,
                      )}
                    </strong>
                  </div>
                </div>

                {preview.summary
                  .fullyConsumed && (
                  <p
                    style={{
                      padding:
                        "0 16px 16px",
                    }}
                  >
                    لا يوجد أي كمية متبقية
                    قابلة للتبديل من هذه
                    الفاتورة.
                  </p>
                )}
              </article>
            </>
          )}
        </>
      ) : mode === "online_order" ? (
        renderOnlineOrderExchange()
      ) : (
        <article className="sales-return-search-panel">
          <div className="sales-return-section-title">
            <div>
              <h3>
                الأصناف المرجعة بدون فاتورة
              </h3>

              <p>
                امسح باركود الصنف القديم.
                السعر الحالي يظهر تلقائيًا
                كقيمة المرتجع ويمكن تعديله
                يدويًا.
              </p>
            </div>

            {noReceiptCart.length > 0 && (
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setNoReceiptCart([]);
                  setNoReceiptMessage("");
                  setNoReceiptError("");
                  focusNoReceiptInput();
                }}
              >
                تفريغ الأصناف المرجعة
              </button>
            )}
          </div>

          <form
            className="sales-return-search-form"
            onSubmit={handleNoReceiptSearch}
          >
            <label className="sales-return-field">
              <span>
                باركود / كود / اسم الصنف
              </span>

              <input
                ref={noReceiptInputRef}
                dir="ltr"
                autoComplete="off"
                value={noReceiptInput}
                onChange={(event) => {
                  setNoReceiptInput(
                    event.target.value,
                  );

                  if (
                    noReceiptSearchOpen
                  ) {
                    clearNoReceiptSearch();
                  }
                }}
                onKeyDown={
                  handleNoReceiptScannerKeyDown
                }
                placeholder="امسح باركود الصنف القديم"
                disabled={
                  noReceiptLookupBusy ||
                  noReceiptSearchBusy
                }
              />
            </label>

            <button
              className="primary-button"
              type="submit"
              disabled={
                noReceiptLookupBusy ||
                noReceiptSearchBusy
              }
            >
              {noReceiptLookupBusy ||
              noReceiptSearchBusy
                ? "جاري البحث..."
                : "إضافة المرتجع"}
            </button>
          </form>

          {noReceiptError && (
            <p
              className="error-message"
              role="alert"
            >
              {noReceiptError}
            </p>
          )}

          {noReceiptMessage && (
            <p
              style={{
                padding:
                  "0 16px 12px",
              }}
            >
              {noReceiptMessage}
            </p>
          )}

          {noReceiptSearchOpen &&
            noReceiptSearchResults.length >
              0 && (
            <div
              style={{
                display: "grid",
                gap: "8px",
                padding:
                  "0 16px 16px",
              }}
            >
              {noReceiptSearchResults.map(
                (product, index) => (
                  <button
                    key={`${product.productId}-${index}`}
                    type="button"
                    className={
                      index ===
                      activeNoReceiptSearchIndex
                        ? "primary-button"
                        : "secondary-button"
                    }
                    onClick={() =>
                      addNoReceiptProduct(
                        product,
                      )
                    }
                  >
                    {product.nameAr}
                    {" — "}
                    {product.productCode ??
                      product.barcode ??
                      ""}
                  </button>
                ),
              )}
            </div>
          )}

          {noReceiptCart.length > 0 && (
            <>
              <div className="sales-return-table-wrap">
                <table className="sales-return-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>الصنف</th>
                      <th>
                        الكود والباركود
                      </th>
                      <th>اللون</th>
                      <th>النمرة</th>
                      <th>الكمية</th>
                      <th>
                        السعر الحالي
                      </th>
                      <th>
                        قيمة المرتجع المعتمدة
                      </th>
                      <th>الإجمالي</th>
                      <th></th>
                    </tr>
                  </thead>

                  <tbody>
                    {noReceiptCart.map(
                      (line, index) => {
                        const colors =
                          getColors(
                            line.product,
                          );

                        const sizes =
                          getSizes(
                            line.product,
                            line.color,
                          );

                        const returnPriceMinor =
                          moneyToMinor(
                            line.returnUnitPrice,
                          ) ?? 0;

                        return (
                          <tr key={line.id}>
                            <td>
                              {index + 1}
                            </td>

                            <td>
                              <div className="sales-return-product">
                                {line.product
                                  .image && (
                                  <img
                                    src={
                                      line
                                        .product
                                        .image
                                    }
                                    alt=""
                                  />
                                )}

                                <div>
                                  <strong>
                                    {
                                      line
                                        .product
                                        .nameAr
                                    }
                                  </strong>

                                  {!noReceiptLineSelectionComplete(
                                    line,
                                  ) && (
                                    <small>
                                      أكمل اللون
                                      والنمرة
                                    </small>
                                  )}
                                </div>
                              </div>
                            </td>

                            <td>
                              <strong dir="ltr">
                                {line.product
                                  .productCode ??
                                  "—"}
                              </strong>

                              <small dir="ltr">
                                {line.barcode ||
                                  line.product
                                    .barcode ||
                                  "—"}
                              </small>
                            </td>

                            <td>
                              {colors.length >
                              0 ? (
                                <select
                                  value={
                                    line.color ??
                                    ""
                                  }
                                  onChange={(
                                    event,
                                  ) =>
                                    changeNoReceiptColor(
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
                                    (color) => (
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
                              ) : (
                                "—"
                              )}
                            </td>

                            <td>
                              {sizes.length >
                              0 ? (
                                <select
                                  value={
                                    line.size ??
                                    ""
                                  }
                                  disabled={
                                    line
                                      .product
                                      .colorVariants
                                      .length >
                                      0 &&
                                    !line.color
                                  }
                                  onChange={(
                                    event,
                                  ) =>
                                    updateNoReceiptLine(
                                      line.id,
                                      {
                                        size:
                                          event
                                            .target
                                            .value ||
                                          null,
                                      },
                                    )
                                  }
                                >
                                  <option value="">
                                    اختر النمرة
                                  </option>

                                  {sizes.map(
                                    (size) => (
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
                              ) : (
                                "—"
                              )}
                            </td>

                            <td>
                              <input
                                className="sales-return-quantity-input"
                                type="number"
                                inputMode="numeric"
                                min={1}
                                max={99}
                                step={1}
                                value={
                                  line.quantity
                                }
                                onChange={(
                                  event,
                                ) =>
                                  updateNoReceiptLine(
                                    line.id,
                                    {
                                      quantity:
                                        Math.max(
                                          1,
                                          Math.min(
                                            99,
                                            Math.trunc(
                                              Number(
                                                event
                                                  .target
                                                  .value,
                                              ) ||
                                                1,
                                            ),
                                          ),
                                        ),
                                    },
                                  )
                                }
                              />
                            </td>

                            <td>
                              <strong>
                                {formatMoney(
                                  line.product
                                    .websiteUnitPriceMinor,
                                )}
                              </strong>
                            </td>

                            <td>
                              <input
                                className="sales-return-quantity-input"
                                type="text"
                                inputMode="decimal"
                                dir="ltr"
                                value={
                                  line.returnUnitPrice
                                }
                                onChange={(
                                  event,
                                ) =>
                                  updateNoReceiptLine(
                                    line.id,
                                    {
                                      returnUnitPrice:
                                        event
                                          .target
                                          .value,
                                    },
                                  )
                                }
                              />
                            </td>

                            <td>
                              <strong>
                                {formatMoney(
                                  returnPriceMinor *
                                    line.quantity,
                                )}
                              </strong>
                            </td>

                            <td>
                              <button
                                className="secondary-button"
                                type="button"
                                onClick={() =>
                                  removeNoReceiptLine(
                                    line.id,
                                  )
                                }
                              >
                                حذف
                              </button>
                            </td>
                          </tr>
                        );
                      },
                    )}
                  </tbody>
                </table>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent:
                    "space-between",
                  gap: "16px",
                  padding: "16px",
                }}
              >
                <div>
                  <small>
                    عدد القطع المرجعة
                  </small>
                  <br />
                  <strong>
                    {noReceiptCart.reduce(
                      (
                        total,
                        line,
                      ) =>
                        total +
                        line.quantity,
                      0,
                    )}
                  </strong>
                </div>

                <div>
                  <small>
                    قيمة المرتجع المعتمدة
                  </small>
                  <br />
                  <strong>
                    {formatMoney(
                      noReceiptReturnMinor,
                    )}
                  </strong>
                </div>
              </div>
            </>
          )}
        </article>
      )}

      <article className="sales-return-search-panel">
        <div className="sales-return-section-title">
          <div>
            <h3>الأصناف الجديدة</h3>

            <p>
              امسح باركود الصنف الجديد أو
              ابحث بالكود أو الاسم. باركود
              المتغير يحدد اللون والنمرة
              تلقائيًا.
            </p>
          </div>

          {newCart.length > 0 && (
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setNewCart([]);
                setNewItemMessage("");
                setNewItemError("");
                focusNewItemInput();
              }}
            >
              تفريغ الأصناف الجديدة
            </button>
          )}
        </div>

        <form
          className="sales-return-search-form"
          onSubmit={handleNewItemSearch}
        >
          <label className="sales-return-field">
            <span>
              باركود / كود / اسم الصنف
            </span>

            <input
              ref={newItemInputRef}
              dir="ltr"
              autoComplete="off"
              value={newItemInput}
              onChange={(event) => {
                setNewItemInput(
                  event.target.value,
                );

                if (
                  newItemSearchOpen
                ) {
                  clearNewItemSearch();
                }
              }}
              onKeyDown={
                handleNewItemScannerKeyDown
              }
              placeholder="امسح الباركود أو اكتب للبحث"
              disabled={
                newItemLookupBusy ||
                newItemSearchBusy
              }
            />
          </label>

          <button
            className="primary-button"
            type="submit"
            disabled={
              newItemLookupBusy ||
              newItemSearchBusy
            }
          >
            {newItemLookupBusy ||
            newItemSearchBusy
              ? "جاري البحث..."
              : "إضافة الصنف"}
          </button>
        </form>

        {newItemError && (
          <p
            className="error-message"
            role="alert"
          >
            {newItemError}
          </p>
        )}

        {newItemMessage && (
          <p
            style={{
              padding:
                "0 16px 12px",
            }}
          >
            {newItemMessage}
          </p>
        )}

        {newItemSearchOpen &&
          newItemSearchResults.length >
            0 && (
          <div
            style={{
              display: "grid",
              gap: "8px",
              padding:
                "0 16px 16px",
            }}
          >
            {newItemSearchResults.map(
              (product, index) => (
                <button
                  key={`${product.productId}-${index}`}
                  type="button"
                  className={
                    index ===
                    activeNewItemSearchIndex
                      ? "primary-button"
                      : "secondary-button"
                  }
                  onClick={() =>
                    addNewProductToCart(
                      product,
                    )
                  }
                >
                  {product.nameAr}
                  {" — "}
                  {product.productCode ??
                    product.barcode ??
                    ""}
                </button>
              ),
            )}
          </div>
        )}

        {newCart.length > 0 && (
          <>
            <div className="sales-return-table-wrap">
              <table className="sales-return-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>الصنف</th>
                    <th>
                      الكود والباركود
                    </th>
                    <th>اللون</th>
                    <th>النمرة</th>
                    <th>الكمية</th>
                    <th>السعر</th>
                    <th>الإجمالي</th>
                    <th></th>
                  </tr>
                </thead>

                <tbody>
                  {newCart.map(
                    (line, index) => {
                      const colors =
                        getColors(
                          line.product,
                        );

                      const sizes =
                        getSizes(
                          line.product,
                          line.color,
                        );

                      const priceMinor =
                        moneyToMinor(
                          line.soldUnitPrice,
                        ) ?? 0;

                      return (
                        <tr
                          key={line.id}
                        >
                          <td>
                            {index + 1}
                          </td>

                          <td>
                            <div className="sales-return-product">
                              {line.product
                                .image && (
                                <img
                                  src={
                                    line
                                      .product
                                      .image
                                  }
                                  alt=""
                                />
                              )}

                              <div>
                                <strong>
                                  {
                                    line
                                      .product
                                      .nameAr
                                  }
                                </strong>

                                {!newLineSelectionComplete(
                                  line,
                                ) && (
                                  <small>
                                    أكمل اللون
                                    والنمرة
                                  </small>
                                )}
                              </div>
                            </div>
                          </td>

                          <td>
                            <strong dir="ltr">
                              {line.product
                                .productCode ??
                                "—"}
                            </strong>

                            <small dir="ltr">
                              {line.barcode ||
                                line.product
                                  .barcode ||
                                "—"}
                            </small>
                          </td>

                          <td>
                            {colors.length >
                            0 ? (
                              <select
                                value={
                                  line.color ??
                                  ""
                                }
                                onChange={(
                                  event,
                                ) =>
                                  changeNewLineColor(
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
                                      {
                                        color
                                      }
                                    </option>
                                  ),
                                )}
                              </select>
                            ) : (
                              "—"
                            )}
                          </td>

                          <td>
                            {sizes.length >
                            0 ? (
                              <select
                                value={
                                  line.size ??
                                  ""
                                }
                                disabled={
                                  line
                                    .product
                                    .colorVariants
                                    .length >
                                    0 &&
                                  !line.color
                                }
                                onChange={(
                                  event,
                                ) =>
                                  updateNewLine(
                                    line.id,
                                    {
                                      size:
                                        event
                                          .target
                                          .value ||
                                        null,
                                    },
                                  )
                                }
                              >
                                <option value="">
                                  اختر النمرة
                                </option>

                                {sizes.map(
                                  (size) => (
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
                            ) : (
                              "—"
                            )}
                          </td>

                          <td>
                            <input
                              className="sales-return-quantity-input"
                              type="number"
                              inputMode="numeric"
                              min={1}
                              max={99}
                              step={1}
                              value={
                                line.quantity
                              }
                              onChange={(
                                event,
                              ) =>
                                updateNewLine(
                                  line.id,
                                  {
                                    quantity:
                                      Math.max(
                                        1,
                                        Math.min(
                                          99,
                                          Math.trunc(
                                            Number(
                                              event
                                                .target
                                                .value,
                                            ) ||
                                              1,
                                          ),
                                        ),
                                      ),
                                  },
                                )
                              }
                            />
                          </td>

                          <td>
                            <input
                              className="sales-return-quantity-input"
                              type="text"
                              inputMode="decimal"
                              dir="ltr"
                              value={
                                line.soldUnitPrice
                              }
                              onChange={(
                                event,
                              ) =>
                                updateNewLine(
                                  line.id,
                                  {
                                    soldUnitPrice:
                                      event
                                        .target
                                        .value,
                                  },
                                )
                              }
                            />
                          </td>

                          <td>
                            <strong>
                              {formatMoney(
                                priceMinor *
                                  line.quantity,
                              )}
                            </strong>
                          </td>

                          <td>
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={() =>
                                removeNewLine(
                                  line.id,
                                )
                              }
                            >
                              حذف
                            </button>
                          </td>
                        </tr>
                      );
                    },
                  )}
                </tbody>
              </table>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent:
                  "space-between",
                gap: "16px",
                padding: "16px",
              }}
            >
              <div>
                <small>
                  عدد الأصناف الجديدة
                </small>
                <br />
                <strong>
                  {newCart.reduce(
                    (
                      total,
                      line,
                    ) =>
                      total +
                      line.quantity,
                    0,
                  )}
                </strong>
              </div>

              <div>
                <small>
                  إجمالي الأصناف الجديدة
                </small>
                <br />
                <strong>
                  {formatMoney(
                    newItemsGrossMinor,
                  )}
                </strong>
              </div>
            </div>
          </>
        )}
      </article>

      <article className="sales-return-search-panel">
        <div className="sales-return-section-title">
          <div>
            <h3>ملخص التبديل</h3>

            <p>
              الحساب النهائي يتم من الخادم
              نفسه قبل تنفيذ فاتورة التبديل،
              بما يشمل الخصومات التاريخية
              وفرق السعر ورصيد الصندوق.
            </p>
          </div>

          <button
            className="primary-button"
            type="button"
            onClick={
              handleQuoteExchange
            }
            disabled={quoteBusy}
          >
            {quoteBusy
              ? "جاري الحساب..."
              : activeQuote
                ? "تحديث فرق التبديل"
                : "احسب فرق التبديل"}
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "16px",
            padding: "16px",
          }}
        >
          <label className="sales-return-field">
            <span>
              خصم على الأصناف الجديدة
            </span>

            <input
              type="text"
              inputMode="decimal"
              dir="ltr"
              value={
                newInvoiceDiscount
              }
              onChange={(event) => {
                setNewInvoiceDiscount(
                  event.target.value,
                );

                setQuoteError("");
              }}
              placeholder="0.00"
            />
          </label>

          <div className="sales-return-field">
            <span>
              طريقة تسوية فرق التبديل
            </span>

            <div
              style={{
                display: "flex",
                gap: "12px",
                flexWrap: "wrap",
                paddingTop: "10px",
              }}
            >
              <label
                style={{
                  display: "flex",
                  gap: "6px",
                  alignItems: "center",
                }}
              >
                <input
                  type="radio"
                  name="exchange-settlement"
                  checked={
                    settlementType ===
                    "cash"
                  }
                  onChange={() => {
                    setSettlementType(
                      "cash",
                    );

                    setQuoteError("");
                  }}
                />

                نقدي Cash
              </label>

              <label
                style={{
                  display: "flex",
                  gap: "6px",
                  alignItems: "center",
                  opacity:
                    activeQuote &&
                    activeQuote
                      .settlementAmountMinor <=
                      0
                      ? 0.5
                      : 1,
                }}
              >
                <input
                  type="radio"
                  name="exchange-settlement"
                  checked={
                    settlementType ===
                    "card"
                  }
                  disabled={
                    Boolean(
                      activeQuote &&
                        activeQuote
                          .settlementAmountMinor <=
                          0,
                    )
                  }
                  onChange={() => {
                    setSettlementType(
                      "card",
                    );

                    setQuoteError("");
                  }}
                />

                بطاقة Card
              </label>
            </div>

            <small>
              البطاقة مسموحة فقط إذا كان
              هناك مبلغ إضافي على الزبون.
            </small>
          </div>
        </div>

        {quoteError && (
          <p
            className="error-message"
            role="alert"
            style={{
              margin:
                "0 16px 16px",
            }}
          >
            {quoteError}
          </p>
        )}

        {quote &&
          !activeQuote &&
          !quoteBusy && (
            <p
              style={{
                margin:
                  "0 16px 16px",
                padding: "12px",
                border:
                  "1px solid rgba(0,0,0,0.12)",
                borderRadius: "10px",
              }}
            >
              تم تغيير بيانات التبديل بعد
              آخر حساب. اضغط
              {" "}
              <strong>
                احسب فرق التبديل
              </strong>
              {" "}
              لتحديث الأرقام.
            </p>
          )}

        {activeQuote ? (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(180px, 1fr))",
                gap: "12px",
                padding:
                  "0 16px 16px",
              }}
            >
              <div>
                <small>
                  قيمة المرتجع قبل الخصومات
                </small>
                <br />
                <strong>
                  {formatMoney(
                    activeQuote
                      .returnGrossMinor,
                  )}
                </strong>
              </div>

              <div>
                <small>
                  خصومات المرتجع
                </small>
                <br />
                <strong>
                  {formatMoney(
                    activeQuote
                      .returnDiscountMinor,
                  )}
                </strong>
              </div>

              <div>
                <small>
                  صافي قيمة المرتجع
                </small>
                <br />
                <strong>
                  {formatMoney(
                    activeQuote
                      .returnNetMinor,
                  )}
                </strong>
              </div>

              <div>
                <small>
                  قيمة الأصناف الجديدة
                </small>
                <br />
                <strong>
                  {formatMoney(
                    activeQuote
                      .newGrossMinor,
                  )}
                </strong>
              </div>

              <div>
                <small>
                  خصومات الأصناف الجديدة
                </small>
                <br />
                <strong>
                  {formatMoney(
                    activeQuote
                      .newDiscountMinor,
                  )}
                </strong>
              </div>

              <div>
                <small>
                  صافي الأصناف الجديدة
                </small>
                <br />
                <strong>
                  {formatMoney(
                    activeQuote
                      .newNetMinor,
                  )}
                </strong>
              </div>
            </div>

            <div
              style={{
                margin:
                  "0 16px 16px",
                padding: "18px",
                border:
                  "2px solid rgba(0,0,0,0.15)",
                borderRadius: "12px",
                textAlign: "center",
              }}
            >
              <small>
                فرق التبديل
              </small>

              <h2
                style={{
                  margin:
                    "8px 0",
                }}
              >
                {activeQuote
                  .settlementAmountMinor >
                0
                  ? `على الزبون ${formatMoney(
                      activeQuote
                        .settlementAmountMinor,
                    )}`
                  : activeQuote
                        .settlementAmountMinor <
                      0
                    ? `للزبون ${formatMoney(
                        Math.abs(
                          activeQuote
                            .settlementAmountMinor,
                        ),
                      )}`
                    : "لا يوجد فرق"}
              </h2>

              <strong>
                طريقة التسوية:
                {" "}
                {activeQuote
                  .settlementType ===
                "cash"
                  ? "نقدي Cash"
                  : "بطاقة Card"}
              </strong>
            </div>

            {activeQuote
              .settlementType ===
              "cash" && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: "12px",
                  padding:
                    "0 16px 16px",
                }}
              >
                <div>
                  <small>
                    رصيد الصندوق قبل
                  </small>
                  <br />
                  <strong>
                    {formatMoney(
                      activeQuote
                        .expectedCashBeforeMinor,
                    )}
                  </strong>
                </div>

                <div>
                  <small>
                    رصيد الصندوق المتوقع بعد
                  </small>
                  <br />
                  <strong>
                    {formatMoney(
                      activeQuote
                        .expectedCashAfterMinor,
                    )}
                  </strong>
                </div>
              </div>
            )}

            {createdExchangePublicId ? (
              <div
                id="exchange-result-actions"
                style={{
                  margin:
                    "0 16px 16px",
                  padding: "18px",
                  border:
                    "2px solid rgba(0,0,0,0.18)",
                  borderRadius: "12px",
                  textAlign: "center",
                }}
              >
                <h3
                  style={{
                    margin:
                      "0 0 8px",
                  }}
                >
                  {historyPublicId
                    ? "فاتورة تبديل محفوظة"
                    : "تم تنفيذ فاتورة التبديل بنجاح"}
                </h3>

                <p>
                  رقم فاتورة التبديل:
                  {" "}
                  <strong dir="ltr">
                    {createdExchangePublicId}
                  </strong>
                </p>

                {createdExchangeWasExisting && (
                  <p>
                    تم استرجاع نفس الفاتورة
                    المحفوظة مسبقًا ولم يتم
                    تكرار العملية.
                  </p>
                )}

                {exchangeVoided && (
                  <p>
                    <strong>
                      فاتورة التبديل ملغاة
                    </strong>
                  </p>
                )}

                {voidError && (
                  <p
                    className="error-message"
                    role="alert"
                  >
                    {voidError}
                  </p>
                )}

                {voidMessage && (
                  <p>
                    {voidMessage}
                  </p>
                )}

                {printError && (
                  <p
                    className="error-message"
                    role="alert"
                  >
                    {printError}
                  </p>
                )}

                {printMessage && (
                  <p>
                    {printMessage}
                  </p>
                )}

                <div
                  style={{
                    display: "flex",
                    gap: "10px",
                    justifyContent:
                      "center",
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    className="primary-button"
                    type="button"
                    disabled={
                      printBusy ||
                      voidBusy
                    }
                    onClick={() =>
                      void handlePrintExchange()
                    }
                  >
                    {printBusy
                      ? "جاري الطباعة..."
                      : "طباعة مباشرة"}
                  </button>

                  {!exchangeVoided && (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={
                        voidBusy ||
                        printBusy
                      }
                      onClick={() =>
                        void handleVoidExchange()
                      }
                    >
                      {voidBusy
                        ? "جاري الإلغاء..."
                        : "إلغاء فاتورة التبديل"}
                    </button>
                  )}

                  <button
                    className="secondary-button"
                    type="button"
                    disabled={
                      printBusy ||
                      voidBusy
                    }
                    onClick={
                      startNewExchange
                    }
                  >
                    فاتورة تبديل جديدة
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p
                  style={{
                    margin:
                      "0 16px 12px",
                  }}
                >
                  هذه معاينة فقط. عند الضغط
                  على تنفيذ فاتورة التبديل
                  سيتم تحديث المخزون والصندوق
                  حسب البيانات المعروضة أعلاه.
                </p>

                {createError && (
                  <p
                    className="error-message"
                    role="alert"
                    style={{
                      margin:
                        "0 16px 12px",
                    }}
                  >
                    {createError}
                  </p>
                )}

                <div
                  style={{
                    padding:
                      "0 16px 18px",
                    display: "flex",
                    justifyContent:
                      "flex-end",
                  }}
                >
                  <button
                    className="primary-button"
                    type="button"
                    onClick={
                      handleCreateExchange
                    }
                    disabled={
                      createBusy ||
                      quoteBusy
                    }
                  >
                    {createBusy
                      ? "جاري تنفيذ التبديل..."
                      : "تنفيذ فاتورة التبديل"}
                  </button>
                </div>
              </>
            )}
          </>
        ) : (
          !quoteBusy &&
          !quoteError &&
          !quote && (
            <p
              style={{
                margin:
                  "0 16px 16px",
              }}
            >
              بعد اختيار المرتجع والأصناف
              الجديدة اضغط
              {" "}
              <strong>
                احسب فرق التبديل
              </strong>
              .
            </p>
          )
        )}
      </article>

      {createdExchangeResult?.exchange ? (
        <ExchangeReceipt
          result={createdExchangeResult}
          receiptRef={exchangeReceiptRef}
        />
      ) : null}
    </section>
  );
}
