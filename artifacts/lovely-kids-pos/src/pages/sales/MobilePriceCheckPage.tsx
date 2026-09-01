import {
  useEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";

import { usePosRuntime } from "../../app/pos-context";
import {
  ApiError,
  lookupPosProductByBarcode,
  type PosProductLookup,
} from "../../lib/api";

interface BarcodeDetectorResult {
  rawValue?: string;
}

interface BarcodeDetectorInstance {
  detect(source: HTMLVideoElement): Promise<BarcodeDetectorResult[]>;
}

type BarcodeDetectorConstructor = new () => BarcodeDetectorInstance;

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "حدث خطأ غير متوقع";
}

export default function MobilePriceCheckPage() {
  const {
    user,
    token,
    clearAuthentication,
  } = usePosRuntime();

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [product, setProduct] =
    useState<PosProductLookup | null>(null);

  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanBusyRef = useRef(false);

  const lastScannedRef = useRef<{
    value: string;
    at: number;
  } | null>(null);

  useEffect(() => {
    document.title = "فحص السعر | Lovely Kids POS";
  }, []);

  function stopCamera() {
    streamRef.current
      ?.getTracks()
      .forEach((track) => track.stop());

    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraOpen(false);
  }

  async function checkBarcode(value: string) {
    const barcode = value.trim();

    if (!barcode) {
      return;
    }

    setScanning(true);
    setError("");

    try {
      const result =
        await lookupPosProductByBarcode(
          token,
          barcode,
        );

      setProduct(result);

      if ("vibrate" in navigator) {
        navigator.vibrate(80);
      }
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setProduct(null);
      setError(errorMessage(caught));
    } finally {
      setScanning(false);
    }
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
          "هذا المتصفح لا يدعم قراءة الباركود بالكاميرا مباشرة.",
        );
        setCameraOpen(false);
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError(
          "تعذر الوصول إلى كاميرا الهاتف.",
        );
        setCameraOpen(false);
        return;
      }

      try {
        const stream =
          await navigator.mediaDevices.getUserMedia({
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
          stream
            .getTracks()
            .forEach((track) => track.stop());

          return;
        }

        streamRef.current = stream;

        if (!videoRef.current) {
          throw new Error(
            "تعذر تجهيز الكاميرا",
          );
        }

        videoRef.current.srcObject = stream;

        await videoRef.current.play();

        const detector = new Detector();

        intervalId = window.setInterval(
          async () => {
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

              const results =
                await detector.detect(
                  videoRef.current,
                );

              const value =
                results[0]?.rawValue?.trim();

              if (!value) {
                return;
              }

              const now = Date.now();
              const previous =
                lastScannedRef.current;

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

              await checkBarcode(value);

              lastScannedRef.current = {
                value,
                at: Date.now(),
              };
            } catch {
              // استمر في محاولة قراءة الباركود.
            } finally {
              scanBusyRef.current = false;
            }
          },
          300,
        );
      } catch (caught) {
        setCameraError(errorMessage(caught));
        setCameraOpen(false);
      }
    }

    void startCamera();

    return () => {
      cancelled = true;

      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }

      streamRef.current
        ?.getTracks()
        .forEach((track) => track.stop());

      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOpen]);

  return (
    <main className="mobile-pos-page mobile-price-check-page" dir="rtl">
      <div className="mobile-pos-shell">
        <header className="mobile-pos-header">
          <div>
            <strong>Lovely Kids</strong>
            <span>نقطة البيع الهاتفية</span>
          </div>

          <div className="mobile-pos-header-actions">
            <Link to="/sales/pos">رجوع</Link>
          </div>
        </header>

        <nav className="mobile-pos-tabs">
          <Link to="/sales/mobile">
            فاتورة مبيعات
          </Link>

          <Link to="/sales/mobile/returns">
            مردودات مبيعات
          </Link>

          <Link
            className="is-active"
            to="/sales/mobile/price-check"
          >
            فحص السعر
          </Link>
        </nav>

        <div className="mobile-pos-user">
          <span>
            👤 {user?.name ?? "موظف"}
          </span>
          <span>🔎 فحص السعر</span>
        </div>

        <section className="mobile-pos-scan-card">
          {!cameraOpen ? (
            <button
              className="mobile-pos-camera-button"
              type="button"
              onClick={() => {
                setCameraError("");
                setError("");
                setCameraOpen(true);
              }}
            >
              <span>📷</span>
              <strong>مسح الباركود</strong>
              <small>
                وجّه الكاميرا نحو باركود المنتج
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
        </section>

        {error && (
          <div className="mobile-pos-alert mobile-pos-error">
            {error}
          </div>
        )}

        {scanning && (
          <div className="mobile-price-check-loading">
            جاري قراءة السعر...
          </div>
        )}

        {product && (
          <section className="mobile-price-result">
            <div className="mobile-price-result-check">
              ✓
            </div>

            <span>سعر المنتج</span>

            <h2>{product.nameAr}</h2>

            {(product.mappedColor ||
              product.mappedSize) && (
              <p>
                {product.mappedColor || ""}
                {product.mappedColor &&
                product.mappedSize
                  ? " / "
                  : ""}
                {product.mappedSize || ""}
              </p>
            )}

            {(() => {
              const colorVariant = product.mappedColor
                ? product.colorVariants.find(
                    (variant) => variant.color === product.mappedColor,
                  )
                : null;

              const exactSize =
                colorVariant && product.mappedSize
                  ? colorVariant.sizes.find(
                      (size) => size.size === product.mappedSize,
                    )
                  : null;

              let availableStock: number | null = null;

              if (typeof exactSize?.stock === "number") {
                availableStock = exactSize.stock;
              } else if (colorVariant && !product.mappedSize) {
                const stocks = colorVariant.sizes
                  .map((size) => size.stock)
                  .filter(
                    (stock): stock is number =>
                      typeof stock === "number",
                  );

                if (stocks.length > 0) {
                  availableStock = stocks.reduce(
                    (total, stock) => total + stock,
                    0,
                  );
                }
              } else if (product.mappedSize && !product.mappedColor) {
                const stocks = product.colorVariants
                  .flatMap((variant) => variant.sizes)
                  .filter(
                    (size) =>
                      size.size === product.mappedSize &&
                      typeof size.stock === "number",
                  )
                  .map((size) => size.stock as number);

                if (stocks.length > 0) {
                  availableStock = stocks.reduce(
                    (total, stock) => total + stock,
                    0,
                  );
                }
              }

              if (
                availableStock === null &&
                typeof product.stock === "number"
              ) {
                availableStock = product.stock;
              }

              if (availableStock !== null) {
                availableStock = Math.max(
                  0,
                  Math.trunc(availableStock),
                );
              }

              return (
                <div className="mobile-price-summary">
                  <div className="mobile-price-summary-item">
                    <span>السعر</span>
                    <strong dir="ltr">
                      {product.websiteUnitPrice.toFixed(2)} ₪
                    </strong>
                  </div>

                  <div className="mobile-price-summary-item mobile-price-stock">
                    <span>المتوفر حاليًا</span>
                    <strong>
                      {availableStock === null
                        ? "—"
                        : `${availableStock} قطعة`}
                    </strong>
                  </div>
                </div>
              );
            })()}

            {product.barcode && (
              <small dir="ltr">
                {product.barcode}
              </small>
            )}
          </section>
        )}

        {!product && !scanning && !error && (
          <section className="mobile-price-empty">
            <span>🏷️</span>
            <strong>
              امسح المنتج لمعرفة سعره
            </strong>
          </section>
        )}
      </div>
    </main>
  );
}
