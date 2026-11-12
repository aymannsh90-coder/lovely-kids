import "./StaffOrdersVisualRefresh.css";
import { useEffect, useMemo, useState } from "react";
import { usePosRuntime } from "../../app/pos-context";
import { API_BASE_URL } from "../../lib/api";

type OrderStatus = "new" | "confirmed" | "delivering" | "done" | "cancelled";
type OrderRow = {
  id: number;
  customerName: string;
  customerPhone: string;
  status: OrderStatus;
  totalPrice: number;
  shippingZone: string | null;
  createdAt: string;
  paymentMethod?: string | null;
};
const statusLabels: Record<OrderStatus, string> = {
  new: "جديد", confirmed: "مؤكد", delivering: "قيد التوصيل",
  done: "تم الاستلام", cancelled: "ملغي",
};
const card = { background: "#fff", border: "1px solid #dfe5ec", borderRadius: 12, padding: 18 };
const control = { border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 12px", background: "#fff" };

export default function StaffOrdersPage() {
  const { token, user, clearAuthentication } = usePosRuntime();
  const canEdit = Boolean(user?.isOwner || user?.isAdmin || user?.permissions?.includes("orders.edit"));
  const canCancel = Boolean(user?.isOwner || user?.isAdmin || user?.permissions?.includes("orders.cancel"));
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [pendingStatus, setPendingStatus] = useState<Record<number, OrderStatus>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function request(path: string, init: RequestInit = {}) {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...init, cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      clearAuthentication();
      throw new Error("انتهت جلسة الدخول");
    }
    if (!res.ok) throw new Error((data as { error?: string }).error || "تعذر تنفيذ الطلب");
    return data;
  }

  async function load() {
    setBusy(true);
    setError("");
    try {
      const response = await request("/api/orders");
      if (!Array.isArray(response)) throw new Error("صيغة قائمة الطلبات غير صحيحة");
      setOrders(response as OrderRow[]);
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر قراءة الطلبات"); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, [token]);

  const shown = useMemo(() => orders.filter(order => {
    if (statusFilter !== "all" && order.status !== statusFilter) return false;
    const term = filter.trim().toLowerCase();
    return !term || String(order.id).includes(term) ||
      (order.customerName ?? "").toLowerCase().includes(term) ||
      (order.customerPhone ?? "").includes(term);
  }), [orders, filter, statusFilter]);

  async function saveStatus(order: OrderRow) {
    const next = pendingStatus[order.id] ?? order.status;
    if (next === order.status) return;
    if (next === "cancelled") {
      await cancelOrder(order);
      return;
    }
    if (!window.confirm(`تغيير حالة الطلب #${order.id} إلى ${statusLabels[next]}؟\nقد تؤثر الحالة على المخزون والمالية.`)) return;
    setBusyId(order.id); setError(""); setMessage("");
    try {
      await request(`/api/orders/${order.id}/status`, {
        method: "PATCH", body: JSON.stringify({ status: next }),
      });
      await load();
      setMessage(`تم تحديث حالة الطلب #${order.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "فشل تعديل الطلب"); }
    finally { setBusyId(null); }
  }

  async function cancelOrder(order: OrderRow) {
    if (!canCancel || order.status !== "new") return;
    if (!window.confirm(`إلغاء الطلب الجديد #${order.id} وإعادة الأصناف للمخزون؟`)) return;
    setBusyId(order.id); setError(""); setMessage("");
    try {
      await request(`/api/orders/${order.id}/cancel`, { method: "PATCH", body: "{}" });
      await load();
      setMessage(`تم إلغاء الطلب #${order.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "فشل إلغاء الطلب"); }
    finally { setBusyId(null); }
  }

  return <div className="lk-online-orders-page" dir="rtl" style={{ maxWidth: 1450, margin: "0 auto", padding: 16 }}>
    <section style={{ ...card, marginBottom: 14 }}>
      <h1 style={{ marginTop: 0 }}>إدارة الطلبات الإلكترونية</h1>
      <p>عرض الطلبات وصلاحيات تعديل الحالة والإلغاء حسب التفويض من المالك. لا تتوفر هنا وظيفة الحذف النهائي أو عكس قيد الديلفري.</p>
      {error && <p role="alert" style={{ color: "#b91c1c" }}>{error}</p>}
      {message && <p role="status" style={{ color: "#15803d" }}>{message}</p>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input style={{ ...control, minWidth: 260, flex: 1 }} value={filter} onChange={e => setFilter(e.target.value)}
          placeholder="ابحث برقم الطلب أو اسم الزبون أو الجوال" />
        <select style={control} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">جميع الحالات</option>
          {(Object.keys(statusLabels) as OrderStatus[]).map(s => <option key={s} value={s}>{statusLabels[s]}</option>)}
        </select>
        <button type="button" style={control} disabled={busy} onClick={() => void load()}>{busy ? "جاري التحميل…" : "تحديث"}</button>
      </div>
      <p style={{ color: "#64748b" }}>المعروض: {shown.length} طلب</p>
    </section>
    <div style={{ ...card, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "right" }}>
        <thead><tr>{["الطلب", "الزبون", "الجوال", "القيمة", "المنطقة", "التاريخ", "الحالة", "الإجراء"].map(h => <th key={h} style={{ padding: 10, borderBottom: "1px solid #cbd5e1" }}>{h}</th>)}</tr></thead>
        <tbody>{shown.map(order => <tr key={order.id}>
          <td style={{ padding: 10, borderBottom: "1px solid #edf2f7" }}>#{order.id}</td>
          <td>{order.customerName}</td><td dir="ltr">{order.customerPhone}</td>
          <td>{Number(order.totalPrice).toLocaleString("en-US")} ₪</td>
          <td>{order.shippingZone ?? "—"}</td><td>{order.createdAt?.slice(0, 10) ?? "—"}</td>
          <td>{statusLabels[order.status] ?? order.status}</td>
          <td style={{ padding: 6 }}>
            {canEdit && !["done", "cancelled"].includes(order.status) ? <div style={{ display: "flex", gap: 5 }}>
              <select style={control} value={pendingStatus[order.id] ?? order.status}
                onChange={e => setPendingStatus(p => ({ ...p, [order.id]: e.target.value as OrderStatus }))}>
                <option value={order.status}>{statusLabels[order.status]}</option>
                {(order.status === "new" ? ["confirmed"] : order.status === "confirmed" ? ["delivering", "done"] : ["done"]).map(s =>
                  <option key={s} value={s}>{statusLabels[s as OrderStatus]}</option>)}
              </select>
              <button type="button" style={control} disabled={busyId === order.id} onClick={() => void saveStatus(order)}>حفظ</button>
            </div> : null}
            {canCancel && order.status === "new" && <button type="button" style={{ ...control, color: "#b91c1c" }}
              disabled={busyId === order.id} onClick={() => void cancelOrder(order)}>إلغاء طلب</button>}
          </td>
        </tr>)}</tbody>
      </table>
      {!shown.length && !busy && <p>لا توجد طلبات مطابقة.</p>}
    </div>
  </div>;
}
