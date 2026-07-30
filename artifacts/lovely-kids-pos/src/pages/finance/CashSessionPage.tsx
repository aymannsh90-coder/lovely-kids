import { useLocation } from "react-router-dom";

import { usePosRuntime } from "../../app/pos-context";
import {
  formatBusinessDate,
  formatDateTime,
  formatMoney,
} from "../../lib/format";

interface LocationState {
  message?: string;
}

export default function CashSessionPage() {
  const location = useLocation();

  const state = location.state as LocationState | null;

  const {
    session,
    openingBalance,
    setOpeningBalance,
    openingNote,
    setOpeningNote,
    openBusy,
    openError,
    openMessage,
    handleOpenDay,
    closingBalance,
    setClosingBalance,
    closingNote,
    setClosingNote,
    closeBusy,
    closeError,
    handleCloseDay,
  } = usePosRuntime();

  if (!session) {
    return (
      <section className="work-panel cash-session-page">
        <div className="panel-heading">
          <div className="panel-icon">💰</div>

          <div>
            <h2>فتح يوم العمل</h2>

            <p>أدخل المبلغ الموجود فعليًا داخل الصندوق قبل بدء المبيعات.</p>
          </div>
        </div>

        {state?.message && (
          <div className="alert error-alert route-message">{state.message}</div>
        )}

        <form className="open-day-form" onSubmit={handleOpenDay}>
          <label>
            <span>رصيد بداية الصندوق</span>

            <div className="money-input">
              <input
                dir="ltr"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={openingBalance}
                onChange={(event) => setOpeningBalance(event.target.value)}
                disabled={openBusy}
              />

              <span>₪</span>
            </div>
          </label>

          <label>
            <span>
              ملاحظة الافتتاح
              <small> اختياري</small>
            </span>

            <textarea
              maxLength={500}
              rows={3}
              value={openingNote}
              onChange={(event) => setOpeningNote(event.target.value)}
              placeholder="مثال: رصيد مُرحّل من اليوم السابق"
              disabled={openBusy}
            />
          </label>

          {openError && <div className="alert error-alert">{openError}</div>}

          <button
            className="primary-button open-button"
            type="submit"
            disabled={openBusy}
          >
            {openBusy ? "جاري فتح اليوم…" : "فتح يوم العمل"}
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="work-panel cash-session-page">
      <div className="panel-heading">
        <div className="panel-icon">✅</div>

        <div>
          <h2>بيانات جلسة اليوم</h2>

          <p>جلسة الصندوق نشطة ويمكن تنفيذ العمليات اليومية.</p>
        </div>
      </div>

      {openMessage && (
        <div className="alert success-alert route-message">{openMessage}</div>
      )}

      <div className="session-details">
        <div>
          <span>تاريخ العمل</span>

          <strong>{formatBusinessDate(session.businessDate)}</strong>
        </div>

        <div>
          <span>وقت الافتتاح</span>

          <strong>{formatDateTime(session.openedAt)}</strong>
        </div>

        <div>
          <span>رصيد البداية</span>

          <strong>
            {formatMoney(session.openingBalance, session.currencyCode)}
          </strong>
        </div>

        <div>
          <span>رقم الجلسة</span>

          <strong dir="ltr">#{session.id}</strong>
        </div>
      </div>

      {session.openingNote && (
        <div className="session-note">
          <span>ملاحظة الافتتاح</span>
          <p>{session.openingNote}</p>
        </div>
      )}

      <div className="close-day-block">
        <div className="close-day-heading">
          <div>
            <h3>إغلاق يوم العمل</h3>

            <p>أدخل المبلغ الفعلي الموجود داخل الصندوق عند نهاية اليوم.</p>
          </div>

          <span className="danger-badge">إجراء نهائي</span>
        </div>

        <form className="close-day-form" onSubmit={handleCloseDay}>
          <label>
            <span>الرصيد الفعلي عند الإغلاق</span>

            <div className="money-input">
              <input
                dir="ltr"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={closingBalance}
                onChange={(event) => setClosingBalance(event.target.value)}
                disabled={closeBusy}
              />

              <span>₪</span>
            </div>
          </label>

          <label>
            <span>
              ملاحظة الإغلاق
              <small> اختياري</small>
            </span>

            <textarea
              maxLength={500}
              rows={3}
              value={closingNote}
              onChange={(event) => setClosingNote(event.target.value)}
              placeholder="مثال: تم عدّ الصندوق ومطابقة الرصيد"
              disabled={closeBusy}
            />
          </label>

          {closeError && <div className="alert error-alert">{closeError}</div>}

          <button className="danger-button" type="submit" disabled={closeBusy}>
            {closeBusy ? "جاري إغلاق اليوم…" : "إغلاق يوم العمل"}
          </button>
        </form>
      </div>
    </section>
  );
}
