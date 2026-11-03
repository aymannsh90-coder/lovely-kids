import { useEffect, useState, type FormEvent } from "react";
import { usePosRuntime } from "../../app/pos-context";
import {
  createPosBankAccount, createPosCurrencyConversion, createPosFinanceCashAccount,
  createPosFinanceTransfer, getPosBankAccounts, getPosCurrencyConversions,
  getPosFinanceBankingReference, getPosFinanceCashAccounts, getPosFinanceTransfers,
  reversePosCurrencyConversion, reversePosFinanceTransfer, savePosExchangeRate,
  type PosBank, type PosBankAccount, type PosCurrencyConversion, type PosFinanceCashAccount,
  type PosFinanceTransfer,
} from "../../lib/api";

const money = (minor: number, currency = "ILS") =>
  `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)} ${currency === "ILS" ? "₪" : currency}`;

const sectionStyle = { padding: 16, marginTop: 16, border: "1px solid #d9e1ee", borderRadius: 12 };
const inputStyle = { display: "block" as const, width: "100%", padding: 10, marginTop: 4, boxSizing: "border-box" as const };

export default function StaffBankingOverviewPage() {
  const { token, user } = usePosRuntime();
  const canCreate = Boolean(user?.permissions?.includes("banking.create"));
  const canManage = Boolean(user?.permissions?.includes("banking.manage"));
  const canReverse = Boolean(user?.permissions?.includes("banking.reverse"));
  const [accounts, setAccounts] = useState<PosBankAccount[]>([]);
  const [cashAccounts, setCashAccounts] = useState<PosFinanceCashAccount[]>([]);
  const [banks, setBanks] = useState<PosBank[]>([]);
  const [transfers, setTransfers] = useState<PosFinanceTransfer[]>([]);
  const [conversions, setConversions] = useState<PosCurrencyConversion[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [conversion, setConversion] = useState(false);
  const [toAmount, setToAmount] = useState("");
  const [newBankId, setNewBankId] = useState("");
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountCurrency, setNewAccountCurrency] = useState("ILS");
  const [rateCurrency, setRateCurrency] = useState("USD");
  const [rateValue, setRateValue] = useState("");
  const [newCashName, setNewCashName] = useState("");

  const combined = [
    ...cashAccounts.map(a => ({ id: a.id, name: a.name, currencyCode: a.currencyCode })),
    ...accounts.map(a => ({ id: a.financeAccountId, name: a.name, currencyCode: a.currencyCode })),
  ];

  async function load() {
    setBusy(true); setError("");
    try {
      const [bankResult, transfersResult, cashResult, conversionResult, reference] = await Promise.all([
        getPosBankAccounts(token), getPosFinanceTransfers(token),
        getPosFinanceCashAccounts(token), getPosCurrencyConversions(token),
        getPosFinanceBankingReference(token),
      ]);
      setAccounts(bankResult.results);
      setTransfers(transfersResult.results);
      setCashAccounts(cashResult.results);
      setConversions(conversionResult.results);
      setBanks(reference.banks);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر تحميل الحسابات البنكية");
    } finally { setBusy(false); }
  }

  useEffect(() => { void load(); }, [token]);

  async function execute(task: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await task();
      setMessage(success);
      // load owns the loading indicator and refreshes balances.
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر تنفيذ العملية");
    } finally { setBusy(false); }
  }

  async function submitTransfer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canCreate) return;
    const source = combined.find(x => String(x.id) === fromId);
    const target = combined.find(x => String(x.id) === toId);
    if (!source || !target || source.id === target.id) {
      setError("حدد حساب مصدر ووجهة مختلفين"); return;
    }
    if (conversion ? source.currencyCode === target.currencyCode : source.currencyCode !== target.currencyCode) {
      setError(conversion ? "تحويل العملات يحتاج عملتين مختلفتين" : "التحويل العادي يحتاج نفس العملة"); return;
    }
    if (!(Number(amount) > 0) || (conversion && !(Number(toAmount) > 0))) {
      setError("أدخل مبلغ تحويل صحيحًا"); return;
    }
    if (!window.confirm(`تأكيد ${conversion ? "تحويل العملة" : "التحويل"} من ${source.name} إلى ${target.name} بقيمة ${amount} ${source.currencyCode}؟ سيُسجل قيد محاسبي.`)) return;
    void execute(
      () => conversion
        ? createPosCurrencyConversion(token, { fromAccountId: source.id, toAccountId: target.id, fromAmount: amount, toAmount, notes: note.trim(), idempotencyKey: crypto.randomUUID() })
        : createPosFinanceTransfer(token, { fromAccountId: source.id, toAccountId: target.id, amount, notes: note.trim(), idempotencyKey: crypto.randomUUID() }),
      "تم تسجيل التحويل بنجاح.",
    );
  }

  function reverse(type: "transfer" | "conversion", publicId: string) {
    if (!canReverse) return;
    const reason = window.prompt(`سبب عكس ${publicId}:`);
    if (!reason?.trim() || !window.confirm(`تأكيد عكس ${publicId}؟ سيُسجَّل قيد عكسي ولن تُحذف الحركة التاريخية.`)) return;
    void execute(
      () => type === "transfer"
        ? reversePosFinanceTransfer(token, { publicId, reason: reason.trim() })
        : reversePosCurrencyConversion(token, { publicId, reason: reason.trim() }),
      "تم عكس الحركة وإعادة تحميل الأرصدة.",
    );
  }

  async function addBankAccount(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canManage || !newBankId || !newAccountName.trim()) return;
    if (!window.confirm("إنشاء حساب بنكي جديد؟ سيتم إدراجه في دليل الحسابات.")) return;
    void execute(
      () => createPosBankAccount(token, { bankId: Number(newBankId), name: newAccountName.trim(), currencyCode: newAccountCurrency }),
      "تم إنشاء الحساب البنكي.",
    );
  }

  async function addCash(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canManage || !newCashName.trim()) return;
    if (!window.confirm("إضافة صندوق محاسبي جديد؟")) return;
    void execute(() => createPosFinanceCashAccount(token, { name: newCashName.trim(), currencyCode: "ILS" }), "تم إنشاء الصندوق.");
  }

  async function addRate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canManage || !(Number(rateValue) > 0)) return;
    if (!window.confirm(`حفظ سعر صرف ${rateCurrency} مقابل الشيكل بقيمة ${rateValue}؟`)) return;
    void execute(() => savePosExchangeRate(token, { currencyCode: rateCurrency, ilsPerUnit: rateValue }), "تم حفظ سعر الصرف.");
  }

  return <main dir="rtl" style={{ padding: 20 }}>
    <section style={{ background: "var(--card-bg, white)", borderRadius: 12, padding: 18 }}>
      <h1>🏦 الحسابات البنكية والتحويلات</h1>
      <p>لكل إجراء إذن مستقل من المالك. لا يُسمح بالتحويل أو العكس إلا بعد تأكيد العملية.</p>
      <button type="button" disabled={busy} onClick={() => void load()}>{busy ? "جاري التحديث..." : "تحديث"}</button>
      {error && <p role="alert" style={{ padding: 10, color: "#991b1b" }}>{error}</p>}
      {message && <p role="status" style={{ padding: 10, color: "#166534" }}>{message}</p>}
      <h2>الحسابات البنكية ({accounts.length})</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", textAlign: "right" }}>
          <thead><tr><th>البنك</th><th>الحساب</th><th>العملة</th><th>الرصيد</th></tr></thead>
          <tbody>{accounts.map(a => <tr key={a.id}>
            <td>{a.bank.nameAr}</td><td>{a.name}</td><td>{a.currencyCode}</td>
            <td>{money(a.currencyBalanceMinor, a.currencyCode)}</td>
          </tr>)}</tbody>
        </table>
      </div>

      {canCreate && <section style={sectionStyle}>
        <h2>إنشاء تحويل</h2>
        <form onSubmit={submitTransfer} style={{ display: "grid", gap: 12 }}>
          <label><input type="checkbox" checked={conversion} onChange={e => setConversion(e.target.checked)} /> تحويل بين عملتين مختلفتين</label>
          <label>الحساب المصدر <select required style={inputStyle} value={fromId} onChange={e => setFromId(e.target.value)}>
            <option value="">اختر</option>{combined.map(a => <option key={a.id} value={a.id}>{a.name} — {a.currencyCode}</option>)}
          </select></label>
          <label>حساب الوجهة <select required style={inputStyle} value={toId} onChange={e => setToId(e.target.value)}>
            <option value="">اختر</option>{combined.map(a => <option key={a.id} value={a.id}>{a.name} — {a.currencyCode}</option>)}
          </select></label>
          <label>المبلغ من المصدر <input required type="number" min="0.01" step="0.01" style={inputStyle} value={amount} onChange={e => setAmount(e.target.value)} /></label>
          {conversion && <label>المبلغ المستلم بالعملة الأخرى <input required type="number" min="0.01" step="0.01" style={inputStyle} value={toAmount} onChange={e => setToAmount(e.target.value)} /></label>}
          <label>بيان <input style={inputStyle} value={note} onChange={e => setNote(e.target.value)} /></label>
          <button disabled={busy} type="submit" className="primary-button">تسجيل التحويل</button>
        </form>
      </section>}

      <section style={sectionStyle}>
        <h2>آخر التحويلات ({transfers.length})</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", textAlign: "right" }}>
            <thead><tr><th>السند</th><th>التاريخ</th><th>من</th><th>إلى</th><th>المبلغ</th><th>الحالة</th>{canReverse && <th>الإجراء</th>}</tr></thead>
            <tbody>{transfers.slice(0, 100).map(t => <tr key={t.transaction.id}>
              <td>{t.transaction.publicId}</td><td>{t.transaction.businessDate}</td>
              <td>{t.source?.name ?? "—"}</td><td>{t.destination?.name ?? "—"}</td>
              <td>{money(t.amountMinor, t.source?.currencyCode)}</td><td>{t.transaction.status}</td>
              {canReverse && <td>{t.transaction.status === "posted" &&
                <button type="button" disabled={busy} onClick={() => reverse("transfer", t.transaction.publicId)}>عكس التحويل</button>}</td>}
            </tr>)}</tbody>
          </table>
        </div>
        <h3>تحويلات العملات ({conversions.length})</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", textAlign: "right" }}>
            <thead><tr><th>السند</th><th>من</th><th>إلى</th><th>الصادر</th><th>المستلم</th><th>الحالة</th>{canReverse && <th>الإجراء</th>}</tr></thead>
            <tbody>{conversions.slice(0, 100).map(t => <tr key={t.transaction.id}>
              <td>{t.transaction.publicId}</td><td>{t.source?.name ?? "—"}</td><td>{t.destination?.name ?? "—"}</td>
              <td>{money(t.fromAmountMinor, t.source?.currencyCode)}</td>
              <td>{money(t.toAmountMinor, t.destination?.currencyCode)}</td>
              <td>{t.transaction.status}</td>
              {canReverse && <td>{t.transaction.status === "posted" &&
                <button disabled={busy} type="button" onClick={() => reverse("conversion", t.transaction.publicId)}>عكس التحويل</button>}</td>}
            </tr>)}</tbody>
          </table>
        </div>
      </section>

      {canManage && <section style={sectionStyle}>
        <h2>إدارة الحسابات وأسعار الصرف</h2>
        <form onSubmit={addBankAccount} style={{ display: "grid", gap: 9, marginBottom: 18 }}>
          <h3>إضافة حساب بنكي</h3>
          <label>البنك <select required style={inputStyle} value={newBankId} onChange={e => setNewBankId(e.target.value)}>
            <option value="">اختر</option>{banks.map(b => <option key={b.id} value={b.id}>{b.nameAr}</option>)}
          </select></label>
          <label>اسم الحساب <input required style={inputStyle} value={newAccountName} onChange={e => setNewAccountName(e.target.value)} /></label>
          <label>العملة <select style={inputStyle} value={newAccountCurrency} onChange={e => setNewAccountCurrency(e.target.value)}>
            <option value="ILS">شيكل</option><option value="USD">دولار</option><option value="JOD">دينار</option>
          </select></label>
          <button disabled={busy} type="submit">إنشاء الحساب</button>
        </form>
        <form onSubmit={addCash} style={{ display: "grid", gap: 9, marginBottom: 18 }}>
          <h3>إضافة صندوق</h3><label>اسم الصندوق <input required style={inputStyle} value={newCashName} onChange={e => setNewCashName(e.target.value)} /></label>
          <button disabled={busy} type="submit">إنشاء الصندوق</button>
        </form>
        <form onSubmit={addRate} style={{ display: "grid", gap: 9 }}>
          <h3>سعر الصرف</h3><label>العملة <select style={inputStyle} value={rateCurrency} onChange={e => setRateCurrency(e.target.value)}>
            <option value="USD">دولار</option><option value="JOD">دينار</option>
          </select></label>
          <label>شيكل لكل وحدة عملة <input required type="number" min="0.000001" step="any" style={inputStyle} value={rateValue} onChange={e => setRateValue(e.target.value)} /></label>
          <button disabled={busy} type="submit">حفظ سعر الصرف</button>
        </form>
      </section>}
    </section>
  </main>;
}
