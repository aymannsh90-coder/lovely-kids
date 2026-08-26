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
  width: 49mm;
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
  width: 24mm;
  min-width: 24mm;

  height: 100%;

  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;

  overflow: hidden;
}

.qr-code {
  width: 24mm;
  height: 24mm;

  flex: 0 0 24mm;
}

.qr-code svg {
  display: block;

  width: 24mm;
  height: 24mm;

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
  size: 58mm auto;
  margin: 0;
}

@media print {

  html,
  body {
    width: 58mm !important;
    min-width: 58mm !important;

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

    width: 58mm !important;
    min-width: 58mm !important;

    height: auto !important;
    min-height: 0 !important;

    margin-left: auto !important;
    margin-right: auto !important;
    padding: 0 !important;

    overflow: visible !important;

    background: #fff !important;
  }

  .label-row {
    width: 58mm !important;
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
    width: 49mm !important;
    height: 25mm !important;

    margin-left: auto !important;
    margin-right: auto !important;

    position: relative !important;
    left: -5.4mm !important;

    transform: scale(0.9) !important;
    transform-origin: top center !important;

    background: #fff !important;
    color: #000 !important;

    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .qr-code,
  .qr-code svg {
    width: 21.5mm !important;
    height: 21.5mm !important;
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

const PRINT_BRIDGE_BASE =
  "http://127.0.0.1:17858";

const RAW_LABEL_WIDTH_DOTS = 384;
const RAW_LABEL_HEIGHT_DOTS = 200;

function fitCanvasText(
  context: any,
  value: string,
  maxWidth: number,
) {
  const clean = value.trim();

  if (
    context.measureText(clean).width <=
    maxWidth
  ) {
    return clean;
  }

  let shortened = clean;

  while (
    shortened.length > 1 &&
    context.measureText(
      `${shortened}…`,
    ).width > maxWidth
  ) {
    shortened =
      shortened.slice(0, -1);
  }

  return `${shortened}…`;
}

function buildRawQrLabelCanvas(
  input: ProductQrPrintInput,
  item: ProductBarcode,
) {
  const documentRef =
    (globalThis as any).document;

  if (!documentRef?.createElement) {
    throw new Error(
      "إنشاء ملصق الطباعة المباشرة غير متاح.",
    );
  }

  const canvas =
    documentRef.createElement("canvas");

  canvas.width =
    RAW_LABEL_WIDTH_DOTS;

  canvas.height =
    RAW_LABEL_HEIGHT_DOTS;

  const context =
    canvas.getContext("2d");

  if (!context) {
    throw new Error(
      "تعذر إنشاء صورة الملصق.",
    );
  }

  context.fillStyle = "#ffffff";
  context.fillRect(
    0,
    0,
    RAW_LABEL_WIDTH_DOTS,
    RAW_LABEL_HEIGHT_DOTS,
  );

  /*
   * QR side
   *
   * Keep every QR module on whole printer dots.
   * This avoids browser scaling / anti-aliasing.
   */
  const qrValue =
    item.barcode.trim();

  const qr =
    QRCode.create(qrValue, {
      errorCorrectionLevel: "L",
    }) as any;

  const modules = qr.modules;
  const moduleCount = modules.size;
  const quiet = 4;

  const qrAreaWidth = 190;
  const maxQrDots = 184;

  const moduleDots =
    Math.max(
      3,
      Math.floor(
        maxQrDots /
          (moduleCount + quiet * 2),
      ),
    );

  const qrDots =
    (moduleCount + quiet * 2) *
    moduleDots;

  const qrStartX =
    Math.floor(
      (qrAreaWidth - qrDots) / 2,
    );

  const qrStartY =
    Math.floor(
      (
        RAW_LABEL_HEIGHT_DOTS -
        qrDots
      ) / 2,
    );

  context.fillStyle = "#000000";

  for (
    let row = 0;
    row < moduleCount;
    row += 1
  ) {
    for (
      let col = 0;
      col < moduleCount;
      col += 1
    ) {
      if (
        modules.get(row, col)
      ) {
        context.fillRect(
          qrStartX +
            (col + quiet) *
              moduleDots,
          qrStartY +
            (row + quiet) *
              moduleDots,
          moduleDots,
          moduleDots,
        );
      }
    }
  }

  /*
   * Product information side
   */
  const right = 376;
  const textWidth = 178;

  context.fillStyle = "#000000";
  context.textAlign = "right";
  context.textBaseline = "alphabetic";

  context.direction = "ltr";
  context.font =
    "900 24px Arial, Tahoma, sans-serif";

  context.fillText(
    "Lovely Kids",
    right,
    31,
  );

  context.direction = "rtl";
  context.font =
    "800 18px Arial, Tahoma, sans-serif";

  context.fillText(
    fitCanvasText(
      context,
      input.nameAr,
      textWidth,
    ),
    right,
    60,
  );

  context.font =
    "700 14px Arial, Tahoma, sans-serif";

  const productCode =
    input.productCode?.trim() || "—";

  const color =
    item.color?.trim() || "—";

  const size =
    item.size?.trim() || "—";

  context.fillText(
    `الكود: ${productCode}`,
    right,
    89,
  );

  context.fillText(
    `اللون: ${color}`,
    right,
    113,
  );

  context.fillText(
    `النمرة: ${size}`,
    right,
    137,
  );

  context.font =
    "900 27px Arial, Tahoma, sans-serif";

  context.fillText(
    `${input.price} ₪`,
    right,
    178,
  );

  return canvas;
}

function canvasToPngBlob(
  canvas: any,
) {
  return new Promise<any>(
    (resolve, reject) => {
      canvas.toBlob(
        (blob: any) => {
          if (!blob) {
            reject(
              new Error(
                "تعذر إنشاء صورة الملصق.",
              ),
            );
            return;
          }

          resolve(blob);
        },
        "image/png",
      );
    },
  );
}

async function ensurePrintBridge() {
  try {
    const response =
      await fetch(
        `${PRINT_BRIDGE_BASE}/health`,
        {
          method: "GET",
          cache: "no-store",
        },
      );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`,
      );
    }

    const result =
      await response.json();

    if (!result?.ok) {
      throw new Error(
        "Bridge is not ready",
      );
    }
  } catch {
    throw new Error(
      "برنامج Lovely Kids Print Bridge غير شغال على هذا الكمبيوتر. شغّله ثم حاول مرة أخرى، وتأكد أن Chrome يسمح بالوصول إلى التطبيقات على الجهاز.",
    );
  }
}

async function printProductQrsViaBridge(
  input: ProductQrPrintInput,
) {
  const labels =
    input.barcodes.filter(
      (item) =>
        item.barcode
          .trim()
          .startsWith("LKQR-"),
    );

  if (labels.length === 0) {
    throw new Error(
      "لا يوجد QR مولّد لهذا الموديل.",
    );
  }

  await ensurePrintBridge();

  let printed = 0;

  for (const item of labels) {
    const canvas =
      buildRawQrLabelCanvas(
        input,
        item,
      );

    const png =
      await canvasToPngBlob(
        canvas,
      );

    const response =
      await fetch(
        `${PRINT_BRIDGE_BASE}/print-png?width=${RAW_LABEL_WIDTH_DOTS}&copies=1`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "image/png",
          },
          body: png,
        },
      );

    if (!response.ok) {
      let detail = "";

      try {
        detail =
          await response.text();
      } catch {
        detail = "";
      }

      throw new Error(
        `فشلت الطباعة المباشرة عند الملصق ${
          printed + 1
        }${
          detail
            ? `: ${detail}`
            : ""
        }`,
      );
    }

    printed += 1;
  }

  return printed;
}

export async function previewAndPrintProductQrs(
  input: ProductQrPrintInput,
) {
  if (Platform.OS === "web") {
    return printProductQrsViaBridge(
      input,
    );
  }

  const {
    html,
    count,
  } = buildProductQrHtml(input);

  const Print =
    await import("expo-print");

  await Print.printAsync({
    html,
    width: LABEL_WIDTH_PX,
    height: LABEL_HEIGHT_PX,
  });

  return count;
}
