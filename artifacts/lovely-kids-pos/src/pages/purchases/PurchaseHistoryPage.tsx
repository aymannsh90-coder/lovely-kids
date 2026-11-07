import { useEffect, useState, type FormEvent } from "react";
import { usePosRuntime } from "../../app/pos-context";
import { ApiError, getLatestPosPurchase, getPosPurchaseByPublicId, type PosPurchaseResult } from "../../lib/api";
import "./PurchaseHistoryPage.css";

const money = (minor: number | null | undefined) =>
  minor === null || minor === undefined
    ? "غير محدد"
    : (minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₪";
const formatStatus = (value: string) =>
  value === "completed" ? "معتمدة" : value === "draft" ? "مسودة" : "ملغاة";

export default function PurchaseHistoryPage() {
  const { token, clearAuthentication } = usePosRuntime();
  const [publicId, setPublicId] = useState("");
  const [result, setResult] = useState<PosPurchaseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load(id?: string) {
    setLoading(true);
    setError("");
    try {
      const data = id?.trim()
        ? await getPosPurchaseByPublicId(token, id.trim())
        : await getLatestPosPurchase(token);
      setResult(data);
      setPublicId(data.purchase.publicId);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        clearAuthentication();
        return;
      }
      setError(caught instanceof Error ? caught.message : "تعذّر تحميل فاتورة المشتريات");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [token]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(publicId);
  }

  return <section className="lk-purchase-history" dir="rtl" style={{ maxWidth: 1300, margin: "0 auto", padding: 18 }}>
    <header className="purchase-history-hero" style={{ background: "#fff", padding: 18, borderRadius: 12, marginBottom: 16 }}>
      <h1 className="purchase-history-title" style={{ marginTop: 0 }}>سجل فواتير المشتريات — عرض فقط</h1>
      <p>الاطلاع على فواتير الموردين وتكاليفها دون تعديل أو إلغاء أي فاتورة.</p>
      <form className="purchase-history-search" onSubmit={submit} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input className="purchase-history-search-input" dir="ltr" value={publicId} onChange={e => setPublicId(e.target.value)}
          placeholder="رقم فاتورة المشتريات" aria-label="رقم فاتورة المشتريات"
          style={{ padding: 10, border: "1px solid #cbd5e1", borderRadius: 8, flex: 1, minWidth: 230 }} />
        <button className="purchase-history-search-primary" type="submit" disabled={loading}>{loading ? "جاري البحث…" : "فتح فاتورة"}</button>
        <button className="purchase-history-search-latest" type="button" disabled={loading} onClick={() => void load()}>آخر فاتورة</button>
      </form>
      {error && <p className="purchase-history-error" role="alert" style={{ color: "#b91c1c" }}>{error}</p>}
    </header>
    {result && <article className="purchase-history-invoice" style={{ background: "#fff", padding: 18, borderRadius: 12 }}>
      <div className="purchase-history-invoice-summary" style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div className="purchase-history-invoice-details">
          <h2>فاتورة {result.purchase.publicId}</h2>
          <p><strong>المورد:</strong> {result.purchase.supplier.name} · <strong>التاريخ:</strong> {result.purchase.businessDate}</p>
          <p><strong>الحالة:</strong> {formatStatus(result.purchase.status)} · <strong>طريقة الدفع:</strong> {result.purchase.paymentMethod}</p>
        </div>
        <div className="purchase-history-invoice-totals">
          <p><strong>الإجمالي:</strong> {money(result.purchase.totalMinor)}</p>
          <p><strong>المدفوع:</strong> {money(result.purchase.paidMinor)}</p>
          <p><strong>المتبقي:</strong> {money(result.purchase.dueMinor)}</p>
        </div>
      </div>
      <div className="purchase-history-navigation" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {result.navigation?.previousPublicId && <button type="button" disabled={loading}
          onClick={() => void load(result.navigation?.previousPublicId ?? undefined)}>السابق</button>}
        {result.navigation?.nextPublicId && <button type="button" disabled={loading}
          onClick={() => void load(result.navigation?.nextPublicId ?? undefined)}>التالي</button>}
      </div>
      <div className="purchase-history-table-scroll" style={{ overflowX: "auto" }}>
        <table className="purchase-history-table" style={{ width: "100%", borderCollapse: "collapse", textAlign: "right" }}>
          <thead><tr>{["#", "الصنف", "اللون/النمرة", "الكمية", "المجاني", "تكلفة القطعة", "الإجمالي"].map(h =>
            <th key={h} style={{ padding: 10, borderBottom: "1px solid #cbd5e1" }}>{h}</th>)}</tr></thead>
          <tbody>{result.purchase.items.map((line, index) => <tr key={line.id}>
            <td style={{ padding: 10, borderBottom: "1px solid #edf2f7" }}>{index + 1}</td>
            <td>{line.productNameAr} <small dir="ltr">{line.productCode ?? ""}</small></td>
            <td>{line.color ?? "—"} / {line.size ?? "—"}</td>
            <td>{line.quantity}</td><td>{line.freeQuantity}</td>
            <td>{money(line.unitCostMinor)}</td><td>{money(line.lineTotalMinor)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </article>}
  </section>;
}
