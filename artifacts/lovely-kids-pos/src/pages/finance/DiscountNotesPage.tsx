import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { usePosRuntime } from "../../app/pos-context";
import {
  ApiError,
  createPosFinanceDiscountNote,
  getPosCustomers,
  getPosFinanceVouchers,
  getPosSuppliers,
  voidPosFinanceVoucher,
  type PosCustomer,
  type PosFinanceVoucher,
  type PosSupplier,
} from "../../lib/api";
import "./FinanceVisualRefresh.css";

type Kind = "customer_credit" | "customer_debit" | "supplier_earned";

const kinds: Array<{ value: Kind; label: string; description: string }> = [
  {
    value: "customer_credit",
    label: "إشعار دائن للزبون — خصم مسموح به",
    description: "يقلّل دين الزبون دون تعديل الفاتورة أو دخول أي مبلغ للصندوق.",
  },
  {
    value: "customer_debit",
    label: "إشعار مدين للزبون",
    description: "يزيد دين الزبون مقابل تسوية مالية مبرّرة؛ لا يستخدم لبيع أصناف جديدة.",
  },
  {
    value: "supplier_earned",
    label: "خصم مكتسب من المورد",
    description: "خصم تسوية ذمة المورد فقط؛ لا يصحّح أسعار أو تكلفة الأصناف في فاتورة المشتريات.",
  },
];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "تعذرت العملية";
}

function newKey() {
  return "discount_note:" +
    (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now() + "_" + Math.random().toString(16).slice(2));
}

function displayMoney(minor: number) {
  return (minor / 100).toFixed(2) + " ₪";
}

const notePrefixes = ["CRN-", "DBN-", "SDS-"];

export default function DiscountNotesPage() {
  const { token, clearAuthentication } = usePosRuntime();
  const [kind, setKind] = useState<Kind>("customer_credit");
  const [partyId, setPartyId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [customers, setCustomers] = useState<PosCustomer[]>([]);
  const [suppliers, setSuppliers] = useState<PosSupplier[]>([]);
  const [vouchers, setVouchers] = useState<PosFinanceVoucher[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [voidingId, setVoidingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const pendingKey = useRef<string | null>(null);

  const options = useMemo(() => kind === "supplier_earned"
    ? suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name, balanceMinor: null as number | null }))
    : customers.map((customer) => ({
        id: customer.id,
        name: customer.name,
        balanceMinor: customer.balanceMinor as number | null,
      })), [kind, customers, suppliers]);

  const chosen = options.find((item) => String(item.id) === partyId);
  const selectedKind = kinds.find((item) => item.value === kind)!;
  const recentNotes = vouchers.filter((voucher) =>
    notePrefixes.some((prefix) => voucher.publicId.startsWith(prefix)));

  async function load() {
    setBusy(true);
    try {
      const [customerData, supplierData, voucherData] = await Promise.all([
        getPosCustomers(token, { status: "active" }),
        getPosSuppliers(token, { status: "active" }),
        getPosFinanceVouchers(token, { type: "adjustment" }),
      ]);
      setCustomers(customerData.results);
      setSuppliers(supplierData.results);
      setVouchers(voucherData.results);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        clearAuthentication();
        return;
      }
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, [token]);

  function changed() {
    pendingKey.current = null;
    setError("");
    setSuccess("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!partyId) {
      setError("اختر الزبون أو المورد.");
      return;
    }
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0 ||
      !/^\d+(\.\d{1,2})?$/.test(amount.trim())) {
      setError("أدخل مبلغ خصم صحيحًا بالشيكل.");
      return;
    }
    if (reason.trim().length < 5) {
      setError("اكتب سبب الإشعار (5 أحرف على الأقل).");
      return;
    }
    if (kind === "customer_credit" && chosen?.balanceMinor != null &&
      Math.round(Number(amount) * 100) > chosen.balanceMinor) {
      setError("الخصم أكبر من الرصيد الحالي للزبون.");
      return;
    }

    setError("");
    setSuccess("");
    setSaving(true);
    const key = pendingKey.current ?? newKey();
    pendingKey.current = key;
    try {
      const result = await createPosFinanceDiscountNote(token, {
        kind,
        partyId: Number(partyId),
        amount,
        reason: reason.trim(),
        reference: reference.trim() || undefined,
        idempotencyKey: key,
      });
      pendingKey.current = null;
      setSuccess("تم حفظ " + result.voucher.publicId + " مع القيد المحاسبي. لا يوجد أي أثر على الصندوق.");
      setAmount("");
      setReason("");
      setReference("");
      await load();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        clearAuthentication();
        return;
      }
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function voidNote(voucher: PosFinanceVoucher) {
    const reason = window.prompt("سبب عكس الإشعار " + voucher.publicId + " (لن يُحذف من السجل):");
    if (!reason || reason.trim().length < 5) return;
    setVoidingId(voucher.id);
    setError("");
    setSuccess("");
    try {
      await voidPosFinanceVoucher(token, voucher.id, reason.trim());
      setSuccess("تم إلغاء الإشعار بقيد عكسي. لا يوجد تأثير على الصندوق.");
      await load();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        clearAuthentication();
        return;
      }
      setError(errorMessage(caught));
    } finally {
      setVoidingId(null);
    }
  }

  const labelFor = (voucher: PosFinanceVoucher) =>
    voucher.publicId.startsWith("CRN-") ? "إشعار دائن للزبون"
      : voucher.publicId.startsWith("DBN-") ? "إشعار مدين للزبون"
      : "خصم مكتسب من المورد";

  return (
    <section className="work-panel lk-finance-refresh" dir="rtl">
      <div className="panel-heading lk-finance-header">
        <div>
          <h2>الإشعارات والخصومات</h2>
          <p>تسويات غير نقدية مستقلة عن الفواتير والمخزون، وتظهر في حسابات الأطراف وميزان المراجعة.</p>
        </div>
        <Link className="secondary-button" to="/vouchers/register">سجل السندات</Link>
      </div>

      <form className="lk-finance-form" onSubmit={submit} style={{ display: "grid", gap: 13, maxWidth: 850 }}>
        <label>
          <span>نوع الإشعار</span>
          <select value={kind} disabled={saving} onChange={(event) => {
            changed(); setKind(event.target.value as Kind); setPartyId("");
          }}>
            {kinds.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </select>
        </label>
        <div style={{ fontSize: 13, color: "#526275" }}>{selectedKind.description}</div>
        <label>
          <span>{kind === "supplier_earned" ? "المورد" : "الزبون"}</span>
          <select value={partyId} disabled={busy || saving} onChange={(event) => {
            changed(); setPartyId(event.target.value);
          }}>
            <option value="">اختر</option>
            {options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        {kind !== "supplier_earned" && chosen?.balanceMinor != null && (
          <div>الرصيد الحالي للزبون: <strong>{displayMoney(chosen.balanceMinor)}</strong></div>
        )}
        <label>
          <span>قيمة الإشعار ₪</span>
          <input required type="number" dir="ltr" min="0.01" step="0.01"
            value={amount} disabled={saving} onChange={(event) => {
              changed(); setAmount(event.target.value);
            }}/>
        </label>
        <label>
          <span>سبب الإشعار (إجباري)</span>
          <textarea required minLength={5} maxLength={500} rows={2}
            value={reason} disabled={saving} onChange={(event) => {
              changed(); setReason(event.target.value);
            }} placeholder="مثال: خصم تسوية الحساب عند الدفع"/>
        </label>
        <label>
          <span>مرجع اختياري (رقم فاتورة / اتفاق)</span>
          <input maxLength={100} value={reference} disabled={saving}
            onChange={(event) => { changed(); setReference(event.target.value); }}/>
        </label>
        {kind === "supplier_earned" && <div className="error-message">
          هذا خصم تسوية دين المورد فقط، وليس تصحيحًا لتكلفة المخزون أو فاتورة المشتريات.
        </div>}
        <div>المبلغ لا يدخل الصندوق. الإلغاء يتم بقيد عكسي، وليس بحذف السند.</div>
        {error && <div className="error-message">{error}</div>}
        {success && <div className="lk-finance-success">{success}</div>}
        <button className="primary-button" type="submit" disabled={busy || saving}>
          {saving ? "جاري تسجيل الإشعار..." : "حفظ الإشعار وترحيله"}
        </button>
      </form>

      <div style={{ marginTop: 24 }}>
        <h3>آخر الإشعارات</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 670 }}>
            <thead>
              <tr><th>التاريخ</th><th>المستند</th><th>النوع</th><th>المبلغ</th><th>الحالة</th><th>الإجراء</th></tr>
            </thead>
            <tbody>
              {recentNotes.length === 0 && (
                <tr><td colSpan={6}>لا توجد إشعارات مسجلة.</td></tr>
              )}
              {recentNotes.map((voucher) => (
                <tr key={voucher.id}>
                  <td>{voucher.businessDate}</td>
                  <td dir="ltr">{voucher.publicId}</td>
                  <td>{labelFor(voucher)}</td>
                  <td>{displayMoney(voucher.amountMinor)}</td>
                  <td>{voucher.status === "posted" ? "مرحّل" : "ملغى"}</td>
                  <td>
                    {voucher.status === "posted" && (
                      <button type="button" className="secondary-button"
                        disabled={voidingId === voucher.id || saving}
                        onClick={() => void voidNote(voucher)}>
                        {voidingId === voucher.id ? "جاري الإلغاء" : "إلغاء بقيد عكسي"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
