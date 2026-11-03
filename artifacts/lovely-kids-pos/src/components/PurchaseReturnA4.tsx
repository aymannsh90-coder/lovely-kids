import type { PosPurchaseReturnDetail } from "../lib/api";

interface PurchaseReturnA4Props {
  detail: PosPurchaseReturnDetail;
}

const money = (minor: number) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100) + " ₪";

function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-PS", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Hebron",
  }).format(date);
}

/**
 * Dedicated A4 document. It uses the persisted return detail rather than the
 * currently open purchase preview, so historical and voided returns print
 * correctly even when opened directly from the returns register.
 */
export default function PurchaseReturnA4({ detail }: PurchaseReturnA4Props) {
  const { purchaseReturn: returned, purchase, items } = detail;
  const isVoided = returned.status === "voided";
  const totalPieces = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <article className="pret-a4-sheet" dir="rtl" aria-label="سند مردود مشتريات A4">
      <header className="pret-a4-header">
        <div className="pret-a4-brand">
          <strong>Lovely Kids</strong>
          <span>ملابس ومستلزمات الأطفال</span>
          <span>نابلس — المركز التجاري</span>
          <span dir="ltr">09-2376808</span>
        </div>
        <div className="pret-a4-document">
          <h1>سند مردود مشتريات</h1>
          <strong dir="ltr">{returned.publicId}</strong>
          <span>التاريخ: {returned.businessDate}</span>
          <span className={isVoided ? "pret-a4-status is-voided" : "pret-a4-status"}>
            {isVoided ? "ملغى — لا يعتمد للتسوية" : "معتمد"}
          </span>
        </div>
      </header>

      {isVoided && (
        <section className="pret-a4-cancel-banner">
          <strong>سند ملغى — تم عكس أثره المالي والمخزني</strong>
          <span>سبب الإلغاء: {returned.voidReason ?? "—"}</span>
          <span>تاريخ الإلغاء: {dateTime(returned.voidedAt)}</span>
        </section>
      )}

      <section className="pret-a4-meta">
        <div><span>اسم المورد</span><strong>{purchase.supplierName}</strong></div>
        <div><span>فاتورة الشراء الأصلية</span><strong dir="ltr">{purchase.publicId}</strong></div>
        <div><span>فاتورة المورد</span><strong dir="ltr">{purchase.supplierInvoiceNumber || "—"}</strong></div>
        <div><span>تاريخ تسجيل السند</span><strong>{dateTime(returned.createdAt)}</strong></div>
      </section>

      <table className="pret-a4-table">
        <thead>
          <tr>
            <th>#</th>
            <th>الصنف</th>
            <th>اللون</th>
            <th>النمرة</th>
            <th>الكمية</th>
            <th>قيمة المورد</th>
            <th>تكلفة المخزون</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={item.id}>
              <td>{i + 1}</td>
              <td>
                <div className="pret-a4-product">
                  {item.productImage && <img src={item.productImage} alt="" />}
                  <div>
                    <strong>{item.productName}</strong>
                    <small>رقم الصنف: {item.productId}{item.productCode ? " | كود " + item.productCode : ""}</small>
                  </div>
                </div>
              </td>
              <td>{item.color ?? "—"}</td>
              <td>{item.size ?? "—"}</td>
              <td>{item.quantity}</td>
              <td dir="ltr">{money(item.refundAmountMinor)}</td>
              <td dir="ltr">{money(item.inventoryCostMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="pret-a4-summary">
        <div><span>إجمالي القطع</span><strong>{totalPieces}</strong></div>
        <div><span>قيمة المردود على المورد</span><strong dir="ltr">{money(returned.refundAmountMinor)}</strong></div>
        <div><span>تكلفة المخزون</span><strong dir="ltr">{money(returned.inventoryCostMinor)}</strong></div>
      </section>

      <section className="pret-a4-description">
        <p><strong>سبب المردود:</strong> {returned.reason}</p>
        {returned.notes && <p><strong>ملاحظات:</strong> {returned.notes}</p>}
      </section>

      <footer className="pret-a4-footer">
        <p>{isVoided
          ? "هذا السند ملغى ومحفوظ للتوثيق فقط؛ لا ينشئ مستحقات أو خصم مخزون قائم."
          : "يتم ترحيل قيمة المردود إلى حساب المورد دون حركة نقدية. التسوية أو القبض يتمان بسند مستقل."}
        </p>
        <div><span>توقيع المستلم: ___________________</span><span>توقيع المورد: ___________________</span></div>
      </footer>
    </article>
  );
}
