import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { usePosRuntime } from "../../app/pos-context";
import SaleReceipt from "../../components/SaleReceipt";
import {
  ApiError,
  getPosSaleByPublicId,
  type PosSaleResult,
} from "../../lib/api";
import { formatDateTime, formatMinor } from "../../lib/format";
import { printReceiptElementDirect } from "../../lib/directReceiptPrint";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "حدث خطأ غير متوقع";
}

function stockText(before: number | null, after: number | null) {
  if (before === null && after === null) {
    return "غير محدد";
  }

  return `${before ?? "—"} ← ${after ?? "—"}`;
}

function printReceipt() {
  document.body.dataset.printMode = "receipt";

  const cleanup = () => {
    delete document.body.dataset.printMode;
  };

  window.addEventListener("afterprint", cleanup, { once: true });

  window.print();
}

export default function InvoiceLookupPage() {
  const { token, clearAuthentication } = usePosRuntime();

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const queryPublicId =
    searchParams.get("publicId")?.trim().toUpperCase() ?? "";
  const openedFromToday = searchParams.get("from") === "today";

  const inputRef = useRef<HTMLInputElement>(null);
  const receiptRef = useRef<HTMLElement>(null);

  const [publicId, setPublicId] = useState("");

  const [busy, setBusy] = useState(false);

  const [error, setError] = useState("");

  const [result, setResult] = useState<PosSaleResult | null>(null);

  useEffect(() => {
    if (queryPublicId) {
      setPublicId(queryPublicId);
      void loadInvoice(queryPublicId);
      return;
    }

    inputRef.current?.focus();
  }, [queryPublicId]);

  async function loadInvoice(rawValue: string) {
    const value = rawValue.trim().toUpperCase();

    if (!value) {
      setError("امسح باركود الفاتورة أو أدخل رقمها.");
      inputRef.current?.focus();
      return;
    }

    setBusy(true);
    setError("");
    setResult(null);

    try {
      const response = await getPosSaleByPublicId(token, value);

      setResult(response);
      setPublicId(response.sale.publicId);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        clearAuthentication();
        return;
      }

      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadInvoice(publicId);
  }

  function navigateToInvoice(targetPublicId: string) {
    const fromToday = openedFromToday ? "&from=today" : "";

    navigate(
      `/sales/invoice-check?publicId=${encodeURIComponent(targetPublicId)}${fromToday}`,
    );
  }

  async function handleDirectReceiptPrint() {
    const source = receiptRef.current;

    if (!source) {
      setError("تعذر تجهيز الإيصال للطباعة.");
      return;
    }

    try {
      setError("");
      await printReceiptElementDirect(source);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <section className="invoice-lookup-page">
      <div className="panel-heading">
        <div className="panel-icon">🔎</div>

        <div>
          <h2>فحص فاتورة</h2>

          <p>امسح الباركود الموجود أسفل إيصال الزبون أو أدخل رقم الفاتورة.</p>
        </div>
      </div>

      <form className="standalone-invoice-form" onSubmit={handleSearch}>
        <input
          ref={inputRef}
          dir="ltr"
          autoComplete="off"
          value={publicId}
          onChange={(event) => setPublicId(event.target.value)}
          placeholder="POS-YYYYMMDD-XXXXXXXXXXXX"
          disabled={busy}
        />

        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? "جاري البحث…" : "عرض الفاتورة"}
        </button>
      </form>

      {error && (
        <div className="alert error-alert invoice-page-alert">{error}</div>
      )}

      {!result && !error && (
        <div className="invoice-page-empty">
          تفاصيل الفاتورة ستظهر هنا بعد مسح الباركود.
        </div>
      )}

      {result && (
        <>
          <div className="invoice-sequence-navigation">
            <button
              className="secondary-button"
              type="button"
              disabled={!result.navigation?.previousPublicId || busy}
              onClick={() => {
                const target = result.navigation?.previousPublicId;

                if (target) {
                  navigateToInvoice(target);
                }
              }}
            >
              ← الفاتورة السابقة
            </button>

            {openedFromToday ? (
              <button
                className="secondary-button invoice-list-button"
                type="button"
                onClick={() => navigate("/sales/today")}
              >
                العودة إلى مبيعات اليوم
              </button>
            ) : (
              <span className="invoice-sequence-label">
                التنقل بين فواتير المحل
              </span>
            )}

            <button
              className="secondary-button"
              type="button"
              disabled={!result.navigation?.nextPublicId || busy}
              onClick={() => {
                const target = result.navigation?.nextPublicId;

                if (target) {
                  navigateToInvoice(target);
                }
              }}
            >
              الفاتورة التالية →
            </button>
          </div>

          <div className="invoice-print-actions">
            <div>
              <strong>الفاتورة جاهزة للطباعة</strong>

              <span>إيصال حراري مختصر بعرض 56mm.</span>
            </div>

            <button
              className="secondary-button"
              type="button"
              onClick={() => void handleDirectReceiptPrint()}
            >
              إعادة طباعة مباشرة
            </button>

            <button
              className="secondary-button"
              type="button"
              onClick={printReceipt}
            >
              طباعة عبر المتصفح
            </button>
          </div>

          <article className="standalone-invoice-result">
            <div className="standalone-invoice-summary">
              <div>
                <span>رقم الفاتورة</span>

                <strong dir="ltr">{result.sale.publicId}</strong>
              </div>

              <div>
                <span>التاريخ والوقت</span>

                <strong>{formatDateTime(result.sale.createdAt)}</strong>
              </div>

              <div>
                <span>اسم الزبون</span>

                <strong>{result.sale.customerName || "زبون نقدي"}</strong>
              </div>

              <div>
                <span>حالة الفاتورة</span>

                <strong>
                  {result.sale.status === "completed"
                    ? "مكتملة"
                    : result.sale.status}
                </strong>
              </div>

              <div>
                <span>الإجمالي</span>

                <strong>{formatMinor(result.sale.totalMinor)}</strong>
              </div>
            </div>

            <div className="standalone-invoice-items">
              {result.items.map((item) => (
                <div className="standalone-invoice-item" key={item.id}>
                  <div>
                    <strong>{item.productNameAr}</strong>

                    <span>الكود: {item.productCode ?? "—"}</span>

                    <span dir="ltr">الباركود: {item.barcode ?? "—"}</span>
                  </div>

                  <div>
                    <span>اللون: {item.color ?? "—"}</span>

                    <span>المقاس: {item.size ?? "—"}</span>

                    <span>الكمية: {item.quantity}</span>
                  </div>

                  <div>
                    <span>
                      سعر البيع: {formatMinor(item.soldUnitPriceMinor)}
                    </span>

                    <span>مجموع الصنف: {formatMinor(item.lineTotalMinor)}</span>
                  </div>

                  <div>
                    <span>
                      المخزون العام:{" "}
                      {stockText(
                        item.generalStockBefore,
                        item.generalStockAfter,
                      )}
                    </span>

                    <span>
                      مخزون المتغير:{" "}
                      {stockText(
                        item.variantStockBefore,
                        item.variantStockAfter,
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="standalone-invoice-totals">
              <div>
                <span>مجموع الأصناف</span>

                <strong>{formatMinor(result.sale.subtotalMinor)}</strong>
              </div>

              <div>
                <span>الخصم</span>

                <strong>{formatMinor(result.sale.discountMinor)}</strong>
              </div>

              <div>
                <span>الإجمالي النهائي</span>

                <strong>{formatMinor(result.sale.totalMinor)}</strong>
              </div>

              <div>
                <span>المدفوع</span>

                <strong>{formatMinor(result.sale.paidMinor)}</strong>
              </div>

              <div>
                <span>الباقي</span>

                <strong>{formatMinor(result.sale.changeMinor)}</strong>
              </div>
            </div>

            {result.sale.notes && (
              <div className="standalone-invoice-note">
                <strong>ملاحظات</strong>
                <p>{result.sale.notes}</p>
              </div>
            )}
          </article>

          <SaleReceipt result={result} isReprint receiptRef={receiptRef} />
        </>
      )}
    </section>
  );
}
