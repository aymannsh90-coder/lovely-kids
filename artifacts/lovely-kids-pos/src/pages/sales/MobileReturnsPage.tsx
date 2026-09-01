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
  createPosMobileReturn,
  getCurrentCashSession,
  lookupPosProductByBarcode,
} from "../../lib/api";

interface BarcodeDetectorResult {
  rawValue?: string;
}

interface BarcodeDetectorInstance {
  detect(
    source: HTMLVideoElement,
  ): Promise<BarcodeDetectorResult[]>;
}

type BarcodeDetectorConstructor =
  new () => BarcodeDetectorInstance;

interface ReturnCartLine {
  id: string;

  barcode: string;

  productNameAr: string;

  color: string | null;
  size: string | null;

  quantity: number;

  refundUnitPrice: string;
}

function createKey() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID ===
      "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}`;
}

function formatMinor(
  value: number,
) {
  return `${new Intl.NumberFormat(
    "en-US",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  ).format(value / 100)} ₪`;
}

function moneyToMinor(
  value: string,
) {
  const amount = Number(
    value.trim().replace(",", "."),
  );

  if (
    !Number.isFinite(amount) ||
    amount < 0
  ) {
    return null;
  }

  const minor =
    Math.round(amount * 100);

  if (
    !Number.isSafeInteger(minor) ||
    Math.abs(minor / 100 - amount) >
      0.000001
  ) {
    return null;
  }

  return minor;
}

function errorMessage(
  error: unknown,
) {
  return error instanceof Error
    ? error.message
    : "حدث خطأ غير متوقع";
}

export default function MobileReturnsPage() {
  const {
    token,
    user,
    session,
    setSession,
    clearAuthentication,
  } = usePosRuntime();

  const [cart, setCart] =
    useState<ReturnCartLine[]>([]);

  const cartRef =
    useRef<ReturnCartLine[]>([]);

  const [barcodeInput, setBarcodeInput] =
    useState("");

  const [lookupBusy, setLookupBusy] =
    useState(false);

  const [submitBusy, setSubmitBusy] =
    useState(false);

  const [error, setError] =
    useState("");

  const [message, setMessage] =
    useState("");

  const [cameraOpen, setCameraOpen] =
    useState(false);

  const [cameraError, setCameraError] =
    useState("");

  const [
    scanFeedback,
    setScanFeedback,
  ] = useState("");

  const [
    lastSummary,
    setLastSummary,
  ] = useState<{
    publicId: string;
    pieces: number;
    refundMinor: number;
  } | null>(null);

  const videoRef =
    useRef<HTMLVideoElement>(null);

  const streamRef =
    useRef<MediaStream | null>(null);

  const scanBusyRef = useRef(false);

  const lastScannedRef = useRef<{
    value: string;
    at: number;
  } | null>(null);

  const scanFeedbackTimerRef =
    useRef<number | null>(null);

  const idempotencyKeyRef =
    useRef<string | null>(null);

  useEffect(() => {
    document.title =
      "مردودات الهاتف | Lovely Kids POS";
  }, []);

  function updateCart(
    next: ReturnCartLine[],
  ) {
    cartRef.current = next;
    setCart(next);
  }

  const itemCount = useMemo(
    () =>
      cart.reduce(
        (total, line) =>
          total + line.quantity,
        0,
      ),
    [cart],
  );

  const totalMinor = useMemo(
    () =>
      cart.reduce(
        (total, line) => {
          const unit =
            moneyToMinor(
              line.refundUnitPrice,
            );

          if (unit === null) {
            return total;
          }

          return (
            total +
            unit * line.quantity
          );
        },
        0,
      ),
    [cart],
  );

  function showScanFeedback(
    productName: string,
  ) {
    setScanFeedback(
      `تمت إضافة ${productName}`,
    );

    if (
      scanFeedbackTimerRef.current !==
      null
    ) {
      window.clearTimeout(
        scanFeedbackTimerRef.current,
      );
    }

    scanFeedbackTimerRef.current =
      window.setTimeout(() => {
        setScanFeedback("");
        scanFeedbackTimerRef.current =
          null;
      }, 1100);
  }

  function stopCamera() {
    streamRef.current
      ?.getTracks()
      .forEach((track) =>
        track.stop(),
      );

    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject =
        null;
    }

    setCameraOpen(false);
  }

  async function lookupAndAddBarcode(
    rawValue: string,
  ) {
    const barcode =
      rawValue.trim();

    if (!barcode) {
      setError(
        "امسح باركود الصنف",
      );
      return;
    }

    setLookupBusy(true);
    setError("");
    setMessage("");

    try {
      const product =
        await lookupPosProductByBarcode(
          token,
          barcode,
        );

      const current =
        cartRef.current;

      const existing =
        current.find(
          (line) =>
            line.barcode === barcode &&
            line.color ===
              (product.mappedColor ??
                null) &&
            line.size ===
              (product.mappedSize ??
                null),
        );

      if (existing) {
        updateCart(
          current.map((line) =>
            line.id === existing.id
              ? {
                  ...line,

                  quantity:
                    Math.min(
                      99,
                      line.quantity +
                        1,
                    ),
                }
              : line,
          ),
        );
      } else {
        updateCart([
          ...current,

          {
            id: createKey(),

            barcode,

            productNameAr:
              product.nameAr,

            color:
              product.mappedColor ??
              null,

            size:
              product.mappedSize ??
              null,

            quantity: 1,

            refundUnitPrice:
              product.websiteUnitPrice.toFixed(
                2,
              ),
          },
        ]);
      }

      idempotencyKeyRef.current =
        null;

      setLastSummary(null);

      showScanFeedback(
        product.nameAr,
      );

      setMessage(
        `تمت إضافة ${product.nameAr}`,
      );

      if (
        "vibrate" in navigator
      ) {
        navigator.vibrate(80);
      }

      setBarcodeInput("");
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
      setLookupBusy(false);
    }
  }

  function handleBarcodeSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    void lookupAndAddBarcode(
      barcodeInput,
    );
  }

  useEffect(() => {
    if (!cameraOpen) {
      return;
    }

    let cancelled = false;

    let intervalId:
      | number
      | null = null;

    async function startCamera() {
      setCameraError("");

      const Detector = (
        window as unknown as {
          BarcodeDetector?:
            BarcodeDetectorConstructor;
        }
      ).BarcodeDetector;

      if (!Detector) {
        setCameraError(
          "هذا المتصفح لا يدعم قراءة الباركود بالكاميرا مباشرة.",
        );

        setCameraOpen(false);
        return;
      }

      if (
        !navigator.mediaDevices
          ?.getUserMedia
      ) {
        setCameraError(
          "تعذر الوصول إلى كاميرا الهاتف.",
        );

        setCameraOpen(false);
        return;
      }

      try {
        const stream =
          await navigator.mediaDevices.getUserMedia(
            {
              audio: false,

              video: {
                facingMode: {
                  ideal:
                    "environment",
                },

                width: {
                  ideal: 1280,
                },

                height: {
                  ideal: 720,
                },
              },
            },
          );

        if (cancelled) {
          stream
            .getTracks()
            .forEach((track) =>
              track.stop(),
            );

          return;
        }

        streamRef.current =
          stream;

        if (!videoRef.current) {
          throw new Error(
            "تعذر تجهيز الكاميرا",
          );
        }

        videoRef.current.srcObject =
          stream;

        await videoRef.current.play();

        const detector =
          new Detector();

        intervalId =
          window.setInterval(
            async () => {
              if (
                cancelled ||
                scanBusyRef.current ||
                !videoRef.current ||
                videoRef.current
                  .readyState < 2
              ) {
                return;
              }

              try {
                scanBusyRef.current =
                  true;

                const results =
                  await detector.detect(
                    videoRef.current,
                  );

                const value =
                  results[0]?.rawValue?.trim();

                if (!value) {
                  return;
                }

                const now =
                  Date.now();

                const previous =
                  lastScannedRef.current;

                if (
                  previous &&
                  previous.value ===
                    value &&
                  now - previous.at <
                    3000
                ) {
                  return;
                }

                lastScannedRef.current =
                  {
                    value,
                    at: now,
                  };

                void playMobileScanSound();
                await lookupAndAddBarcode(
                  value,
                );

                lastScannedRef.current =
                  {
                    value,
                    at: Date.now(),
                  };
              } catch {
                // Continue scanning.
              } finally {
                scanBusyRef.current =
                  false;
              }
            },
            300,
          );
      } catch (caught) {
        setCameraError(
          errorMessage(caught),
        );

        setCameraOpen(false);
      }
    }

    void startCamera();

    return () => {
      cancelled = true;

      if (intervalId !== null) {
        window.clearInterval(
          intervalId,
        );
      }

      streamRef.current
        ?.getTracks()
        .forEach((track) =>
          track.stop(),
        );

      streamRef.current = null;
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOpen]);

  function changeQuantity(
    lineId: string,
    amount: number,
  ) {
    updateCart(
      cartRef.current.map(
        (line) =>
          line.id === lineId
            ? {
                ...line,

                quantity:
                  Math.max(
                    1,
                    Math.min(
                      99,
                      line.quantity +
                        amount,
                    ),
                  ),
              }
            : line,
      ),
    );

    idempotencyKeyRef.current =
      null;

    setLastSummary(null);
  }

  function changePrice(
    lineId: string,
    value: string,
  ) {
    updateCart(
      cartRef.current.map(
        (line) =>
          line.id === lineId
            ? {
                ...line,

                refundUnitPrice:
                  value,
              }
            : line,
      ),
    );

    idempotencyKeyRef.current =
      null;

    setLastSummary(null);
  }

  function removeLine(
    lineId: string,
  ) {
    updateCart(
      cartRef.current.filter(
        (line) =>
          line.id !== lineId,
      ),
    );

    idempotencyKeyRef.current =
      null;

    setLastSummary(null);
  }

  async function completeReturn() {
    const currentCart =
      cartRef.current;

    if (!session) {
      setError(
        "يجب فتح يوم العمل أولًا",
      );
      return;
    }

    if (
      currentCart.length === 0
    ) {
      setError(
        "أضف صنفًا واحدًا على الأقل",
      );
      return;
    }

    for (const line of currentCart) {
      if (
        moneyToMinor(
          line.refundUnitPrice,
        ) === null
      ) {
        setError(
          `سعر مردود ${line.productNameAr} غير صالح`,
        );

        return;
      }
    }

    const pieces =
      currentCart.reduce(
        (total, line) =>
          total + line.quantity,
        0,
      );

    const confirmed =
      window.confirm(
        `إتمام مردود ${pieces} قطعة بقيمة ${formatMinor(
          totalMinor,
        )}؟`,
      );

    if (!confirmed) {
      return;
    }

    let idempotencyKey =
      idempotencyKeyRef.current;

    if (!idempotencyKey) {
      idempotencyKey =
        `mobile-return:${Date.now()}:${createKey()}`;

      idempotencyKeyRef.current =
        idempotencyKey;
    }

    setSubmitBusy(true);
    setError("");
    setMessage("");

    try {
      const result =
        await createPosMobileReturn(
          token,
          {
            registerKey:
              session.registerKey,

            idempotencyKey,

            items:
              currentCart.map(
                (line) => ({
                  barcode:
                    line.barcode,

                  color:
                    line.color,

                  size:
                    line.size,

                  quantity:
                    line.quantity,

                  refundUnitPrice:
                    line.refundUnitPrice,
                }),
              ),
          },
        );

      stopCamera();

      setScanFeedback("");

      lastScannedRef.current =
        null;

      updateCart([]);

      setBarcodeInput("");

      idempotencyKeyRef.current =
        null;

      setLastSummary({
        publicId:
          result.saleReturn.publicId,

        pieces,

        refundMinor:
          result.saleReturn
            .refundAmountMinor,
      });

      setMessage(
        `تم تنفيذ المردود ${result.saleReturn.publicId} وإرجاع المخزون وخصم المبلغ من الصندوق`,
      );

      try {
        const current =
          await getCurrentCashSession(
            token,
            session.registerKey,
          );

        if (current.session) {
          setSession(
            current.session,
          );
        }
      } catch {
        // Return already succeeded.
      }
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
      setSubmitBusy(false);
    }
  }

  return (
    <main
      className="mobile-pos-page"
      dir="rtl"
    >
      <div className="mobile-pos-shell">
        <header className="mobile-pos-header">
          <div>
            <strong>
              Lovely Kids
            </strong>

            <span>
              نقطة البيع الهاتفية
            </span>
          </div>

          <div className="mobile-pos-header-actions">
            <Link to="/sales/pos">
              رجوع
            </Link>
          </div>
        </header>

        <nav className="mobile-pos-tabs">
          <Link to="/sales/mobile">
            فاتورة مبيعات
          </Link>

          <Link
            className="is-active"
            to="/sales/mobile/returns"
          >
            مردودات مبيعات
          </Link>

          <Link to="/sales/mobile/price-check">
            فحص السعر
          </Link>
        </nav>

        <div className="mobile-pos-user">
          <span>
            👤{" "}
            {user?.name ??
              "موظف"}
          </span>

          <span>
            ↩️ مردود احتياطي
          </span>
        </div>

        <section className="mobile-pos-scan-card">
          {!cameraOpen ? (
            <button
              className="mobile-pos-camera-button"
              type="button"
              onClick={() => {
                setCameraError("");
                setError("");
                void unlockMobileScanSound();
                setCameraOpen(true);
              }}
            >
              <span>📷</span>

              <strong>
                مسح باركود الصنف
              </strong>

              <small>
                امسح القطع المراد إرجاعها
              </small>
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

                  <strong>
                    {scanFeedback}
                  </strong>
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
            onSubmit={
              handleBarcodeSubmit
            }
          >
            <input
              dir="ltr"
              value={barcodeInput}
              onChange={(event) =>
                setBarcodeInput(
                  event.target.value,
                )
              }
              placeholder="باركود الصنف"
              autoComplete="off"
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

        {lastSummary && (
          <section className="mobile-pos-last-sale">
            <div className="mobile-pos-last-sale-icon">
              ✓
            </div>

            <div>
              <strong>
                تم المردود بنجاح
              </strong>

              <span>
                {lastSummary.pieces}
                {" "}
                قطعة
              </span>

              <small dir="ltr">
                {
                  lastSummary.publicId
                }
              </small>
            </div>

            <strong>
              {formatMinor(
                lastSummary.refundMinor,
              )}
            </strong>
          </section>
        )}

        <section className="mobile-pos-cart">
          <div className="mobile-pos-cart-title">
            <strong>
              سلة المردودات
            </strong>

            <span>
              {itemCount} قطعة
            </span>
          </div>

          {cart.length === 0 ? (
            <div className="mobile-pos-empty-cart">
              <span>↩️</span>

              <strong>
                لا توجد قطع
              </strong>

              <small>
                امسح أول قطعة لبدء المردود
              </small>
            </div>
          ) : (
            <div className="mobile-return-lines">
              {cart.map(
                (line) => (
                  <article
                    className="mobile-return-line"
                    key={line.id}
                  >
                    <div className="mobile-pos-line-top">
                      <div>
                        <strong>
                          {
                            line.productNameAr
                          }
                        </strong>

                        {(line.color ||
                          line.size) && (
                          <small>
                            {line.color ||
                              "—"}
                            {" / "}
                            {line.size ||
                              "—"}
                          </small>
                        )}

                        <small dir="ltr">
                          {
                            line.barcode
                          }
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
                      >
                        ×
                      </button>
                    </div>

                    <div className="mobile-return-price-row">
                      <label>
                        سعر المردود
                      </label>

                      <div>
                        <input
                          inputMode="decimal"
                          value={
                            line.refundUnitPrice
                          }
                          onChange={(
                            event,
                          ) =>
                            changePrice(
                              line.id,
                              event
                                .target
                                .value,
                            )
                          }
                          disabled={
                            submitBusy
                          }
                        />

                        <span>₪</span>
                      </div>
                    </div>

                    <div className="mobile-return-quantity-row">
                      <span>
                        الكمية
                      </span>

                      <div className="mobile-pos-quantity">
                        <button
                          type="button"
                          disabled={
                            line.quantity <=
                              1 ||
                            submitBusy
                          }
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
                          {
                            line.quantity
                          }
                        </span>

                        <button
                          type="button"
                          disabled={
                            line.quantity >=
                              99 ||
                            submitBusy
                          }
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
                ),
              )}
            </div>
          )}
        </section>

        <footer className="mobile-return-checkout">
          <div>
            <span>
              {itemCount} قطعة
            </span>

            <strong>
              {formatMinor(
                totalMinor,
              )}
            </strong>

            <small>
              سيتم خصم المبلغ من الصندوق
            </small>
          </div>

          <button
            type="button"
            disabled={
              submitBusy ||
              cart.length === 0
            }
            onClick={() =>
              void completeReturn()
            }
          >
            {submitBusy
              ? "جاري تنفيذ المردود..."
              : "إتمام المردودات"}
          </button>
        </footer>
      </div>
    </main>
  );
}
