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
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  deliveryCompanyCost?: number | null;
  createdAt?: string;
};

const statusOptions = [
  { value: "confirmed", label: "تأكيد" },
  { value: "delivering", label: "قيد التوصيل" },
  { value: "done", label: "تم الاستلام" },
] as const;

export default function StaffOrdersPage() {
  const { token, user } = usePosRuntime();
  const [rows, setRows] = useState<Order[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [draftStatus, setDraftStatus] = useState<Record<number, string>>({});

  const allowed = (permission: string) =>
    Boolean(user?.isOwner || user?.isAdmin || user?.permissions?.includes(permission));
  const canAct = ["orders.edit", "orders.cancel", "orders.confirm-payment",
    "orders.delivery-cost", "orders.courier.cash", "orders.courier.reverse"].some(allowed);

  const filtered = useMemo(() => rows.filter(o =>
    [String(o.id), o.customerName, o.customerPhone ?? "", o.shippingZone ?? ""].some(
      x => x.toLowerCase().includes(filter.trim().toLowerCase()),
    ),
  ), [rows, filter]);

  async function request(path: string, method: string, body?: unknown) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error((result as { error?: string }).error || "تعذر تنفيذ العملية");
    }
  }

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

  async function run(order: Order, action: string) {
    if (busy) return;
    const n = order.id;
    let endpoint = `/api/orders/${n}`;
    let method = "PATCH";
    let body: unknown;

    if (action === "status") {
      if (!allowed("orders.edit")) return;
      const next = draftStatus[n];
      if (!next || next === order.status) return;
      if (!window.confirm(`تغيير حالة الطلب #${n} من "${order.status}" إلى "${next}"؟ قد يترتب عليه تحديث مخزون أو قيد مالي.`)) return;
      if (next === "done" && order.paymentMethod === "cod" && order.shippingZone === "استلام من المحل") {
        setError("إنهاء طلب استلام من المحل نقدًا يحتاج تحديد طريقة التسوية من شاشة إدارة الطلبات؛ لا يمكن إكماله من هنا.");
        return;
      }
      endpoint += "/status";
      body = { status: next };
    } else if (action === "cancel") {
      if (!allowed("orders.cancel") || order.status !== "new") return;
      if (!window.confirm(`إلغاء الطلب #${n}؟ لا يمكن إرجاعه بعد تنفيذ الحركة.`)) return;
      endpoint += "/cancel";
    } else if (action === "payment") {
      if (!allowed("orders.confirm-payment") || order.paymentMethod !== "bank_transfer") return;
      if (!window.confirm(`هل تم التأكد فعليًا من وصول التحويل البنكي للطلب #${n} قبل اعتماد الدفع؟`)) return;
      endpoint += "/confirm-payment";
    } else if (action === "courier-cash") {
      if (!allowed("orders.courier.cash")) return;
      if (!window.confirm(`هل استلم المحل قيمة البضاعة نقدًا من المندوب للطلب #${n}؟ سيتم تسجيل قيد قبض.`)) return;
      endpoint += "/local-courier-cash";
      method = "POST";
    } else if (action === "courier-reverse") {
      if (!allowed("orders.courier.reverse")) return;
      const reason = window.prompt(`سبب عكس قبض المندوب للطلب #${n}:`);
      if (!reason?.trim()) return;
      if (!window.confirm("تأكد: البضاعة رجعت للمحل فعليًا، وتم رد مبلغ البضاعة للمندوب؟")) return;
      if (!window.confirm("تأكيد نهائي: شركة/مندوب التوصيل لا يستحق أي رسوم، وسيتم عكس المالية والمخزون؟")) return;
      endpoint += "/local-courier-reverse";
      method = "POST";
      body = { reason: reason.trim(), goodsReturned: true, courierRefunded: true, noCourierFeeOwed: true };
    } else if (action === "delivery-cost") {
      if (!allowed("orders.delivery-cost")) return;
      const raw = window.prompt(`تكلفة شركة التوصيل الفعلية للطلب #${n} (بالشيكل):`, String(order.deliveryCompanyCost ?? ""));
      if (raw === null || raw.trim() === "") return;
      const value = Number(raw.trim().replace(",", "."));
      if (!Number.isInteger(value) || value < 0 || value > 10000) {
        setError("اكتب تكلفة صحيحة بالشيكل (رقم صحيح من 0 إلى 10000).");
        return;
      }
      if (!window.confirm(`تأكيد تعديل تكلفة الشركة للطلب #${n} إلى ${value} ₪؟ سعر الزبون لن يتغير.`)) return;
      endpoint += "/delivery-company-cost";
      body = { companyCost: value, expectedCost: order.deliveryCompanyCost ?? null };
    } else return;

    setBusy(true); setError(""); setNotice("");
    try {
      await request(endpoint, method, body);
      setNotice(`تم تنفيذ العملية للطلب #${n} بنجاح. راجع القيود المالية والمخزون حسب نوع العملية.`);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر تنفيذ العملية"); }
    finally { setBusy(false); }
  }

  return <main dir="rtl" style={{ padding: 18 }}>
    <section style={{ background: "var(--card-bg, white)", borderRadius: 12, padding: 20 }}>
      <h1>📦 الطلبات الإلكترونية</h1>
      <p>تظهر عمليات الطلب حسب الصلاحيات التي حددها المالك. تعديل الحالة، الدفع، وتسجيل نقدية المندوب تؤثر فعليًا على الحسابات؛ راجع البيانات قبل التأكيد.</p>
      <div style={{ display: "flex", gap: 12, margin: "15px 0", flexWrap: "wrap" }}>
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="ابحث برقم الطلب أو الزبون أو الهاتف" style={{ flex: 1, minWidth: 230, padding: 10, border: "1px solid #cbd5e1", borderRadius: 8 }} />
        <button type="button" disabled={busy} onClick={() => void refresh()}>{busy ? "جاري التحديث..." : "تحديث"}</button>
      </div>
      {error && <p role="alert" style={{ color: "#991b1b" }}>{error}</p>}
      {notice && <p role="status" style={{ color: "#166534" }}>{notice}</p>}
      <p>عدد الطلبات المطابقة: {filtered.length}</p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", textAlign: "right" }}>
          <thead><tr><th>رقم</th><th>الزبون</th><th>الحالة</th><th>المنطقة</th><th>المبلغ</th><th>التاريخ</th>{canAct && <th>العمليات المصرّح بها</th>}</tr></thead>
          <tbody>{filtered.slice(0, 300).map(o => <tr key={o.id} style={{ borderTop: "1px solid #e2e8f0" }}>
            <td>#{o.id}</td><td>{o.customerName}</td><td>{o.status}</td><td>{o.shippingZone ?? "—"}</td>
            <td>{o.totalPrice === undefined ? "—" : `${o.totalPrice.toFixed(2)} ₪`}</td>
            <td>{o.createdAt ? new Date(o.createdAt).toLocaleDateString("ar-PS") : "—"}</td>
            {canAct && <td><div style={{ display: "flex", gap: 6, flexWrap: "wrap", minWidth: 280 }}>
              {allowed("orders.edit") && <><select aria-label={`الحالة الجديدة للطلب ${o.id}`} value={draftStatus[o.id] ?? o.status}
                onChange={e => setDraftStatus(s => ({ ...s, [o.id]: e.target.value }))}>
                <option value={o.status}>{o.status}</option>
                {statusOptions.filter(x => x.value !== o.status).map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
              </select><button type="button" disabled={busy} onClick={() => void run(o, "status")}>تعديل الحالة</button></>}
              {allowed("orders.cancel") && o.status === "new" && <button disabled={busy} type="button" onClick={() => void run(o, "cancel")}>إلغاء الطلب</button>}
              {allowed("orders.confirm-payment") && o.paymentMethod === "bank_transfer" && o.paymentStatus !== "confirmed" &&
                <button disabled={busy} type="button" onClick={() => void run(o, "payment")}>تأكيد التحويل</button>}
              {allowed("orders.delivery-cost") && <button disabled={busy} type="button" onClick={() => void run(o, "delivery-cost")}>تكلفة الشركة</button>}
              {allowed("orders.courier.cash") && <button disabled={busy} type="button" onClick={() => void run(o, "courier-cash")}>قبض المندوب</button>}
              {allowed("orders.courier.reverse") && <button disabled={busy} type="button" onClick={() => void run(o, "courier-reverse")}>عكس المندوب</button>}
            </div></td>}
          </tr>)}</tbody>
        </table>
      </div>
    </section>
  </main>;
}
