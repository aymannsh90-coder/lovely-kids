export type ReportCell = string | number | null | undefined;

export interface ReportSummaryItem {
  label: string;
  value: ReportCell;
}

export interface ReportTableSection {
  title?: string;
  headers: string[];
  rows: ReportCell[][];
}

export interface A4ReportOptions {
  title: string;
  subtitle?: string;
  period?: string;
  orientation?: "portrait" | "landscape";
  summary?: ReportSummaryItem[];
  sections: ReportTableSection[];
}

function escapeHtml(value: ReportCell) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function reportBody(options: A4ReportOptions) {
  const summary = options.summary?.length
    ? `<section class="summary">${options.summary
        .map(
          (item) =>
            `<div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`,
        )
        .join("")}</section>`
    : "";

  const sections = options.sections
    .map(
      (section) => `
        <section class="report-section">
          ${section.title ? `<h2>${escapeHtml(section.title)}</h2>` : ""}
          <table>
            <thead>
              <tr>
                ${section.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${section.rows.length
                ? section.rows
                    .map(
                      (row) =>
                        `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`,
                    )
                    .join("")
                : `<tr><td colspan="${Math.max(1, section.headers.length)}">لا توجد بيانات</td></tr>`}
            </tbody>
          </table>
        </section>`,
    )
    .join("");

  return `
    <header class="report-header">
      <div class="brand">Lovely Kids</div>
      <h1>${escapeHtml(options.title)}</h1>
      ${options.subtitle ? `<p>${escapeHtml(options.subtitle)}</p>` : ""}
      ${options.period ? `<small>${escapeHtml(options.period)}</small>` : ""}
    </header>
    ${summary}
    ${sections}
    <footer>Lovely Kids POS</footer>
  `;
}

export function printA4Report(options: A4ReportOptions) {
  const printWindow = window.open("", "_blank", "noopener,noreferrer,width=1200,height=850");

  if (!printWindow) {
    throw new Error("تعذر فتح معاينة الطباعة. اسمح بالنوافذ المنبثقة ثم حاول مرة أخرى.");
  }

  const orientation = options.orientation ?? "portrait";

  printWindow.opener = null;
  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(options.title)}</title>
<style>
  @page { size: A4 ${orientation}; margin: 12mm 9mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #111827; }
  body { font-family: Arial, "Noto Sans Arabic", Tahoma, sans-serif; font-size: 10px; direction: rtl; }
  .report-header { text-align: center; margin-bottom: 6mm; }
  .report-header .brand { color: #e91e8c; font-weight: 800; font-size: 14px; }
  .report-header h1 { margin: 1.5mm 0 1mm; font-size: 20px; }
  .report-header p, .report-header small { margin: 0.8mm 0; color: #4b5563; }
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 2mm; margin-bottom: 5mm; }
  .summary > div { border: 1px solid #cbd5e1; padding: 2.2mm; background: #f8fafc; break-inside: avoid; }
  .summary span { display: block; color: #475569; margin-bottom: 1mm; }
  .summary strong { display: block; font-size: 12px; }
  .report-section { margin-top: 5mm; }
  .report-section h2 { margin: 0 0 2mm; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; table-layout: auto; }
  thead { display: table-header-group; }
  th, td { border: 1px solid #94a3b8; padding: 1.6mm 1.3mm; text-align: center; vertical-align: middle; overflow-wrap: anywhere; }
  th { background: #f1f5f9; font-weight: 800; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  footer { margin-top: 6mm; padding-top: 2mm; border-top: 1px solid #cbd5e1; text-align: center; color: #64748b; font-size: 9px; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
${reportBody(options)}
</body>
</html>`);
  printWindow.document.close();

  const runPrint = () => {
    printWindow.focus();
    printWindow.print();
  };

  if (printWindow.document.readyState === "complete") {
    window.setTimeout(runPrint, 50);
  } else {
    printWindow.addEventListener("load", () => window.setTimeout(runPrint, 50), { once: true });
  }
}

export function exportReportAsExcel(
  fileName: string,
  options: A4ReportOptions,
) {
  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<style>
  body { font-family: Arial, Tahoma, sans-serif; direction: rtl; }
  h1, h2, p { text-align: center; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0 22px; }
  th, td { border: 1px solid #777; padding: 6px; text-align: center; }
  th { font-weight: 700; background: #eee; }
</style>
</head>
<body>
${reportBody(options)}
</body>
</html>`;

  const blob = new Blob(["\ufeff", html], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName.endsWith(".xls") ? fileName : `${fileName}.xls`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
