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
  createPosSaleReturn,
  getCurrentCashSession,
  getPosSaleReturnPreview,
  type PosSaleReturnPreviewResult,
  type PosSaleReturnResult,
} from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import {
  captureScannerKeyboardEvent,
  createScannerKeyboardBuffer,
} from "../../lib/scannerKeyboard";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "حدث خطأ غير متوقع";
}

function formatMoney(valueMinor: number) {
  return new Intl.NumberFormat("ar-PS", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 2,
  }).format(valueMinor / 100);
}

function createIdempotencyKey() {
  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);

  return `pos-return:${Date.now()}:${randomPart}`;
}

export default function SalesReturnsPage() {
  const { token, session, setSession, clearAuthentication } = usePosRuntime();

  const invoiceInputRef = useRef<HTMLInputElement>(null);

  const invoiceScannerKeyboard = useRef(
    createScannerKeyboardBuffer(),
  );

  const barcodeScannerKeyboard = useRef(
    createScannerKeyboardBuffer(),
  );

  const [invoiceInput, setInvoiceInput] = useState("");

  const [barcodeInput, setBarcodeInput] = useState("");

  const [preview, setPreview] = useState<PosSaleReturnPreviewResult | null>(
    null,
  );

  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  const [searchBusy, setSearchBusy] = useState(false);

  const [submitBusy, setSubmitBusy] = useState(false);

  const [error, setError] = useState("");

  const [completedReturn, setCompletedReturn] =
    useState<PosSaleReturnResult | null>(null);

  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);

  const selectedItems = useMemo(() => {
    if (!preview) {
      return [];
    }

    return preview.items
      .map((item) => ({
        item,
        quantity: quantities[item.id] ?? 0,
      }))
      .filter(({ quantity }) => quantity > 0);
  }, [preview, quantities]);

  const selectedPieces = useMemo(
    () => selectedItems.reduce((total, entry) => total + entry.quantity, 0),
    [selectedItems],
  );

  const selectedGrossMinor = useMemo(
    () =>
      selectedItems.reduce(
        (total, entry) =>
          total + entry.item.soldUnitPriceMinor * entry.quantity,
        0,
      ),
    [selectedItems],
  );

  if (!session) {
    return null;
  }

  const registerKey = session.registerKey;

  function resetReturnForm() {
    setPreview(null);
    setQuantities({});
    setInvoiceInput("");
    setBarcodeInput("");
    setReason("");
    setNotes("");
    setError("");
    setCompletedReturn(null);
    setIdempotencyKey(createIdempotencyKey());

    window.setTimeout(() => {
      invoiceInputRef.current?.focus();
    }, 0);
  }

  function initializeQuantities(
    result: PosSaleReturnPreviewResult,
    quickBarcode: string,
  ) {
    const next: Record<string, number> = {};

    for (const item of result.items) {
      next[item.id] = quickBarcode && item.returnableQuantity > 0 ? 1 : 0;
    }

    setQuantities(next);
  }

  async function loadPreviewByPublicId(
    rawPublicId: string,
    rawBarcode: string,
  ) {
    const publicId = rawPublicId.trim().toUpperCase();
    const barcode = rawBarcode.trim();

    if (!publicId) {
      setError("امسح رمز QR للفاتورة أو أدخل رقمها");

      invoiceInputRef.current?.focus();
      return;
    }

    setSearchBusy(true);
    setError("");
    setPreview(null);
    setCompletedReturn(null);
    setReason("");
    setNotes("");

    try {
      const result = await getPosSaleReturnPreview(
        token,
        publicId,
        barcode || undefined,
      );

      setPreview(result);
      setInvoiceInput(result.sale.publicId);
      setBarcodeInput(barcode);

      initializeQuantities(result, barcode);

      setIdempotencyKey(createIdempotencyKey());
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        clearAuthentication();
        return;
      }

      setError(errorMessage(caught));
    } finally {
      setSearchBusy(false);
    }
  }

  function handleInvoiceScannerKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
  ) {
    if (event.nativeEvent.isComposing) {
      return;
    }

    const scannedValue = captureScannerKeyboardEvent(
      invoiceScannerKeyboard.current,
      event,
    );

    if (event.key === "Enter" && scannedValue) {
      event.preventDefault();

      setInvoiceInput(scannedValue);

      void loadPreviewByPublicId(
        scannedValue,
        barcodeInput,
      );
    }
  }

  function handleBarcodeScannerKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
  ) {
    if (event.nativeEvent.isComposing) {
      return;
    }

    const scannedValue = captureScannerKeyboardEvent(
      barcodeScannerKeyboard.current,
      event,
    );

    if (event.key === "Enter" && scannedValue) {
      event.preventDefault();

      setBarcodeInput(scannedValue);

      if (invoiceInput.trim()) {
        void loadPreviewByPublicId(
          invoiceInput,
          scannedValue,
        );
      } else {
        invoiceInputRef.current?.focus();
      }
    }
  }

  async function loadPreview(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    await loadPreviewByPublicId(invoiceInput, barcodeInput);
  }

  function navigateReturnInvoice(targetPublicId: string | null | undefined) {
    if (!targetPublicId || searchBusy || submitBusy) {
      return;
    }

    setInvoiceInput(targetPublicId);
    setBarcodeInput("");

    void loadPreviewByPublicId(targetPublicId, "");
  }

  function updateQuantity(
    itemId: string,
    requestedValue: number,
    maximum: number,
  ) {
    const normalized = Number.isFinite(requestedValue)
      ? Math.max(0, Math.min(maximum, Math.trunc(requestedValue)))
      : 0;

    setQuantities((current) => ({
      ...current,
      [itemId]: normalized,
    }));

    setCompletedReturn(null);
    setIdempotencyKey(createIdempotencyKey());
  }

  function selectAllReturnable() {
    if (!preview) {
      return;
    }

    setQuantities(
      Object.fromEntries(
        preview.items.map((item) => [item.id, item.returnableQuantity]),
      ),
    );

    setCompletedReturn(null);
    setIdempotencyKey(createIdempotencyKey());
  }

  function clearSelection() {
    if (!preview) {
      return;
    }

    setQuantities(
      Object.fromEntries(preview.items.map((item) => [item.id, 0])),
    );

    setCompletedReturn(null);
    setIdempotencyKey(createIdempotencyKey());
  }

  async function handleSubmitReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!preview) {
      setError("يجب اختيار الفاتورة أولًا");
      return;
    }

    if (selectedItems.length === 0) {
      setError("اختر كمية صنف واحد على الأقل للمرتجع");
      return;
    }

    if (reason.trim().length < 2) {
      setError("اختر سبب المرتجع");
      return;
    }

    const confirmed = window.confirm(
      [
        "تأكيد تنفيذ مردود مبيعات؟",
        "",
        `الفاتورة: ${preview.sale.publicId}`,
        `عدد القطع: ${selectedPieces}`,
        `قيمة الأصناف قبل توزيع الخصم: ${formatMoney(selectedGrossMinor)}`,
        "",
        "سيتم إرجاع المخزون وخصم مبلغ الاسترداد من الصندوق.",
      ].join("\n"),
    );

    if (!confirmed) {
      return;
    }

    setSubmitBusy(true);
    setError("");

    try {
      const result = await createPosSaleReturn(token, {
        registerKey,
        idempotencyKey,
        publicId: preview.sale.publicId,
        reason,
        notes,
        items: selectedItems.map(({ item, quantity }) => ({
          originalSaleItemId: item.id,
          quantity,
        })),
      });

      setCompletedReturn(result);
      setQuantities({});
      setIdempotencyKey(createIdempotencyKey());

      const [currentSession, updatedPreview] = await Promise.all([
        getCurrentCashSession(token, registerKey),
        getPosSaleReturnPreview(
          token,
          preview.sale.publicId,
          barcodeInput.trim() || undefined,
        ),
      ]);

      setSession(currentSession.session);
      setPreview(updatedPreview);

      initializeQuantities(updatedPreview, "");
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        clearAuthentication();
        return;
      }

      setError(errorMessage(caught));
    } finally {
      setSubmitBusy(false);
    }
  }

  return (
    <section className="sales-return-page" id="pos-sales-returns">
      <header className="sales-return-heading">
        <div className="panel-heading">
          <div className="panel-icon">↩️</div>

          <div>
            <h2>مردودات المبيعات</h2>

            <p>
              مرتجع مرتبط بالفاتورة الأصلية مع إعادة المخزون وتحديث الصندوق.
            </p>
          </div>
        </div>

        <div className="sales-return-session">
          <span>جلسة الصندوق</span>
          <strong dir="ltr">{session.registerKey}</strong>
        </div>
      </header>

      <article className="sales-return-search-panel">
        <div className="sales-return-section-title">
          <div>
            <h3>البحث عن الفاتورة</h3>

            <p>
              امسح رمز QR أو أدخل رقم الفاتورة، ويمكن تحديد باركود صنف لمرتجع
              سريع.
            </p>
          </div>

          {(preview || completedReturn) && (
            <button
              className="secondary-button"
              type="button"
              disabled={searchBusy || submitBusy}
              onClick={resetReturnForm}
            >
              مرتجع جديد
            </button>
          )}
        </div>

        <form className="sales-return-search-form" onSubmit={loadPreview}>
          <label className="sales-return-field">
            <span>رقم أو QR الفاتورة</span>

            <input
              ref={invoiceInputRef}
              dir="ltr"
              autoFocus
              autoComplete="off"
              value={invoiceInput}
              onChange={(event) => setInvoiceInput(event.target.value)}
              onKeyDown={handleInvoiceScannerKeyDown}
              placeholder="POS-YYYYMMDD-XXXXXXXXXXXX"
              disabled={searchBusy || submitBusy}
            />
          </label>

          <label className="sales-return-field">
            <span>
              باركود الصنف
              <small> اختياري</small>
            </span>

            <input
              dir="ltr"
              autoComplete="off"
              value={barcodeInput}
              onChange={(event) => setBarcodeInput(event.target.value)}
              onKeyDown={handleBarcodeScannerKeyDown}
              placeholder="امسح باركود الصنف"
              disabled={searchBusy || submitBusy}
            />
          </label>

          <button
            className="primary-button sales-return-search-button"
            type="submit"
            disabled={searchBusy || submitBusy}
          >
            {searchBusy ? "جاري البحث…" : "عرض الفاتورة"}
          </button>
        </form>
      </article>

      {error && <div className="alert error-alert">{error}</div>}

      {completedReturn && (
        <article className="sales-return-success">
          <div className="sales-return-success-icon">✓</div>

          <div>
            <span>تم تنفيذ المرتجع بنجاح</span>

            <strong dir="ltr">{completedReturn.saleReturn.publicId}</strong>

            <p>
              مبلغ الاسترداد الفعلي:{" "}
              <b>{formatMoney(completedReturn.saleReturn.refundAmountMinor)}</b>
            </p>

            {completedReturn.alreadyCreated && (
              <small>تم استرجاع نتيجة العملية السابقة دون تكرار المرتجع.</small>
            )}
          </div>
        </article>
      )}

      {preview && (
        <form onSubmit={handleSubmitReturn}>
          <article className="sales-return-invoice">
            <div className="invoice-sequence-navigation sales-return-sequence-navigation">
              <button
                className="secondary-button"
                type="button"
                disabled={
                  !preview.navigation?.previousPublicId ||
                  searchBusy ||
                  submitBusy
                }
                onClick={() =>
                  navigateReturnInvoice(preview.navigation?.previousPublicId)
                }
              >
                ← الفاتورة السابقة
              </button>

              <span className="invoice-sequence-label">
                التنقل بين فواتير المحل
              </span>

              <button
                className="secondary-button"
                type="button"
                disabled={
                  !preview.navigation?.nextPublicId || searchBusy || submitBusy
                }
                onClick={() =>
                  navigateReturnInvoice(preview.navigation?.nextPublicId)
                }
              >
                الفاتورة التالية →
              </button>
            </div>

            <div className="sales-return-section-title">
              <div>
                <h3>بيانات الفاتورة الأصلية</h3>

                <strong dir="ltr">{preview.sale.publicId}</strong>
              </div>

              <span
                className={
                  preview.summary.fullyReturned
                    ? "return-status returned"
                    : "return-status available"
                }
              >
                {preview.summary.fullyReturned
                  ? "مردودة بالكامل"
                  : "متاح للإرجاع"}
              </span>
            </div>

            <div className="sales-return-summary-grid">
              <div>
                <span>التاريخ والوقت</span>
                <strong>{formatDateTime(preview.sale.createdAt)}</strong>
              </div>

              <div>
                <span>الزبون</span>
                <strong>{preview.sale.customerName || "زبون نقدي"}</strong>
              </div>

              <div>
                <span>إجمالي الفاتورة</span>
                <strong>{formatMoney(preview.sale.totalMinor)}</strong>
              </div>

              <div>
                <span>الخصم الأصلي</span>
                <strong>{formatMoney(preview.sale.discountMinor)}</strong>
              </div>

              <div>
                <span>الكمية المباعة</span>
                <strong>{preview.summary.soldQuantity}</strong>
              </div>

              <div>
                <span>الكمية المرتجعة سابقًا</span>
                <strong>{preview.summary.returnedQuantity}</strong>
              </div>

              <div>
                <span>المتبقي للإرجاع</span>
                <strong>{preview.summary.returnableQuantity}</strong>
              </div>
            </div>
          </article>

          <article className="sales-return-items-panel">
            <div className="sales-return-section-title">
              <div>
                <h3>أصناف المرتجع</h3>

                <p>اختر الكمية المراد إرجاعها من كل صنف.</p>
              </div>

              {!preview.summary.fullyReturned && (
                <div className="sales-return-selection-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={submitBusy}
                    onClick={selectAllReturnable}
                  >
                    مرتجع كامل
                  </button>

                  <button
                    className="secondary-button"
                    type="button"
                    disabled={submitBusy}
                    onClick={clearSelection}
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
                    <th>الكود والباركود</th>
                    <th>اللون والمقاس</th>
                    <th>سعر البيع</th>
                    <th>مباع</th>
                    <th>مرتجع سابق</th>
                    <th>متاح</th>
                    <th>كمية المرتجع</th>
                    <th>القيمة</th>
                  </tr>
                </thead>

                <tbody>
                  {preview.items.map((item, index) => {
                    const selectedQuantity = quantities[item.id] ?? 0;

                    return (
                      <tr key={item.id}>
                        <td>{index + 1}</td>

                        <td>
                          <div className="sales-return-product">
                            {item.productImage && (
                              <img src={item.productImage} alt="" />
                            )}

                            <div>
                              <strong>{item.productNameAr}</strong>

                              <small>سطر الفاتورة {item.lineNumber}</small>
                            </div>
                          </div>
                        </td>

                        <td>
                          <strong dir="ltr">{item.productCode ?? "—"}</strong>

                          <small dir="ltr">{item.barcode ?? "—"}</small>
                        </td>

                        <td>
                          <strong>{item.color ?? "—"}</strong>

                          <small>{item.size ?? "—"}</small>
                        </td>

                        <td>{formatMoney(item.soldUnitPriceMinor)}</td>

                        <td>{item.soldQuantity}</td>

                        <td>{item.returnedQuantity}</td>

                        <td>{item.returnableQuantity}</td>

                        <td>
                          <input
                            className="sales-return-quantity-input"
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={item.returnableQuantity}
                            step={1}
                            value={selectedQuantity}
                            disabled={
                              submitBusy || item.returnableQuantity === 0
                            }
                            onChange={(event) =>
                              updateQuantity(
                                item.id,
                                Number(event.target.value),
                                item.returnableQuantity,
                              )
                            }
                          />
                        </td>

                        <td>
                          <strong>
                            {formatMoney(
                              item.soldUnitPriceMinor * selectedQuantity,
                            )}
                          </strong>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>

          {!preview.summary.fullyReturned && (
            <article className="sales-return-completion-panel">
              <div className="sales-return-form-grid">
                <label className="sales-return-field">
                  <span>سبب المرتجع</span>

                  <select
                    value={reason}
                    disabled={submitBusy}
                    onChange={(event) => {
                      setReason(event.target.value);

                      setCompletedReturn(null);
                      setIdempotencyKey(createIdempotencyKey());
                    }}
                  >
                    <option value="">اختر السبب</option>

                    <option value="تبديل المقاس أو اللون">
                      تبديل المقاس أو اللون
                    </option>

                    <option value="المقاس غير مناسب">المقاس غير مناسب</option>

                    <option value="المنتج غير مناسب">المنتج غير مناسب</option>

                    <option value="وجود عيب في المنتج">
                      وجود عيب في المنتج
                    </option>

                    <option value="سبب آخر">سبب آخر</option>
                  </select>
                </label>

                <label className="sales-return-field sales-return-notes">
                  <span>
                    ملاحظات
                    <small> اختيارية</small>
                  </span>

                  <textarea
                    rows={3}
                    maxLength={1000}
                    value={notes}
                    disabled={submitBusy}
                    onChange={(event) => {
                      setNotes(event.target.value);

                      setCompletedReturn(null);
                      setIdempotencyKey(createIdempotencyKey());
                    }}
                    placeholder="تفاصيل إضافية عن المرتجع"
                  />
                </label>
              </div>

              <div className="sales-return-final-row">
                <div className="sales-return-estimate">
                  <div>
                    <span>القطع المحددة</span>
                    <strong>{selectedPieces}</strong>
                  </div>

                  <div>
                    <span>القيمة قبل توزيع الخصم</span>

                    <strong>{formatMoney(selectedGrossMinor)}</strong>
                  </div>

                  <p>
                    مبلغ الاسترداد النهائي يُحسب حسب سعر البيع والخصم الأصلي
                    للفاتورة.
                  </p>
                </div>

                <button
                  className="primary-button sales-return-submit"
                  type="submit"
                  disabled={
                    submitBusy ||
                    selectedPieces === 0 ||
                    reason.trim().length < 2
                  }
                >
                  {submitBusy ? "جاري تنفيذ المرتجع…" : "تنفيذ المرتجع"}
                </button>
              </div>
            </article>
          )}
        </form>
      )}
    </section>
  );
}
