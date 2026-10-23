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


function customerBalanceValue(balanceMinor: number) {
  if (balanceMinor > 0) {
    return `${(balanceMinor / 100).toFixed(2)} ₪ عليك`;
  }

  if (balanceMinor < 0) {
    return `${(Math.abs(balanceMinor) / 100).toFixed(2)} ₪ لك`;
  }

  return "0.00 ₪";
}

function paymentMethodLabel(
  value: string,
  cardProcessor:
    | "arab"
    | "bop"
    | null,
) {
  if (value === "card") {
    if (
      cardProcessor ===
      "arab"
    ) {
      return "فيزا البنك العربي";
    }

    if (
      cardProcessor ===
      "bop"
    ) {
      return "فيزا بنك فلسطين";
    }

    return "فيزا";
  }

  if (value === "credit") {
    return "آجل";
  }

  if (value === "mixed") {
    return "دفعة نقدية + حساب";
  }

  return "نقدي";
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

        <span>الزبون: {result.sale.customerName ||
              (result.sale.paymentMethod === "card"
                ? "زبون فيزا"
                : result.sale.paymentMethod === "credit" ||
                    result.sale.paymentMethod === "mixed"
                  ? "زبون على الحساب"
                  : "زبون نقدي")}</span>

        <span>
          طريقة الدفع: {paymentMethodLabel(
            result.sale.paymentMethod,
            result.sale.cardProcessor,
          )}
          {result.sale.cashTender &&
          result.sale.cashTender.currencyCode !== "ILS"
            ? ` — ${result.sale.cashTender.currencyCode}`
            : ""}
        </span>

        {result.sale.cashTender &&
          result.sale.cashTender.currencyCode !== "ILS" && (
          <span dir="ltr">
            {(
              result.sale.cashTender.currencyAmountMinor /
              100
            ).toFixed(2)}{" "}
            {result.sale.cashTender.currencyCode}
            {" × "}
            {(
              result.sale.cashTender.exchangeRateMicros /
              1_000_000
            ).toFixed(6)}
          </span>
        )}
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

              <td dir="ltr">{item.productCode?.trim() || item.barcode?.trim() || "—"}</td>

              <td>{item.quantity}</td>

              <td dir="ltr">
                {(
                  item.soldUnitPrice *
                  item.quantity
                ).toFixed(2)} ₪
              </td>
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

        {result.sale.itemDiscountMinor > 0 && (
          <div>
            <span>خصم الأصناف</span>
            <strong>
              -{result.sale.itemDiscount.toFixed(2)} ₪
            </strong>
          </div>
        )}

        {result.promotions.map((promotion) => (
          <div
            key={`${promotion.promotionId ?? "snapshot"}-${promotion.promotionName}`}
          >
            <span>
              خصم {promotion.publicLabel}
            </span>
            <strong>
              -{(promotion.discountMinor / 100).toFixed(2)} ₪
            </strong>
          </div>
        ))}

        {result.sale.invoiceDiscountMinor > 0 && (
          <div>
            <span>خصم يدوي</span>
            <strong>
              -{result.sale.invoiceDiscount.toFixed(2)} ₪
            </strong>
          </div>
        )}

        <div className="receipt-total">
          <span>الإجمالي النهائي</span>
          <strong>{result.sale.total.toFixed(2)} ₪</strong>
        </div>

        <div>
          <span>المدفوع</span>
          <strong>
            {result.sale.cashTender &&
            result.sale.cashTender.currencyCode !== "ILS"
              ? `${(
                  result.sale.cashTender.currencyAmountMinor /
                  100
                ).toFixed(2)} ${result.sale.cashTender.currencyCode}`
              : `${result.sale.paid.toFixed(2)} ₪`}
          </strong>
        </div>

        {result.sale.cashTender &&
          result.sale.cashTender.currencyCode !== "ILS" && (
          <div>
            <span>قيمة المستلم بالشيكل</span>
            <strong>
              {(
                result.sale.cashTender.baseReceivedMinor /
                100
              ).toFixed(2)} ₪
            </strong>
          </div>
        )}


        {result.sale.accountDueMinor > 0 && (
          <div>
            <span>
              المتبقي على الحساب
            </span>

            <strong>
              {result.sale.accountDue.toFixed(2)} ₪
            </strong>
          </div>
        )}

        <div>
          <span>الباقي</span>
          <strong>{result.sale.change.toFixed(2)} ₪</strong>
        </div>

        {result.sale.customerId &&
          typeof result.sale.customerBalanceMinor === "number" && (
            <div className="receipt-total">
              <span>رصيدك الحالي حتى لحظة طباعة الفاتورة</span>
              <strong>
                {customerBalanceValue(result.sale.customerBalanceMinor)}
              </strong>
            </div>
          )}
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
