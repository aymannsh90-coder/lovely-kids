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
    errorCorrectionLevel: "M",
  }) as any;

  const modules = qr.modules;
  const size = modules.size;
  const quiet = 2;

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
        <section class="label">

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

          <div class="qr-side">

            <div class="qr-code">
              ${buildQrSvg(qrValue)}
            </div>

            <div class="qr-number">
              ${escapeHtml(qrValue)}
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
}

.sheet {
  display: flex;
  flex-direction: column;
  align-items: center;

  gap: 8mm;
  padding: 10mm;

  background: #eee;
}

.label {
  width: 50mm;
  height: 25mm;

  direction: rtl;

  display: grid;

  grid-template-columns:
    minmax(0, 1fr)
    18.5mm;

  align-items: center;

  overflow: hidden;

  padding:
    1.1mm
    1.2mm;

  background: #fff;

  page-break-after: always;
  break-after: page;
}

.product-info {
  min-width: 0;
  height: 100%;

  display: flex;
  flex-direction: column;
  justify-content: center;

  padding-left: 1mm;
}

.brand {
  font-size: 8pt;
  line-height: 1;

  font-weight: 900;

  margin-bottom: 0.6mm;
}

.product-name {
  max-width: 100%;

  font-size: 6.6pt;
  line-height: 1.1;

  font-weight: 800;

  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  margin-bottom: 0.5mm;
}

.info-line {
  display: flex;
  align-items: center;

  gap: 1mm;

  font-size: 5.8pt;
  line-height: 1.25;

  white-space: nowrap;
}

.info-line strong {
  font-weight: 900;
}

.price {
  margin-top: 0.6mm;

  font-size: 9pt;
  line-height: 1;

  font-weight: 900;
}

.qr-side {
  width: 18.5mm;
  height: 100%;

  display: flex;
  flex-direction: column;

  justify-content: center;
  align-items: center;
}

.qr-code {
  width: 17mm;
  height: 17mm;
}

.qr-code svg {
  display: block;

  width: 100%;
  height: 100%;
}

.qr-number {
  direction: ltr;

  width: 18mm;

  margin-top: 0.25mm;

  text-align: center;

  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  font-family: monospace;

  font-size: 3.6pt;
  line-height: 1;

  font-weight: 700;
}

@page {
  size: 50mm 25mm;
  margin: 0;
}

@media print {

  html,
  body {
    width: 50mm;

    margin: 0;
    padding: 0;

    background: #fff;
  }

  .toolbar {
    display: none !important;
  }

  .sheet {
    display: block;

    margin: 0;
    padding: 0;

    background: #fff;
  }

  .label {
    width: 50mm;
    height: 25mm;

    margin: 0;

    page-break-after: always;
    break-after: page;
  }

  .label:last-child {
    page-break-after: auto;
    break-after: auto;
  }
}

</style>

</head>

<body>

<div class="toolbar">

  <button onclick="window.print()">
    🖨️ طباعة الآن
  </button>

  <strong>
    ${generatedBarcodes.length} ملصق
  </strong>

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

function sanitizeWebFilePart(value?: string | null) {
  const cleaned = (value ?? "")
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 35);

  return cleaned || "label";
}

function webPngDataUrlToFile(
  dataUrl: string,
  filename: string,
) {
  const browserWindow =
    (globalThis as any).window;

  const base64 =
    dataUrl.split(",")[1];

  if (!base64) {
    throw new Error(
      "فشل إنشاء صورة الملصق.",
    );
  }

  const binary =
    browserWindow.atob(base64);

  const bytes =
    new Uint8Array(binary.length);

  for (
    let index = 0;
    index < binary.length;
    index += 1
  ) {
    bytes[index] =
      binary.charCodeAt(index);
  }

  return new browserWindow.File(
    [bytes],
    filename,
    {
      type: "image/png",
    },
  );
}

function createWebQrLabelFile(
  input: ProductQrPrintInput,
  item: ProductBarcode,
  index: number,
) {
  const browserDocument =
    (globalThis as any).document;

  const canvas =
    browserDocument.createElement("canvas");

  /*
   * 50mm x 25mm = 2:1 ratio.
   * High resolution for thermal label printing.
   */
  canvas.width = 1000;
  canvas.height = 500;

  const ctx =
    canvas.getContext("2d");

  if (!ctx) {
    throw new Error(
      "تعذر إنشاء صورة الملصق.",
    );
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(
    0,
    0,
    canvas.width,
    canvas.height,
  );

  ctx.fillStyle = "#000000";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.direction = "rtl";

  const rightX = 950;

  // Brand
  ctx.font =
    "900 45px Arial, sans-serif";

  ctx.fillText(
    "Lovely Kids",
    rightX,
    58,
    530,
  );

  // Product name
  ctx.font =
    "900 37px Arial, sans-serif";

  ctx.fillText(
    input.nameAr,
    rightX,
    120,
    530,
  );

  let lineY = 188;

  if (input.productCode) {
    ctx.font =
      "700 29px Arial, sans-serif";

    ctx.fillText(
      `كود الصنف: ${input.productCode}`,
      rightX,
      lineY,
      530,
    );

    lineY += 55;
  }

  const color =
    item.color?.trim() || "—";

  const size =
    item.size?.trim() || "—";

  ctx.font =
    "800 31px Arial, sans-serif";

  ctx.fillText(
    `اللون: ${color}`,
    rightX,
    lineY,
    530,
  );

  lineY += 58;

  ctx.fillText(
    `النمرة: ${size}`,
    rightX,
    lineY,
    530,
  );

  // Price
  ctx.font =
    "900 55px Arial, sans-serif";

  ctx.fillText(
    `${Number(input.price).toFixed(0)} ₪`,
    rightX,
    410,
    530,
  );

  // QR
  const qrValue =
    item.barcode.trim();

  const qr = QRCode.create(
    qrValue,
    {
      errorCorrectionLevel: "M",
    },
  ) as any;

  const modules =
    qr.modules;

  const moduleCount =
    modules.size;

  const quietModules = 4;

  const qrBoxSize = 330;

  const cellSize =
    Math.floor(
      qrBoxSize /
        (
          moduleCount +
          quietModules * 2
        ),
    );

  const realQrSize =
    cellSize *
    (
      moduleCount +
      quietModules * 2
    );

  const qrX =
    Math.round(
      55 +
        (330 - realQrSize) / 2,
    );

  const qrY =
    Math.round(
      52 +
        (330 - realQrSize) / 2,
    );

  ctx.fillStyle = "#ffffff";

  ctx.fillRect(
    qrX,
    qrY,
    realQrSize,
    realQrSize,
  );

  ctx.fillStyle = "#000000";

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
        ctx.fillRect(
          qrX +
            (col + quietModules) *
              cellSize,

          qrY +
            (row + quietModules) *
              cellSize,

          cellSize,
          cellSize,
        );
      }
    }
  }

  // QR value
  ctx.direction = "ltr";
  ctx.textAlign = "center";

  ctx.font =
    "700 18px monospace";

  ctx.fillText(
    qrValue,
    220,
    423,
    360,
  );

  const filename =
    [
      "lovely-kids",
      sanitizeWebFilePart(
        input.productCode,
      ),
      sanitizeWebFilePart(
        color,
      ),
      sanitizeWebFilePart(
        size,
      ),
      String(index + 1),
    ].join("-") + ".png";

  const dataUrl =
    canvas.toDataURL(
      "image/png",
      1,
    );

  return webPngDataUrlToFile(
    dataUrl,
    filename,
  );
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

export async function shareProductQrPdfToDlabel(
  input: ProductQrPrintInput,
) {
  if (Platform.OS === "web") {
    const browserDocument =
      (globalThis as any).document;

    const generatedBarcodes =
      input.barcodes.filter(
        (item) =>
          item.barcode
            .trim()
            .startsWith("LKQR-"),
      );

    if (generatedBarcodes.length === 0) {
      throw new Error(
        "لا يوجد QR مولّد للطباعة.",
      );
    }

    /*
     * أول تجربة:
     * ننزل ملصق واحد فقط حتى نتأكد من
     * المقاس والجودة داخل DLabel.
     */
    const item = generatedBarcodes[0];

    const file =
      createWebQrLabelFile(
        input,
        item,
        0,
      );

    const url =
      URL.createObjectURL(file);

    const link =
      browserDocument.createElement("a");

    link.href = url;

    link.download =
      file.name;

    browserDocument.body.appendChild(
      link,
    );

    link.click();

    link.remove();

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1500);

    return 1;
  }

  const {
    html,
    count,
  } = buildProductQrHtml(input);

  const Print =
    await import("expo-print");

  const Sharing =
    await import("expo-sharing");

  const sharingAvailable =
    await Sharing.isAvailableAsync();

  if (!sharingAvailable) {
    throw new Error(
      "المشاركة غير متاحة على هذا الجهاز.",
    );
  }

  const result =
    await Print.printToFileAsync({
      html,
      width: LABEL_WIDTH_PX,
      height: LABEL_HEIGHT_PX,
      base64: false,
      textZoom: 100,
    });

  await Sharing.shareAsync(
    result.uri,
    {
      mimeType:
        "application/pdf",

      dialogTitle:
        "فتح ملصقات Lovely Kids في DLabel",

      UTI:
        "com.adobe.pdf",
    },
  );

  return count;
}

