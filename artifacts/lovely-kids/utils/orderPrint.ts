import * as QRCode from "qrcode";

export interface PrintableOrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  size?: string;
  color?: string;
}

export interface PrintableOrder {
  id: number;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  items: PrintableOrderItem[];
  totalPrice: number;
  shippingZone?: string;
  shippingCost?: number;
  notes?: string;
  paymentMethod: string;
  paymentStatus: string;
  createdAt: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeImageUrl(value?: string): string {
  const url = String(value ?? "").trim();

  return /^https?:\/\//i.test(url)
    ? escapeHtml(url)
    : "";
}

function orderUrl(id: number): string {
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://lovelykids.net";

  return `${origin}/admin/orders?orderId=${id}`;
}

export async function createOrderPrintHtml(
  order: PrintableOrder,
): Promise<string> {
  const qrLink = orderUrl(order.id);

  const qrSvg = await QRCode.toString(qrLink, {
    type: "svg",
    width: 180,
    margin: 1,
    errorCorrectionLevel: "M",
  });

  const items = order.items
    .map((item) => {
      const details = [
        item.color ? `اللون: ${escapeHtml(item.color)}` : "",
        item.size ? `المقاس: ${escapeHtml(item.size)}` : "",
      ]
        .filter(Boolean)
        .join(" — ");

      const imageUrl = safeImageUrl(item.image);

      return `
        <tr>
          <td class="image-cell">
            ${
              imageUrl
                ? `<img class="product-image" src="${imageUrl}" alt="" />`
                : `<div class="no-image">—</div>`
            }
          </td>
          <td>
            <strong>${escapeHtml(item.name)}</strong>
            ${details ? `<div class="muted">${details}</div>` : ""}
          </td>
          <td>${item.quantity}</td>
          <td>${item.price} ₪</td>
          <td>${item.price * item.quantity} ₪</td>
        </tr>
      `;
    })
    .join("");

  const createdAt = new Date(order.createdAt).toLocaleString("ar-EG");

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>طلب #${order.id} - Lovely Kids</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body {
    font-family: Arial, sans-serif;
    direction: rtl;
    color: #222;
    margin: 0;
    background: #fff;
  }
  .page { max-width: 760px; margin: 0 auto; }
  .header {
    text-align: center;
    border-bottom: 3px solid #E91E8C;
    padding-bottom: 14px;
    margin-bottom: 18px;
  }
  .brand { font-size: 26px; font-weight: 800; color: #E91E8C; }
  .order-number { font-size: 20px; font-weight: 800; margin-top: 7px; }
  .date { color: #666; font-size: 13px; margin-top: 5px; }
  .box {
    border: 1px solid #ddd;
    border-radius: 10px;
    padding: 12px;
    margin-bottom: 14px;
  }
  .box-title { font-weight: 800; margin-bottom: 8px; }
  .row { margin: 5px 0; line-height: 1.6; }
  .image-cell {
    width: 68px;
    text-align: center;
  }
  .product-image {
    width: 58px;
    height: 58px;
    object-fit: cover;
    border-radius: 8px;
    border: 1px solid #ddd;
    display: block;
    margin: auto;
  }
  .no-image {
    width: 58px;
    height: 58px;
    border-radius: 8px;
    background: #f5f5f5;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: auto;
    color: #aaa;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 8px;
  }
  th, td {
    border-bottom: 1px solid #ddd;
    padding: 9px 6px;
    text-align: right;
    vertical-align: top;
  }
  th { background: #f8f8f8; }
  .muted { color: #666; font-size: 12px; margin-top: 3px; }
  .totals { margin-top: 14px; font-size: 15px; }
  .total {
    font-size: 20px;
    font-weight: 800;
    color: #E91E8C;
    border-top: 2px solid #ddd;
    padding-top: 10px;
    margin-top: 10px;
  }
  .qr { text-align: center; margin-top: 20px; }
  .qr svg { width: 155px; height: 155px; }
  .qr-title { font-weight: 800; margin-top: 5px; }
  .qr-sub { color: #666; font-size: 11px; margin-top: 4px; }
  .footer {
    text-align: center;
    margin-top: 18px;
    padding-top: 12px;
    border-top: 1px dashed #ccc;
    color: #666;
    font-size: 12px;
  }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="brand">Lovely Kids</div>
    <div class="order-number">طلب رقم #${order.id}</div>
    <div class="date">${escapeHtml(createdAt)}</div>
  </div>

  <div class="box">
    <div class="box-title">بيانات الزبون</div>
    <div class="row"><strong>الاسم:</strong> ${escapeHtml(order.customerName)}</div>
    <div class="row"><strong>الهاتف:</strong> ${escapeHtml(order.customerPhone)}</div>
    <div class="row"><strong>العنوان:</strong> ${escapeHtml(order.customerAddress)}</div>
    ${
      order.shippingZone
        ? `<div class="row"><strong>منطقة التوصيل:</strong> ${escapeHtml(order.shippingZone)}</div>`
        : ""
    }
    ${
      order.notes
        ? `<div class="row"><strong>ملاحظات:</strong> ${escapeHtml(order.notes)}</div>`
        : ""
    }
  </div>

  <div class="box">
    <div class="box-title">المنتجات</div>
    <table>
      <thead>
        <tr>
          <th>الصورة</th>
          <th>المنتج</th>
          <th>الكمية</th>
          <th>السعر</th>
          <th>المجموع</th>
        </tr>
      </thead>
      <tbody>${items}</tbody>
    </table>

    <div class="totals">
      ${
        order.shippingCost != null
          ? `<div class="row"><strong>التوصيل:</strong> ${order.shippingCost} ₪</div>`
          : ""
      }
      <div class="total">الإجمالي: ${order.totalPrice} ₪</div>
    </div>
  </div>

  <div class="box">
    <div class="row"><strong>طريقة الدفع:</strong> ${
      order.paymentMethod === "bank_transfer"
        ? "تحويل بنكي"
        : "الدفع عند الاستلام"
    }</div>
  </div>

  <div class="qr">
    ${qrSvg}
    <div class="qr-title">طلب #${order.id}</div>
    <div class="qr-sub">امسح QR من لوحة الطلبات لفتح هذا الطلب مباشرة</div>
  </div>

  <div class="footer">Lovely Kids — كل ما يحتاجه طفلك في مكان واحد</div>
</div>
</body>
</html>`;
}
