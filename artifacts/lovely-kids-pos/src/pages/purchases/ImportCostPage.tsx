import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { usePosRuntime } from "../../app/pos-context";
import {
  ApiError,
  createImportCostCase, getImportCostCase, getPosSuppliers,
  getPosBankAccounts, postImportUsdAdvance, postImportDirectCostPayment,
  linkImportPurchase, unlinkImportPurchase,
  claimImportSupplierVoucher, detachImportSupplierVoucherClaim,
  postImportAccountingClose, reverseImportAccountingClose,
  listImportCostCases, updateImportCostCase,
  type ImportCostDraft, type ImportCostCaseResult,
  type ImportCostInvoiceDraft, type ImportCostShipmentDraft,
  type ImportCostAllocationDraft, type PosSupplier, type PosBankAccount,
} from "../../lib/api";

const card: CSSProperties = {
  background: "#fff", border: "1px solid #e2e8f0",
  borderRadius: 14, padding: 16, marginBottom: 14,
};
const field: CSSProperties = {
  width: "100%", minWidth: 0, border: "1px solid #cbd5e1",
  background: "#fff", borderRadius: 8, padding: 9, boxSizing: "border-box",
};
const btn: CSSProperties = {
  background: "#f5f7fa", border: "1px solid #cbd5e1", borderRadius: 8,
  padding: "8px 13px", cursor: "pointer", fontWeight: 700,
};
const wrap: CSSProperties = {
  display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
};
const label: CSSProperties = { fontSize: 12, fontWeight: 800, display: "block", marginBottom: 5 };
const money = (minor: number) => (minor / 100).toLocaleString("en-US", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const minor = (value: string) => {
  const num = Number(value.trim().replace(",", "."));
  return Number.isFinite(num) && num >= 0 ? Math.min(2147483647, Math.round(num * 100)) : 0;
};
const dateNow = () => {
  const d = new Date();
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
};
const ref = (prefix: string) => prefix + "-" + crypto.randomUUID().slice(0, 8);
const blank = (): ImportCostDraft => ({
  title: "", businessDate: dateNow(), withTravel: false,
  travelRecordedIlsMinor: 0, notes: "",
  invoices: [], shipments: [], allocations: [],
});

type CaseSummary = {
  id: number;
  publicId: string;
  title: string;
  businessDate: string;
  withTravel: boolean;
  revision: number;
  updatedAt: string;
};
const MoneyInput = ({
  value, onChange, title, disabled,
}: { value: number; onChange: (v: number) => void; title: string; disabled?: boolean }) => (
  <label style={{ display: "block", minWidth: 0 }}>
    <span style={label}>{title}</span>
    <input style={field} type="number" min="0" step="0.01"
      value={value / 100} onChange={(e) => onChange(minor(e.target.value))}
      disabled={disabled} dir="ltr" />
  </label>
);

export default function ImportCostPage() {
  const { token, clearAuthentication } = usePosRuntime();
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [suppliers, setSuppliers] = useState<PosSupplier[]>([]);
  const [usdBanks, setUsdBanks] = useState<PosBankAccount[]>([]);
  const [ilsBanks, setIlsBanks] = useState<PosBankAccount[]>([]);
  const [directKind, setDirectKind] = useState<"freight"|"customs"|"local_transport"|"travel">("freight");
  const [directShipmentRef, setDirectShipmentRef] = useState("");
  const [directMethod, setDirectMethod] = useState<"bank"|"cash">("cash");
  const [directBankId, setDirectBankId] = useState(0);
  const [directAmount, setDirectAmount] = useState("");
  const directKey = useRef(crypto.randomUUID());
  const [voucherInvoiceRef,setVoucherInvoiceRef]=useState("");
  const [voucherIdText,setVoucherIdText]=useState("");
  const [voucherClaimAmount,setVoucherClaimAmount]=useState("");
  const [paymentInvoiceRef, setPaymentInvoiceRef] = useState("");
  const [paymentBankId, setPaymentBankId] = useState(0);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentSpotRate, setPaymentSpotRate] = useState("");
  const [paymentBusinessDate, setPaymentBusinessDate] = useState(dateNow);
  const paymentKey = useRef(crypto.randomUUID());
  const [draft, setDraft] = useState<ImportCostDraft>(blank);
  const [selected, setSelected] = useState<ImportCostCaseResult | null>(null);
  const [linkGroupRef,setLinkGroupRef] = useState("");
  const [linkPurchaseId,setLinkPurchaseId] = useState("");
  const [preview, setPreview] = useState<ImportCostCaseResult["preview"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestKey = useRef(crypto.randomUUID());
  const closingKey = useRef(crypto.randomUUID());
  const reversalKey = useRef(crypto.randomUUID());
  const [closeDate,setCloseDate] = useState(dateNow);
  const [approveClose,setApproveClose] = useState(false);
  const [approveTravel,setApproveTravel] = useState(false);
  const [reversalReason,setReversalReason] = useState("");
  const [confirmReverse,setConfirmReverse] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listImportCostCases(token), getPosSuppliers(token), getPosBankAccounts(token)])
      .then(([loaded, people, banks]) => {
        if (cancelled) return;
        setCases(loaded.cases);
        setSuppliers(people.results);
        const usd = banks.results.filter((bank) => bank.currencyCode === "USD" && bank.status === "active");
        setUsdBanks(usd);
        if (usd[0]) setPaymentBankId(usd[0].id);
        const ils = banks.results.filter((bank) => bank.currencyCode === "ILS" && bank.status === "active");
        setIlsBanks(ils);
        if (ils[0]) setDirectBankId(ils[0].id);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) { clearAuthentication(); return; }
        setError(e instanceof Error ? e.message : "تعذر تحميل ملفات الاستيراد");
      });
    return () => { cancelled = true; };
  }, [token, clearAuthentication]);

  const update = (patch: Partial<ImportCostDraft>) => {
    setDraft((previous) => ({ ...previous, ...patch }));
    setPreview(null);
    setNotice("");
  };
  const updateInvoice = (idx: number, patch: Partial<ImportCostInvoiceDraft>) =>
    update({ invoices: draft.invoices.map((line, i) => i === idx ? { ...line, ...patch } : line) });
  const updateShipment = (idx: number, patch: Partial<ImportCostShipmentDraft>) => {
    const shipments = draft.shipments.map((line, i) => {
      if (i !== idx) return line;
      const changed = { ...line, ...patch };
      return { ...changed, freightClearingIlsMinor:
        changed.freightIlsMinor + changed.customsIlsMinor + changed.localTransportIlsMinor };
    });
    update({ shipments });
  };
  const updateAllocation = (idx: number, patch: Partial<ImportCostAllocationDraft>) => {
    const allocations = draft.allocations.map((line, i) => {
      if (i !== idx) return line;
      const changed = { ...line, ...patch };
      return { ...changed, excelLandedIlsMinor:
        changed.goodsIlsMinor + changed.freightIlsMinor + changed.travelManagerialIlsMinor };
    });
    update({ allocations });
  };
  const totals = useMemo(() => ({
    usd: draft.invoices.reduce((sum, i) => sum + i.goodsUsdMinor, 0),
    ils: draft.invoices.reduce((sum, i) => sum + i.goodsBookedIlsMinor, 0),
    freight: draft.shipments.reduce((sum, s) => sum + s.freightClearingIlsMinor, 0),
    excel: draft.allocations.reduce((sum, a) => sum + a.excelLandedIlsMinor, 0),
  }), [draft]);

  async function reloadCases() {
    const result = await listImportCostCases(token);
    setCases(result.cases);
  }
  async function openCase(id: number) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await getImportCostCase(token, id);
      setSelected(result);
      setDraft(result.draft);
      setPreview(result.preview);
      setApproveClose(false);setApproveTravel(false);setConfirmReverse(false);setReversalReason("");
      closingKey.current=crypto.randomUUID();reversalKey.current=crypto.randomUUID();
      setPaymentInvoiceRef(result.draft.invoices[0]?.lineRef ?? "");
      setVoucherInvoiceRef(result.draft.invoices[0]?.lineRef ?? "");
      setDirectShipmentRef(result.draft.shipments[0]?.lineRef ?? "");
      setLinkGroupRef(result.draft.allocations[0]?.lineRef ?? "");
      setLinkPurchaseId("");
      requestKey.current = crypto.randomUUID();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر فتح ملف الاستيراد");
    } finally { setBusy(false); }
  }
  function newCase() {
    setSelected(null); setDraft(blank()); setError(""); setNotice(""); setPreview(null);
    setPaymentInvoiceRef("");
    setPaymentAmount("");
    setPaymentSpotRate("");
    setDirectAmount("");
    setDirectShipmentRef("");
    setLinkGroupRef("");
    setLinkPurchaseId("");
    requestKey.current = crypto.randomUUID();
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const result = selected
        ? await updateImportCostCase(token, selected.case.id, selected.case.revision, draft)
        : await createImportCostCase(token, draft, requestKey.current);
      setSelected(result);
      setDraft(result.draft);
      setPreview(result.preview);
      setNotice("تم حفظ مسودة الاستيراد فقط. لم تُسجل أي دفعة أو قيد مخزون.");
      await reloadCases();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر حفظ المسودة");
    } finally { setBusy(false); }
  }

  async function sendAdvancePayment() {
    if (!selected || !selected.advancePostingEnabled || busy) return;
    const usdAmountMinor = minor(paymentAmount);
    const spotRateMicros = Math.round(Number(paymentSpotRate) * 1_000_000);
    if (!paymentInvoiceRef || !paymentBankId || usdAmountMinor <= 0 ||
      !Number.isSafeInteger(spotRateMicros) || spotRateMicros <= 0) {
      setError("اختر المورد وبنك الدولار وأدخل المبلغ وسعر الصرف الصحيحين");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await postImportUsdAdvance(token, selected.case.id, {
        invoiceRef: paymentInvoiceRef,
        bankAccountId: paymentBankId,
        usdAmountMinor,
        spotRateMicros,
        businessDate: paymentBusinessDate,
        idempotencyKey: paymentKey.current,
      });
      const refreshed = await getImportCostCase(token, selected.case.id);
      setSelected(refreshed);
      setDraft(refreshed.draft);
      setPreview(refreshed.preview);
      paymentKey.current = crypto.randomUUID();
      setPaymentAmount("");
      setPaymentSpotRate("");
      setNotice("تم تسجيل دفعة المورد في دفتر الأستاذ وربطها بالاستيراد. رقم القيد: " +
        result.payment.financeTransactionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تنفيذ دفعة المورد");
    } finally { setBusy(false); }
  }

  async function sendDirectPayment() {
    if (!selected || !selected.advancePostingEnabled || busy) return;
    const amountIlsMinor = minor(directAmount);
    const shipmentRef = directKind === "travel" ? null : directShipmentRef;
    if (amountIlsMinor <= 0 || (directKind !== "travel" && !shipmentRef) ||
      (directMethod === "bank" && !directBankId)) {
      setError("حدد نوع المصروف والشحنة وطريقة الدفع والمبلغ الفعلي");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await postImportDirectCostPayment(token, selected.case.id, {
        shipmentRef, costType: directKind, paymentMethod: directMethod,
        bankAccountId: directMethod === "bank" ? directBankId : null,
        registerKey: directMethod === "cash" ? "main" : null,
        amountIlsMinor, businessDate: paymentBusinessDate,
        idempotencyKey: directKey.current,
      });
      const refreshed = await getImportCostCase(token, selected.case.id);
      setSelected(refreshed);
      setDraft(refreshed.draft);
      setPreview(refreshed.preview);
      setDirectAmount("");
      directKey.current = crypto.randomUUID();
      setNotice("تم ترحيل المصروف لحساب تجميع الاستيراد مرة واحدة، ورقم القيد: " +
        result.payment.financeTransactionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تسجيل مصروف الشحنة");
    } finally { setBusy(false); }
  }

  async function assignExistingVoucher() {
    if(!selected || busy)return;
    const voucherPublicId=voucherIdText.trim();
    const amountIlsMinor=minor(voucherClaimAmount);
    if(!voucherInvoiceRef || voucherPublicId.length<1 || voucherPublicId.length>100 ||
      amountIlsMinor<=0) {
      setError("اختر فاتورة المورد وأدخل رقم سند الصرف الموجود والمبلغ المخصص بالشيكل");
      return;
    }
    setBusy(true);setError("");setNotice("");
    try{
      const result=await claimImportSupplierVoucher(token,selected.case.id,{
        invoiceRef:voucherInvoiceRef,voucherPublicId,amountIlsMinor,
        expectedRevision:selected.case.revision,
      });
      setSelected(result);setDraft(result.draft);setPreview(result.preview);
      setVoucherIdText("");setVoucherClaimAmount("");
      setNotice("تم تخصيص سند المورد الموجود لفاتورة الاستيراد دون إنشاء دفع أو قيد جديد.");
    }catch(e){
      setError(e instanceof Error?e.message:"تعذر تخصيص سند المورد");
    }finally{setBusy(false);}
  }
  async function unlinkExistingVoucher(claimId:number){
    if(!selected||busy)return;
    setBusy(true);setError("");setNotice("");
    try{
      const result=await detachImportSupplierVoucherClaim(token,selected.case.id,
        claimId,selected.case.revision);
      setSelected(result);setDraft(result.draft);setPreview(result.preview);
      setNotice("انفصل مرجع السند عن فاتورة الاستيراد فقط؛ السند والدفعة الأصلية ما تغيروا.");
    }catch(e){
      setError(e instanceof Error?e.message:"تعذر فصل سند المورد");
    }finally{setBusy(false);}
  }

  async function attachPurchase() {
    if (!selected || busy) return;
    const purchaseId = Number(linkPurchaseId);
    if (!linkGroupRef || !Number.isSafeInteger(purchaseId) || purchaseId <= 0) {
      setError("اختر مجموعة تكلفة الإكسل وأدخل الرقم الداخلي لفاتورة المشتريات المعتمدة");
      return;
    }
    setBusy(true);setError("");setNotice("");
    try {
      const refreshed = await linkImportPurchase(token,selected.case.id,{
        allocationRef:linkGroupRef,purchaseId,expectedRevision:selected.case.revision,
      });
      setSelected(refreshed);
      setDraft(refreshed.draft);
      setPreview(refreshed.preview);
      setLinkPurchaseId("");
      setNotice("تم ربط فاتورة الشراء بسجلات تكلفتها الأصلية فقط؛ لم يُسجّل شراء أو صرف أو إدخال مخزون جديد.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر مطابقة فاتورة المشتريات");
    } finally {setBusy(false);}
  }
  async function detachPurchase(linkId:number) {
    if (!selected || busy) return;
    setBusy(true);setError("");setNotice("");
    try {
      const refreshed = await unlinkImportPurchase(token,selected.case.id,linkId,selected.case.revision);
      setSelected(refreshed);
      setDraft(refreshed.draft);
      setPreview(refreshed.preview);
      setNotice("تم فصل مرجع الفاتورة عن ملف الاستيراد فقط؛ لم يتغيّر القيد الأصلي ولا المخزون.");
    } catch(e) {
      setError(e instanceof Error ? e.message : "تعذر فصل الربط");
    } finally {setBusy(false);}
  }

  async function closeImport() {
    if(!selected||!selected.closingEnabled||selected.case.status!=="draft"||
       !selected.clearingPreview.ready||!approveClose||busy)return;
    if(draft.withTravel&&!approveTravel){
      setError("لازم توافق صراحة على تصنيف مصاريف السفر قبل الإقفال");
      return;
    }
    setBusy(true);setError("");setNotice("");
    try{
      const result=await postImportAccountingClose(token,selected.case.id,{
        expectedRevision:selected.case.revision,expectedPlanHash:selected.closePlanHash,
        travelClassificationConfirmed:approveTravel,businessDate:closeDate,
        idempotencyKey:closingKey.current,
      });
      setSelected(result.case);setDraft(result.case.draft);setPreview(result.case.preview);
      closingKey.current=crypto.randomUUID();setApproveClose(false);
      setNotice("تم تسجيل إقفال الاستيراد بقيد مالي موثق دون إعادة خصم بنك أو صندوق أو مخزون. رقم القيد: "+
        (result.posting.financeTransactionId??"لا يوجد قيد إضافي لأن التسوية صفرية"));
    }catch(e){
      setError(e instanceof Error?e.message:"تعذر إقفال الاستيراد");
    }finally{setBusy(false);}
  }
  async function reverseImportClose() {
    if(!selected||!selected.closingEnabled||selected.case.status!=="closed"||
       !confirmReverse||reversalReason.trim().length<5||busy)return;
    setBusy(true);setError("");setNotice("");
    try{
      const result=await reverseImportAccountingClose(token,selected.case.id,{
        expectedRevision:selected.case.revision,businessDate:closeDate,
        reason:reversalReason.trim(),idempotencyKey:reversalKey.current,
      });
      setSelected(result.case);setDraft(result.case.draft);setPreview(result.case.preview);
      reversalKey.current=crypto.randomUUID();setConfirmReverse(false);setReversalReason("");
      setNotice("تم عكس قيد التسوية المحاسبي وإعادة الملف لمسودة. لا يوجد عكس لحركات المخزون أو الدفعات الأصلية.");
    }catch(e){
      setError(e instanceof Error?e.message:"تعذر عكس التسوية");
    }finally{setBusy(false);}
  }

  return <main dir="rtl" style={{ padding: "12px clamp(10px, 2vw, 24px)", maxWidth: 1350, margin: "auto" }}>
    <header style={{ ...card, borderColor: "#93c5fd", background: "#eff6ff" }}>
      <h1 style={{ margin: "0 0 8px", fontSize: 25 }}>ملفات استيراد البضاعة</h1>
      <p style={{ margin: 0, lineHeight: 1.8 }}>
        ملف استيراد واحد لعدة موردين وشحنات، مع سفر اختياري موزع على الجميع.
        تكلفة الصنف النهائية تظل تدخلها ببطاقة الصنف بعد حسابها في الإكسل.
      </p>
      <p role="status" style={{ margin: "10px 0 0", fontWeight: 800, color: "#9a3412" }}>
        مرحلة مسودة توثيق ومطابقة: الحفظ لا يخصم من الصندوق ولا يثبت مخزونًا ولا يُقفل الشحنة محاسبيًا.
      </p>
    </header>

    <section style={card}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 9 }}>
        <strong>ملفات الاستيراد</strong>
        <button type="button" style={btn} onClick={newCase} disabled={busy}>+ فتح ملف استيراد جديد</button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {cases.length === 0 && <span style={{ color: "#64748b" }}>لا توجد مسودات بعد</span>}
        {cases.map((c) => <button type="button" key={c.id} style={{
          ...btn, background: selected?.case.id === c.id ? "#dbeafe" : "#fff",
        }} onClick={() => void openCase(c.id)} disabled={busy}>
          {c.publicId} — {c.title} ({c.businessDate})
        </button>)}
      </div>
    </section>

    <form onSubmit={(e) => void save(e)}>
      <section style={card}>
        <h2 style={{ fontSize: 18 }}>بيانات ملف الاستيراد {selected ? selected.case.publicId : "(جديد)"}</h2>
        <div style={wrap}>
          <label><span style={label}>اسم الملف</span>
            <input style={field} required maxLength={150} value={draft.title}
              onChange={(e) => update({ title: e.target.value })} placeholder="استيراد ملابس الشتاء" />
          </label>
          <label><span style={label}>التاريخ</span>
            <input style={field} type="date" required value={draft.businessDate}
              onChange={(e) => update({ businessDate: e.target.value })} />
          </label>
          <label><span style={label}>طريقة الشراء</span>
            <select style={field} value={draft.withTravel ? "yes" : "no"} onChange={(e) =>
              update({ withTravel: e.target.value === "yes", travelRecordedIlsMinor: e.target.value === "yes" ? draft.travelRecordedIlsMinor : 0 })}>
              <option value="no">طلب بضاعة بدون سفر</option>
              <option value="yes">رحلة شراء مع سفر</option>
            </select>
          </label>
          {draft.withTravel && <MoneyInput title="مجموع مصاريف السفر الموزعة بالإكسل — ₪"
            value={draft.travelRecordedIlsMinor} onChange={(v) => update({ travelRecordedIlsMinor: v })} />}
        </div>
        <label style={{ display: "block", marginTop: 8 }}>
          <span style={label}>ملاحظات</span>
          <textarea style={field} value={draft.notes ?? ""} maxLength={2000}
            onChange={(e) => update({ notes: e.target.value })} rows={2} />
        </label>
      </section>

      <section style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 18, marginTop: 0 }}>فواتير الموردين بالدولار</h2>
          <button type="button" style={btn} onClick={() => update({ invoices: [...draft.invoices, {
            lineRef: ref("INV"), supplierId: suppliers.length ? Number(suppliers[0]!.id) : 0,
            invoiceNumber: "", goodsUsdMinor: 0, goodsBookedIlsMinor: 0,
          }] })}>+ إضافة فاتورة مورد</button>
        </div>
        <p style={{ color: "#64748b", fontSize: 13 }}>القيمة بالشيكل هنا للمطابقة مبدئيًا؛ لا تُثبت كدفعة مورد. عند الترحيل لاحقًا نربطها بسعر الصرف وتاريخ الدفع الحقيقيين.</p>
        {draft.invoices.map((line, idx) => <div key={line.lineRef} style={{
          ...wrap, borderTop: "1px solid #e2e8f0", padding: "12px 0",
        }}>
          <label><span style={label}>المورد</span>
            <select style={field} value={line.supplierId} onChange={(e) => updateInvoice(idx, { supplierId: Number(e.target.value) })}>
              <option value={0}>اختر المورد</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label><span style={label}>رقم الفاتورة</span>
            <input style={field} value={line.invoiceNumber} maxLength={100}
              onChange={(e) => updateInvoice(idx, { invoiceNumber: e.target.value })}/>
          </label>
          <MoneyInput title="قيمة الفاتورة — $" value={line.goodsUsdMinor}
            onChange={(v) => updateInvoice(idx, { goodsUsdMinor: v })}/>
          <MoneyInput title="قيمة البضاعة المقابلة — ₪" value={line.goodsBookedIlsMinor}
            onChange={(v) => updateInvoice(idx, { goodsBookedIlsMinor: v })}/>
          <div style={{ display: "flex", alignItems: "end" }}><button type="button" style={btn}
            onClick={() => update({
              invoices: draft.invoices.filter((_, i) => i !== idx),
              allocations: draft.allocations.filter((a) => a.invoiceRef !== line.lineRef),
            })}>حذف</button></div>
        </div>)}
      </section>

      <section style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 18, marginTop: 0 }}>الشحن والتخليص والنقل لكل شحنة</h2>
          <button type="button" style={btn} onClick={() => update({ shipments: [...draft.shipments, {
            lineRef: ref("SHIP"), trackingNumber: null,
            freightIlsMinor: 0, customsIlsMinor: 0, localTransportIlsMinor: 0,
            freightClearingIlsMinor: 0,
          }] })}>+ إضافة شحنة</button>
        </div>
        {draft.shipments.map((s, idx) => <div key={s.lineRef} style={{
          ...wrap, borderTop: "1px solid #e2e8f0", padding: "12px 0",
        }}>
          <label><span style={label}>رقم الشحنة</span><input style={field}
            value={s.trackingNumber ?? ""} onChange={(e) => updateShipment(idx, { trackingNumber: e.target.value })}/>
          </label>
          <MoneyInput title="الشحن — ₪" value={s.freightIlsMinor}
            onChange={(v) => updateShipment(idx, { freightIlsMinor: v })}/>
          <MoneyInput title="التخليص — ₪" value={s.customsIlsMinor}
            onChange={(v) => updateShipment(idx, { customsIlsMinor: v })}/>
          <MoneyInput title="النقل المحلي — ₪" value={s.localTransportIlsMinor}
            onChange={(v) => updateShipment(idx, { localTransportIlsMinor: v })}/>
          <div><span style={label}>مجموع الشحنة</span><strong>{money(s.freightClearingIlsMinor)} ₪</strong></div>
          <div style={{ display: "flex", alignItems: "end" }}><button type="button" style={btn}
            onClick={() => update({
              shipments: draft.shipments.filter((_, i) => i !== idx),
              allocations: draft.allocations.filter((a) => a.shipmentRef !== s.lineRef),
            })}>حذف</button></div>
        </div>)}
      </section>

      <section style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>مطابقة توزيع الإكسل</h2>
          <button type="button" style={btn} disabled={!draft.invoices.length || !draft.shipments.length}
            onClick={() => update({ allocations: [...draft.allocations, {
              lineRef: ref("LINE"), invoiceRef: draft.invoices[0]!.lineRef,
              shipmentRef: draft.shipments[0]!.lineRef,
              goodsIlsMinor: 0, freightIlsMinor: 0,
              travelManagerialIlsMinor: 0, travelCapitalizableIlsMinor: 0, excelLandedIlsMinor: 0,
            }] })}>+ إضافة مجموعة تكلفة</button>
        </div>
        <p style={{ color: "#64748b", fontSize: 13, lineHeight: 1.7 }}>
          المبالغ بهذا القسم من الإكسل بعد توزيعها مسبقًا. يمكن إدخال مجموعة واحدة لكل فاتورة/شحنة بدل إدخال كل صنف،
          مع إبقاء تكلفة القطعة في بطاقة الصنف. لا يقوم النظام بتوزيع جديد.
        </p>
        {draft.allocations.map((a, idx) => <div key={a.lineRef} style={{
          ...wrap, padding: "12px 0", borderTop: "1px solid #e2e8f0",
        }}>
          <label><span style={label}>فاتورة المورد</span>
            <select style={field} value={a.invoiceRef} onChange={(e) => updateAllocation(idx, { invoiceRef: e.target.value })}>
              {draft.invoices.map((i) => <option key={i.lineRef} value={i.lineRef}>{i.invoiceNumber || i.lineRef}</option>)}
            </select>
          </label>
          <label><span style={label}>الشحنة</span>
            <select style={field} value={a.shipmentRef} onChange={(e) => updateAllocation(idx, { shipmentRef: e.target.value })}>
              {draft.shipments.map((s) => <option key={s.lineRef} value={s.lineRef}>{s.trackingNumber || s.lineRef}</option>)}
            </select>
          </label>
          <MoneyInput title="حصة البضاعة — ₪" value={a.goodsIlsMinor}
            onChange={(v) => updateAllocation(idx, { goodsIlsMinor: v })}/>
          <MoneyInput title="حصة الشحن والتخليص والنقل — ₪" value={a.freightIlsMinor}
            onChange={(v) => updateAllocation(idx, { freightIlsMinor: v })}/>
          {draft.withTravel && <>
            <MoneyInput title="حصة السفر الموزعة — ₪" value={a.travelManagerialIlsMinor}
              onChange={(v) => updateAllocation(idx, { travelManagerialIlsMinor: v })}/>
            <MoneyInput title="حصة السفر المؤهلة محاسبيًا — ₪" value={a.travelCapitalizableIlsMinor}
              onChange={(v) => updateAllocation(idx, { travelCapitalizableIlsMinor: v })}/>
          </>}
          <div><span style={label}>التكلفة النهائية في الإكسل</span>
            <strong>{money(a.excelLandedIlsMinor)} ₪</strong></div>
          <div style={{ display: "flex", alignItems: "end" }}>
            <button type="button" style={btn} onClick={() => update({
              allocations: draft.allocations.filter((_, i) => i !== idx),
            })}>حذف</button>
          </div>
        </div>)}
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 18, marginTop: 0 }}>ربط تكلفة الأصناف بفواتير المشتريات المعتمدة</h2>
        <p style={{ lineHeight: 1.7, color: "#475569", fontSize: 13 }}>
          بعد إدخال تكلفة القطعة من بطاقة الصنف واعتماد فاتورة مشتريات بالشيكل <b>على الحساب</b>،
          اربط رقم الفاتورة الداخلي بمجموعة الإكسل الخاصة بها.
          النظام يفحص قيد المخزون، وذمة المورد، وسجل التكلفة الحقيقي؛ الربط لا يُدخل كميات أو تكلفة إضافية.
        </p>
        {selected?.costGroupMatching?.length ? <div style={{ display: "grid",gap: 7 }}>
          {selected.costGroupMatching.map(group => <div key={group.allocationRef} style={{
            padding: 10, background: group.valid ? "#f0fdf4" : "#fff7ed",
            border: "1px solid #e2e8f0", borderRadius: 9,
          }}>
            <b>{group.allocationRef}</b> — تكلفة محاسبية مطلوبة
            {" "}<b>{money(group.expectedAccountingIlsMinor)} ₪</b>
            {" "} / مربوطة من قيد المخزون <b>{money(group.linkedAccountingIlsMinor)} ₪</b>
            {" "} <strong>{group.valid ? "✓ مطابقة" : "— لم تكتمل المطابقة"}</strong>
          </div>)}
        </div> : <p style={{ color: "#64748b" }}>لا يوجد توزيع إكسل محفوظ لربط فواتير الشراء به.</p>}
        {selected?.purchaseLinks?.length ? <div style={{ overflowX: "auto",marginTop: 12 }}>
          <table style={{ width:"100%",borderCollapse:"collapse",textAlign:"right" }}>
            <thead><tr>{["مجموعة الإكسل","فاتورة المشتريات","قيمة المخزون","فحص القيد","إجراء"].map(h =>
              <th key={h} style={{ padding:8,borderBottom:"1px solid #cbd5e1" }}>{h}</th>)}</tr></thead>
            <tbody>{selected.purchaseLinks.map(l => <tr key={l.id}>
              <td>{l.allocationRef}</td><td>{l.purchaseId}</td>
              <td>{money(l.inventoryCostIlsMinor)} ₪</td>
              <td style={{ color:l.valid?"#166534":"#b91c1c" }}>
                {l.valid?"مطابق":l.reasons.join("؛ ")}
              </td>
              <td><button type="button" disabled={busy} style={btn}
                onClick={()=>void detachPurchase(l.id)}>فصل المرجع فقط</button></td>
            </tr>)}</tbody>
          </table>
        </div> : null}
        {selected && <div style={{ ...wrap,marginTop:12 }}>
          <label><span style={label}>مجموعة تكلفة الإكسل</span>
            <select style={field} value={linkGroupRef} onChange={e=>setLinkGroupRef(e.target.value)}>
              <option value="">اختر المجموعة</option>
              {draft.allocations.map(a=><option key={a.lineRef} value={a.lineRef}>{a.lineRef}</option>)}
            </select>
          </label>
          <label><span style={label}>الرقم الداخلي لفاتورة المشتريات المعتمدة</span>
            <input style={field} type="number" step="1" min="1" value={linkPurchaseId}
              onChange={e=>setLinkPurchaseId(e.target.value)} placeholder="مثال: 421"/>
          </label>
          <div style={{ display:"flex",alignItems:"end" }}>
            <button type="button" disabled={busy||!draft.allocations.length} style={btn}
              onClick={()=>void attachPurchase()}>فحص وربط الفاتورة بدون ترحيل</button>
          </div>
        </div>}
        {!!selected?.purchaseLinks?.length && <p style={{ color:"#92400e",fontSize:12,fontWeight:700 }}>
          بعد ربط فاتورة مشتريات يجب فصل مراجعها قبل تعديل تفاصيل توزيع الإكسل؛ ذلك لحماية سلامة التكلفة المسجلة.
        </p>}
      </section>

      <section style={card}>
        <h2 style={{ fontSize:18,marginTop:0 }}>تخصيص سندات صرف المورد الموجودة — بدون دفع جديد</h2>
        <p style={{ fontSize:13,color:"#475569",lineHeight:1.8 }}>
          لو سبق وسددت للمورد بسند صرف من النظام، ممكن تربط قيمة هذا السند
          بفاتورة استيراد معينة. وإذا السند بغطّي أكثر من فاتورة، بتحدد
          الجزء اللي يخص كل واحدة. النظام بيراجع القيد الأصلي، وبمنع استعمال
          نفس السند بأكثر من قيمته أو ربطه بمورد مختلف.
        </p>
        {selected?.supplierVoucherClaims?.length ? <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%",borderCollapse:"collapse",textAlign:"right",fontSize:13 }}>
            <thead><tr>{["فاتورة المورد","السند","المخصص","قيمة السند","صحة القيد","المرجع"].map(h=>
              <th key={h} style={{ padding:8,borderBottom:"1px solid #cbd5e1" }}>{h}</th>)}</tr></thead>
            <tbody>{selected.supplierVoucherClaims.map(claim=><tr key={claim.id}>
              <td>{claim.invoiceRef}</td><td>{claim.voucherPublicId}</td>
              <td>{money(claim.amountIlsMinor)} ₪</td>
              <td>{money(claim.voucherAmountIlsMinor)} ₪</td>
              <td style={{ color:claim.verified?"#166534":"#b91c1c" }}>
                {claim.verified?"مطابق":"غير مطابق: "+claim.errors.join("؛ ")}
              </td>
              <td><button type="button" disabled={busy} style={btn}
                onClick={()=>void unlinkExistingVoucher(claim.id)}>فصل المرجع</button></td>
            </tr>)}</tbody>
          </table>
        </div>:<p style={{fontSize:13,color:"#64748b"}}>لا يوجد سند صرف سابق مخصص لهذه الشحنة بعد.</p>}
        {selected && <div style={{...wrap,marginTop:12}}>
          <label><span style={label}>فاتورة المورد</span>
            <select style={field} value={voucherInvoiceRef}
              onChange={e=>setVoucherInvoiceRef(e.target.value)}>
              <option value="">اختر الفاتورة</option>
              {draft.invoices.map(i=><option key={i.lineRef} value={i.lineRef}>
                {i.invoiceNumber}
              </option>)}
            </select></label>
          <label><span style={label}>رقم سند الصرف الظاهر بالنظام</span>
            <input style={field} type="text" maxLength={100} value={voucherIdText}
              onChange={e=>setVoucherIdText(e.target.value)} placeholder="مثال: PAY-20261109-..."/></label>
          <label><span style={label}>المبلغ المخصص لهذه الفاتورة ₪</span>
            <input style={field} type="number" min="0.01" step="0.01"
              value={voucherClaimAmount} onChange={e=>setVoucherClaimAmount(e.target.value)}/>
          </label>
          <div style={{display:"flex",alignItems:"end"}}>
            <button type="button" style={btn} disabled={busy} onClick={()=>void assignExistingVoucher()}>
              ربط سند موجود — دون صرف جديد
            </button>
          </div>
        </div>}
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 18, marginTop: 0 }}>دفعات الموردين بالدولار</h2>
        {!selected && <p style={{ color: "#64748b" }}>احفظ ملف الاستيراد أولًا لتتمكن من ربط الدفعات به.</p>}
        {selected?.advances?.length ? <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", textAlign: "right", borderCollapse: "collapse" }}>
            <thead><tr>{["الفاتورة", "المدفوع بالدولار", "المقدم بقيمة الشيكل", "فرق الصرف", "قيد المالية"].map(h =>
              <th key={h} style={{ padding: 8, borderBottom: "1px solid #cbd5e1" }}>{h}</th>)}</tr></thead>
            <tbody>{selected.advances.map((a) => <tr key={a.paymentId}>
              <td style={{ padding: 8 }}>{a.invoiceRef}</td>
              <td>{money(a.usdAmountMinor)} $</td>
              <td>{money(a.advanceIlsMinor)} ₪</td>
              <td>{money(a.fxGainIlsMinor - a.fxLossIlsMinor)} ₪</td>
              <td>{a.financeTransactionId ?? "بدون قيد"} — {a.journalVerified ? "قيد مطابق" : "قيد غير مطابق"}
                {!a.journalVerified && <span style={{ color:"#b91c1c",display:"block",fontSize:12 }}>
                  {a.journalErrors.join("؛ ")}</span>}</td>
            </tr>)}</tbody>
          </table>
        </div> : <p style={{ color: "#64748b" }}>ما في دفعات مقدمة مرحلة ومربوطة بهذا الملف حتى الآن.</p>}
        {!selected?.advancePostingEnabled ? <p style={{ color: "#92400e", fontWeight: 700 }}>
          تسجيل دفعات الدولار من هذه الصفحة غير مفعل حاليًا لحماية الأرصدة.
          قيم فواتير الموردين أعلاه للتوثيق فقط، وليست سندات صرف.
        </p> : <div style={{ ...wrap, marginTop: 12 }}>
          <label><span style={label}>الفاتورة</span><select style={field} value={paymentInvoiceRef}
            onChange={e => setPaymentInvoiceRef(e.target.value)}>
            <option value="">اختر الفاتورة</option>
            {draft.invoices.map(i => <option key={i.lineRef} value={i.lineRef}>{i.invoiceNumber}</option>)}
          </select></label>
          <label><span style={label}>بنك الدولار</span><select style={field} value={paymentBankId}
            onChange={e => setPaymentBankId(Number(e.target.value))}>
            <option value={0}>اختر البنك</option>
            {usdBanks.map(b => <option key={b.id} value={b.id}>{b.bank.nameAr} — {b.name}</option>)}
          </select></label>
          <label><span style={label}>المبلغ بالدولار</span><input type="number" min="0.01"
            step="0.01" style={field} value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)}/></label>
          <label><span style={label}>سعر الدولار يوم الدفع (₪ لكل $)</span><input type="number" min="0.1"
            step="0.000001" style={field} value={paymentSpotRate} onChange={e => setPaymentSpotRate(e.target.value)}/></label>
          <label><span style={label}>تاريخ الدفع الفعلي</span><input type="date" style={field}
            value={paymentBusinessDate} onChange={e => setPaymentBusinessDate(e.target.value)}/></label>
          <div style={{ display: "flex", alignItems: "end" }}>
            <button type="button" style={{ ...btn, color: "#fff", background: "#14532d" }}
              disabled={busy || !selected || usdBanks.length === 0} onClick={() => void sendAdvancePayment()}>
              تسجيل دفعة مقدمة للمورد
            </button>
          </div>
        </div>}
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 18, marginTop: 0 }}>دفعات الشحن والتخليص والنقل والسفر</h2>
        {selected?.directPayments?.length ? <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "right" }}>
            <thead><tr>{["النوع", "الشحنة", "المبلغ", "الطريقة", "رقم القيد"].map(h =>
              <th key={h} style={{ borderBottom: "1px solid #cbd5e1", padding: 8 }}>{h}</th>)}</tr></thead>
            <tbody>{selected.directPayments.map(p => <tr key={p.paymentId}>
              <td style={{ padding: 8 }}>{({ freight:"شحن",customs:"تخليص",local_transport:"نقل",travel:"سفر" } as Record<string,string>)[p.costType] ?? p.costType}</td>
              <td>{p.shipmentRef ?? "جميع الموردين"}</td>
              <td>{money(p.amountIlsMinor)} ₪</td>
              <td>{p.paymentMethod === "bank" ? "البنك" : "الصندوق"}</td>
              <td>{p.financeTransactionId ?? "بدون قيد"} — {p.journalVerified ? "قيد مطابق" : "قيد غير مطابق"}
                {!p.journalVerified && <span style={{ color:"#b91c1c",display:"block",fontSize:12 }}>
                  {p.journalErrors.join("؛ ")}</span>}</td>
            </tr>)}</tbody>
          </table>
        </div> : <p style={{ color: "#64748b" }}>ما في مصاريف مرحلة على هذه الشحنة بعد.</p>}
        {selected?.advancePostingEnabled && <div style={{ ...wrap, marginTop: 12 }}>
          <label><span style={label}>نوع التكلفة</span>
            <select style={field} value={directKind} onChange={e => setDirectKind(e.target.value as typeof directKind)}>
              <option value="freight">الشحن</option>
              <option value="customs">التخليص</option>
              <option value="local_transport">النقل المحلي</option>
              {draft.withTravel && <option value="travel">مصاريف السفر المشتركة</option>}
            </select>
          </label>
          {directKind !== "travel" && <label><span style={label}>الشحنة</span>
            <select style={field} value={directShipmentRef} onChange={e => setDirectShipmentRef(e.target.value)}>
              <option value="">اختر الشحنة</option>
              {draft.shipments.map(sh => <option key={sh.lineRef} value={sh.lineRef}>{sh.trackingNumber || sh.lineRef}</option>)}
            </select>
          </label>}
          <label><span style={label}>طريقة الدفع</span>
            <select style={field} value={directMethod} onChange={e => setDirectMethod(e.target.value as "bank"|"cash")}>
              <option value="cash">الصندوق الرئيسي — شيكل</option>
              <option value="bank">بنك الشيكل</option>
            </select>
          </label>
          {directMethod === "bank" && <label><span style={label}>بنك الشيكل</span>
            <select style={field} value={directBankId} onChange={e => setDirectBankId(Number(e.target.value))}>
              <option value={0}>اختر حساب البنك</option>
              {ilsBanks.map(b => <option key={b.id} value={b.id}>{b.bank.nameAr} — {b.name}</option>)}
            </select>
          </label>}
          <label><span style={label}>المبلغ المدفوع — ₪</span>
            <input type="number" min="0.01" step="0.01" value={directAmount}
              style={field} onChange={e => setDirectAmount(e.target.value)}/>
          </label>
          <label><span style={label}>تاريخ الدفع</span>
            <input type="date" style={field} value={paymentBusinessDate}
              onChange={e => setPaymentBusinessDate(e.target.value)}/>
          </label>
          <div style={{ display: "flex", alignItems: "end" }}>
            <button type="button" style={{ ...btn, background: "#14532d", color: "#fff" }}
              disabled={busy} onClick={() => void sendDirectPayment()}>تسجيل مصروف استيراد</button>
          </div>
        </div>}
        {!selected?.advancePostingEnabled && <p style={{ color: "#92400e" }}>
          تسجيل هذه المصاريف فعليًا من الصندوق أو البنك مقفول حاليًا؛ الأرقام أعلاه للتوثيق والمطابقة فقط.
        </p>}
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 18 }}>ملخص التكاليف (مسودة وليست قيودًا)</h2>
        <div style={wrap}>
          <div><span style={label}>فواتير الموردين</span><b>{money(totals.usd)} $</b></div>
          <div><span style={label}>بضاعة بالشيكل</span><b>{money(totals.ils)} ₪</b></div>
          <div><span style={label}>شحن وتخليص ونقل</span><b>{money(totals.freight)} ₪</b></div>
          <div><span style={label}>سفر</span><b>{money(draft.travelRecordedIlsMinor)} ₪</b></div>
          <div><span style={label}>المجموع المُدخل من الإكسل</span><b>{money(totals.excel)} ₪</b></div>
        </div>
        {preview && <div style={{ marginTop: 12, padding: 10, background: "#f8fafc", borderRadius: 10 }}>
          <p style={{ fontWeight: 800, marginTop: 0, color: preview.balanced ? "#166534" : "#b45309" }}>
            {preview.balanced ? "مطابقة الأرقام صحيحة حسابيًا — غير مرحّلة" : "هناك فروقات يجب مراجعتها"}
          </p>
          <div style={wrap}>
            <span>تكلفة المخزون المبدئية: <b>{money(preview.inventoryAccountingCostIlsMinor)} ₪</b></span>
            <span>تكلفة التسعير: <b>{money(preview.excelManagerialCostIlsMinor)} ₪</b></span>
            <span>السفر المستبعد من المخزون: <b>{money(preview.travelExpenseIlsMinor)} ₪</b></span>
          </div>
          {preview.errors.length > 0 && <ul>{preview.errors.map((e, index) => <li key={index}>{e}</li>)}</ul>}
          <p style={{ fontSize: 13, color: "#92400e", marginBottom: 0 }}>
            حتى لو تطابقت الأرقام، لا يجوز اعتماد قيود مالية قبل ربط دفعات الدولار والشحن الحقيقية ومراجعة أهلية مصاريف السفر.
          </p>
        </div>}
        {selected?.clearingPreview && <div style={{
          marginTop:14,borderTop:"1px solid #e2e8f0",paddingTop:12,
        }}>
          <h3 style={{ fontSize:17,marginTop:0 }}>معاينة تسوية المقدمات والشحن والسفر — بدون ترحيل</h3>
          <p style={{ fontSize:13,color:"#475569",lineHeight:1.8 }}>
            التسوية المقترحة تنقل المدفوعات من الحسابات الوسيطة لمقابلة ذمم الموردين،
            ولا تنشئ أي قيد شراء أو مخزون ثاني. لا يجوز اعتمادها قبل التأكد من الربط والمطابقة.
          </p>
          <div style={wrap}>
            <div><span style={label}>سندات المورد المسددة مسبقًا (لا يعاد خصمها)</span>
              <b>{money(selected.clearingPreview.supplierVouchersAlreadyAppliedIlsMinor)} ₪</b></div>
            <div><span style={label}>مقدمات الموردين التي ستُسوّى</span>
              <b>{money(selected.clearingPreview.reclassifiedAdvanceIlsMinor)} ₪</b></div>
            <div><span style={label}>الشحن والنقل والتخليص</span>
              <b>{money(selected.clearingPreview.reclassifiedShipmentFreightIlsMinor)} ₪</b></div>
            <div><span style={label}>السفر المؤهل ضمن تكلفة المخزون</span>
              <b>{money(selected.clearingPreview.reclassifiedCapitalizableTravelIlsMinor)} ₪</b></div>
            <div><span style={label}>السفر غير المؤهل كمصروف منفصل</span>
              <b>{money(selected.clearingPreview.recognizedTravelExpenseIlsMinor)} ₪</b></div>
            <div><span style={label}>ذمة المورد المتبقية بعد التسوية</span>
              <b>{money(selected.clearingPreview.remainingSupplierLiabilityIlsMinor)} ₪</b></div>
          </div>
          {!!selected.clearingPreview.supplierBalanceChecks.length && <div style={{ marginTop:10 }}>
            <b style={{ fontSize:13 }}>فحص رصيد ذمم الموردين قبل التسوية</b>
            {selected.clearingPreview.supplierBalanceChecks.map(item=><p key={item.supplierId}
              style={{ fontSize:13,margin:"5px 0",color:item.sufficient?"#166534":"#b91c1c" }}>
              المورد #{item.supplierId}: رصيد الذمة الحالي {money(item.currentPayableIlsMinor)} ₪،
              التسوية المطلوبة {money(item.plannedDebitIlsMinor)} ₪
              — {item.sufficient?"الرصيد كافٍ":"المبلغ يتجاوز الرصيد — ممنوع الإقفال"}
            </p>)}
          </div>}
          <p style={{ fontWeight:800,color:selected.clearingPreview.ready?"#166534":"#92400e" }}>
            {selected.clearingPreview.ready
              ? "خطة التسوية متوازنة حسابيًا فقط، ولم تُرحّل للأستاذ."
              : "خطة التسوية غير مطابقة، وتحتاج معالجة الفروقات التالية."}
          </p>
          {!!selected.clearingPreview.blockers.length && <ul style={{ fontSize:13,lineHeight:1.7,paddingRight:20 }}>
            {selected.clearingPreview.blockers.map((x,i)=><li key={i}>{x}</li>)}
          </ul>}
          <details>
            <summary style={{ cursor:"pointer",fontWeight:700 }}>عرض مسودة سطور القيد المحاسبي (للمراجعة فقط)</summary>
            <div style={{ overflowX:"auto",marginTop:10 }}>
              <table style={{ width:"100%",borderCollapse:"collapse",textAlign:"right",fontSize:12 }}>
                <thead><tr>{["الحساب","المورد","مدين ₪","دائن ₪"].map(x=>
                  <th key={x} style={{ padding:6,borderBottom:"1px solid #cbd5e1" }}>{x}</th>)}</tr></thead>
                <tbody>{selected.clearingPreview.journalLines.map((line,i)=><tr key={i}>
                  <td>{line.accountCode}</td><td>{line.supplierId??"—"}</td>
                  <td>{money(line.debitMinor)}</td><td>{money(line.creditMinor)}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </details>
        </div>}
        {selected?.closePreview && <div style={{
          marginTop: 14, borderTop: "1px solid #e2e8f0", paddingTop: 14,
        }}>
          <h3 style={{ fontSize: 17, marginTop: 0 }}>فحص جاهزية إقفال ملف الاستيراد</h3>
          <div style={wrap}>
            <div><span style={label}>مدفوع المورد بالدولار</span><b>{money(selected.closePreview.paidUsdMinor)} / {money(selected.closePreview.totalUsdMinor)} $</b></div>
            <div><span style={label}>مدفوع الشحن والتخليص والنقل</span><b>{money(selected.closePreview.directCostPaidIlsMinor)} / {money(selected.closePreview.directCostPlannedIlsMinor)} ₪</b></div>
            <div><span style={label}>مدفوع السفر</span><b>{money(selected.closePreview.travelPaidIlsMinor)} / {money(selected.closePreview.travelPlannedIlsMinor)} ₪</b></div>
          </div>
          <p style={{ color: "#92400e", fontWeight: 800 }}>
            {selected.closePreview.canCloseAccounting
              ? "الفحص الحسابي مكتمل، لكن الإقفال غير مفعل حتى ربط قيد شراء المخزون."
              : "الإقفال محجوب لحماية الأرصدة والمخزون. لا توجد حركة مالية عند عرض هذا الفحص."}
          </p>
          {selected.closePreview.reasons.length > 0 && <ul style={{
            margin: "0", paddingRight: 22, lineHeight: 1.8, fontSize: 13,
          }}>
            {selected.closePreview.reasons.map((reason, i) => <li key={i}>{reason}</li>)}
          </ul>}
        </div>}
        {selected?.closure?.status==="posted" && <p style={{fontWeight:800,color:"#166534"}}>
          إقفال مالي مثبت — رقم قيد التسوية: {selected.closure.financeTransactionId??"لا يحتاج قيدًا إضافيًا"}
          {" "} | قيمة التسوية {money(selected.closure.debitIlsMinor)} ₪
        </p>}
        {selected?.closingEnabled && selected.case.status==="draft" && <div style={{
          marginTop:16,borderTop:"1px solid #cbd5e1",paddingTop:14,
        }}>
          <h3 style={{fontSize:17,marginTop:0}}>اعتماد إقفال ملف الاستيراد (مالك فقط)</h3>
          <p style={{fontSize:13,color:"#92400e",lineHeight:1.8}}>
            هذه عملية مالية حقيقية إلى ذمم الموردين وحسابات تجميع الشحن والسفر فقط.
            لا تغيّر تكلفة بطاقة الصنف أو كميات المخزون أو أرصدة البنوك والصندوق.
            لا تعتمدها إلا بعد مراجعة تقرير الفواتير والدفعات وأرصدة الموردين.
          </p>
          <label style={{display:"block",marginBottom:10}}><input type="date" value={closeDate}
            style={{...field,width:200}} onChange={e=>setCloseDate(e.target.value)}/></label>
          {draft.withTravel && <label style={{display:"block",marginBottom:8}}>
            <input type="checkbox" checked={approveTravel} onChange={e=>setApproveTravel(e.target.checked)}/>
            {" "} راجعت وصنفت حصص السفر المؤهلة للمخزون وغير المؤهلة كمصروف
          </label>}
          <label style={{display:"block",marginBottom:9}}>
            <input type="checkbox" checked={approveClose} onChange={e=>setApproveClose(e.target.checked)}/>
            {" "} أوافق على تثبيت تسوية الحسابات المعروضة بعد التحقق من الفواتير والموردين
          </label>
          <button type="button" style={{...btn,background:"#14532d",color:"white"}}
            disabled={busy||!approveClose||(draft.withTravel&&!approveTravel)||
              !selected.clearingPreview.ready}
            onClick={()=>void closeImport()}>إقفال الشحنة بالقيد المالي المطابق</button>
        </div>}
        {selected?.closingEnabled && selected.case.status==="closed" && <div style={{
          marginTop:16,paddingTop:12,borderTop:"1px solid #cbd5e1",
        }}>
          <h3 style={{fontSize:17}}>عكس إقفال الاستيراد</h3>
          <p style={{fontSize:13,color:"#92400e"}}>
            العكس يثبت قيدًا معاكسًا للتسوية فقط ويعيد الملف لمسودة؛ لا يلغي دفعات المورد أو المخزون.
          </p>
          <label><span style={label}>سبب العكس</span><textarea value={reversalReason}
            onChange={e=>setReversalReason(e.target.value)} rows={2}
            style={{...field,maxWidth:550}} placeholder="سبب مالي واضح ومراجع"/></label>
          <label style={{display:"block",marginTop:9,marginBottom:9}}>
            <input type="checkbox" checked={confirmReverse}
              onChange={e=>setConfirmReverse(e.target.checked)}/>
            {" "} أوافق على إنشاء قيد عكسي لنفس الحسابات والمبالغ
          </label>
          <button type="button" style={{...btn,color:"#991b1b"}}
            disabled={busy||!confirmReverse||reversalReason.trim().length<5}
            onClick={()=>void reverseImportClose()}>عكس إقفال الاستيراد</button>
        </div>}
        {!selected?.closingEnabled && selected && <p style={{color:"#92400e",fontSize:13}}>
          إقفال الاستيراد والعكس المالي غير مفعلين بهذا النظام حتى إكمال الاختبارات التجريبية.
        </p>}
        {error && <p role="alert" style={{ color: "#b91c1c", fontWeight: 800 }}>{error}</p>}
        {notice && <p role="status" style={{ color: "#166534", fontWeight: 800 }}>{notice}</p>}
        <button type="submit" disabled={busy||selected?.case.status==="closed"} style={{ ...btn, background: "#1d4ed8", color: "white", marginTop: 12, padding: "11px 24px" }}>
          {busy ? "جاري الحفظ…" : selected ? "حفظ تعديلات المسودة ومطابقتها" : "فتح ملف الاستيراد وحفظه"}
        </button>
      </section>
    </form>
  </main>;
}
