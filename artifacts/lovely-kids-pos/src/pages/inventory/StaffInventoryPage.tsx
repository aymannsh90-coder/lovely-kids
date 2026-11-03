import { useEffect, useMemo, useState, type FormEvent } from "react";
import { usePosRuntime } from "../../app/pos-context";
import {
  getPosAdminInventoryProducts, setPosGeneralStock, setPosVariantStock, setPosProductVisibility,
  type PosAdminInventoryProduct,
} from "../../lib/api";

type StockTarget = { product: PosAdminInventoryProduct; color?: string; size?: string; amount: string };

export default function StaffInventoryPage() {
  const { token, user } = usePosRuntime();
  const [products, setProducts] = useState<PosAdminInventoryProduct[]>([]);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<StockTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const canEdit = Boolean(user?.permissions?.includes("inventory.edit"));
  const filtered = useMemo(() => products.filter(p =>
    [p.nameAr, p.productCode ?? "", p.barcode ?? "", ...(p.additionalBarcodes ?? []).map(x => x.barcode)]
      .some(x => x.toLowerCase().includes(query.trim().toLowerCase())),
  ).slice(0, 200), [products, query]);

  async function load() {
    setBusy(true); setError("");
    try {
      const rows = await getPosAdminInventoryProducts(token);
      setProducts(rows);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر تحميل المخزون");
    } finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, [token]);

  function edit(product: PosAdminInventoryProduct, color?: string, size?: string, stock?: number | null) {
    if (!canEdit) return;
    setTarget({ product, color, size, amount: String(stock ?? 0) });
    setError(""); setMessage("");
  }

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!target || !canEdit || busy) return;
    const amount = Number(target.amount);
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1_000_000) {
      setError("يجب أن تكون الكمية عددًا صحيحًا غير سالب");
      return;
    }
    const label = target.color && target.size
      ? `${target.product.nameAr} - ${target.color} / ${target.size}`
      : target.product.nameAr;
    if (!window.confirm(`تعديل رصيد ${label} إلى ${amount} قطعة؟ سيُسجل تعديل للمخزون.`)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (target.color && target.size) {
        await setPosVariantStock(token, target.product.id, { color: target.color, size: target.size, amount });
      } else {
        await setPosGeneralStock(token, target.product.id, { amount });
      }
      setTarget(null);
      setProducts(await getPosAdminInventoryProducts(token));
      setMessage("تم تحديث الكمية بنجاح.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر تعديل الكمية");
    } finally { setBusy(false); }
  }

  async function visibility(product: PosAdminInventoryProduct) {
    if (!canEdit || busy) return;
    if (!window.confirm(`${product.isHidden ? "إظهار" : "إخفاء"} صنف "${product.nameAr}" من المتجر الإلكتروني؟`)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await setPosProductVisibility(token, product.id, !product.isHidden);
      setProducts(await getPosAdminInventoryProducts(token));
      setMessage("تم تحديث حالة ظهور الصنف.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر تغيير ظهور الصنف");
    } finally { setBusy(false); }
  }

  return <main dir="rtl" style={{ padding: 18, maxWidth: 1250, margin: "0 auto" }}>
    <section style={{ padding: 20, borderRadius: 12, background: "var(--card-bg, white)" }}>
      <h1>📦 الأصناف والمخزون</h1>
      <p>الصلاحية تسمح بمشاهدة الكميات والباركود. تعديل الرصيد والظهور يحتاج إذن «تعديل المخزون». تكلفة الأصناف والحذف النهائي غير متاحين هنا.</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "12px 0" }}>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="اسم أو كود أو باركود" style={{ flex: 1, minWidth: 220, padding: 10, borderRadius: 8, border: "1px solid #cbd5e1" }} />
        <button type="button" disabled={busy} onClick={() => void load()}>تحديث</button>
      </div>
      {error && <p role="alert" style={{ color: "#991b1b" }}>{error}</p>}
      {message && <p role="status" style={{ color: "#166534" }}>{message}</p>}
      <p>عدد الأصناف الظاهرة: {filtered.length}</p>
      {target && <form onSubmit={save} style={{ padding: 15, border: "1px solid #f472b6", borderRadius: 10, marginBottom: 15 }}>
        <strong>{target.product.nameAr} {target.color ? ` / ${target.color}` : ""} {target.size ? ` / ${target.size}` : ""}</strong>
        <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap", marginTop: 10 }}>
          <label>الكمية الجديدة <input required inputMode="numeric" type="number" min="0" step="1" value={target.amount}
            onChange={e => setTarget(old => old ? { ...old, amount: e.target.value } : old)} style={{ display: "block", padding: 9 }} /></label>
          <button disabled={busy} type="submit" className="primary-button">حفظ الكمية</button>
          <button type="button" onClick={() => setTarget(null)}>إلغاء</button>
        </div>
      </form>}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", textAlign: "right" }}>
          <thead><tr><th>الصنف</th><th>الكود والباركود</th><th>المتاح</th><th>الحالة</th>{canEdit && <th>التعديل</th>}</tr></thead>
          <tbody>{filtered.map(p => <tr key={p.id} style={{ borderTop: "1px solid #e2e8f0" }}>
            <td>{p.nameAr}</td><td dir="ltr">{p.productCode ?? p.barcode ?? p.id}</td>
            <td>
              <strong>{p.stock ?? "—"}</strong>
              {p.colorVariants.map(v => <div key={v.color} style={{ fontSize: 13, marginTop: 4 }}>
                {v.color}: {v.sizes.map(s => `${s.size} (${s.stock ?? "—"})`).join("، ")}
              </div>)}
            </td>
            <td>{p.deletedAt ? "محذوف" : p.isHidden ? "مخفي" : "ظاهر"}</td>
            {canEdit && <td>
              {!p.deletedAt && <>
                {!p.colorVariants.some(v => v.sizes.length > 0) && <button type="button" disabled={busy} onClick={() => edit(p, undefined, undefined, p.stock)}>تعديل العدد</button>}
                {p.colorVariants.flatMap(v => v.sizes.map(s => ({ color: v.color, size: s.size, stock: s.stock }))).map(x =>
                  <button key={`${x.color}-${x.size}`} type="button" disabled={busy}
                    onClick={() => edit(p, x.color, x.size, x.stock)} style={{ margin: 3 }}>{x.color} / {x.size}</button>)}
                <button type="button" disabled={busy} onClick={() => void visibility(p)}>{p.isHidden ? "إظهار" : "إخفاء"}</button>
              </>}
            </td>}
          </tr>)}</tbody>
        </table>
      </div>
    </section>
  </main>;
}
