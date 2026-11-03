import { useState, type FormEvent } from "react";
import { usePosRuntime } from "../../app/pos-context";
import { getLatestPosPurchase, getPosPurchaseByPublicId, type PosPurchaseResult } from "../../lib/api";

const amount = (n: number | null | undefined) =>
  n == null ? "غير محدد" : `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} ₪`;

export default function PurchaseHistoryPage() {
  const { token } = usePosRuntime();
  const [publicId, setPublicId] = useState("");
  const [result, setResult] = useState<PosPurchaseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load(e?: FormEvent<HTMLFormElement>, latest = false) {
    e?.preventDefault();
    if (!latest && !publicId.trim()) {
      setError("أدخل رقم فاتورة المشتريات");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = latest
        ? await getLatestPosPurchase(token)
        : await getPosPurchaseByPublicId(token, publicId.trim());
      setResult(r);
    } catch (caught) {
      setResult(null);
      setError(caught instanceof Error ? caught.message : "تعذر تحميل الفاتورة");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main dir="rtl" style={{ padding: 18, maxWidth: 1300, margin: "0 auto" }}>
      <header style={{ padding: "16px 22px", background: "var(--card-bg, white)", borderRadius: 12, marginBottom: 16 }}>
        <h1>📄 استعراض فواتير المشتريات</h1>
        <p>عرض تفاصيل الفاتورة فقط. لا تسمح هذه الصفحة بالتعديل أو الإلغاء.</p>
      </header>
      <form onSubmit={e => void load(e)} style={{ padding: 16, background: "var(--card-bg, white)", borderRadius: 12, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
        <label style={{ flex: "1 1 260px" }}>رقم الفاتورة
          <input value={publicId} onChange={e => setPublicId(e.target.value)} placeholder="رقم فاتورة المشتريات" style={{ width: "100%", padding: 11, borderRadius: 8, border: "1px solid #cbd5e1" }} />
        </label>
        <button type="submit" className="primary-button" disabled={busy}>عرض الفاتورة</button>
        <button type="button" disabled={busy} onClick={() => void load(undefined, true)}>آخر فاتورة</button>
      </form>
      {error && <p role="alert" style={{ background: "#fee2e2", color: "#991b1b", padding: 12, borderRadius: 8 }}>{error}</p>}
      {result && (
        <section style={{ background: "var(--card-bg, white)", borderRadius: 12, padding: 18, marginTop: 16 }}>
          <h2>فاتورة {result.purchase.publicId}</h2>
          <p><strong>المورد:</strong> {result.purchase.supplier.name} — <strong>التاريخ:</strong> {result.purchase.businessDate} — <strong>الحالة:</strong> {result.purchase.status}</p>
          <p><strong>إجمالي الفاتورة:</strong> {amount(result.purchase.total)} — <strong>المدفوع:</strong> {amount(result.purchase.paid)} — <strong>المستحق:</strong> {amount(result.purchase.due)}</p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "right" }}>
              <thead><tr><th>الصنف</th><th>اللون</th><th>المقاس</th><th>الكمية</th><th>تكلفة الوحدة</th><th>الإجمالي</th></tr></thead>
              <tbody>{result.purchase.items.map(item => (
                <tr key={item.id} style={{ borderTop: "1px solid #dce3ee" }}>
                  <td>{item.productNameAr}</td><td>{item.color ?? "—"}</td><td>{item.size ?? "—"}</td><td>{item.quantity}</td><td>{amount(item.unitCost)}</td><td>{amount(item.lineTotal)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
