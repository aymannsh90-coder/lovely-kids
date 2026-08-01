function getLocalDateTimeValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;

  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

export default function SalesInvoicePage() {
  return (
    <section className="accounting-invoice-page">
      <header className="accounting-invoice-titlebar">
        <div>
          <span>الفواتير</span>
          <h1>فاتورة مبيعات</h1>
          <p>واجهة محاسبية تفصيلية لإدخال ومراجعة فاتورة المبيعات.</p>
        </div>

        <span className="accounting-invoice-draft-badge">
          واجهة أولية — الحفظ غير مفعّل
        </span>
      </header>

      <div className="accounting-invoice-toolbar">
        <button type="button">
          <span aria-hidden="true">＋</span>
          جديد
        </button>

        <button type="button" disabled>
          <span aria-hidden="true">💾</span>
          حفظ
        </button>

        <button type="button" disabled>
          <span aria-hidden="true">🖨️</span>
          حفظ وطباعة
        </button>

        <button type="button" disabled>
          <span aria-hidden="true">👁️</span>
          معاينة الطباعة
        </button>

        <button type="button" disabled>
          <span aria-hidden="true">✕</span>
          حذف
        </button>
      </div>

      <section className="accounting-invoice-information">
        <div className="accounting-invoice-card">
          <h2>بيانات الفاتورة</h2>

          <div className="accounting-fields-grid">
            <label>
              <span>رقم الفاتورة</span>
              <input value="تلقائي عند الحفظ" readOnly />
            </label>

            <label>
              <span>التاريخ والوقت</span>
              <input
                type="datetime-local"
                defaultValue={getLocalDateTimeValue()}
              />
            </label>

            <label>
              <span>نوع الفاتورة</span>
              <select defaultValue="cash">
                <option value="cash">نقدية</option>
                <option value="credit">آجلة</option>
              </select>
            </label>

            <label>
              <span>المستودع</span>
              <select defaultValue="main">
                <option value="main">المستودع الرئيسي</option>
              </select>
            </label>
          </div>
        </div>

        <div className="accounting-invoice-card">
          <h2>بيانات الزبون</h2>

          <div className="accounting-fields-grid">
            <label className="accounting-wide-field">
              <span>اسم الزبون</span>
              <input placeholder="زبون نقدي" />
            </label>

            <label>
              <span>رقم الهاتف</span>
              <input dir="ltr" inputMode="tel" />
            </label>

            <label>
              <span>المندوب</span>
              <input placeholder="اختياري" />
            </label>

            <label className="accounting-wide-field">
              <span>ملاحظات الفاتورة</span>
              <input placeholder="ملاحظات اختيارية" />
            </label>
          </div>
        </div>
      </section>

      <section className="accounting-item-entry">
        <div>
          <label>
            <span>الباركود أو كود الصنف</span>
            <input dir="ltr" placeholder="امسح الباركود أو اكتب كود الصنف" />
          </label>

          <button type="button">بحث / إضافة</button>
        </div>

        <small>
          هذه الواجهة غير مرتبطة بالحفظ أو المخزون حتى اعتماد التصميم.
        </small>
      </section>

      <div className="accounting-invoice-table-wrap">
        <table className="accounting-invoice-table">
          <thead>
            <tr>
              <th>#</th>
              <th>الباركود</th>
              <th>رقم الصنف</th>
              <th>اسم الصنف</th>
              <th>اللون</th>
              <th>المقاس</th>
              <th>الوحدة</th>
              <th>الكمية</th>
              <th>سعر الوحدة</th>
              <th>الخصم</th>
              <th>المجموع</th>
              <th>حذف</th>
            </tr>
          </thead>

          <tbody>
            <tr className="accounting-empty-row">
              <td colSpan={12}>
                امسح باركود صنف أو استخدم البحث لإضافته إلى الفاتورة.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <section className="accounting-invoice-bottom">
        <div className="accounting-payment-section">
          <h2>الدفع والتسديد</h2>

          <div className="accounting-payment-grid">
            <label>
              <span>طريقة الدفع</span>
              <select defaultValue="cash">
                <option value="cash">نقدي</option>
                <option value="card">بطاقة</option>
                <option value="mixed">دفع مختلط</option>
              </select>
            </label>

            <label>
              <span>المبلغ المدفوع</span>
              <div className="accounting-money-input">
                <input dir="ltr" type="number" defaultValue="0.00" />
                <span>₪</span>
              </div>
            </label>

            <label>
              <span>مركز التكلفة</span>
              <select defaultValue="general">
                <option value="general">عام</option>
              </select>
            </label>
          </div>
        </div>

        <div className="accounting-invoice-totals">
          <div>
            <span>مجموع الكميات</span>
            <strong>0</strong>
          </div>

          <div>
            <span>مجموع الأصناف</span>
            <strong dir="ltr">0.00 ₪</strong>
          </div>

          <label>
            <span>خصم الفاتورة</span>
            <div className="accounting-money-input">
              <input dir="ltr" type="number" defaultValue="0.00" />
              <span>₪</span>
            </div>
          </label>

          <div className="accounting-final-total">
            <span>الإجمالي النهائي</span>
            <strong dir="ltr">0.00 ₪</strong>
          </div>

          <div>
            <span>الباقي</span>
            <strong dir="ltr">0.00 ₪</strong>
          </div>
        </div>
      </section>
    </section>
  );
}
