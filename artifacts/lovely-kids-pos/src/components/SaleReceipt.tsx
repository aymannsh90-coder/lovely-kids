import JsBarcode from "jsbarcode";

import type { PosSaleResult } from "../lib/api";

interface SaleReceiptProps {
  result: PosSaleResult;
  isReprint?: boolean;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ar-PS", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Hebron",
  }).format(new Date(value));
}

function shortProductName(value: string) {
  return value.trim().split(/\s+/)[0] || "صنف";
}

function renderBarcode(element: SVGSVGElement | null, value: string) {
  if (!element) return;

  try {
    JsBarcode(element, value, {
      format: "CODE128",
      width: 1,
      height: 34,
      margin: 0,
      displayValue: false,
    });
  } catch {
    element.innerHTML = "";
  }
}

export default function SaleReceipt({
  result,
  isReprint = false,
}: SaleReceiptProps) {
  return (
    <section className="receipt-print-area" dir="rtl">
      <header className="receipt-header">
        <strong>Lovely Kids</strong>
        <span>ملابس ومستلزمات الأطفال</span>
        <span>نابلس - المركز التجاري</span>
        <span dir="ltr">09-2376808</span>

        {isReprint && <b className="receipt-copy-label">نسخة معاد طباعتها</b>}
      </header>

      <div className="receipt-divider" />

      <div className="receipt-info">
        <span>
          رقم الفاتورة:
          <b dir="ltr"> {result.sale.publicId}</b>
        </span>

        <span>التاريخ والوقت: {formatDateTime(result.sale.createdAt)}</span>

        <span>الزبون: {result.sale.customerName || "زبون نقدي"}</span>

        <span>طريقة الدفع: نقدي</span>
      </div>

      <div className="receipt-divider" />

      <table className="receipt-items-table">
        <thead>
          <tr>
            <th>#</th>
            <th>الصنف</th>
            <th>الكود</th>
            <th>الكمية</th>
            <th>السعر</th>
          </tr>
        </thead>

        <tbody>
          {result.items.map((item, index) => (
            <tr key={item.id}>
              <td>{index + 1}</td>

              <td>{shortProductName(item.productNameAr)}</td>

              <td dir="ltr">{item.productCode ?? "—"}</td>

              <td>{item.quantity}</td>

              <td dir="ltr">{item.lineTotal.toFixed(2)} ₪</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="receipt-divider" />

      <div className="receipt-totals">
        <div>
          <span>مجموع الأصناف</span>
          <strong>{result.sale.subtotal.toFixed(2)} ₪</strong>
        </div>

        {result.sale.discountMinor > 0 && (
          <div>
            <span>قيمة الخصم</span>
            <strong>{result.sale.discount.toFixed(2)} ₪</strong>
          </div>
        )}

        <div className="receipt-total">
          <span>الإجمالي النهائي</span>
          <strong>{result.sale.total.toFixed(2)} ₪</strong>
        </div>

        <div>
          <span>المدفوع</span>
          <strong>{result.sale.paid.toFixed(2)} ₪</strong>
        </div>

        <div>
          <span>الباقي</span>
          <strong>{result.sale.change.toFixed(2)} ₪</strong>
        </div>
      </div>

      <div className="receipt-invoice-barcode">
        <svg ref={(element) => renderBarcode(element, result.sale.publicId)} />

        <span dir="ltr">{result.sale.publicId}</span>

        <small>امسح الباركود لاسترجاع تفاصيل الفاتورة</small>
      </div>

      <footer className="receipt-footer">
        <strong>شكرًا لتسوقكم من Lovely Kids</strong>

        <span>الاستبدال بالبضاعة السليمة حسب سياسة المتجر</span>
      </footer>
    </section>
  );
}
