import { useEffect, useMemo, useState, type FormEvent } from "react";
import JsBarcode from "jsbarcode";
import { useNavigate } from "react-router-dom";

import {
  ApiError,
  getPosSaleByPublicId,
  getTodayPosSales,
  type CashSession,
  type PosSaleItemResult,
  type PosSaleResult,
} from "./lib/api";

interface TodaySalesPanelProps {
  token: string;
  session: CashSession;
  refreshKey: string;
  onUnauthorized: () => void;
}

interface ReportRow {
  sale: PosSaleResult["sale"];
  item: PosSaleItemResult;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "حدث خطأ غير متوقع";
}

function formatMinor(value: number) {
  return new Intl.NumberFormat("ar-PS", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 2,
  }).format(value / 100);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ar-PS", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Hebron",
  }).format(new Date(value));
}

function stockText(before: number | null, after: number | null) {
  if (before === null && after === null) {
    return "غير محدد";
  }

  return `${before ?? "—"} ← ${after ?? "—"}`;
}

function renderBarcode(
  element: SVGSVGElement | null,
  value: string | null,
  printReport = false,
) {
  if (!element || !value) {
    return;
  }

  try {
    JsBarcode(element, value, {
      format: "CODE128",
      width: printReport ? 1.05 : 1,
      height: printReport ? 25 : 30,
      margin: 0,
      displayValue: printReport,
      fontSize: 8,
      textMargin: 1,
    });
  } catch {
    element.innerHTML = "";
  }
}

function printDailyReport() {
  document.body.dataset.printMode = "daily-sales";

  const cleanup = () => {
    delete document.body.dataset.printMode;
  };

  window.addEventListener("afterprint", cleanup, { once: true });

  window.print();
}

export default function TodaySalesPanel({
  token,
  session,
  refreshKey,
  onUnauthorized,
}: TodaySalesPanelProps) {
  const navigate = useNavigate();

  const [sales, setSales] = useState<PosSaleResult[]>([]);

  const [loading, setLoading] = useState(true);

  const [loadError, setLoadError] = useState("");

  const [invoiceSearch, setInvoiceSearch] = useState("");

  const [searchBusy, setSearchBusy] = useState(false);

  const [searchError, setSearchError] = useState("");

  const [selectedSale, setSelectedSale] = useState<PosSaleResult | null>(null);

  const rows = useMemo<ReportRow[]>(
    () =>
      sales.flatMap((result) =>
        result.items.map((item) => ({
          sale: result.sale,
          item,
        })),
      ),
    [sales],
  );

  const totalPieces = useMemo(
    () => rows.reduce((total, row) => total + row.item.quantity, 0),
    [rows],
  );

  const subtotalMinor = useMemo(
    () => sales.reduce((total, result) => total + result.sale.subtotalMinor, 0),
    [sales],
  );

  const discountMinor = useMemo(
    () => sales.reduce((total, result) => total + result.sale.discountMinor, 0),
    [sales],
  );

  const netTotalMinor = useMemo(
    () => sales.reduce((total, result) => total + result.sale.totalMinor, 0),
    [sales],
  );

  async function loadTodaySales() {
    setLoading(true);
    setLoadError("");

    try {
      const result = await getTodayPosSales(token, session.registerKey);

      setSales(result.sales);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onUnauthorized();
        return;
      }

      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTodaySales();
  }, [token, session.registerKey, refreshKey]);

  async function handleInvoiceSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const value = invoiceSearch.trim().toUpperCase();

    if (!value) {
      setSearchError("امسح باركود الفاتورة أو أدخل رقمها");
      return;
    }

    setSearchBusy(true);
    setSearchError("");
    setSelectedSale(null);

    try {
      const result = await getPosSaleByPublicId(token, value);

      setSelectedSale(result);
      setInvoiceSearch(result.sale.publicId);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onUnauthorized();
        return;
      }

      setSearchError(errorMessage(error));
    } finally {
      setSearchBusy(false);
    }
  }

  function openSaleInvoice(publicId: string) {
    navigate(
      `/sales/invoice-check?publicId=${encodeURIComponent(publicId)}&from=today`,
    );
  }

  return (
    <>
      <section className="today-sales-panel" id="pos-today-sales">
        <div className="today-sales-heading">
          <div className="panel-heading">
            <div className="panel-icon">📋</div>

            <div>
              <h2>مبيعات اليوم</h2>
              <p>مراجعة الفواتير وطباعة تقرير الإدخال إلى برنامج المحاسبة.</p>
            </div>
          </div>

          <div className="today-sales-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={loading}
              onClick={() => void loadTodaySales()}
            >
              {loading ? "جاري التحديث…" : "تحديث"}
            </button>

            <button
              className="primary-button"
              type="button"
              disabled={loading || rows.length === 0}
              onClick={printDailyReport}
            >
              طباعة تقرير A4
            </button>
          </div>
        </div>

        <div className="today-summary">
          <div>
            <span>عدد الفواتير</span>
            <strong>{sales.length}</strong>
          </div>

          <div>
            <span>عدد القطع</span>
            <strong>{totalPieces}</strong>
          </div>

          <div>
            <span>قبل الخصم</span>
            <strong>{formatMinor(subtotalMinor)}</strong>
          </div>

          <div>
            <span>الخصومات</span>
            <strong>{formatMinor(discountMinor)}</strong>
          </div>

          <div>
            <span>صافي المبيعات</span>
            <strong>{formatMinor(netTotalMinor)}</strong>
          </div>
        </div>

        {loadError && <div className="alert error-alert">{loadError}</div>}

        {!loading && !loadError && rows.length === 0 && (
          <div className="empty-cart">
            لا توجد مبيعات مسجلة في جلسة اليوم حتى الآن.
          </div>
        )}

        {rows.length > 0 && (
          <div className="today-sales-table-wrap">
            <table className="today-sales-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>اسم الصنف</th>
                  <th>الكود</th>
                  <th>الباركود</th>
                  <th>الكمية</th>
                  <th>السعر</th>
                  <th>اسم الزبون</th>
                  <th>ملاحظات</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((row, index) => (
                  <tr
                    key={`${row.sale.id}-${row.item.id}`}
                    className="today-sale-clickable-row"
                    role="button"
                    tabIndex={0}
                    title="فتح الفاتورة"
                    aria-label={`فتح الفاتورة ${row.sale.publicId}`}
                    onClick={() => openSaleInvoice(row.sale.publicId)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openSaleInvoice(row.sale.publicId);
                      }
                    }}
                  >
                    <td>{index + 1}</td>

                    <td>
                      <strong>{row.item.productNameAr}</strong>

                      <small dir="ltr">{row.sale.publicId}</small>
                    </td>

                    <td dir="ltr">{row.item.productCode ?? "—"}</td>

                    <td dir="ltr">{row.item.barcode ?? "—"}</td>

                    <td>{row.item.quantity}</td>

                    <td>{formatMinor(row.item.soldUnitPriceMinor)}</td>

                    <td>{row.sale.customerName || "زبون نقدي"}</td>

                    <td>{row.sale.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="invoice-search-block">
          <div>
            <h3>البحث بباركود الفاتورة</h3>

            <p>
              امسح الباركود الموجود أسفل إيصال الزبون لإظهار جميع التفاصيل
              الداخلية.
            </p>
          </div>

          <form className="invoice-search-form" onSubmit={handleInvoiceSearch}>
            <input
              dir="ltr"
              autoComplete="off"
              value={invoiceSearch}
              onChange={(event) => setInvoiceSearch(event.target.value)}
              placeholder="POS-YYYYMMDD-XXXXXXXXXXXX"
              disabled={searchBusy}
            />

            <button
              className="secondary-button"
              type="submit"
              disabled={searchBusy}
            >
              {searchBusy ? "جاري البحث…" : "عرض الفاتورة"}
            </button>
          </form>

          {searchError && (
            <div className="alert error-alert">{searchError}</div>
          )}

          {selectedSale && (
            <article className="invoice-details">
              <div className="invoice-details-header">
                <div>
                  <span>رقم الفاتورة</span>
                  <strong dir="ltr">{selectedSale.sale.publicId}</strong>
                </div>

                <div>
                  <span>التاريخ والوقت</span>
                  <strong>{formatDateTime(selectedSale.sale.createdAt)}</strong>
                </div>

                <div>
                  <span>اسم الزبون</span>
                  <strong>
                    {selectedSale.sale.customerName || "زبون نقدي"}
                  </strong>
                </div>

                <div>
                  <span>الإجمالي</span>
                  <strong>{formatMinor(selectedSale.sale.totalMinor)}</strong>
                </div>
              </div>

              <div className="invoice-internal-items">
                {selectedSale.items.map((item) => (
                  <div className="invoice-internal-item" key={item.id}>
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

                      <span>المجموع: {formatMinor(item.lineTotalMinor)}</span>
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
                        مخزون اللون/المقاس:{" "}
                        {stockText(
                          item.variantStockBefore,
                          item.variantStockAfter,
                        )}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {selectedSale.sale.notes && (
                <div className="invoice-note">
                  <strong>ملاحظات</strong>
                  <p>{selectedSale.sale.notes}</p>
                </div>
              )}
            </article>
          )}
        </div>
      </section>

      <section className="daily-sales-print-area" dir="rtl">
        <header className="daily-report-header">
          <div>
            <h1>Lovely Kids</h1>
            <p>تقرير مبيعات اليوم</p>
          </div>

          <div>
            <span>تاريخ العمل: {session.businessDate}</span>

            <span>الصندوق: {session.registerKey}</span>
          </div>
        </header>

        <div className="daily-report-summary">
          <span>الفواتير: {sales.length}</span>

          <span>القطع: {totalPieces}</span>

          <span>قبل الخصم: {formatMinor(subtotalMinor)}</span>

          <span>الخصومات: {formatMinor(discountMinor)}</span>

          <strong>الصافي: {formatMinor(netTotalMinor)}</strong>
        </div>

        <table className="daily-report-table">
          <thead>
            <tr>
              <th>الترتيب</th>
              <th>اسم الصنف</th>
              <th>الكود</th>
              <th>الباركود</th>
              <th>الكمية</th>
              <th>السعر</th>
              <th>اسم الزبون</th>
              <th>ملاحظات</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row, index) => (
              <tr key={`print-${row.sale.id}-${row.item.id}`}>
                <td>{index + 1}</td>

                <td>{row.item.productNameAr}</td>

                <td dir="ltr">{row.item.productCode ?? "—"}</td>

                <td className="daily-report-barcode">
                  {row.item.barcode ? (
                    <svg
                      ref={(element) =>
                        renderBarcode(element, row.item.barcode, true)
                      }
                    />
                  ) : (
                    "—"
                  )}
                </td>

                <td>{row.item.quantity}</td>

                <td>{row.item.soldUnitPrice.toFixed(2)} ₪</td>

                <td>{row.sale.customerName || "زبون نقدي"}</td>

                <td>{row.sale.notes || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <footer className="daily-report-footer">
          تمت طباعة التقرير:{" "}
          {new Intl.DateTimeFormat("ar-PS", {
            dateStyle: "short",
            timeStyle: "short",
            timeZone: "Asia/Hebron",
          }).format(new Date())}
        </footer>
      </section>
    </>
  );
}
