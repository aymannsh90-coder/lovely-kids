import {
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { usePosRuntime } from "../../app/pos-context";
import {
  ApiError,
  getPosExchangePreview,
  type PosExchangePreviewResult,
} from "../../lib/api";
import {
  captureScannerKeyboardEvent,
  createScannerKeyboardBuffer,
} from "../../lib/scannerKeyboard";

type ExchangeMode =
  | "with_receipt"
  | "no_receipt";

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

  const invoiceInputRef =
    useRef<HTMLInputElement>(null);

  const invoiceScannerKeyboard = useRef(
    createScannerKeyboardBuffer(),
  );

  const barcodeScannerKeyboard = useRef(
    createScannerKeyboardBuffer(),
  );

  const [mode, setMode] =
    useState<ExchangeMode>("with_receipt");

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

  if (!session) {
    return null;
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
    resetReceiptExchange();
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

        <div className="sales-return-session">
          <span>جلسة الصندوق</span>

          <strong dir="ltr">
            {session.registerKey}
          </strong>
        </div>
      </header>

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
              "repeat(2, minmax(0, 1fr))",
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
            onClick={() =>
              changeMode(
                "no_receipt",
              )
            }
          >
            📦 تبديل بدون فاتورة
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
      ) : (
        <article className="sales-return-search-panel">
          <div className="sales-return-section-title">
            <div>
              <h3>
                الأصناف المرجعة بدون فاتورة
              </h3>

              <p>
                بالخطوة التالية سنضيف مسح
                باركود الصنف، والسعر الحالي
                كقيمة افتراضية مع إمكانية
                تعديل القيمة يدويًا.
              </p>
            </div>
          </div>
        </article>
      )}

      <article className="sales-return-search-panel">
        <div className="sales-return-section-title">
          <div>
            <h3>الأصناف الجديدة</h3>

            <p>
              سيتم إضافة الأصناف البديلة هنا
              بالباركود مع اللون والمقاس
              والكمية والسعر.
            </p>
          </div>
        </div>
      </article>

      <article className="sales-return-search-panel">
        <div className="sales-return-section-title">
          <div>
            <h3>ملخص التبديل</h3>

            <p>
              قيمة المرتجع، قيمة الأصناف
              الجديدة، فرق السعر وطريقة
              التسوية ستظهر هنا.
            </p>
          </div>
        </div>
      </article>
    </section>
  );
}
