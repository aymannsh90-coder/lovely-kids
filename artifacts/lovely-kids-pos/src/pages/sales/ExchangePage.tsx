import { useState } from "react";

import { usePosRuntime } from "../../app/pos-context";

type ExchangeMode = "with_receipt" | "no_receipt";

export default function ExchangePage() {
  const { session } = usePosRuntime();

  const [mode, setMode] =
    useState<ExchangeMode>("with_receipt");

  if (!session) {
    return null;
  }

  return (
    <section
      className="sales-return-page"
      id="pos-sales-exchange"
    >
      <header className="sales-return-heading">
        <div className="panel-heading">
          <div className="panel-icon">🔄</div>

          <div>
            <h2>فاتورة تبديل</h2>

            <p>
              تبديل أصناف مع فاتورة أو بدون فاتورة،
              مع احتساب فرق السعر وتحديث المخزون والصندوق.
            </p>
          </div>
        </div>

        <div className="sales-return-session">
          <span>جلسة الصندوق</span>
          <strong dir="ltr">
            {session.registerKey}
          </strong>
        </div>
      </header>

      <article className="sales-return-search-panel">
        <div className="sales-return-section-title">
          <div>
            <h3>نوع التبديل</h3>

            <p>
              اختر إذا كان الزبون يحمل الفاتورة الأصلية
              أو سيتم التبديل بدون فاتورة.
            </p>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(2, minmax(0, 1fr))",
            gap: "12px",
            padding: "16px",
          }}
        >
          <button
            type="button"
            className={
              mode === "with_receipt"
                ? "primary-button"
                : "secondary-button"
            }
            onClick={() =>
              setMode("with_receipt")
            }
          >
            🧾 تبديل مع فاتورة
          </button>

          <button
            type="button"
            className={
              mode === "no_receipt"
                ? "primary-button"
                : "secondary-button"
            }
            onClick={() =>
              setMode("no_receipt")
            }
          >
            📦 تبديل بدون فاتورة
          </button>
        </div>
      </article>

      <article className="sales-return-search-panel">
        <div className="sales-return-section-title">
          <div>
            <h3>
              {mode === "with_receipt"
                ? "الأصناف المرجعة من الفاتورة"
                : "الأصناف المرجعة بدون فاتورة"}
            </h3>

            <p>
              {mode === "with_receipt"
                ? "الخطوة التالية: مسح QR أو إدخال رقم الفاتورة واختيار الأصناف المراد تبديلها."
                : "الخطوة التالية: مسح باركود الصنف وتحديد قيمة المرتجع المعتمدة."}
            </p>
          </div>
        </div>
      </article>

      <article className="sales-return-search-panel">
        <div className="sales-return-section-title">
          <div>
            <h3>الأصناف الجديدة</h3>

            <p>
              سيتم إضافة الأصناف البديلة هنا بالباركود
              مع اللون والمقاس والكمية والسعر.
            </p>
          </div>
        </div>
      </article>

      <article className="sales-return-search-panel">
        <div className="sales-return-section-title">
          <div>
            <h3>ملخص التبديل</h3>

            <p>
              قيمة المرتجع، قيمة الأصناف الجديدة،
              فرق السعر وطريقة التسوية ستظهر هنا.
            </p>
          </div>
        </div>
      </article>
    </section>
  );
}
