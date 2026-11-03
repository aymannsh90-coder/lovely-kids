import { useEffect, useState } from "react";
import { usePosRuntime } from "../../app/pos-context";
import {
  getPosBankAccounts, getPosFinanceTransfers,
  type PosBankAccount, type PosFinanceTransfer,
} from "../../lib/api";

const money = (minor: number, currency = "ILS") =>
  `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)} ${currency === "ILS" ? "₪" : currency}`;

export default function StaffBankingOverviewPage() {
  const { token } = usePosRuntime();
  const [accounts, setAccounts] = useState<PosBankAccount[]>([]);
  const [transfers, setTransfers] = useState<PosFinanceTransfer[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true); setError("");
    try {
      const [banks, movements] = await Promise.all([
        getPosBankAccounts(token), getPosFinanceTransfers(token),
      ]);
      setAccounts(banks.results);
      setTransfers(movements.results);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر تحميل الحسابات البنكية");
    } finally { setBusy(false); }
  }

  useEffect(() => { void load(); }, [token]);

  return <main dir="rtl" style={{ padding: 20 }}>
    <section style={{ background: "var(--card-bg, white)", borderRadius: 12, padding: 18 }}>
      <h1>🏦 البنوك والتحويلات — عرض فقط</h1>
      <p>يمكنك مراجعة الحسابات والحركات المصرح بها. إنشاء الحسابات والتحويلات وعكسها يحتاج صلاحيات مستقلة من المالك.</p>
      <button type="button" disabled={busy} onClick={() => void load()}>{busy ? "جاري التحديث..." : "تحديث"}</button>
      {error && <p role="alert" style={{ color: "#991b1b" }}>{error}</p>}
      <h2>الحسابات ({accounts.length})</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", textAlign: "right" }}>
          <thead><tr><th>البنك</th><th>الحساب</th><th>العملة</th><th>الرصيد</th></tr></thead>
          <tbody>{accounts.map(a => <tr key={a.id}>
            <td>{a.bank.nameAr}</td><td>{a.name}</td><td>{a.currencyCode}</td>
            <td>{money(a.currencyBalanceMinor, a.currencyCode)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <h2>آخر التحويلات ({transfers.length})</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", textAlign: "right" }}>
          <thead><tr><th>السند</th><th>التاريخ</th><th>من</th><th>إلى</th><th>المبلغ</th><th>الحالة</th></tr></thead>
          <tbody>{transfers.slice(0, 100).map(t => <tr key={t.transaction.id}>
            <td>{t.transaction.publicId}</td><td>{t.transaction.businessDate}</td>
            <td>{t.source?.name ?? "—"}</td><td>{t.destination?.name ?? "—"}</td>
            <td>{money(t.amountMinor, t.source?.currencyCode)}</td><td>{t.transaction.status}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
  </main>;
}
