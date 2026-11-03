import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { usePosRuntime } from "../../app/pos-context";
import { createPosPurchaseReturn, getPosPurchaseReturnDetail, getPosPurchaseReturnHistory, getPosPurchaseReturnPreview, voidPosPurchaseReturn, type PosPurchaseReturnDetail, type PosPurchaseReturnPreview } from "../../lib/api";
import "./PurchaseReturnsPage.css";

type PurchaseLine = PosPurchaseReturnPreview["lines"][number];
type StockOption = PurchaseLine["options"][number];
const formatMoney = (minor: number) => new Intl.NumberFormat("ar-PS", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100) + " ₪";
const selectionKey = (line: PurchaseLine, option: StockOption) => JSON.stringify([line.id, option.color, option.size]);
const newKey = () => typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
  ? crypto.randomUUID() : "pret-" + Date.now() + "-" + Math.random().toString(36).slice(2);
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "حدث خطأ غير متوقع";

export default function PurchaseReturnsPage() {
  const { token } = usePosRuntime();
  const [purchaseNo, setPurchaseNo] = useState("");
  const [preview, setPreview] = useState<PosPurchaseReturnPreview | null>(null);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("إرجاع بضاعة إلى المورد");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [history, setHistory] = useState<PosPurchaseReturnDetail["purchaseReturn"][]>([]);
  const [saved, setSaved] = useState<PosPurchaseReturnDetail | null>(null);
  const requestKey = useRef<string | null>(null);
  const [voidReason, setVoidReason] = useState("إلغاء مردود المشتريات");

  const requested = useMemo(() => {
    if (!preview) return [];
    return preview.lines.flatMap(line => line.options.map(option => ({
      purchaseItemId: line.id, color: option.color, size: option.size,
      quantity: selected[selectionKey(line, option)] ?? 0,
    })).filter(row => row.quantity > 0));
  }, [preview, selected]);
  const requestedTotal = requested.reduce((sum, item) => sum + item.quantity, 0);
  const invalidSelected = requested.some(row => {
    const line = preview?.lines.find(l => l.id === row.purchaseItemId);
    const option = line?.options.find(o => o.color === row.color && o.size === row.size);
    return !line || !option || option.stock === null || option.stock < row.quantity;
  }) || (preview?.lines.some(line =>
    requested.filter(r => r.purchaseItemId === line.id).reduce((s, r) => s + r.quantity, 0) > line.availableToReturn
  ) ?? false);

  async function refreshHistory(purchasePublicId?: string) {
    const result = await getPosPurchaseReturnHistory(token, purchasePublicId);
    setHistory(result.returns);
  }
  useEffect(() => { void refreshHistory().catch(() => {}); }, [token]);

  async function openPurchase(event?: FormEvent) {
    event?.preventDefault();
    if (!purchaseNo.trim()) { setError("أدخل رقم فاتورة المشتريات"); return; }
    setBusy(true); setError(""); setSuccess(""); setSaved(null);
    try {
      const result = await getPosPurchaseReturnPreview(token, purchaseNo.trim());
      setPreview(result); setSelected({}); requestKey.current = null;
      await refreshHistory(result.purchase.publicId);
    } catch (e) { setError(errorMessage(e)); setPreview(null); }
    finally { setBusy(false); }
  }

  function changeQuantity(line: PurchaseLine, option: StockOption, value: string) {
    const n = Number(value);
    setSelected(prev => ({ ...prev, [selectionKey(line, option)]: Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0 }));
    requestKey.current = null; setSuccess("");
  }
  function chooseFull(line: PurchaseLine) {
    let remaining = line.availableToReturn;
    const update: Record<string, number> = {};
    for (const option of line.options) {
      const quantity = Math.min(Math.max(0, option.stock ?? 0), remaining);
      update[selectionKey(line, option)] = quantity; remaining -= quantity;
    }
    if (remaining > 0) { setError("المخزون الفعلي لا يكفي للمردود الكامل؛ اختر مردودًا جزئيًا أو راجع المخزون"); return; }
    setSelected(prev => ({ ...prev, ...update })); requestKey.current = null; setError("");
  }
  function clearLine(line: PurchaseLine) {
    setSelected(prev => {
      const next = { ...prev };
      for (const option of line.options) delete next[selectionKey(line, option)];
      return next;
    });
    requestKey.current = null;
  }

  async function saveReturn() {
    if (!preview || busy) return;
    if (!requested.length || invalidSelected) {
      setError("راجع الكميات؛ لا يمكن إرجاع أكثر من المتوفر فعليًا أو المتبقي في فاتورة المشتريات"); return;
    }
    if (reason.trim().length < 2) { setError("أدخل سبب المردود"); return; }
    setError(""); setSuccess(""); setBusy(true);
    const key = requestKey.current ?? newKey();
    requestKey.current = key;
    try {
      const result = await createPosPurchaseReturn(token, {
        purchasePublicId: preview.purchase.publicId, idempotencyKey: key,
        reason: reason.trim(), notes: notes.trim(), lines: requested,
      });
      setSaved(result);
      setSuccess(result.alreadyCreated ? "تم العثور على المردود المحفوظ مسبقًا" : "تم تسجيل المردود وخصم المخزون وترحيل حساب المورد بنجاح");
      setSelected({}); requestKey.current = null;
      setPreview(await getPosPurchaseReturnPreview(token, preview.purchase.publicId));
      await refreshHistory(preview.purchase.publicId);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  async function openReturn(publicId: string) {
    setError(""); setBusy(true);
    try { setSaved(await getPosPurchaseReturnDetail(token, publicId)); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  async function cancelReturn() {
    if (!saved || saved.purchaseReturn.status === "voided" || busy) return;
    if (voidReason.trim().length < 2) { setError("أدخل سبب الإلغاء"); return; }
    if (!window.confirm("هل تؤكد إلغاء هذا المردود؟ سيتم إعادة المخزون وعكس القيد المالي.")) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const result = await voidPosPurchaseReturn(token, { publicId: saved.purchaseReturn.publicId, reason: voidReason.trim() });
      setSaved(result);
      setSuccess("تم عكس المردود وإعادة الكميات إلى المخزون وإلغاء الأثر المالي");
      if (preview) setPreview(await getPosPurchaseReturnPreview(token, preview.purchase.publicId));
      await refreshHistory(preview?.purchase.publicId);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  return <main dir="rtl" className="pret-page">
    <header className="pret-no-print">
      <h1>مردودات المشتريات</h1>
      <p className="pret-small">مردود المورد يخصم من المخزون الفعلي حسب اللون والنمرة. فاتورة المشتريات الأصلية لا تزيد المخزون، ولا تتغير آليتها.</p>
    </header>
    <section className="pret-card pret-no-print">
      <form className="pret-toolbar" onSubmit={e => void openPurchase(e)}>
        <label>رقم فاتورة المشتريات<input value={purchaseNo} onChange={e => setPurchaseNo(e.target.value)} placeholder="رقم الفاتورة" /></label>
        <button type="submit" className="pret-primary" disabled={busy}>🔎 فتح فاتورة الشراء</button>
        <button type="button" disabled={busy} onClick={() => {
          setPreview(null); setSelected({}); setSaved(null); setPurchaseNo("");
          setError(""); setSuccess(""); requestKey.current = null;
          void refreshHistory().catch(() => {});
        }}>مردود جديد</button>
      </form>
    </section>
    {error && <div role="alert" className="pret-error pret-no-print">{error}</div>}
    {success && <div role="status" className="pret-success pret-no-print">{success}</div>}
    {preview && <section className="pret-card pret-no-print">
      <h2>فاتورة {preview.purchase.publicId}</h2>
      <p><strong>المورد:</strong> {preview.purchase.supplierName} | <strong>تاريخ الشراء:</strong> {preview.purchase.businessDate} | <strong>إجمالي الفاتورة:</strong> {formatMoney(preview.purchase.totalMinor)}</p>
      <p className="pret-small">اختر اللون والنمرة والكمية للمردود الجزئي، أو اختر «إرجاع كامل المتبقي» لتوزيع المردود على المخزون المتوفر.</p>
      {preview.lines.map(line => {
        const quantity = requested.filter(row => row.purchaseItemId === line.id).reduce((s, r) => s + r.quantity, 0);
        return <article className="pret-line" key={line.id}>
          <div className="pret-line-head">
            {line.productImage && <img src={line.productImage} alt="" />}
            <div className="pret-line-title"><strong>{line.productName}</strong>
              <div className="pret-small">مشتراة: {line.originalQuantity} | مردودة سابقًا: {line.returnedQuantity} | متبقية للمردود: {line.availableToReturn}</div>
              <div className="pret-small">الرصيد من قيمة الصنف: {formatMoney(line.remainingAmountMinor)} | الموجود بالمحل: {line.stock ?? "غير معروف"}</div>
            </div>
            <button type="button" onClick={() => chooseFull(line)} disabled={busy || line.availableToReturn === 0}>إرجاع كامل المتبقي</button>
            <button type="button" onClick={() => clearLine(line)} disabled={busy}>مردود جزئي / تصفير</button>
          </div>
          {line.options.map(option => {
            const key = selectionKey(line, option);
            return <div className="pret-option" key={key}>
              <span>{option.color ?? "بدون لون"} / {option.size ?? "بدون نمرة"} <span className="pret-small">— متوفر {option.stock ?? "غير محدد"}</span></span>
              <label>كمية المردود <input aria-label={"مردود " + line.productName + " " + (option.color ?? "") + " " + (option.size ?? "")} type="number" min="0"
                max={Math.max(0, Math.min(line.availableToReturn, option.stock ?? 0))}
                value={selected[key] ?? 0} disabled={busy || line.availableToReturn === 0 || option.stock === null}
                onChange={e => changeQuantity(line, option, e.target.value)} /></label>
            </div>;
          })}
          <strong>مردود الصنف المحدد: {quantity} قطعة</strong>
        </article>;
      })}
      <div className="pret-toolbar pret-edit-meta">
        <label>سبب المردود<input value={reason} onChange={e => { setReason(e.target.value); requestKey.current = null; }} /></label>
        <label>ملاحظات<textarea rows={1} value={notes} onChange={e => { setNotes(e.target.value); requestKey.current = null; }} /></label>
      </div>
      <div className="pret-actions">
        <strong>إجمالي القطع المحددة: {requestedTotal}</strong>
        <button className="pret-primary" type="button" disabled={busy || requestedTotal === 0 || invalidSelected}
          onClick={() => void saveReturn()}>{busy ? "جارٍ الحفظ..." : "اعتماد مردود المشتريات"}</button>
      </div>
      <p className="pret-small">قيمة المردود تُسجل على حساب المورد دون حركة صندوق. يمكن قبضها أو تسويتها لاحقًا بسند مستقل.</p>
    </section>}
    {saved && <section className="pret-card">
      <div className="pret-actions"><h2>سند مردود {saved.purchaseReturn.publicId}</h2><span>{saved.purchaseReturn.status === "completed" ? "معتمد" : "ملغى"}</span></div>
      <p>التاريخ: {saved.purchaseReturn.businessDate} | السبب: {saved.purchaseReturn.reason}</p>
      <div className="pret-scroll"><table className="pret-table"><thead><tr><th>الصنف</th><th>اللون</th><th>النمرة</th><th>الكمية</th><th>قيمة المورد</th><th>تكلفة المخزون</th></tr></thead>
        <tbody>{saved.items.map(item => {
          const line = preview?.lines.find(l => l.id === item.purchaseItemId);
          return <tr key={item.id}><td>{line?.productName ?? "منتج #" + item.productId}</td><td>{item.color ?? "—"}</td><td>{item.size ?? "—"}</td><td>{item.quantity}</td>
            <td>{formatMoney(item.refundAmountMinor)}</td><td>{formatMoney(item.inventoryCostMinor)}</td></tr>;
        })}</tbody></table></div>
      <div className="pret-actions"><strong>قيمة المورد: {formatMoney(saved.purchaseReturn.refundAmountMinor)}</strong>
        <strong>تكلفة المخزون: {formatMoney(saved.purchaseReturn.inventoryCostMinor)}</strong></div>
      <div className="pret-toolbar pret-no-print">
        <button type="button" onClick={() => window.print()}>🖨 طباعة A4</button>
        {saved.purchaseReturn.status === "completed" && <>
          <label>سبب الإلغاء<input value={voidReason} onChange={e => setVoidReason(e.target.value)} /></label>
          <button type="button" disabled={busy} onClick={() => void cancelReturn()}>إلغاء المردود وعكس حركته</button>
        </>}
      </div>
    </section>}
    <section className="pret-card pret-no-print">
      <div className="pret-actions"><h2>سجل مردودات المشتريات</h2>
        <button type="button" disabled={busy} onClick={() => void refreshHistory(preview?.purchase.publicId).catch(e => setError(errorMessage(e)))}>تحديث السجل</button></div>
      {!history.length ? <p className="pret-small">لا توجد مردودات.</p> : <div className="pret-scroll"><table className="pret-table">
        <thead><tr><th>رقم المردود</th><th>التاريخ</th><th>القيمة</th><th>الحالة</th><th>فتح</th></tr></thead>
        <tbody>{history.map(entry => <tr key={entry.id}>
          <td>{entry.publicId}</td><td>{entry.businessDate}</td><td>{formatMoney(entry.refundAmountMinor)}</td>
          <td>{entry.status === "voided" ? "ملغى" : "معتمد"}</td>
          <td><button type="button" disabled={busy} onClick={() => void openReturn(entry.publicId)}>عرض</button></td>
        </tr>)}</tbody></table></div>}
    </section>
  </main>;
}
