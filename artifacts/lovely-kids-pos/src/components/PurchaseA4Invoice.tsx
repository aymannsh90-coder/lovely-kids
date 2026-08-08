import type { PosPurchaseResult } from "../lib/api";

interface PurchaseA4InvoiceProps {
  result: PosPurchaseResult;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ar-PS", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Hebron",
  }).format(new Date(value));
}

function paymentMethodLabel(value: string) {
  if (value === "cash") return "نقدي";
  if (value === "credit") return "آجل";
  if (value === "mixed") return "مختلط";
  return value;
}

function money(value: number) {
  return `${value.toFixed(2)} ₪`;
}

export default function PurchaseA4Invoice({
  result,
}: PurchaseA4InvoiceProps) {
  const { purchase } = result;

  const paidQuantity = purchase.items.reduce(
    (total, item) => total + item.quantity,
    0,
  );

  const freeQuantity = purchase.items.reduce(
    (total, item) => total + item.freeQuantity,
    0,
  );

  return (
    <section className="purchase-a4-print-area" dir="rtl">
      <header className="purchase-a4-header">
        <div>
          <h1>Lovely Kids</h1>
          <strong>فاتورة مشتريات</strong>
          <span>ملابس ومستلزمات الأطفال</span>
          <span>نابلس - المركز التجاري</span>
          <span dir="ltr">09-2376808</span>
        </div>

        <div className="purchase-a4-invoice-number">
          <span>رقم الفاتورة الداخلي</span>
          <strong dir="ltr">{purchase.publicId}</strong>

          <span>التاريخ</span>
          <strong>{purchase.businessDate}</strong>
        </div>
      </header>

      {purchase.status === "voided" && (
        <div className="purchase-a4-voided">
          <strong>فاتورة محذوفة</strong>
          <span>سبب الحذف: {purchase.voidReason ?? "—"}</span>
          <span>
            تاريخ الحذف:{" "}
            {purchase.voidedAt
              ? formatDateTime(purchase.voidedAt)
              : "—"}
          </span>
        </div>
      )}

      <section className="purchase-a4-meta">
        <div>
          <span>المورد</span>
          <strong>{purchase.supplier.name}</strong>
        </div>

        <div>
          <span>كود المورد</span>
          <strong dir="ltr">{purchase.supplier.code}</strong>
        </div>

        <div>
          <span>رقم فاتورة المورد</span>
          <strong dir="ltr">
            {purchase.supplierInvoiceNumber ?? "—"}
          </strong>
        </div>

        <div>
          <span>طريقة الدفع</span>
          <strong>
            {paymentMethodLabel(purchase.paymentMethod)}
          </strong>
        </div>

        <div>
          <span>المستودع</span>
          <strong>{purchase.warehouseKey}</strong>
        </div>

        <div>
          <span>تاريخ التسجيل</span>
          <strong>{formatDateTime(purchase.createdAt)}</strong>
        </div>
      </section>

      <table className="purchase-a4-table">
        <thead>
          <tr>
            <th>#</th>
            <th>رقم الصنف</th>
            <th>اسم الصنف</th>
            <th>اللون</th>
            <th>المقاس</th>
            <th>الكمية</th>
            <th>مجاني</th>
            <th>تكلفة الوحدة</th>
            <th>الخصم</th>
            <th>المجموع</th>
          </tr>
        </thead>

        <tbody>
          {purchase.items.map((item, index) => (
            <tr key={item.id}>
              <td>{index + 1}</td>
              <td dir="ltr">{item.productCode ?? "—"}</td>
              <td>{item.productNameAr}</td>
              <td>{item.color ?? "—"}</td>
              <td>{item.size ?? "—"}</td>
              <td>{item.quantity}</td>
              <td>{item.freeQuantity}</td>
              <td dir="ltr">{money(item.unitCost)}</td>
              <td dir="ltr">{money(item.lineDiscount)}</td>
              <td dir="ltr">{money(item.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="purchase-a4-summary">
        <div className="purchase-a4-quantities">
          <div>
            <span>الكمية المدفوعة</span>
            <strong>{paidQuantity}</strong>
          </div>

          <div>
            <span>الكمية المجانية</span>
            <strong>{freeQuantity}</strong>
          </div>

          <div>
            <span>إجمالي القطع المستلمة</span>
            <strong>{paidQuantity + freeQuantity}</strong>
          </div>
        </div>

        <div className="purchase-a4-totals">
          <div>
            <span>مجموع الأصناف</span>
            <strong dir="ltr">{money(purchase.subtotal)}</strong>
          </div>

          <div>
            <span>الخصم</span>
            <strong dir="ltr">{money(purchase.discount)}</strong>
          </div>

          <div className="is-total">
            <span>الإجمالي النهائي</span>
            <strong dir="ltr">{money(purchase.total)}</strong>
          </div>

          <div>
            <span>المدفوع</span>
            <strong dir="ltr">{money(purchase.paid)}</strong>
          </div>

          <div>
            <span>المستحق</span>
            <strong dir="ltr">{money(purchase.due)}</strong>
          </div>
        </div>
      </section>

      {purchase.notes && (
        <section className="purchase-a4-notes">
          <strong>ملاحظات</strong>
          <p>{purchase.notes}</p>
        </section>
      )}

      <footer className="purchase-a4-footer">
        <span>
          فاتورة مشتريات داخلية — Lovely Kids
        </span>
        <span dir="ltr">{purchase.publicId}</span>
      </footer>
    </section>
  );
}
