import { useEffect, useMemo, useState } from "react";
import { usePosRuntime } from "../../app/pos-context";
import { API_BASE_URL } from "../../lib/api";

type Order = {
  id: number;
  customerName: string;
  customerPhone?: string | null;
  status: string;
  shippingZone?: string | null;
  totalPrice?: number;
  createdAt?: string;
};

export default function StaffOrdersPage() {
  const { token } = usePosRuntime();
  const [rows, setRows] = useState<Order[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const filtered = useMemo(() => rows.filter(o =>
    [String(o.id), o.customerName, o.customerPhone ?? "", o.shippingZone ?? ""].some(x => x.toLowerCase().includes(filter.trim().toLowerCase())),
  ), [rows, filter]);

  async function refresh() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`${API_BASE_URL}/api/orders`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "غير مصرح بعرض الطلبات");
      }
      const data = await response.json() as unknown;
      if (!Array.isArray(data)) throw new Error("استجابة الطلبات غير صالحة");
      setRows(data as Order[]);
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر تحميل الطلبات"); }
    finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, [token]);

  return <main dir="rtl" style={{ padding: 18 }}>
    <section style={{ background: "var(--card-bg, white)", borderRadius: 12, padding: 20 }}>
      <h1>📦 استعراض الطلبات الإلكترونية</h1>
      <p>قائمة الطلبات للموظف المخوّل. تتطلب التعديلات وإلغاء الطلبات وتأكيد الدفع صلاحيات مستقلة.</p>
      <div style={{ display: "flex", gap: 12, margin: "15px 0" }}>
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="ابحث برقم الطلب أو الزبون أو الهاتف" style={{ flex: 1, padding: 10, border: "1px solid #cbd5e1", borderRadius: 8 }} />
        <button type="button" disabled={busy} onClick={() => void refresh()}>{busy ? "جاري التحديث..." : "تحديث"}</button>
      </div>
      {error && <p role="alert" style={{ color: "#991b1b" }}>{error}</p>}
      <p>عدد الطلبات المطابقة: {filtered.length}</p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", textAlign: "right" }}>
          <thead><tr><th>رقم الطلب</th><th>الزبون</th><th>الحالة</th><th>المنطقة</th><th>المبلغ</th><th>التاريخ</th></tr></thead>
          <tbody>{filtered.slice(0, 300).map(o => <tr key={o.id} style={{ borderTop: "1px solid #e2e8f0" }}>
            <td>#{o.id}</td><td>{o.customerName}</td><td>{o.status}</td><td>{o.shippingZone ?? "—"}</td>
            <td>{o.totalPrice === undefined ? "—" : `${o.totalPrice.toFixed(2)} ₪`}</td>
            <td>{o.createdAt ? new Date(o.createdAt).toLocaleDateString("ar-PS") : "—"}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
  </main>;
}
