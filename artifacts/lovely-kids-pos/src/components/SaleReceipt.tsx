import { QRCodeSVG } from "qrcode.react";
import type { Ref } from "react";

import type { PosSaleResult } from "../lib/api";

interface SaleReceiptProps {
  result: PosSaleResult;
  isReprint?: boolean;
  receiptRef?: Ref<HTMLElement>;
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

export default function SaleReceipt({
  result,
  isReprint = false,
  receiptRef,
}: SaleReceiptProps) {
  return (
    <section ref={receiptRef} className="receipt-print-area" dir="rtl">
      <header className="receipt-header">
        <img className="receipt-logo" src="/lovely-kids-receipt-logo.png" alt="Lovely Kids" />
        <span>لملابس الأطفال وتجهيز المواليد</span>
        <span>نابلس - المركز التجاري - شارع عمر المختار</span>
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
        <QRCodeSVG
          value={result.sale.publicId}
          size={96}
          level="M"
          aria-label={`رمز QR للفاتورة ${result.sale.publicId}`}
        />
      </div>

      <footer className="receipt-footer">
        <strong>شكرًا لتسوقكم من Lovely Kids</strong>

        <b className="receipt-exchange-reminder">
          يرجى الاحتفاظ بالفاتورة لإتمام عملية التبديل.
        </b>

        <span>الاستبدال بالبضاعة السليمة حسب سياسة المتجر</span>
      </footer>

      <div className="receipt-social-qrs" aria-label="روابط Lovely Kids">
        <div className="receipt-social-qr-item">
          <QRCodeSVG
            value="https://www.facebook.com/lovely.kids.nablus1"
            size={112}
            level="M"
            aria-label="فيسبوك Lovely Kids"
          />
          <span>فيسبوك</span>
        </div>

        <div className="receipt-social-qr-item">
          <QRCodeSVG
            value="https://wa.me/97292376808"
            size={112}
            level="M"
            aria-label="واتساب Lovely Kids"
          />
          <span>واتساب</span>
        </div>

        <div className="receipt-social-qr-item">
          <QRCodeSVG
            value="https://lovelykids.net"
            size={112}
            level="M"
            aria-label="متجر Lovely Kids الإلكتروني"
          />
          <span>المتجر الإلكتروني</span>
        </div>
      </div>

    </section>
  );
}
