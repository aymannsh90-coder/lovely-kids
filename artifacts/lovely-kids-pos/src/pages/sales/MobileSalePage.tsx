import { playMobileScanSound, unlockMobileScanSound } from "../../lib/mobile-scan-sound";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link } from "react-router-dom";

import { usePosRuntime } from "../../app/pos-context";
import {
  ApiError,
  createPosSale,
  getCurrentCashSession,
  lookupPosProductByBarcode,
  searchPosProducts,
  type PosProductLookup,
  type PosSaleResult,
} from "../../lib/api";

interface MobileCartLine {
  id: string;
  barcode: string;
  product: PosProductLookup;
  color: string | null;
  size: string | null;
  quantity: number;
  soldUnitPrice: string;
}

interface BarcodeDetectorResult {
  rawValue?: string;
}

interface BarcodeDetectorInstance {
  detect(source: HTMLVideoElement): Promise<BarcodeDetectorResult[]>;
}

type BarcodeDetectorConstructor = new () => BarcodeDetectorInstance;

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
    return 0;
  }

  return Math.round(amount * 100);
}

function formatMinor(value: number) {
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100)} ₪`;
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

function selectionIsComplete(line: MobileCartLine) {
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

function getLineAvailability(line: MobileCartLine) {
  if (line.product.colorVariants.length > 0 && line.color) {
    const variant = line.product.colorVariants.find(
      (entry) => entry.color === line.color,
    );

    if (line.size) {
      const size = variant?.sizes.find(
        (entry) => entry.size === line.size,
      );

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

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "حدث خطأ غير متوقع";
}

export default function MobileSalePage() {
  const {
    token,
    user,
    session,
    setSession,
    clearAuthentication,
  } = usePosRuntime();

  const [cart, setCart] = useState<MobileCartLine[]>([]);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] =
    useState<PosProductLookup[]>([]);

  const [lookupBusy, setLookupBusy] = useState(false);
  const [saleBusy, setSaleBusy] = useState(false);
  const [discountAmount, setDiscountAmount] = useState("0.00");

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [lastSale, setLastSale] =
    useState<PosSaleResult | null>(null);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [scanFeedback, setScanFeedback] = useState("");

  const scanFeedbackTimerRef = useRef<number | null>(null);

  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const scanBusyRef = useRef(false);
  const lastScannedRef = useRef<{
    value: string;
    at: number;
  } | null>(null);

  const idempotencyKey = useRef<string | null>(null);

  const subtotalMinor = useMemo(
    () =>
      cart.reduce(
        (total, line) =>
          total +
          moneyToMinor(line.soldUnitPrice) * line.quantity,
        0,
      ),
    [cart],
  );

  const itemCount = useMemo(
    () =>
      cart.reduce(
        (total, line) => total + line.quantity,
        0,
      ),
    [cart],
  );

  const discountMinor = moneyToMinor(discountAmount);

  const totalMinor = Math.max(
    0,
    subtotalMinor - discountMinor,
  );

  useEffect(() => {
    document.title = "مبيعات الهاتف | Lovely Kids POS";
  }, []);

  useEffect(() => {
    function handleOnline() {
      setOnline(true);
    }

    function handleOffline() {
      setOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  function showScanFeedback(productName: string) {
    setScanFeedback(`تمت إضافة ${productName}`);

    if (scanFeedbackTimerRef.current !== null) {
      window.clearTimeout(scanFeedbackTimerRef.current);
    }

    scanFeedbackTimerRef.current = window.setTimeout(() => {
      setScanFeedback("");
      scanFeedbackTimerRef.current = null;
    }, 1100);
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraOpen(false);
  }

  useEffect(() => {
    if (!cameraOpen) {
      return;
    }

    let cancelled = false;
    let intervalId: number | null = null;

    async function startCamera() {
      setCameraError("");

      const Detector = (
        window as unknown as {
          BarcodeDetector?: BarcodeDetectorConstructor;
        }
      ).BarcodeDetector;

      if (!Detector) {
        setCameraError(
          "هذا المتصفح لا يدعم قراءة الباركود بالكاميرا مباشرة. استخدم البحث اليدوي.",
        );
        setCameraOpen(false);
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError(
          "تعذر الوصول إلى كاميرا الهاتف من هذا المتصفح.",
        );
        setCameraOpen(false);
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: {
              ideal: "environment",
            },
            width: {
              ideal: 1280,
            },
            height: {
              ideal: 720,
            },
          },
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;

        const video = videoRef.current;

        if (!video) {
          throw new Error("تعذر تجهيز شاشة الكاميرا.");
        }

        video.srcObject = stream;
        await video.play();

        const detector = new Detector();

        intervalId = window.setInterval(async () => {
          if (
            cancelled ||
            scanBusyRef.current ||
            !videoRef.current ||
            videoRef.current.readyState < 2
          ) {
            return;
          }

          try {
            scanBusyRef.current = true;

            const results = await detector.detect(videoRef.current);
            const value = results[0]?.rawValue?.trim();

            if (!value) {
              return;
            }

            const now = Date.now();
            const previous = lastScannedRef.current;

            if (
              previous &&
              previous.value === value &&
              now - previous.at < 3000
            ) {
              return;
            }

            lastScannedRef.current = {
              value,
              at: now,
            };
            void playMobileScanSound();

            if ("vibrate" in navigator) {
              navigator.vibrate(80);
            }

            await lookupAndAdd(value, true);

            // ابدأ مهلة منع التكرار بعد انتهاء إضافة المنتج،
            // وليس من لحظة اكتشاف الباركود.
            lastScannedRef.current = {
              value,
              at: Date.now(),
            };
          } catch {
            // تجاهل خطأ قراءة إطار واحد واستمر بالمسح.
          } finally {
            scanBusyRef.current = false;
          }
        }, 300);
      } catch (caught) {
        setCameraError(
          caught instanceof Error
            ? caught.message
            : "تعذر تشغيل الكاميرا.",
        );
        setCameraOpen(false);
      }
    }

    void startCamera();

    return () => {
      cancelled = true;

      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
    // الكاميرا تُشغّل أو تُوقف فقط عند تغيير cameraOpen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOpen]);

  function addProductToCart(product: PosProductLookup) {
    const colors = getColors(product);

    const color =
      product.mappedColor ??
      (colors.length === 1 ? colors[0] : null);

    const sizes = getSizes(product, color);

    const size =
      product.mappedSize ??
      (sizes.length === 1 ? sizes[0] : null);

    const selectionComplete =
      (colors.length === 0 || !!color) &&
      (sizes.length === 0 || !!size);

    const barcode = product.barcode ?? "";

    setCart((current) => {
      if (selectionComplete) {
        const existingIndex = current.findIndex(
          (line) =>
            line.product.productId === product.productId &&
            line.barcode === barcode &&
            line.color === color &&
            line.size === size,
        );

        if (existingIndex >= 0) {
          return current.map((line, index) =>
            index === existingIndex
              ? {
                  ...line,
                  quantity: Math.min(99, line.quantity + 1),
                }
              : line,
          );
        }
      }

      return [
        ...current,
        {
          id: createKey(),
          barcode,
          product,
          color,
          size,
          quantity: 1,
          soldUnitPrice: product.websiteUnitPrice.toFixed(2),
        },
      ];
    });

    setMessage(`تمت إضافة ${product.nameAr}`);
    setError("");
    setSearchResults([]);
    setQuery("");
  }

  async function lookupAndAdd(
    value: string,
    fromCamera = false,
  ) {
    const normalized = value.trim();

    if (!normalized) {
      return;
    }

    setLookupBusy(true);
    setError("");

    try {
      const product = await lookupPosProductByBarcode(
        token,
        normalized,
      );

      addProductToCart(product);

      if (fromCamera) {
        showScanFeedback(product.nameAr);
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        clearAuthentication();
        return;
      }

      if (caught instanceof ApiError && caught.status === 404) {
        try {
          const result = await searchPosProducts(
            token,
            normalized,
            10,
          );

          if (result.results.length === 1 && fromCamera) {
            addProductToCart(result.results[0]);
            showScanFeedback(result.results[0].nameAr);
            return;
          }

          setSearchResults(result.results);

          if (result.results.length === 0) {
            setError("لم يتم العثور على الصنف");
          } else {
            setMessage("اختر الصنف المطلوب");
          }
        } catch (searchError) {
          if (
            searchError instanceof ApiError &&
            searchError.status === 401
          ) {
            clearAuthentication();
            return;
          }

          setError(errorMessage(searchError));
        }
      } else {
        setError(errorMessage(caught));
      }
    } finally {
      setLookupBusy(false);
    }
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!query.trim()) {
      setError("اكتب الباركود أو كود المنتج أو الاسم");
      return;
    }

    void lookupAndAdd(query);
  }

  function changeColor(
    line: MobileCartLine,
    colorValue: string,
  ) {
    const color = colorValue || null;
    const sizes = getSizes(line.product, color);

    setCart((current) =>
      current.map((item) =>
        item.id === line.id
          ? {
              ...item,
              color,
              size: sizes.length === 1 ? sizes[0] : null,
            }
          : item,
      ),
    );
  }

  function changeSize(
    line: MobileCartLine,
    sizeValue: string,
  ) {
    setCart((current) =>
      current.map((item) =>
        item.id === line.id
          ? {
              ...item,
              size: sizeValue || null,
            }
          : item,
      ),
    );
  }

  function changePrice(
    lineId: string,
    value: string,
  ) {
    setCart((current) =>
      current.map((line) =>
        line.id === lineId
          ? {
              ...line,
              soldUnitPrice: value,
            }
          : line,
      ),
    );
  }

  function changeQuantity(
    lineId: string,
    change: number,
  ) {
    setCart((current) =>
      current.map((line) =>
        line.id === lineId
          ? {
              ...line,
              quantity: Math.max(
                1,
                Math.min(99, line.quantity + change),
              ),
            }
          : line,
      ),
    );
  }

  function removeLine(lineId: string) {
    setCart((current) =>
      current.filter((line) => line.id !== lineId),
    );
  }

  async function completeSale() {
    setError("");
    setMessage("");

    if (!session) {
      setError("يجب فتح يوم العمل أولًا");
      return;
    }

    if (cart.length === 0) {
      setError("أضف صنفًا واحدًا على الأقل");
      return;
    }

    for (const line of cart) {
      if (!selectionIsComplete(line)) {
        setError(
          `اختر اللون والمقاس للمنتج ${line.product.nameAr}`,
        );
        return;
      }

      const numericPrice = Number(
        line.soldUnitPrice.trim().replace(",", "."),
      );

      if (
        line.soldUnitPrice.trim() === "" ||
        !Number.isFinite(numericPrice) ||
        numericPrice < 0
      ) {
        setError(
          `سعر بيع ${line.product.nameAr} غير صالح`,
        );
        return;
      }

      const availability = getLineAvailability(line);

      if (
        availability.outOfStock ||
        (availability.stock !== null &&
          line.quantity > availability.stock)
      ) {
        setError(
          `الكمية المطلوبة من ${line.product.nameAr} غير متوفرة`,
        );
        return;
      }
    }

    const numericDiscount = Number(
      discountAmount.trim().replace(",", "."),
    );

    if (
      discountAmount.trim() === "" ||
      !Number.isFinite(numericDiscount) ||
      numericDiscount < 0
    ) {
      setError("قيمة الخصم غير صالحة");
      return;
    }

    if (discountMinor > subtotalMinor) {
      setError("الخصم أكبر من مجموع الفاتورة");
      return;
    }

    const confirmed = window.confirm(
      `إتمام البيع بقيمة ${formatMinor(
        totalMinor,
      )} وخصم المخزون؟`,
    );

    if (!confirmed) {
      return;
    }

    const requestKey =
      idempotencyKey.current ?? `mobile_pos_${createKey()}`;

    idempotencyKey.current = requestKey;
    setSaleBusy(true);

    try {
      const result = await createPosSale(token, {
        registerKey: session.registerKey,
        idempotencyKey: requestKey,
        paymentMethod: "cash",
        discountAmount: (discountMinor / 100).toFixed(2),
        paidAmount: (totalMinor / 100).toFixed(2),
        items: cart.map((line) => ({
          productId: line.product.productId,
          barcode: line.barcode || undefined,
          quantity: line.quantity,
          soldUnitPrice: line.soldUnitPrice,
          color: line.color ?? undefined,
          size: line.size ?? undefined,
        })),
      });

      idempotencyKey.current = null;

      // بعد نجاح البيع أعد شاشة الهاتف لوضعها الأول
      stopCamera();
      setScanFeedback("");
      lastScannedRef.current = null;

      setLastSale(result);
      setCart([]);
      setSearchResults([]);
      setQuery("");
      setDiscountAmount("0.00");

      setMessage(
        `تم حفظ الفاتورة ${result.sale.publicId} وخصم المخزون`,
      );

      const current = await getCurrentCashSession(
        token,
        session.registerKey,
      );

      if (current.session) {
        setSession(current.session);
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        clearAuthentication();
        return;
      }

      setError(errorMessage(caught));
    } finally {
      setSaleBusy(false);
    }
  }

  return (
    <main className="mobile-pos-page" dir="rtl">
      <div className="mobile-pos-shell">
        <header className="mobile-pos-header">
          <div>
            <strong>Lovely Kids</strong>
            <span>مبيعات الهاتف</span>
          </div>

          <div className="mobile-pos-header-actions">
            <span
              className={
                online
                  ? "mobile-pos-online"
                  : "mobile-pos-offline"
              }
            >
              {online ? "● متصل" : "● غير متصل"}
            </span>

            <Link to="/sales/pos">رجوع</Link>
          </div>
        </header>

        <nav className="mobile-pos-tabs">
          <Link
            className="is-active"
            to="/sales/mobile"
          >
            فاتورة مبيعات
          </Link>

          <Link to="/sales/mobile/returns">
            مردودات مبيعات
          </Link>

          <Link to="/sales/mobile/price-check">
            فحص السعر
          </Link>
        </nav>

        <div className="mobile-pos-user">
          <span>👤 {user?.name ?? "موظف"}</span>
          <span>🟢 يوم العمل مفتوح</span>
        </div>

        <section className="mobile-pos-scan-card">
          {!cameraOpen ? (
            <button
              className="mobile-pos-camera-button"
              type="button"
              onClick={() => {
                setCameraError("");
                void unlockMobileScanSound();
                setCameraOpen(true);
              }}
            >
              <span>📷</span>
              <strong>مسح الباركود</strong>
              <small>افتح الكاميرا ووجّهها نحو الكود</small>
            </button>
          ) : (
            <div className="mobile-pos-camera">
              <video
                ref={videoRef}
                playsInline
                muted
              />

              <div className="mobile-pos-camera-target" />

              {scanFeedback && (
                <div className="mobile-pos-scan-feedback">
                  <span>✓</span>
                  <strong>{scanFeedback}</strong>
                </div>
              )}

              <button
                type="button"
                onClick={stopCamera}
              >
                إغلاق الكاميرا
              </button>
            </div>
          )}

          {cameraError && (
            <div className="mobile-pos-alert mobile-pos-error">
              {cameraError}
            </div>
          )}

          <form
            className="mobile-pos-search"
            onSubmit={handleSearch}
          >
            <input
              value={query}
              onChange={(event) =>
                setQuery(event.target.value)
              }
              placeholder="باركود، كود المنتج أو الاسم"
              autoComplete="off"
            />

            <button
              type="submit"
              disabled={lookupBusy}
            >
              {lookupBusy ? "..." : "بحث"}
            </button>
          </form>

          {searchResults.length > 0 && (
            <div className="mobile-pos-search-results">
              {searchResults.map((product) => (
                <button
                  type="button"
                  key={`${product.productId}-${product.barcode ?? ""}`}
                  onClick={() => addProductToCart(product)}
                >
                  <span>{product.nameAr}</span>
                  <strong>
                    {product.websiteUnitPrice.toFixed(2)} ₪
                  </strong>
                </button>
              ))}
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

        {lastSale && (
          <section className="mobile-pos-last-sale">
            <div className="mobile-pos-last-sale-icon">✓</div>

            <div>
              <strong>تم البيع بنجاح</strong>
              <span>
                فاتورة {lastSale.sale.publicId}
              </span>
            </div>

            <strong>
              {formatMinor(lastSale.sale.totalMinor)}
            </strong>
          </section>
        )}

        <section className="mobile-pos-cart">
          <div className="mobile-pos-cart-title">
            <strong>السلة</strong>
            <span>{itemCount} قطعة</span>
          </div>

          {cart.length === 0 ? (
            <div className="mobile-pos-empty-cart">
              <span>🛒</span>
              <strong>السلة فارغة</strong>
              <small>امسح أول منتج لبدء البيع</small>
            </div>
          ) : (
            <div className="mobile-pos-cart-lines">
              {cart.map((line) => {
                const colors = getColors(line.product);
                const sizes = getSizes(
                  line.product,
                  line.color,
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

                        {line.barcode && (
                          <small dir="ltr">
                            {line.barcode}
                          </small>
                        )}
                      </div>

                      <button
                        className="mobile-pos-remove"
                        type="button"
                        aria-label={`حذف ${line.product.nameAr}`}
                        onClick={() =>
                          removeLine(line.id)
                        }
                      >
                        ×
                      </button>
                    </div>

                    {(colors.length > 0 ||
                      sizes.length > 0) && (
                      <div className="mobile-pos-variants">
                        {colors.length > 0 && (
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
                                key={color}
                                value={color}
                              >
                                {color}
                              </option>
                            ))}
                          </select>
                        )}

                        {sizes.length > 0 && (
                          <select
                            value={line.size ?? ""}
                            onChange={(event) =>
                              changeSize(
                                line,
                                event.target.value,
                              )
                            }
                          >
                            <option value="">
                              اختر المقاس
                            </option>

                            {sizes.map((size) => (
                              <option
                                key={size}
                                value={size}
                              >
                                {size}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}

                    <div className="mobile-pos-line-bottom">
                      <div className="mobile-pos-price-area">
                        <span>سعر القطعة</span>

                        <label className="mobile-pos-price-input">
                          <input
                            dir="ltr"
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            value={line.soldUnitPrice}
                            onChange={(event) =>
                              changePrice(
                                line.id,
                                event.target.value,
                              )
                            }
                          />
                          <b>₪</b>
                        </label>

                        {line.quantity > 1 && (
                          <small>
                            المجموع:{" "}
                            {formatMinor(
                              moneyToMinor(
                                line.soldUnitPrice,
                              ) * line.quantity,
                            )}
                          </small>
                        )}
                      </div>

                      <div className="mobile-pos-quantity">
                        <button
                          type="button"
                          onClick={() =>
                            changeQuantity(line.id, -1)
                          }
                        >
                          −
                        </button>

                        <span>{line.quantity}</span>

                        <button
                          type="button"
                          onClick={() =>
                            changeQuantity(line.id, 1)
                          }
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <footer className="mobile-pos-checkout">
          <div className="mobile-pos-checkout-details">
            <div className="mobile-pos-checkout-row">
              <span>المجموع ({itemCount} قطعة)</span>
              <strong>{formatMinor(subtotalMinor)}</strong>
            </div>

            <label className="mobile-pos-discount-row">
              <span>خصم الفاتورة</span>

              <div>
                <input
                  dir="ltr"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={discountAmount}
                  onChange={(event) =>
                    setDiscountAmount(event.target.value)
                  }
                />
                <b>₪</b>
              </div>
            </label>

            <div className="mobile-pos-final-total">
              <span>الإجمالي النهائي</span>
              <strong>{formatMinor(totalMinor)}</strong>
            </div>
          </div>

          <button
            type="button"
            disabled={saleBusy || cart.length === 0}
            onClick={() => void completeSale()}
          >
            {saleBusy
              ? "جاري حفظ البيع..."
              : "إتمام البيع"}
          </button>
        </footer>
      </div>
    </main>
  );
}
