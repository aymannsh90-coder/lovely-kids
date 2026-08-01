import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { usePosRuntime } from "../../app/pos-context";
import {
  ApiError,
  lookupPosProductByBarcode,
  searchPosProducts,
  type PosProductLookup,
} from "../../lib/api";

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

function moneyToMinor(value: string) {
  const amount = Number(value.trim().replace(",", "."));

  if (!Number.isFinite(amount) || amount < 0) {
    return 0;
  }

  return Math.round(amount * 100);
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

export default function SalesInvoicePage() {
  const { token, clearAuthentication } = usePosRuntime();
  const searchInput = useRef<HTMLInputElement>(null);
  const tableWrap = useRef<HTMLDivElement>(null);
  const lastTouchedLineId = useRef<string | null>(null);
  const [revealVersion, setRevealVersion] = useState(0);

  const [invoiceDateTime, setInvoiceDateTime] = useState(getLocalDateTimeValue);
  const [invoiceType, setInvoiceType] = useState("cash");
  const [warehouse, setWarehouse] = useState("main");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [representative, setRepresentative] = useState("");
  const [notes, setNotes] = useState("");

  const [query, setQuery] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<PosProductLookup[]>([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);

  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [invoiceDiscount, setInvoiceDiscount] = useState("0.00");
  const [paidAmount, setPaidAmount] = useState("0.00");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [costCenter, setCostCenter] = useState("general");

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

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
      line.product.mappedSize ?? (sizes.length === 1 ? sizes[0] : null);

    updateLine(line.id, {
      color,
      size,
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
            line.barcode === product.barcode &&
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
                quantity: Math.min(999, line.quantity + 1),
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
          barcode: product.barcode,
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

    const value = query.trim();

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

  function handleNewInvoice() {
    setInvoiceDateTime(getLocalDateTimeValue());
    setInvoiceType("cash");
    setWarehouse("main");
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

  return (
    <section className="accounting-invoice-page">
      <header className="accounting-invoice-titlebar">
        <div>
          <span>الفواتير</span>
          <h1>فاتورة مبيعات</h1>
          <p>واجهة محاسبية تفصيلية لإدخال ومراجعة فاتورة المبيعات.</p>
        </div>

        <span className="accounting-invoice-draft-badge">
          واجهة أولية — الحفظ غير مفعّل
        </span>
      </header>

      <div className="accounting-invoice-toolbar">
        <button type="button" onClick={handleNewInvoice}>
          <span aria-hidden="true">＋</span>
          جديد
        </button>

        <button type="button" disabled>
          <span aria-hidden="true">💾</span>
          حفظ
        </button>

        <button type="button" disabled>
          <span aria-hidden="true">🖨️</span>
          حفظ وطباعة
        </button>

        <button type="button" disabled>
          <span aria-hidden="true">👁️</span>
          معاينة الطباعة
        </button>

        <button type="button" disabled>
          <span aria-hidden="true">✕</span>
          حذف
        </button>
      </div>

      <section className="accounting-invoice-information">
        <div className="accounting-invoice-card">
          <h2>بيانات الفاتورة</h2>

          <div className="accounting-fields-grid">
            <label>
              <span>رقم الفاتورة</span>
              <input value="تلقائي عند الحفظ" readOnly />
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
                <option value="cash">نقدية</option>
                <option value="credit">آجلة</option>
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
            <label className="accounting-wide-field">
              <span>اسم الزبون</span>
              <input
                placeholder="زبون نقدي"
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
              />
            </label>

            <label>
              <span>رقم الهاتف</span>
              <input
                dir="ltr"
                inputMode="tel"
                value={customerPhone}
                onChange={(event) => setCustomerPhone(event.target.value)}
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
              البحث والإضافة محليان داخل الفاتورة، والحفظ غير مفعّل.
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
                    <img src={product.image} alt="" />

                    <div>
                      <strong>{product.nameAr}</strong>

                      <span>
                        الكود: {product.productCode ?? "—"} · الباركود:{" "}
                        <b dir="ltr">{product.barcode}</b>
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
                      <img src={line.product.image} alt="" />

                      <div>
                        <strong>{line.product.nameAr}</strong>
                        <small>المخزون: {stock ?? "غير محدد"}</small>
                      </div>
                    </td>

                    <td>
                      {colors.length > 0 ? (
                        <select
                          value={line.color ?? ""}
                          disabled={!!line.product.mappedColor}
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
                          value={line.size ?? ""}
                          disabled={!!line.product.mappedSize}
                          onChange={(event) =>
                            updateLine(line.id, {
                              size: event.target.value || null,
                            })
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
                        dir="ltr"
                        type="number"
                        min="1"
                        max="999"
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
                onChange={(event) => setPaymentMethod(event.target.value)}
              >
                <option value="cash">نقدي</option>
                <option value="card">بطاقة</option>
                <option value="mixed">دفع مختلط</option>
              </select>
            </label>

            <label>
              <span>المبلغ المدفوع</span>
              <div className="accounting-money-input">
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
            <span>الباقي</span>
            <strong dir="ltr">{formatMinor(changeMinor)}</strong>
          </div>
        </div>
      </section>
    </section>
  );
}
