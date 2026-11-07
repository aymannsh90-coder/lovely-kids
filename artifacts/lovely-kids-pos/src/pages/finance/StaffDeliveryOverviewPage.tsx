import { useEffect, useState } from "react";
import { usePosRuntime } from "../../app/pos-context";
import {
  getDeliveryCompanies, getDeliveryCompanySettlementSummary,
  type PosDeliveryCompany, type PosDeliverySettlementSummary,
} from "../../lib/api";

const money = (amount: number) =>
  `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)} ₪`;

export default function StaffDeliveryOverviewPage() {
  const { token } = usePosRuntime();
  const [companies, setCompanies] = useState<PosDeliveryCompany[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [summary, setSummary] = useState<PosDeliverySettlementSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    void getDeliveryCompanies(token).then(r => {
      if (live) { setCompanies(r); setSelected(r[0]?.id ?? null); }
    }).catch(e => { if (live) setError(e instanceof Error ? e.message : "تعذر تحميل شركات التوصيل"); });
    return () => { live = false; };
  }, [token]);

  useEffect(() => {
    if (selected == null) return;
    let live = true;
    void getDeliveryCompanySettlementSummary(token, selected).then(r => {
      if (live) { setSummary(r); setError(""); }
    }).catch(e => { if (live) setError(e instanceof Error ? e.message : "تعذر تحميل التقرير"); });
    return () => { live = false; };
  }, [selected, token]);

  return <main dir="rtl" style={{ padding: 18, maxWidth: 1150, margin: "0 auto" }}>
    <section style={{ background: "var(--card-bg, white)", padding: 20, borderRadius: 12 }}>
      <h1>🚚 تقرير شركة التوصيل — عرض فقط</h1>
      <p>الاطلاع على المبالغ والتسويات. لا يمكن تعديل الشركات أو ترحيل أو عكس تسوية دون صلاحيات المالك المنفصلة.</p>
      <label>شركة التوصيل
        <select value={selected ?? ""} onChange={e => { setSelected(Number(e.target.value)); setSummary(null); }} style={{ width: "100%", padding: 12, marginTop: 6 }}>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      {error && <p role="alert" style={{ color: "#991b1b" }}>{error}</p>}
      {summary && <div style={{ marginTop: 18 }}>
        <h2>{summary.company.name}</h2>
        <p><strong>مستحقات الشركة:</strong> {money(summary.outstanding)}</p>
        <p><strong>توصيل محصل من الزبائن:</strong> {money(summary.shippingChargedMinor / 100)}</p>
        <p><strong>تكلفة شركة التوصيل:</strong> {money(summary.deliveryCompanyCostMinor / 100)}</p>
        <p><strong>فرق التوصيل:</strong> {money(summary.deliveryMarginMinor / 100)}</p>
        <p><strong>طلبات غير مسوّاة:</strong> {summary.unsettledOrders.length}</p>
      </div>}
    </section>
  </main>;
}
