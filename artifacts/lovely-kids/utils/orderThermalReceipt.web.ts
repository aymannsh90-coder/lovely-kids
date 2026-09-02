import html2canvas from "html2canvas";
import QRCode from "qrcode";

const PRINT_BRIDGE_BASE = "http://127.0.0.1:17858";
const RECEIPT_WIDTH_DOTS = 384;

export interface ThermalOrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  size?: string;
  color?: string;
  productCode?: string | null;
}

export interface ThermalOrder {
  id: number;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  items: ThermalOrderItem[];
  totalPrice: number;
  shippingZone?: string;
  shippingCost?: number;
  notes?: string;
  paymentMethod: string;
  paymentStatus: string;
  createdAt: string;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDateTime(value: string) {
  try {
    return new Intl.DateTimeFormat("ar-PS", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Asia/Hebron",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function money(value: number) {
  return `${Number(value || 0).toFixed(2)} ₪`;
}

function shortProductName(value: string) {
  const clean = value.trim();
  if (!clean) return "صنف";

  if (clean.length <= 18) return clean;

  return `${clean.slice(0, 18)}…`;
}

function paymentMethodLabel(value: string) {
  switch (value) {
    case "bank_transfer":
      return "تحويل بنكي";
    case "cash":
    case "cash_on_delivery":
      return "نقدي";
    default:
      return value || "نقدي";
  }
}

function paymentStatusLabel(value: string) {
  switch (value) {
    case "confirmed":
      return "مدفوع";
    case "proof_submitted":
      return "وصل مرفق";
    case "awaiting_transfer":
      return "بانتظار التحويل";
    default:
      return "غير مدفوع";
  }
}

async function ensureReceiptBridge() {
  let response: Response;

  try {
    response = await fetch(`${PRINT_BRIDGE_BASE}/health`, {
      cache: "no-store",
    });
  } catch {
    throw new Error(
      "تعذر الاتصال ببرنامج Lovely Kids Print Bridge. تأكد أن برنامج الطباعة يعمل على جهاز المحل.",
    );
  }

  if (!response.ok) {
    throw new Error("تعذر الاتصال ببرنامج Lovely Kids Print Bridge");
  }

  const health = (await response.json()) as {
    ok?: boolean;
    printer?: string;
    version?: string;
  };

  if (!health.ok) {
    throw new Error("الطابعة غير جاهزة في Print Bridge");
  }
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("تعذر تجهيز صورة الفاتورة للطباعة"));
      }
    }, "image/png");
  });
}

async function waitForImages(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll("img"));

  await Promise.all(
    images.map((image) => {
      if (image.complete) return Promise.resolve();

      return new Promise<void>((resolve) => {
        let done = false;

        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };

        image.addEventListener("load", finish, { once: true });
        image.addEventListener("error", finish, { once: true });

        window.setTimeout(finish, 2500);
      });
    }),
  );
}

export async function printOrderThermalReceipt(
  order: ThermalOrder,
): Promise<void> {
  if (typeof document === "undefined") {
    throw new Error("الطباعة الحرارية متاحة من جهاز الكمبيوتر");
  }

  await ensureReceiptBridge();

  const [
    invoiceQr,
    facebookQr,
    whatsappQr,
    storeQr,
  ] = await Promise.all([
    QRCode.toDataURL(String(order.id), {
      width: 256,
      margin: 0,
      errorCorrectionLevel: "M",
    }),
    QRCode.toDataURL("https://www.facebook.com/lovely.kids.nablus1", {
      width: 256,
      margin: 0,
      errorCorrectionLevel: "M",
    }),
    QRCode.toDataURL("https://wa.me/97292376808", {
      width: 256,
      margin: 0,
      errorCorrectionLevel: "M",
    }),
    QRCode.toDataURL("https://lovelykids.net", {
      width: 256,
      margin: 0,
      errorCorrectionLevel: "M",
    }),
  ]);

  const productsSubtotal = order.items.reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
    0,
  );

  const shippingCost = Number(order.shippingCost || 0);

  const itemRows = order.items
    .map((item, index) => {
      const variant =
        [
          item.color ? `لون ${item.color}` : "",
          item.size ? `مقاس ${item.size}` : "",
        ]
          .filter(Boolean)
          .join(" / ") || item.productCode || "—";

      return `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(shortProductName(item.name))}</td>
          <td>${escapeHtml(variant)}</td>
          <td>${Number(item.quantity || 0)}</td>
          <td dir="ltr">${money(
            Number(item.price || 0) * Number(item.quantity || 0),
          )}</td>
        </tr>
      `;
    })
    .join("");

  const captureHost = document.createElement("div");
  captureHost.className = "lk-order-thermal-capture";
  captureHost.dataset.directReceiptCapture = "true";

  Object.assign(captureHost.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: `${RECEIPT_WIDTH_DOTS}px`,
    background: "#ffffff",
    zIndex: "-9999",
    pointerEvents: "none",
  });

  const style = document.createElement("style");

  style.textContent = `
    .lk-order-thermal-capture,
    .lk-order-thermal-capture * {
      box-sizing: border-box;
    }

    .lk-order-thermal-capture .receipt-print-area {
      display: block !important;
      position: static !important;
      direction: rtl;
      width: 384px !important;
      min-width: 384px !important;
      max-width: 384px !important;
      margin: 0 !important;
      padding: 10px 12px 6px !important;
      overflow: visible !important;
      background: #fff !important;
      color: #000 !important;
      font-family: Tahoma, Arial, sans-serif !important;
      font-size: 14px !important;
      font-weight: 700 !important;
      line-height: 1.4 !important;
    }

    .lk-order-thermal-capture .receipt-header {
      display: grid;
      gap: 4px;
      text-align: center;
      justify-items: center;
    }

    .lk-order-thermal-capture .receipt-logo {
      display: block;
      width: 248px;
      max-width: 248px;
      height: auto;
      margin: 0 auto 6px;
      object-fit: contain;
    }

    .lk-order-thermal-capture .receipt-header span {
      font-size: 14px;
      font-weight: 700;
      line-height: 1.25;
    }

    .lk-order-thermal-capture .receipt-divider {
      margin: 7px 0;
      border-top: 2px dashed #000;
    }

    .lk-order-thermal-capture .receipt-info,
    .lk-order-thermal-capture .receipt-totals {
      display: grid;
      gap: 5px;
      font-size: 14px;
    }

    .lk-order-thermal-capture .receipt-info b,
    .lk-order-thermal-capture .receipt-totals strong {
      font-weight: 700;
    }

    .lk-order-thermal-capture .receipt-items-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 14px;
      font-weight: 700;
    }

    .lk-order-thermal-capture .receipt-items-table th,
    .lk-order-thermal-capture .receipt-items-table td {
      padding: 4px 1px;
      border-bottom: 1px solid #000;
      text-align: center;
      vertical-align: middle;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      line-height: 1.2;
    }

    .lk-order-thermal-capture .receipt-items-table th {
      font-size: 14px;
      font-weight: 700;
    }

    .lk-order-thermal-capture .receipt-items-table th:nth-child(1),
    .lk-order-thermal-capture .receipt-items-table td:nth-child(1) {
      width: 7%;
    }

    .lk-order-thermal-capture .receipt-items-table th:nth-child(2),
    .lk-order-thermal-capture .receipt-items-table td:nth-child(2) {
      width: 31%;
    }

    .lk-order-thermal-capture .receipt-items-table th:nth-child(3),
    .lk-order-thermal-capture .receipt-items-table td:nth-child(3) {
      width: 23%;
      font-size: 13px;
    }

    .lk-order-thermal-capture .receipt-items-table th:nth-child(4),
    .lk-order-thermal-capture .receipt-items-table td:nth-child(4) {
      width: 14%;
    }

    .lk-order-thermal-capture .receipt-items-table th:nth-child(5),
    .lk-order-thermal-capture .receipt-items-table td:nth-child(5) {
      width: 25%;
      font-size: 13.5px;
    }

    .lk-order-thermal-capture .receipt-totals > div {
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }

    .lk-order-thermal-capture .receipt-total {
      margin: 4px 0;
      padding: 6px 0;
      border-top: 2px solid #000;
      border-bottom: 2px solid #000;
      font-size: 18px;
      font-weight: 700;
    }

    .lk-order-thermal-capture .receipt-total strong {
      font-size: 19px;
    }

    .lk-order-thermal-capture .receipt-invoice-barcode {
      display: grid;
      justify-items: center;
      margin-top: 9px;
    }

    .lk-order-thermal-capture .receipt-invoice-barcode img {
      display: block;
      width: 200px;
      height: 200px;
      image-rendering: pixelated;
    }

    .lk-order-thermal-capture .receipt-footer {
      display: grid;
      gap: 4px;
      margin-top: 10px;
      padding-top: 9px;
      border-top: 2px dashed #000;
      text-align: center;
      font-size: 13px;
      line-height: 1.35;
    }

    .lk-order-thermal-capture .receipt-footer strong {
      font-size: 15px;
      font-weight: 700;
    }

    .lk-order-thermal-capture .receipt-exchange-reminder {
      font-size: 13px;
      font-weight: 700;
    }

    .lk-order-thermal-capture .receipt-social-qrs {
      display: flex;
      width: 100%;
      align-items: flex-start;
      justify-content: center;
      gap: 14px;
      margin: 8px auto 0;
      direction: ltr;
    }

    .lk-order-thermal-capture .receipt-social-qr-item {
      width: 112px;
      max-width: 31%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      gap: 3px;
    }

    .lk-order-thermal-capture .receipt-social-qr-item img {
      display: block;
      width: 100%;
      max-width: 112px;
      height: auto;
      background: #fff;
      image-rendering: pixelated;
    }

    .lk-order-thermal-capture .receipt-social-qr-item span {
      display: block;
      direction: rtl;
      text-align: center;
      font-size: 14px;
      line-height: 1.3;
      font-weight: 800;
      white-space: nowrap;
    }
  `;

  captureHost.innerHTML = `
    <section class="receipt-print-area" dir="rtl">
      <header class="receipt-header">
        <img
          class="receipt-logo"
          src="/lovely-kids-receipt-logo.png"
          alt="Lovely Kids"
        />
        <span>لملابس الأطفال وتجهيز المواليد</span>
        <span>نابلس - المركز التجاري - شارع عمر المختار</span>
        <span dir="ltr">09-2376808</span>
      </header>

      <div class="receipt-divider"></div>

      <div class="receipt-info">
        <span>رقم الطلب: <b dir="ltr">#${escapeHtml(order.id)}</b></span>
        <span>التاريخ والوقت: ${escapeHtml(formatDateTime(order.createdAt))}</span>
        <span>الزبون: ${escapeHtml(order.customerName || "زبون")}</span>
        <span>الهاتف: <b dir="ltr">${escapeHtml(order.customerPhone)}</b></span>
        ${
          order.customerAddress
            ? `<span>العنوان: ${escapeHtml(order.customerAddress)}</span>`
            : ""
        }
        ${
          order.shippingZone
            ? `<span>طريقة الاستلام: ${escapeHtml(order.shippingZone)}</span>`
            : ""
        }
        <span>طريقة الدفع: ${escapeHtml(
          paymentMethodLabel(order.paymentMethod),
        )}</span>
        <span>حالة الدفع: ${escapeHtml(
          paymentStatusLabel(order.paymentStatus),
        )}</span>
      </div>

      <div class="receipt-divider"></div>

      <table class="receipt-items-table">
        <thead>
          <tr>
            <th>#</th>
            <th>الصنف</th>
            <th>التفاصيل</th>
            <th>الكمية</th>
            <th>السعر</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
        </tbody>
      </table>

      <div class="receipt-divider"></div>

      <div class="receipt-totals">
        <div>
          <span>مجموع الأصناف</span>
          <strong>${money(productsSubtotal)}</strong>
        </div>

        ${
          shippingCost > 0
            ? `
              <div>
                <span>التوصيل</span>
                <strong>${money(shippingCost)}</strong>
              </div>
            `
            : ""
        }

        <div class="receipt-total">
          <span>الإجمالي النهائي</span>
          <strong>${money(order.totalPrice)}</strong>
        </div>
      </div>

      ${
        order.notes
          ? `
            <div class="receipt-divider"></div>
            <div class="receipt-info">
              <span>ملاحظات: ${escapeHtml(order.notes)}</span>
            </div>
          `
          : ""
      }

      <div class="receipt-invoice-barcode">
        <img
          src="${invoiceQr}"
          alt="QR الطلب ${escapeHtml(order.id)}"
        />
      </div>

      <footer class="receipt-footer">
        <strong>شكرًا لتسوقكم من Lovely Kids</strong>
        <b class="receipt-exchange-reminder">
          يرجى الاحتفاظ بالفاتورة لإتمام عملية التبديل.
        </b>
        <span>الاستبدال بالبضاعة السليمة حسب سياسة المتجر</span>
      </footer>

      <div class="receipt-social-qrs">
        <div class="receipt-social-qr-item">
          <img src="${facebookQr}" alt="Facebook" />
          <span>فيسبوك</span>
        </div>

        <div class="receipt-social-qr-item">
          <img src="${whatsappQr}" alt="WhatsApp" />
          <span>واتساب</span>
        </div>

        <div class="receipt-social-qr-item">
          <img src="${storeQr}" alt="Lovely Kids" />
          <span>المتجر الإلكتروني</span>
        </div>
      </div>
    </section>
  `;

  document.head.appendChild(style);
  document.body.appendChild(captureHost);

  const receipt = captureHost.querySelector(
    ".receipt-print-area",
  ) as HTMLElement | null;

  if (!receipt) {
    captureHost.remove();
    style.remove();
    throw new Error("تعذر تجهيز فاتورة الإيصال");
  }

  try {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }

    await waitForImages(receipt);

    await new Promise<void>((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => resolve()),
      ),
    );

    const canvas = await html2canvas(receipt, {
      backgroundColor: "#ffffff",
      scale: 1,
      width: RECEIPT_WIDTH_DOTS,
      windowWidth: RECEIPT_WIDTH_DOTS,
      useCORS: true,
      logging: false,
    });

    const context = canvas.getContext("2d", {
      willReadFrequently: true,
    });

    if (context) {
      const image = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      );

      const data = image.data;

      for (let index = 0; index < data.length; index += 4) {
        const luminance =
          data[index] * 0.299 +
          data[index + 1] * 0.587 +
          data[index + 2] * 0.114;

        const value = luminance < 150 ? 0 : 255;

        data[index] = value;
        data[index + 1] = value;
        data[index + 2] = value;
        data[index + 3] = 255;
      }

      context.putImageData(image, 0, 0);
    }

    const png = await canvasToPngBlob(canvas);

    const response = await fetch(
      `${PRINT_BRIDGE_BASE}/print-receipt-png?width=${RECEIPT_WIDTH_DOTS}&copies=1`,
      {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
        },
        body: png,
      },
    );

    if (!response.ok) {
      const message = await response.text().catch(() => "");

      throw new Error(
        message || "تعذر إرسال فاتورة الطلب إلى الطابعة",
      );
    }
  } finally {
    captureHost.remove();
    style.remove();
  }
}
