import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import JsBarcode from "jsbarcode";

import {
  ApiError,
  createPosSale,
  getCurrentCashSession,
  lookupPosProductByBarcode,
  type CashSession,
  type PosProductLookup,
  type PosSaleResult,
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

function formatMinor(value: number) {
  return new Intl.NumberFormat("ar-PS", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 2,
  }).format(value / 100);
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

export default function SalePanel({
  token,
  session,
  cashierName,
  onSessionChange,
  onUnauthorized,
}: SalePanelProps) {
  const barcodeInput = useRef<HTMLInputElement>(null);

  const idempotencyKey = useRef<string | null>(null);

  const [barcode, setBarcode] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);

  const [discountAmount, setDiscountAmount] = useState("0.00");

  const [paidAmount, setPaidAmount] = useState("0.00");

  const [customerName, setCustomerName] = useState("");

  const [customerPhone, setCustomerPhone] = useState("");

  const [notes, setNotes] = useState("");

  const [lookupBusy, setLookupBusy] = useState(false);

  const [saleBusy, setSaleBusy] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [lastSale, setLastSale] = useState<PosSaleResult | null>(null);

  const subtotalMinor = useMemo(
    () =>
      cart.reduce((total, line) => {
        const price = moneyToMinor(line.soldUnitPrice) ?? 0;

        return total + price * line.quantity;
      }, 0),
    [cart],
  );

  const discountMinor = moneyToMinor(discountAmount) ?? 0;

  const totalMinor = Math.max(0, subtotalMinor - discountMinor);

  const paidMinor = moneyToMinor(paidAmount) ?? 0;

  const changeMinor = Math.max(0, paidMinor - totalMinor);

  useEffect(() => {
    barcodeInput.current?.focus();
  }, []);

  useEffect(() => {
    setPaidAmount((totalMinor / 100).toFixed(2));
  }, [totalMinor]);

  async function handleBarcode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const value = barcode.trim();

    if (!value) {
      setError("أدخل الباركود");
      barcodeInput.current?.focus();
      return;
    }

    setLookupBusy(true);
    setError("");
    setMessage("");

    try {
      const product = await lookupPosProductByBarcode(token, value);

      const colors = getColors(product);

      const color =
        product.mappedColor ?? (colors.length === 1 ? colors[0] : null);

      const sizes = getSizes(product, color);

      const size = product.mappedSize ?? (sizes.length === 1 ? sizes[0] : null);

      setCart((current) => {
        const existing = current.findIndex(
          (line) =>
            line.barcode === product.barcode &&
            line.color === color &&
            line.size === size,
        );

        if (existing >= 0) {
          return current.map((line, index) =>
            index === existing
              ? {
                  ...line,
                  quantity: line.quantity + 1,
                }
              : line,
          );
        }

        return [
          ...current,
          {
            id: createKey(),
            barcode: product.barcode,
            product,
            color,
            size,
            quantity: 1,
            soldUnitPrice: product.websiteUnitPrice.toFixed(2),
          },
        ];
      });

      setBarcode("");
      setMessage(`تمت إضافة ${product.nameAr}`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        onUnauthorized();
        return;
      }

      setError(errorMessage(caught));
    } finally {
      setLookupBusy(false);

      window.setTimeout(() => barcodeInput.current?.focus(), 0);
    }
  }

  function updateLine(id: string, patch: Partial<CartLine>) {
    setCart((current) =>
      current.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    );
  }

  function changeColor(line: CartLine, colorValue: string) {
    const color = colorValue || null;
    const sizes = getSizes(line.product, color);

    updateLine(line.id, {
      color,
      size: sizes.length === 1 ? sizes[0] : null,
    });
  }

  async function completeSale() {
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

    if (discountMinor > subtotalMinor) {
      setError("الخصم أكبر من مجموع الفاتورة");
      return;
    }

    if (paidMinor < totalMinor) {
      setError("المبلغ المدفوع أقل من قيمة الفاتورة");
      return;
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
        paymentMethod: "cash",

        discountAmount: discountAmount.trim(),

        paidAmount: paidAmount.trim(),

        customerName: customerName.trim() || undefined,

        customerPhone: customerPhone.trim() || undefined,

        notes: notes.trim() || undefined,

        items: cart.map((line) => ({
          barcode: line.barcode,
          quantity: line.quantity,

          soldUnitPrice: line.soldUnitPrice.trim(),

          color: line.color ?? undefined,

          size: line.size ?? undefined,
        })),
      });

      idempotencyKey.current = null;
      setLastSale(result);
      setCart([]);
      setDiscountAmount("0.00");
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

  return (
    <>
      <section className="sale-panel" id="pos-sale">
        <div className="panel-heading">
          <div className="panel-icon">🧾</div>

          <div>
            <h2>فاتورة مبيعات</h2>
            <p>امسح الباركود ثم راجع الكمية والسعر قبل إتمام البيع.</p>
          </div>
        </div>

        <form className="barcode-form" onSubmit={handleBarcode}>
          <label>
            <span>مسح أو إدخال الباركود</span>

            <input
              ref={barcodeInput}
              dir="ltr"
              autoComplete="off"
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
              placeholder="امسح الباركود هنا"
              disabled={lookupBusy}
            />
          </label>

          <button
            className="primary-button"
            type="submit"
            disabled={lookupBusy}
          >
            {lookupBusy ? "جاري البحث…" : "إضافة الصنف"}
          </button>
        </form>

        {error && <div className="alert error-alert sale-alert">{error}</div>}

        {message && (
          <div className="alert success-alert sale-alert">{message}</div>
        )}

        {cart.length === 0 ? (
          <div className="empty-cart">لم تتم إضافة أصناف إلى الفاتورة بعد.</div>
        ) : (
          <div className="sale-cart">
            {cart.map((line) => {
              const colors = getColors(line.product);

              const sizes = getSizes(line.product, line.color);

              const availability = getLineAvailability(line);

              return (
                <article className="sale-line" key={line.id}>
                  <img src={line.product.image} alt="" />

                  <div className="sale-line-main">
                    <strong>{line.product.nameAr}</strong>

                    <div className="sale-line-meta">
                      <span dir="ltr">{line.barcode}</span>

                      <span>الكود: {line.product.productCode ?? "—"}</span>

                      <span>المخزون: {availability.stock ?? "غير محدد"}</span>
                    </div>

                    <div className="sale-line-fields">
                      {colors.length > 0 && (
                        <label>
                          <span>اللون</span>

                          <select
                            value={line.color ?? ""}
                            onChange={(event) =>
                              changeColor(line, event.target.value)
                            }
                            disabled={!!line.product.mappedColor}
                          >
                            <option value="">اختر اللون</option>

                            {colors.map((color) => (
                              <option key={color} value={color}>
                                {color}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}

                      {sizes.length > 0 && (
                        <label>
                          <span>المقاس</span>

                          <select
                            value={line.size ?? ""}
                            onChange={(event) =>
                              updateLine(line.id, {
                                size: event.target.value || null,
                              })
                            }
                            disabled={!!line.product.mappedSize}
                          >
                            <option value="">اختر المقاس</option>

                            {sizes.map((size) => (
                              <option key={size} value={size}>
                                {size}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}

                      <label>
                        <span>الكمية</span>

                        <input
                          dir="ltr"
                          type="number"
                          min="1"
                          max="99"
                          step="1"
                          value={line.quantity}
                          onChange={(event) =>
                            updateLine(line.id, {
                              quantity: Number(event.target.value),
                            })
                          }
                        />
                      </label>

                      <label>
                        <span>سعر البيع</span>

                        <div className="money-input">
                          <input
                            dir="ltr"
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.soldUnitPrice}
                            onChange={(event) =>
                              updateLine(line.id, {
                                soldUnitPrice: event.target.value,
                              })
                            }
                          />

                          <span>₪</span>
                        </div>
                      </label>
                    </div>
                  </div>

                  <div className="sale-line-total">
                    <strong>
                      {formatMinor(
                        (moneyToMinor(line.soldUnitPrice) ?? 0) * line.quantity,
                      )}
                    </strong>

                    <button
                      type="button"
                      onClick={() =>
                        setCart((current) =>
                          current.filter((item) => item.id !== line.id),
                        )
                      }
                    >
                      حذف
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <div className="sale-checkout">
          <div className="sale-customer-fields">
            <label>
              <span>
                اسم الزبون
                <small> اختياري</small>
              </span>

              <input
                maxLength={150}
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
              />
            </label>

            <label>
              <span>
                هاتف الزبون
                <small> اختياري</small>
              </span>

              <input
                dir="ltr"
                maxLength={50}
                inputMode="tel"
                value={customerPhone}
                onChange={(event) => setCustomerPhone(event.target.value)}
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

          <div className="sale-summary">
            <div>
              <span>مجموع الأصناف</span>
              <strong>{formatMinor(subtotalMinor)}</strong>
            </div>

            <label>
              <span>الخصم</span>

              <div className="money-input">
                <input
                  dir="ltr"
                  type="number"
                  min="0"
                  step="0.01"
                  value={discountAmount}
                  onChange={(event) => setDiscountAmount(event.target.value)}
                />

                <span>₪</span>
              </div>
            </label>

            <div className="sale-grand-total">
              <span>الإجمالي النهائي</span>
              <strong>{formatMinor(totalMinor)}</strong>
            </div>

            <label>
              <span>المبلغ المدفوع</span>

              <div className="money-input">
                <input
                  dir="ltr"
                  type="number"
                  min="0"
                  step="0.01"
                  value={paidAmount}
                  onChange={(event) => setPaidAmount(event.target.value)}
                />

                <span>₪</span>
              </div>
            </label>

            <div>
              <span>الباقي للزبون</span>
              <strong>{formatMinor(changeMinor)}</strong>
            </div>

            <button
              className="primary-button complete-sale-button"
              type="button"
              disabled={saleBusy || cart.length === 0}
              onClick={() => void completeSale()}
            >
              {saleBusy ? "جاري حفظ البيع…" : "إتمام البيع وخصم المخزون"}
            </button>
          </div>
        </div>

        {lastSale && (
          <div className="last-sale-actions">
            <div>
              <strong>آخر فاتورة: {lastSale.sale.publicId}</strong>

              <span>الإجمالي: {formatMinor(lastSale.sale.totalMinor)}</span>
            </div>

            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                document.body.dataset.printMode = "receipt";

                const cleanup = () => {
                  delete document.body.dataset.printMode;
                };

                window.addEventListener("afterprint", cleanup, { once: true });

                window.print();
              }}
            >
              طباعة إيصال 56mm
            </button>
          </div>
        )}
      </section>

      {lastSale && (
        <section className="receipt-print-area" dir="rtl">
          <header className="receipt-header">
            <strong>Lovely Kids</strong>
            <span>ملابس ومستلزمات الأطفال</span>
            <span>نابلس - المركز التجاري</span>
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

            <span>الزبون: {lastSale.sale.customerName || "زبون نقدي"}</span>

            <span>الكاشير: {cashierName}</span>

            <span>طريقة الدفع: نقدي</span>
          </div>

          <div className="receipt-divider" />

          <div className="receipt-items">
            {lastSale.items.map((item) => (
              <div className="receipt-item" key={item.id}>
                <strong>{item.productNameAr}</strong>

                <span>الكود: {item.productCode ?? "—"}</span>

                <div>
                  <span>
                    {item.quantity} × {item.soldUnitPrice.toFixed(2)}
                  </span>

                  <strong>{item.lineTotal.toFixed(2)} ₪</strong>
                </div>
              </div>
            ))}
          </div>

          <div className="receipt-divider" />

          <div className="receipt-totals">
            <div>
              <span>مجموع الأصناف</span>

              <strong>{lastSale.sale.subtotal.toFixed(2)} ₪</strong>
            </div>

            {lastSale.sale.discountMinor > 0 && (
              <div>
                <span>قيمة الخصم</span>

                <strong>{lastSale.sale.discount.toFixed(2)} ₪</strong>
              </div>
            )}

            <div className="receipt-total">
              <span>الإجمالي النهائي</span>

              <strong>{lastSale.sale.total.toFixed(2)} ₪</strong>
            </div>

            <div>
              <span>المدفوع</span>

              <strong>{lastSale.sale.paid.toFixed(2)} ₪</strong>
            </div>

            <div>
              <span>الباقي</span>

              <strong>{lastSale.sale.change.toFixed(2)} ₪</strong>
            </div>
          </div>

          <div className="receipt-invoice-barcode">
            <svg
              ref={(element) => {
                if (!element) return;

                try {
                  JsBarcode(element, lastSale.sale.publicId, {
                    format: "CODE128",
                    width: 1,
                    height: 34,
                    margin: 0,
                    displayValue: false,
                  });
                } catch {
                  element.innerHTML = "";
                }
              }}
            />

            <span dir="ltr">{lastSale.sale.publicId}</span>

            <small>امسح الباركود لاسترجاع تفاصيل الفاتورة</small>
          </div>

          <footer className="receipt-footer">
            <strong>شكرًا لتسوقكم من Lovely Kids</strong>

            <span>الاستبدال بالبضاعة السليمة حسب سياسة المتجر</span>
          </footer>
        </section>
      )}
    </>
  );
}
