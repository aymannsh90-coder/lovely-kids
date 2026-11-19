import type { Ref } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { PosSaleResult } from "../lib/api";

/** Common, readonly data needed for saved and unsaved thermal receipts. */
export type SaleReceiptData = {
  sale: Pick<PosSaleResult["sale"],
    | "publicId" | "createdAt" | "customerName" | "paymentMethod"
    | "cardProcessor" | "accountDueMinor" | "subtotal"
    | "promotionDiscountMinor" | "itemDiscountMinor" | "itemDiscount"
    | "invoiceDiscountMinor" | "invoiceDiscount" | "promotionDiscount"
    | "discountMinor" | "discount" | "total" | "paid" | "change" | "cashTender"
  >;
  items: Array<Pick<PosSaleResult["items"][number],
    | "id" | "productNameAr" | "productCode" | "barcode" | "quantity"
    | "lineTotalMinor" | "promotionDiscountMinor" | "lineTotal"
  >>;
  promotions: Array<Pick<PosSaleResult["promotions"][number],
    "promotionId" | "promotionName" | "publicLabel" | "discountMinor"
  >>;
};

function formatMinor(value: number) {
  const amount = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);

  return `${amount}\u00A0₪`;
}

function bidiSafePromotionLabel(label: string) {
  return label.replace(
    /\d+\s*\+\s*\d+/g,
    (value) => `\u2066${value}\u2069`,
  );
}

export default function SaleThermalReceipt({
  receipt, receiptRef, isDraft = false,
}: {
  receipt: SaleReceiptData;
  receiptRef?: Ref<HTMLElement>;
  isDraft?: boolean;
}) {
  // The on-screen preview and the Print Bridge capture share identical markup.
  const lastSale = receipt;
  return (
        <section ref={receiptRef} className="receipt-print-area" dir="rtl">
          <header className="receipt-header">
            <img className="receipt-logo" src="/lovely-kids-receipt-logo.png" alt="Lovely Kids" />
            <span>لملابس الأطفال وتجهيز المواليد</span>
            <span>نابلس - المركز التجاري - شارع عمر المختار</span>
            <span dir="ltr">09-2376808</span>
          </header>

          <div className="receipt-divider" />

          <div className="receipt-info">
            <span>
              رقم الفاتورة:
              <b dir="ltr"> {isDraft ? "مسودة غير محفوظة" : lastSale.sale.publicId}</b>
            </span>

            <span>
              التاريخ والوقت:{" "}
              {new Intl.DateTimeFormat("ar-PS", {
                dateStyle: "short",
                timeStyle: "short",
                timeZone: "Asia/Hebron",
              }).format(new Date(lastSale.sale.createdAt))}
            </span>

            <span>الزبون: {lastSale.sale.customerName ||
                (lastSale.sale.paymentMethod === "card"
                  ? "زبون فيزا"
                  : lastSale.sale.paymentMethod === "credit" ||
                      lastSale.sale.paymentMethod === "mixed"
                    ? "زبون على الحساب"
                    : "زبون نقدي")}</span>

            <span>
              طريقة الدفع: {
                lastSale.sale.paymentMethod === "card"
                  ? lastSale.sale.cardProcessor === "arab"
                    ? "فيزا البنك العربي"
                    : lastSale.sale.cardProcessor === "bop"
                      ? "فيزا بنك فلسطين"
                      : "فيزا"
                  : lastSale.sale.paymentMethod === "credit"
                    ? "آجل"
                    : lastSale.sale.paymentMethod === "mixed"
                      ? "دفعة نقدية + حساب"
                      : "نقدي"
              }
            </span>

            {lastSale.sale.accountDueMinor > 0 && (
              <span>
                المتبقي على الحساب:
                {" "}
                {formatMinor(
                  lastSale.sale.accountDueMinor,
                )}
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
              {lastSale.items.map((item, index) => (
                <tr key={item.id}>
                  <td>{index + 1}</td>

                  <td>{item.productNameAr.trim().split(/\s+/)[0] || "صنف"}</td>

                  <td dir="ltr">{item.productCode?.trim() || item.barcode?.trim() || "—"}</td>

                  <td>{item.quantity}</td>

                  <td dir="ltr">
                    {(
                      lastSale.sale.promotionDiscountMinor > 0
                        ? (
                            item.lineTotalMinor +
                            item.promotionDiscountMinor
                          ) /
                          100
                        : item.lineTotal
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

              <strong>{lastSale.sale.subtotal.toFixed(2)} ₪</strong>
            </div>

            {lastSale.sale.promotionDiscountMinor > 0 ? (
              <>
                {lastSale.sale.itemDiscountMinor > 0 && (
                  <div>
                    <span>خصم الأصناف</span>

                    <strong>
                      -{lastSale.sale.itemDiscount.toFixed(2)} ₪
                    </strong>
                  </div>
                )}

                {lastSale.promotions.length > 0 ? (
                  lastSale.promotions.map((promotion) => (
                    <div
                      key={`direct-receipt-promotion-${promotion.promotionId ?? "snapshot"}-${promotion.promotionName}`}
                    >
                      <span>
                        خصم عرض {bidiSafePromotionLabel(promotion.publicLabel)}
                      </span>

                      <strong>
                        -{(promotion.discountMinor / 100).toFixed(2)} ₪
                      </strong>
                    </div>
                  ))
                ) : (
                  <div>
                    <span>خصم العرض</span>

                    <strong>
                      -{lastSale.sale.promotionDiscount.toFixed(2)} ₪
                    </strong>
                  </div>
                )}

                {lastSale.sale.invoiceDiscountMinor > 0 && (
                  <div>
                    <span>خصم يدوي</span>

                    <strong>
                      -{lastSale.sale.invoiceDiscount.toFixed(2)} ₪
                    </strong>
                  </div>
                )}
              </>
            ) : (
              lastSale.sale.discountMinor > 0 && (
                <div>
                  <span>قيمة الخصم</span>

                  <strong>{lastSale.sale.discount.toFixed(2)} ₪</strong>
                </div>
              )
            )}

            <div className="receipt-total">
              <span>الإجمالي النهائي</span>

              <strong>{lastSale.sale.total.toFixed(2)} ₪</strong>
            </div>

            <div>
              <span>المدفوع</span>

              <strong>
                {lastSale.sale.cashTender &&
                lastSale.sale.cashTender.currencyCode !== "ILS"
                  ? `${(
                      lastSale.sale.cashTender.currencyAmountMinor /
                      100
                    ).toFixed(2)} ${lastSale.sale.cashTender.currencyCode}`
                  : `${lastSale.sale.paid.toFixed(2)} ₪`}
              </strong>
            </div>

            {lastSale.sale.cashTender &&
              lastSale.sale.cashTender.currencyCode !== "ILS" && (
              <div>
                <span>قيمة المستلم بالشيكل</span>

                <strong>
                  {(
                    lastSale.sale.cashTender.baseReceivedMinor /
                    100
                  ).toFixed(2)} ₪
                </strong>
              </div>
            )}

            <div>
              <span>الباقي</span>

              <strong>{lastSale.sale.change.toFixed(2)} ₪</strong>
            </div>
          </div>

          <div className="receipt-invoice-barcode">
            {isDraft ? (
              <span className="receipt-draft-qr-note">رمز QR للفاتورة يظهر بعد الحفظ</span>
            ) : (
              <QRCodeSVG
                value={lastSale.sale.publicId}
                size={96}
                level="M"
                aria-label={`رمز QR للفاتورة ${lastSale.sale.publicId}`}
              />
            )}
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
