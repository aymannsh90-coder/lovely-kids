import * as QRCode from "qrcode";
import { Platform } from "react-native";

import type { ProductBarcode } from "@/data/products";

type ProductQrPrintInput = {
  nameAr: string;
  productCode?: string | null;
  price: number;
  barcodes: ProductBarcode[];
};

const LABEL_WIDTH_PX = 142;
const LABEL_HEIGHT_PX = 71;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildQrSvg(value: string) {
  const qr = QRCode.create(value, {
    errorCorrectionLevel: "L",
  }) as any;

  const modules = qr.modules;
  const size = modules.size;
  const quiet = 4;

  const cells: string[] = [];

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (modules.get(row, col)) {
        cells.push(
          `<rect x="${col}" y="${row}" width="1" height="1"/>`,
        );
      }
    }
  }

  return `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="${-quiet} ${-quiet} ${size + quiet * 2} ${size + quiet * 2}"
      shape-rendering="crispEdges"
    >
      <rect
        x="${-quiet}"
        y="${-quiet}"
        width="${size + quiet * 2}"
        height="${size + quiet * 2}"
        fill="#fff"
      />

      <g fill="#000">
        ${cells.join("")}
      </g>
    </svg>
  `;
}

function buildProductQrHtml(
  input: ProductQrPrintInput,
) {
  const generatedBarcodes =
    input.barcodes.filter(
      (item) =>
        item.barcode
          .trim()
          .startsWith("LKQR-"),
    );

  if (generatedBarcodes.length === 0) {
    throw new Error(
      "لا يوجد QR مولّد لهذا الموديل.",
    );
  }

  const labels = generatedBarcodes
    .map((item) => {
      const qrValue =
        item.barcode.trim();

      const color =
        item.color?.trim() || "—";

      const size =
        item.size?.trim() || "—";

      return `
        <section class="label-row">

          <div class="label">

            <div class="qr-side">

              <div class="qr-code">
                ${buildQrSvg(qrValue)}
              </div>

            </div>

            <div class="product-info">

              <div class="brand">
                Lovely Kids
              </div>

              <div class="product-name">
                ${escapeHtml(input.nameAr)}
              </div>

              ${
                input.productCode
                  ? `
                    <div class="info-line">
                      <span>الكود:</span>
                      <strong>
                        ${escapeHtml(
                          input.productCode,
                        )}
                      </strong>
                    </div>
                  `
                  : ""
              }

              <div class="info-line">
                <span>اللون:</span>
                <strong>
                  ${escapeHtml(color)}
                </strong>
              </div>

              <div class="info-line">
                <span>النمرة:</span>
                <strong>
                  ${escapeHtml(size)}
                </strong>
              </div>

              <div class="price">
                ${Number(input.price).toFixed(0)} ₪
              </div>

            </div>

          </div>

        </section>
      `;
    })
    .join("\n");

  const html = `
<!doctype html>

<html lang="ar" dir="rtl">

<head>

<meta charset="utf-8">

<title>Lovely Kids QR</title>

<style>

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;

  background: #fff;

  font-family:
    Arial,
    Tahoma,
    sans-serif;
}

body {
  direction: rtl;
}

.toolbar {
  position: sticky;
  top: 0;
  z-index: 100;

  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;

  padding: 10px;

  background: #111827;
  color: #fff;
}

.toolbar button {
  border: 0;
  border-radius: 10px;

  padding: 11px 22px;

  background: #e91e8c;
  color: #fff;

  font-size: 15px;
  font-weight: 800;

  cursor: pointer;
}

.sheet {
  width: 56mm;

  margin: 0 auto;

  padding:
    4mm
    2mm;

  background: #eee;
}

.label-row {
  width: 52mm;
  height: 28.5mm;

  display: flex;
  justify-content: center;
  align-items: flex-start;

  margin: 0;
  padding: 0;

  break-inside: avoid;
  page-break-inside: avoid;
}

.label {
  width: 44mm;
  height: 25mm;

  direction: rtl;

  display: flex;
  flex-direction: row-reverse;
  align-items: center;

  overflow: hidden;

  margin: 0;
  padding:
    0.5mm
    0.6mm;

  background: #fff;
  color: #000;
}

.qr-side {
  width: 22mm;
  min-width: 22mm;

  height: 100%;

  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;

  overflow: hidden;
}

.qr-code {
  width: 21.5mm;
  height: 21.5mm;

  flex: 0 0 21.5mm;
}

.qr-code svg {
  display: block;

  width: 21.5mm;
  height: 21.5mm;

  shape-rendering: crispEdges;
}



.product-info {
  flex: 1;
  min-width: 0;

  height: 100%;

  display: flex;
  flex-direction: column;
  justify-content: center;

  padding-right: 0.4mm;

  color: #000;
}

.brand {
  margin-bottom: 0.55mm;

  font-size: 7.4pt;
  line-height: 1;

  font-weight: 900;
}

.product-name {
  max-width: 100%;

  margin-bottom: 0.55mm;

  font-size: 5.9pt;
  line-height: 1.1;

  font-weight: 900;

  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.info-line {
  display: flex;
  align-items: center;

  gap: 0.8mm;

  font-size: 5.3pt;
  line-height: 1.25;

  font-weight: 700;

  white-space: nowrap;
}

.info-line strong {
  font-weight: 900;
}

.price {
  margin-top: 0.65mm;

  font-size: 8.5pt;
  line-height: 1;

  font-weight: 900;
}

@page receipt {
  size: 56mm auto;
  margin: 2mm;
}

@media print {

  html,
  body {
    width: 56mm !important;
    min-width: 56mm !important;

    height: auto !important;
    min-height: 0 !important;

    margin: 0 !important;
    padding: 0 !important;

    overflow: visible !important;

    background: #fff !important;
  }

  .toolbar {
    display: none !important;
  }

  .sheet {
    page: receipt;

    display: block !important;

    width: 52mm !important;
    min-width: 52mm !important;

    height: auto !important;
    min-height: 0 !important;

    margin: 0 !important;
    padding: 0 !important;

    overflow: visible !important;

    background: #fff !important;
  }

  .label-row {
    width: 52mm !important;
    height: 28.5mm !important;

    margin: 0 !important;
    padding: 0 !important;

    display: flex !important;
    justify-content: center !important;
    align-items: flex-start !important;

    break-inside: avoid !important;
    page-break-inside: avoid !important;

    break-after: auto !important;
    page-break-after: auto !important;
  }

  .label {
    width: 44mm !important;
    height: 25mm !important;

    margin: 0 !important;
    transform: translateX(-1.70mm);

    background: #fff !important;
    color: #000 !important;

    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .qr-code,
  .qr-code svg {
    width: 18.2mm !important;
    height: 18.2mm !important;
  }

  .qr-code svg {
    shape-rendering: crispEdges !important;
  }
}

</style>

</head>

<body>

  <div class="toolbar">

    <strong>
      ${generatedBarcodes.length} ملصق
    </strong>

    <button onclick="window.print()">
      طباعة الآن 🖨️
    </button>

  </div>

  <main class="sheet">
    ${labels}
  </main>

</body>

</html>
`;

  return {
    html,
    count:
      generatedBarcodes.length,
  };
}

export async function previewAndPrintProductQrs(
  input: ProductQrPrintInput,
) {
  const {
    html,
    count,
  } = buildProductQrHtml(input);

  if (Platform.OS === "web") {
    const browserWindow =
      (globalThis as any).window;

    const popup =
      browserWindow?.open(
        "",
        "_blank",
        "width=900,height=750",
      );

    if (!popup) {
      throw new Error(
        "المتصفح منع نافذة المعاينة. اسمح بالنوافذ المنبثقة.",
      );
    }

    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    popup.focus();

    return count;
  }

  const Print =
    await import("expo-print");

  await Print.printAsync({
    html,
    width: LABEL_WIDTH_PX,
    height: LABEL_HEIGHT_PX,
  });

  return count;
}
