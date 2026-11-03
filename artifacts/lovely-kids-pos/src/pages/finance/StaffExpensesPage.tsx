import { useEffect, useState, type FormEvent } from "react";
import { usePosRuntime } from "../../app/pos-context";
import { createPosExpense, getPosExpenseCategories, POS_REGISTER_KEY, type PosExpenseCategory } from "../../lib/api";

export default function StaffExpensesPage() {
  const { user, token, session } = usePosRuntime();
  const [categories, setCategories] = useState<PosExpenseCategory[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const canPost = Boolean(user?.permissions?.includes("finance.expenses.create"));

  useEffect(() => {
    let active = true;
    void getPosExpenseCategories(token).then(r => {
      if (active) setCategories(r.results.filter(c => c.status === "active"));
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : "تعذر تحميل تصنيفات المصروفات"); });
    return () => { active = false; };
  }, [token]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canPost || !session) {
      setError("لا تملك صلاحية تسجيل المصروف أو لا توجد جلسة صندوق مفتوحة");
      return;
    }
    setBusy(true); setError(""); setMessage("");
    try {
      await createPosExpense(token, {
        expenseCategoryId: Number(categoryId),
        amount,
        notes: notes.trim(),
        paymentMethod: "cash",
        registerKey: POS_REGISTER_KEY,
        idempotencyKey: crypto.randomUUID(),
      });
      setCategoryId(""); setAmount(""); setNotes("");
      setMessage("تم تسجيل المصروف النقدي. راجع سجل السندات للتفاصيل إذا كانت لديك صلاحية عرضه.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تسجيل المصروف");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main dir="rtl" style={{ padding: 20, maxWidth: 950, margin: "0 auto" }}>
      <section style={{ background: "var(--card-bg, white)", borderRadius: 14, padding: 20 }}>
        <h1>المصاريف اليومية</h1>
        <p>حساب الموظف: عرض التصنيفات وتسجيل مصروف نقدي مصرح به فقط. لا سلف، ولا رواتب، ولا مسحوبات مالك.</p>
        {error && <p role="alert" style={{ padding: 12, color: "#991b1b", background: "#fee2e2", borderRadius: 8 }}>{error}</p>}
        {message && <p role="status" style={{ padding: 12, color: "#166534", background: "#dcfce7", borderRadius: 8 }}>{message}</p>}
        {canPost ? (
          <form onSubmit={save} style={{ display: "grid", gap: 12 }}>
            <label>تصنيف المصروف
              <select required value={categoryId} onChange={e => setCategoryId(e.target.value)} style={{ display: "block", width: "100%", padding: 10 }}>
                <option value="">اختر التصنيف</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label>القيمة بالشيكل
              <input required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" style={{ display: "block", width: "100%", padding: 10 }} />
            </label>
            <label>ملاحظات
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} style={{ display: "block", width: "100%", padding: 10 }} />
            </label>
            <button className="primary-button" disabled={busy || !session} type="submit">{busy ? "جاري التسجيل..." : "تسجيل مصروف نقدي"}</button>
            {!session && <p>يلزم وجود يوم عمل مفتوح لتسجيل مصروف نقدي.</p>}
          </form>
        ) : <p>لديك صلاحية مشاهدة تصنيفات المصاريف فقط، وليس إنشاء حركة.</p>}
      </section>
    </main>
  );
}
