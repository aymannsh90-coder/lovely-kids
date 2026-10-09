import { QRCodeSVG } from "qrcode.react";
import type { Ref } from "react";

import type {
  PosExchangeCreateResult,
} from "../lib/api";

interface ExchangeReceiptProps {
  result: PosExchangeCreateResult;
  receiptRef?: Ref<HTMLElement>;
  showOnScreen?: boolean;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(
    "ar-PS",
    {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Asia/Hebron",
    },
  ).format(new Date(value));
}

function formatMinor(value: number) {
  return `${(value / 100).toFixed(2)} ₪`;
}

function settlementTypeLabel(
  value: string,
) {
  if (value === "card") {
    return "بطاقة";
  }

  if (value === "cash") {
    return "نقدي";
  }

  if (value === "delivery_company") {
    return "شركة التوصيل";
  }

  if (value === "customer") {
    return "الزبون";
  }

  return value;
}

function shortProductName(value: string) {
  return (
    value.trim().split(/\s+/)[0] ||
    "صنف"
  );
}

function variantText(
  color: string | null,
  size: string | null,
) {
  return [color, size]
    .filter(Boolean)
    .join(" / ");
}

export default function ExchangeReceipt({
  result,
  receiptRef,
  showOnScreen = false,
}: ExchangeReceiptProps) {
  const exchange = result.exchange;

  if (!exchange) {
    return null;
  }

  const settlementLabel =
    exchange.settlementAmountMinor > 0
      ? "المطلوب من الزبون"
      : exchange.settlementAmountMinor < 0
        ? "المرجع للزبون"
        : "فرق التبديل";

  return (
    <section
      ref={receiptRef}
      className="receipt-print-area"
      dir="rtl"
      style={showOnScreen ? { display: "block" } : undefined}
    >
      <header className="receipt-header">
        <img
          className="receipt-logo"
          src="/lovely-kids-receipt-logo.png"
          alt="Lovely Kids"
        />

        <strong>فاتورة تبديل</strong>

        <span>
          لملابس الأطفال وتجهيز المواليد
        </span>

        <span>
          نابلس - المركز التجاري - شارع عمر المختار
        </span>

        <span dir="ltr">
          09-2376808
        </span>
      </header>

      <div className="receipt-divider" />

      <div className="receipt-info">
        <span>
          رقم فاتورة التبديل:
          <b dir="ltr">
            {" "}
            {exchange.publicId}
          </b>
        </span>

        <span>
          التاريخ والوقت:
          {" "}
          {formatDateTime(
            exchange.createdAt,
          )}
        </span>

        {exchange.customerName && (
          <span>
            اسم الزبون:
            {" "}
            <b>
              {exchange.customerName}
            </b>
          </span>
        )}

        {exchange.status === "voided" && (
          <span>
            الحالة:
            {" "}
            <b>ملغاة</b>
          </span>
        )}

        <span>
          نوع التبديل:
          {" "}
          {exchange.sourceType ===
          "pos_sale"
            ? "مع فاتورة"
            : exchange.sourceType ===
                "pos_no_receipt"
              ? "بدون فاتورة"
              : "طلب أونلاين"}
        </span>

        <span>
          طريقة التسوية:
          {" "}
          {settlementTypeLabel(
            exchange.settlementType,
          )}
        </span>
      </div>

      <div className="receipt-divider" />

      <strong
        style={{
          display: "block",
          textAlign: "center",
          marginBottom: "6px",
        }}
      >
        الأصناف المرتجعة
      </strong>

      <table className="receipt-items-table">
        <thead>
          <tr>
            <th>#</th>
            <th>الصنف</th>
            <th>الكود</th>
            <th>الكمية</th>
            <th>القيمة</th>
          </tr>
        </thead>

        <tbody>
          {result.returnItems.map(
            (item, index) => (
              <tr
                key={`return-${item.lineNumber}-${index}`}
              >
                <td>
                  {index + 1}
                </td>

                <td>
                  {shortProductName(
                    item.productNameAr,
                  )}

                  {variantText(
                    item.color,
                    item.size,
                  ) && (
                    <small
                      style={{
                        display:
                          "block",
                      }}
                    >
                      {variantText(
                        item.color,
                        item.size,
                      )}
                    </small>
                  )}
                </td>

                <td dir="ltr">
                  {item.productCode ??
                    "—"}
                </td>

                <td>
                  {item.quantity}
                </td>

                <td dir="ltr">
                  {formatMinor(
                    item.returnNetMinor,
                  )}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>

      <div className="receipt-divider" />

      <strong
        style={{
          display: "block",
          textAlign: "center",
          marginBottom: "6px",
        }}
      >
        الأصناف الجديدة
      </strong>

      <table className="receipt-items-table">
        <thead>
          <tr>
            <th>#</th>
            <th>الصنف</th>
            <th>الكود</th>
            <th>الكمية</th>
            <th>القيمة</th>
          </tr>
        </thead>

        <tbody>
          {result.saleItems.map(
            (item, index) => (
              <tr
                key={`sale-${item.lineNumber}-${index}`}
              >
                <td>
                  {index + 1}
                </td>

                <td>
                  {shortProductName(
                    item.productNameAr,
                  )}

                  {variantText(
                    item.color,
                    item.size,
                  ) && (
                    <small
                      style={{
                        display:
                          "block",
                      }}
                    >
                      {variantText(
                        item.color,
                        item.size,
                      )}
                    </small>
                  )}
                </td>

                <td dir="ltr">
                  {item.productCode ??
                    item.barcode ??
                    "—"}
                </td>

                <td>
                  {item.quantity}
                </td>

                <td dir="ltr">
                  {formatMinor(
                    item.lineNetMinor,
                  )}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>

      <div className="receipt-divider" />

      <div className="receipt-totals">
        <div>
          <span>
            صافي قيمة المرتجع
          </span>

          <strong dir="ltr">
            {formatMinor(
              exchange.returnNetMinor,
            )}
          </strong>
        </div>

        <div>
          <span>
            صافي الأصناف الجديدة
          </span>

          <strong dir="ltr">
            {formatMinor(
              exchange.newNetMinor,
            )}
          </strong>
        </div>

        <div className="receipt-total">
          <span>
            {settlementLabel}
          </span>

          <strong dir="ltr">
            {formatMinor(
              Math.abs(
                exchange
                  .settlementAmountMinor,
              ),
            )}
          </strong>
        </div>

        <div>
          <span>
            طريقة التسوية
          </span>

          <strong>
            {settlementTypeLabel(
              exchange.settlementType,
            )}
          </strong>
        </div>
      </div>

      <div className="receipt-invoice-barcode">
        <QRCodeSVG
          value={exchange.publicId}
          size={96}
          level="M"
          aria-label={`رمز QR لفاتورة التبديل ${exchange.publicId}`}
        />
      </div>

      <footer className="receipt-footer">
        <strong>
          شكرًا لتسوقكم من Lovely Kids
        </strong>

        <span>
          يرجى الاحتفاظ بفاتورة التبديل
        </span>
      </footer>
    </section>
  );
}
