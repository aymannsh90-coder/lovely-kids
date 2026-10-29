import { useCallback, useEffect, useState, type FormEvent } from "react";
import { usePosRuntime } from "../../app/pos-context";
import { API_BASE_URL } from "../../lib/api";

type Staff = {
  id: string;
  name: string;
  phone: string;
  roleName: string;
  permissions: string[];
  enabled: boolean;
  createdAt: string;
};
type Audit = { id: number; actorUserId: number | null; targetUserId: number | null; action: string; createdAt: string };
type Role = "cashier" | "accountant" | "inventory" | "custom";
const roleOptions: { value: Role; label: string }[] = [
  { value: "cashier", label: "كاشير" },
  { value: "accountant", label: "محاسب" },
  { value: "inventory", label: "مسؤول مخزون" },
  { value: "custom", label: "مخصص" },
];
const permissionGroups = [
  { title: "المبيعات", items: [["sales.view", "عرض الفواتير"], ["sales.create", "إجراء بيع"], ["sales.edit", "تعديل فاتورة"], ["sales.void", "إلغاء بيع"], ["sales.returns", "مردود المبيعات"]] },
  { title: "الصندوق", items: [["cash.view", "عرض الصندوق"], ["cash.open", "فتح الصندوق"], ["cash.close", "إغلاق الصندوق"]] },
  { title: "المخزون", items: [["inventory.view", "عرض المخزون"], ["inventory.edit", "تعديل الأصناف"], ["inventory.cost", "مشاهدة التكلفة"]] },
  { title: "المشتريات", items: [["purchases.view", "عرض المشتريات"], ["purchases.create", "إضافة فاتورة"], ["purchases.edit", "تعديل فاتورة"]] },
  { title: "الزبائن والموردون", items: [["parties.view", "عرض"], ["parties.edit", "تعديل"]] },
  { title: "السندات", items: [["vouchers.view", "عرض"], ["vouchers.create", "إضافة"], ["vouchers.void", "إلغاء"]] },
  { title: "البنوك", items: [["banking.view", "عرض"], ["banking.create", "إنشاء حركة"]] },
  { title: "التقارير", items: [["reports.sales", "المبيعات"], ["reports.financial", "المالية"], ["reports.cost", "الربح والتكلفة"]] },
  { title: "الطلبات الإلكترونية", items: [["orders.view", "عرض"], ["orders.create", "إنشاء طلب"], ["orders.edit", "تعديل"], ["orders.cancel", "إلغاء"]] },
] as const;
const presets: Record<Role, string[]> = {
  cashier: ["sales.view", "sales.create", "cash.view"],
  accountant: ["sales.view", "purchases.view", "purchases.create", "parties.view", "vouchers.view", "vouchers.create", "banking.view", "reports.sales", "reports.financial"],
  inventory: ["inventory.view", "inventory.edit"],
  custom: [],
};
const cardStyle = { background: "var(--card-bg, #fff)", border: "1px solid #dce3ed", borderRadius: 12, padding: 18, marginBottom: 16 };
const fieldStyle = { width: "100%", padding: 10, border: "1px solid #cbd5e1", borderRadius: 8, boxSizing: "border-box" as const };

export default function StaffAccessPage() {
  const { token, user } = usePosRuntime();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [role, setRole] = useState<Role>("cashier");
  const [permissions, setPermissions] = useState<string[]>(presets.cashier);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const call = useCallback(async (route: string, init: RequestInit = {}) => {
    const response = await fetch(`${API_BASE_URL}/api/pos/access/${route}`, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init.headers },
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error || "تعذر إجراء العملية");
    }
    return response.json();
  }, [token]);

  const load = useCallback(async () => {
    const [users, logs] = await Promise.all([call("staff"), call("audit")]);
    setStaff(users as Staff[]);
    setAudit(logs as Audit[]);
  }, [call]);

  useEffect(() => {
    if (!user?.isOwner) return;
    void load().catch(e => setError(e.message));
  }, [load, user?.isOwner]);

  function reset() {
    setSelected(null);
    setName("");
    setPhone("");
    setPassword("");
    setOwnerPassword("");
    setRole("cashier");
    setPermissions([...presets.cashier]);
    setEnabled(true);
    setMessage("");
    setError("");
  }
  function edit(record: Staff) {
    setSelected(record.id);
    setName(record.name);
    setPhone(record.phone);
    setPassword("");
    setOwnerPassword("");
    setRole(record.roleName as Role);
    setPermissions([...record.permissions]);
    setEnabled(record.enabled);
    setMessage("");
    setError("");
  }
  function changeRole(next: Role) {
    setRole(next);
    setPermissions([...presets[next]]);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const payload = selected
        ? { roleName: role, permissions, enabled, ownerPassword, ...(password ? { password } : {}) }
        : { name, phone, password, ownerPassword, roleName: role, permissions };
      await call(selected ? `staff/${selected}` : "staff", {
        method: selected ? "PATCH" : "POST", body: JSON.stringify(payload),
      });
      await load();
      reset();
      setMessage("تم حفظ بيانات الموظف وصلاحياته بنجاح.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطأ غير متوقع");
    } finally { setBusy(false); }
  }

  if (!user?.isOwner) return <p>إدارة المستخدمين والصلاحيات للمالك فقط.</p>;

  return (
    <div dir="rtl" style={{ maxWidth: 1080, margin: "0 auto", padding: 12 }}>
      <header style={{ marginBottom: 20 }}>
        <h1>🔐 الصلاحيات وإدارة المستخدمين</h1>
        <p>المالك وحده يستطيع إضافة الموظفين وتعديل صلاحياتهم وتعطيلهم. كل تغيير يلغي جلسات الموظف القديمة.</p>
      </header>
      {error && <p role="alert" style={{ padding: 12, color: "#b91c1c", background: "#fee2e2", borderRadius: 8 }}>{error}</p>}
      {message && <p role="status" style={{ padding: 12, color: "#166534", background: "#dcfce7", borderRadius: 8 }}>{message}</p>}

      <section style={cardStyle}>
        <h2>الموظفون ({staff.length})</h2>
        <button type="button" className="primary-button" onClick={reset}>+ إضافة موظف جديد</button>
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table style={{ width: "100%", textAlign: "right", borderCollapse: "collapse" }}>
            <thead><tr><th>الاسم</th><th>رقم الجوال</th><th>الدور</th><th>الحالة</th><th>الإجراء</th></tr></thead>
            <tbody>{staff.map(s => (
              <tr key={s.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                <td>{s.name}</td><td dir="ltr">{s.phone}</td>
                <td>{roleOptions.find(r => r.value === s.roleName)?.label ?? s.roleName}</td>
                <td>{s.enabled ? "مفعل" : "معطل"}</td>
                <td><button type="button" onClick={() => edit(s)}>تعديل الصلاحيات</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section style={cardStyle}>
        <h2>{selected ? "تعديل موظف" : "إضافة مستخدم جديد"}</h2>
        <form onSubmit={save}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <label>اسم الموظف<input style={fieldStyle} required value={name} disabled={Boolean(selected)} onChange={e => setName(e.target.value)}/></label>
            <label>رقم الجوال<input style={fieldStyle} required dir="ltr" value={phone} disabled={Boolean(selected)} onChange={e => setPhone(e.target.value)}/></label>
            <label>الدور<select style={fieldStyle} value={role} onChange={e => changeRole(e.target.value as Role)}>
              {roleOptions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select></label>
            <label>{selected ? "كلمة مرور جديدة (اختياري)" : "كلمة مرور الموظف"}
              <input style={fieldStyle} dir="ltr" type="password" autoComplete="new-password" minLength={10} required={!selected} value={password} onChange={e => setPassword(e.target.value)}/>
            </label>
          </div>
          {selected && <label style={{ display: "block", marginTop: 14 }}><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}/> الحساب مفعل (إلغاؤه يمنع الدخول فورًا)</label>}
          <h3 style={{ marginTop: 22 }}>تحديد الصلاحيات</h3>
          <p style={{ fontSize: 13 }}>الصلاحيات تبدأ مقفلة؛ اختر العمليات التي يحتاجها الموظف. لن يتم منحه صلاحية المدير.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            {permissionGroups.map(group => (
              <fieldset key={group.title} style={{ border: "1px solid #d5dce5", borderRadius: 10, padding: 12 }}>
                <legend style={{ fontWeight: 700 }}>{group.title}</legend>
                {group.items.map(([key, label]) => (
                  <label key={key} style={{ display: "block", margin: "7px 0" }}>
                    <input type="checkbox" checked={permissions.includes(key)}
                      onChange={e => setPermissions(old => e.target.checked ? [...old, key] : old.filter(p => p !== key))}/>
                    {" "}{label}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <div style={{ marginTop: 20, maxWidth: 420 }}>
            <label>تأكيد كلمة مرور المالك (إجباري عند الحفظ)
              <input style={fieldStyle} required type="password" autoComplete="current-password" value={ownerPassword} onChange={e => setOwnerPassword(e.target.value)}/>
            </label>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            <button type="submit" className="primary-button" disabled={busy}>{busy ? "جاري الحفظ..." : selected ? "حفظ التغييرات" : "إضافة الموظف"}</button>
            <button type="button" onClick={reset}>إلغاء</button>
          </div>
        </form>
      </section>

      <section style={cardStyle}>
        <h2>سجل تغييرات الصلاحيات</h2>
        <div style={{ maxHeight: 220, overflowY: "auto" }}>
          {audit.length ? audit.map(log => <p key={log.id} style={{ borderBottom: "1px solid #e2e8f0", paddingBottom: 8 }}>
            <strong>{log.action === "staff_created" ? "إضافة موظف" : "تعديل الصلاحيات"}</strong>
            {" — "}المستخدم #{log.targetUserId}، بواسطة #{log.actorUserId}
            {" — "}{new Date(log.createdAt).toLocaleString("ar-PS")}
          </p>) : <p>لا يوجد نشاط مسجل بعد.</p>}
        </div>
      </section>
    </div>
  );
}
