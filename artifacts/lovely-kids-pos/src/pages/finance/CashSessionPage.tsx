import { useLocation } from "react-router-dom";

import { usePosRuntime } from "../../app/pos-context";
import type { CashSession } from "../../lib/api";
import {
  formatBusinessDate,
  formatDateTime,
  formatMoney,
} from "../../lib/format";

interface LocationState {
  message?: string;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function printClosedSessionReport(
  snapshot: {
    session: CashSession;
    varianceMinor: number;
    variance: number;
  },
) {
  const { session, variance } =
    snapshot;

  const printWindow =
    window.open(
      "",
      "_blank",
      "width=900,height=850",
    );

  if (!printWindow) {
    window.alert(
      "تعذر فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.",
    );
    return;
  }

  const varianceLabel =
    variance > 0
      ? `زيادة ${formatMoney(
          variance,
          session.currencyCode,
        )}`
      : variance < 0
        ? `نقص ${formatMoney(
            Math.abs(variance),
            session.currencyCode,
          )}`
        : "مطابق";

  const generatedAt =
    new Date().toLocaleString(
      "ar-PS",
      {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      },
    );

  printWindow.opener = null;
  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>تقرير إغلاق يوم العمل - ${escapeHtml(session.businessDate)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, Tahoma, sans-serif;
      color: #111827;
      background: #fff;
    }
    .sheet {
      width: 100%;
      max-width: 185mm;
      margin: 0 auto;
      padding: 8mm;
    }
    .head {
      text-align: center;
      margin-bottom: 7mm;
    }
    .brand {
      color: #E91E8C;
      font-size: 20px;
      font-weight: 900;
    }
    h1 {
      margin: 2mm 0 1mm;
      font-size: 23px;
    }
    .meta {
      color: #6b7280;
      font-size: 10px;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      border-top: 1px solid #cfd8df;
      border-right: 1px solid #cfd8df;
    }
    .cell {
      min-height: 25mm;
      padding: 5mm;
      border-left: 1px solid #cfd8df;
      border-bottom: 1px solid #cfd8df;
    }
    .cell span {
      display: block;
      margin-bottom: 2mm;
      color: #667085;
      font-size: 11px;
      font-weight: 700;
    }
    .cell strong {
      display: block;
      font-size: 17px;
    }
    .variance {
      margin-top: 5mm;
      border: 2px solid #111827;
      padding: 5mm;
      text-align: center;
    }
    .variance span {
      display: block;
      margin-bottom: 2mm;
      font-size: 11px;
    }
    .variance strong {
      font-size: 22px;
    }
    .notes {
      margin-top: 5mm;
      border: 1px solid #cfd8df;
      padding: 4mm;
      min-height: 22mm;
    }
    .notes strong {
      display: block;
      margin-bottom: 2mm;
    }
    .signatures {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20mm;
      margin-top: 14mm;
    }
    .signature {
      padding-top: 4mm;
      border-top: 1px solid #6b7280;
      text-align: center;
      font-size: 10px;
    }
    .footer {
      margin-top: 10mm;
      color: #6b7280;
      text-align: center;
      font-size: 9px;
    }
    @page {
      size: A4 portrait;
      margin: 10mm;
    }
    @media print {
      .sheet {
        max-width: none;
        padding: 0;
      }
    }
  </style>
</head>
<body>
  <main class="sheet">
    <header class="head">
      <div class="brand">Lovely Kids</div>
      <h1>تقرير إغلاق يوم العمل</h1>
      <div class="meta">
        تاريخ التقرير: ${escapeHtml(generatedAt)}
        · رقم الجلسة: #${escapeHtml(session.id)}
      </div>
    </header>

    <div class="grid">
      <div class="cell">
        <span>تاريخ العمل</span>
        <strong>${escapeHtml(formatBusinessDate(session.businessDate))}</strong>
      </div>

      <div class="cell">
        <span>وقت الافتتاح</span>
        <strong>${escapeHtml(formatDateTime(session.openedAt))}</strong>
      </div>

      <div class="cell">
        <span>وقت الإغلاق</span>
        <strong>${escapeHtml(session.closedAt ? formatDateTime(session.closedAt) : "—")}</strong>
      </div>

      <div class="cell">
        <span>رصيد البداية</span>
        <strong>${escapeHtml(formatMoney(session.openingBalance, session.currencyCode))}</strong>
      </div>

      <div class="cell">
        <span>الرصيد المتوقع عند الإغلاق</span>
        <strong>${escapeHtml(formatMoney(
          session.expectedBalance ?? session.openingBalance,
          session.currencyCode,
        ))}</strong>
      </div>

      <div class="cell">
        <span>الرصيد الفعلي عند الإغلاق</span>
        <strong>${escapeHtml(formatMoney(
          session.closingBalance ?? 0,
          session.currencyCode,
        ))}</strong>
      </div>
    </div>

    <div class="variance">
      <span>فرق الصندوق</span>
      <strong>${escapeHtml(varianceLabel)}</strong>
    </div>

    <div class="notes">
      <strong>ملاحظات الإغلاق</strong>
      ${escapeHtml(session.closingNote || "لا توجد ملاحظات")}
    </div>

    <div class="signatures">
      <div class="signature">توقيع الكاشير</div>
      <div class="signature">توقيع المسؤول</div>
    </div>

    <div class="footer">
      تقرير صادر من نظام Lovely Kids — للمطابقة اليومية للصندوق.
    </div>
  </main>
</body>
</html>`);
  printWindow.document.close();

  const runPrint = () => {
    printWindow.focus();
    printWindow.print();
  };

  if (
    printWindow.document.readyState ===
    "complete"
  ) {
    window.setTimeout(
      runPrint,
      100,
    );
  } else {
    printWindow.addEventListener(
      "load",
      () =>
        window.setTimeout(
          runPrint,
          100,
        ),
      { once: true },
    );
  }
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
    lastClosedSession,
    handleCloseDay,
  } = usePosRuntime();

  if (!session) {
    return (
      <section className="work-panel cash-session-page">
        {lastClosedSession && (
          <section
            style={{
              marginBottom: 18,
              padding: 18,
              border:
                "1px solid #b9e7cc",
              borderRadius: 14,
              background:
                "#f1fbf5",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent:
                  "space-between",
                alignItems:
                  "center",
                gap: 14,
                flexWrap:
                  "wrap",
              }}
            >
              <div>
                <strong
                  style={{
                    display:
                      "block",
                    fontSize: 18,
                    marginBottom: 5,
                  }}
                >
                  ✅ تم إغلاق يوم العمل
                </strong>

                <span>
                  {formatBusinessDate(
                    lastClosedSession
                      .session
                      .businessDate,
                  )}
                  {" · "}
                  {lastClosedSession
                    .variance >
                  0
                    ? `زيادة ${formatMoney(
                        lastClosedSession
                          .variance,
                        lastClosedSession
                          .session
                          .currencyCode,
                      )}`
                    : lastClosedSession
                          .variance <
                        0
                      ? `نقص ${formatMoney(
                          Math.abs(
                            lastClosedSession
                              .variance,
                          ),
                          lastClosedSession
                            .session
                            .currencyCode,
                        )}`
                      : "الصندوق مطابق"}
                </span>
              </div>

              <button
                type="button"
                className="primary-button"
                onClick={() =>
                  printClosedSessionReport(
                    lastClosedSession,
                  )
                }
              >
                🖨️ طباعة تقرير الإغلاق A4
              </button>
            </div>
          </section>
        )}

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
                onFocus={(event) => event.currentTarget.select()}
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
          <span>رصيد الصندوق الحالي</span>

          <strong>
            {formatMoney(
              session.expectedBalance ?? session.openingBalance,
              session.currencyCode,
            )}
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
                onFocus={(event) => event.currentTarget.select()}
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
