import * as QRCode from "qrcode";

export interface PrintableOrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  invoiceDiscountMinor?: number;
  image?: string;
  size?: string;
  color?: string;
}

export interface PrintableExchangeReturnItem {
  productNameAr: string;
  image?: string;
  productCode?: string | null;
  barcode?: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  returnNetMinor: number;
}

export interface PrintableOrder {
  id: number;
  exchangeOriginalOrderId?: number | null;
  exchangePublicId?: string | null;
  exchangeReturnNetMinor?: number | null;
  exchangeNewNetMinor?: number | null;
  exchangeDifferenceMinor?: number | null;
  exchangeDeliveryChargeMinor?: number | null;
  exchangeDeliveryBaseChargeMinor?: number | null;
  exchangeDeliveryDiscountMinor?: number | null;
  exchangeSettlementAmountMinor?: number | null;
  exchangeReturnItems?: PrintableExchangeReturnItem[];
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  items: PrintableOrderItem[];
  totalPrice: number;
  shippingZone?: string;
  shippingCost?: number;
  deliveryCompanyCost?: number | null;
  shippingOriginalCost?: number | null;
  shippingPromotionDiscount?: number | null;
  discountCode?: string | null;
  discountCodeLabel?: string | null;
  discountCodePercent?: number | null;
  discountCodeAmount?: number | null;
  discountCodeStacksWithShippingPromotion?: boolean | null;
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

function formatMinor(value: number): string {
  return `${(value / 100).toFixed(2)} ₪`;
}

export async function createOrderPrintHtml(
  order: PrintableOrder,
): Promise<string> {
  const qrLink = orderUrl(order.id);

  const qrSvg = await QRCode.toString(qrLink, {
    type: "svg",
    width: 120,
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


  const isOnlineExchange =
    Number.isSafeInteger(order.exchangeOriginalOrderId) &&
    Number(order.exchangeOriginalOrderId) > 0;

  if (isOnlineExchange) {
    const exchangeAmounts = [
      order.exchangeReturnNetMinor,
      order.exchangeNewNetMinor,
      order.exchangeDifferenceMinor,
      order.exchangeDeliveryChargeMinor,
      order.exchangeDeliveryBaseChargeMinor,
      order.exchangeDeliveryDiscountMinor,
      order.exchangeSettlementAmountMinor,
    ];

    if (exchangeAmounts.some((value) => !Number.isSafeInteger(value))) {
      throw new Error(
        "بيانات تبديل الطلب غير مكتملة. حدّث صفحة الطلبات قبل طباعة A4.",
      );
    }

    if (
      !Array.isArray(order.exchangeReturnItems) ||
      order.exchangeReturnItems.length === 0 ||
      order.exchangeReturnItems.some(
        (item) =>
          !item ||
          typeof item.productNameAr !== "string" ||
          !item.productNameAr.trim() ||
          !Number.isSafeInteger(item.quantity) ||
          item.quantity <= 0 ||
          !Number.isSafeInteger(item.returnNetMinor) ||
          item.returnNetMinor < 0,
      )
    ) {
      throw new Error("أصناف التبديل المرتجعة غير مكتملة، أعد تحميل الطلب قبل الطباعة.");
    }

    const returnedTotal = order.exchangeReturnItems.reduce(
      (sum, item) => sum + item.returnNetMinor,
      0,
    );

    if (returnedTotal !== order.exchangeReturnNetMinor) {
      throw new Error("قيمة الأصناف المرتجعة لا تطابق ملخص التبديل.");
    }

    const base = Number(order.exchangeDeliveryBaseChargeMinor);
    const discount = Number(order.exchangeDeliveryDiscountMinor);
    const charge = Number(order.exchangeDeliveryChargeMinor);

    if (base < 0 || discount < 0 || base < discount || base - discount !== charge) {
      throw new Error("معلومات توصيل التبديل وخصمه غير متطابقة.");
    }
  }

  // Print the historic return snapshot, not current stock or the original order.
  const returnedItemRows = isOnlineExchange
    ? (order.exchangeReturnItems ?? [])
        .map((item) => {
          const variants = [item.color, item.size]
            .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
            .map(escapeHtml)
            .join(" — ");
          const code = item.productCode?.trim() || item.barcode?.trim() || "—";
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
                <strong>${escapeHtml(item.productNameAr)}</strong>
                ${variants ? `<div class="muted">${variants}</div>` : ""}
              </td>
              <td>${escapeHtml(code)}</td>
              <td>${item.quantity}</td>
              <td>${formatMinor(item.returnNetMinor)}</td>
            </tr>
          `;
        })
        .join("")
    : "";

  const exchangeSettlementValue = Number(order.exchangeSettlementAmountMinor ?? 0);
  const exchangeSettlementLabel = exchangeSettlementValue > 0
    ? "المطلوب من الزبون"
    : exchangeSettlementValue < 0
      ? "مستحق للزبون"
      : "صافي التبديل";

  const exchangeTotalsHtml = isOnlineExchange
    ? `
        <div class="row"><strong>قيمة الأصناف الجديدة:</strong> ${formatMinor(Number(order.exchangeNewNetMinor))}</div>
        <div class="row"><strong>قيمة الأصناف المرتجعة:</strong> -${formatMinor(Number(order.exchangeReturnNetMinor))}</div>
        <div class="row"><strong>فرق البضاعة:</strong> ${formatMinor(Number(order.exchangeDifferenceMinor))}</div>
        <div class="row"><strong>التوصيل الأساسي:</strong> ${formatMinor(Number(order.exchangeDeliveryBaseChargeMinor))}</div>
        ${Number(order.exchangeDeliveryDiscountMinor) > 0
          ? `<div class="row"><strong>خصم التوصيل:</strong> -${formatMinor(Number(order.exchangeDeliveryDiscountMinor))}</div>`
          : ""}
        <div class="row"><strong>التوصيل بعد الخصم:</strong> ${formatMinor(Number(order.exchangeDeliveryChargeMinor))}</div>
        <div class="total">${exchangeSettlementLabel}: ${formatMinor(Math.abs(exchangeSettlementValue))}</div>
      `
    : "";

  const createdAt = new Date(order.createdAt).toLocaleString("ar-EG");

  const invoiceDiscount =
    order.items.reduce(
      (sum, item) =>
        sum + (Number.isSafeInteger(item.invoiceDiscountMinor)
          ? Number(item.invoiceDiscountMinor)
          : 0),
      0,
    ) / 100;

  const discountCodeAmount =
    Number.isSafeInteger(order.discountCodeAmount)
      ? Number(order.discountCodeAmount)
      : null;

  const hasDiscountCode =
    typeof order.discountCode === "string" &&
    order.discountCode.trim().length > 0 &&
    typeof order.discountCodeLabel === "string" &&
    order.discountCodeLabel.trim().length > 0 &&
    Number.isSafeInteger(order.discountCodePercent) &&
    discountCodeAmount !== null &&
    discountCodeAmount >= 0;

  const shippingCost =
    typeof order.shippingCost === "number"
      ? order.shippingCost
      : null;

  const shippingOriginalCost =
    Number.isSafeInteger(order.shippingOriginalCost)
      ? Number(order.shippingOriginalCost)
      : shippingCost ?? 0;

  const shippingPromotionDiscount =
    Number.isSafeInteger(order.shippingPromotionDiscount)
      ? Number(order.shippingPromotionDiscount)
      : 0;

  const isLocalNablusDelivery =
    order.shippingZone === "ديلفري داخل مدينة نابلس";
  const hasShippingPromotion =
    !isLocalNablusDelivery &&
    shippingCost !== null &&
    shippingPromotionDiscount > 0 &&
    shippingOriginalCost >= shippingPromotionDiscount &&
    shippingOriginalCost - shippingPromotionDiscount === shippingCost;

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>طلب #${order.id} - Lovely Kids</title>
<style>
  @page { size: A4 portrait; margin: 5mm; }
  * { box-sizing: border-box; }
  body {
    font-family: Arial, sans-serif;
    direction: rtl;
    color: #222;
    margin: 0;
    background: #fff;
    font-size: 12px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    width: 100%;
    max-width: none;
    margin: 0 auto;
  }
  .header {
    text-align: center;
    border-bottom: 2px solid #E91E8C;
    padding-bottom: 6px;
    margin-bottom: 7px;
  }
  .brand { font-size: 21px; font-weight: 800; color: #E91E8C; }
  .order-number { font-size: 16px; font-weight: 800; margin-top: 3px; }
  .date { color: #666; font-size: 10px; margin-top: 2px; }
  .box {
    border: 1px solid #ddd;
    border-radius: 7px;
    padding: 7px;
    margin-bottom: 7px;
  }
  .box-title { font-weight: 800; margin-bottom: 4px; }
  .row { margin: 2px 0; line-height: 1.35; }
  .image-cell {
    width: 50px;
    text-align: center;
  }
  .product-image {
    width: 42px;
    height: 42px;
    object-fit: cover;
    border-radius: 6px;
    border: 1px solid #ddd;
    display: block;
    margin: auto;
  }
  .no-image {
    width: 42px;
    height: 42px;
    border-radius: 6px;
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
    margin-top: 4px;
  }
  th, td {
    border-bottom: 1px solid #ddd;
    padding: 4px 4px;
    text-align: right;
    vertical-align: middle;
    line-height: 1.25;
  }
  th { background: #f8f8f8; }
  .muted { color: #666; font-size: 10px; margin-top: 1px; }
  .totals { margin-top: 5px; font-size: 12px; }
  .total {
    font-size: 16px;
    font-weight: 800;
    color: #E91E8C;
    border-top: 1px solid #ddd;
    padding-top: 4px;
    margin-top: 4px;
  }
  .qr { text-align: center; margin-top: 5px; }
  .qr svg { width: 92px; height: 92px; }
  .qr-title { font-weight: 800; margin-top: 2px; }
  .qr-sub { color: #666; font-size: 9px; margin-top: 1px; }
  .footer {
    text-align: center;
    margin-top: 5px;
    padding-top: 4px;
    border-top: 1px dashed #ccc;
    color: #666;
    font-size: 9px;
  }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="brand">Lovely Kids</div>
    <div class="order-number">طلب رقم #${order.id}</div>
    ${isOnlineExchange
      ? `<div class="box-title">طلب تبديل أونلاين</div>
         <div>بدل الطلب الأصلي #${escapeHtml(order.exchangeOriginalOrderId)}</div>
         ${order.exchangePublicId ? `<div>عملية التبديل: ${escapeHtml(order.exchangePublicId)}</div>` : ""}`
      : ""}
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

  ${isOnlineExchange
    ? `
      <div class="box">
        <div class="box-title">الأصناف المرتجعة من الطلب #${escapeHtml(order.exchangeOriginalOrderId)}</div>
        <table>
          <thead><tr><th>الصورة</th><th>الصنف المرتجع</th><th>الكود</th><th>الكمية</th><th>القيمة</th></tr></thead>
          <tbody>${returnedItemRows}</tbody>
        </table>
      </div>
    `
    : ""}

  <div class="box">
    <div class="box-title">${isOnlineExchange ? "الأصناف الجديدة بالطلب البديل" : "المنتجات"}</div>
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
      ${isOnlineExchange ? exchangeTotalsHtml : `
      ${ 
        hasDiscountCode
          ? `
            <div class="row"><strong>كود الخصم:</strong> ${escapeHtml(order.discountCode)} — ${escapeHtml(order.discountCodeLabel)} (${Number(order.discountCodePercent)}%)</div>
            <div class="row"><strong>خصم كود ${escapeHtml(order.discountCodeLabel)}:</strong> -${discountCodeAmount} ₪</div>
          `
          : invoiceDiscount > 0
            ? `<div class="row"><strong>الخصم العام:</strong> -${invoiceDiscount} ₪</div>`
            : ""
      }
      ${
        hasShippingPromotion
          ? `
            <div class="row"><strong>التوصيل الأصلي:</strong> ${shippingOriginalCost} ₪</div>
            <div class="row"><strong>خصم عرض التوصيل:</strong> -${shippingPromotionDiscount} ₪</div>
          `
          : isLocalNablusDelivery
            ? `
              <div class="row"><strong>توصيل ديلفري نابلس:</strong> ${shippingCost ?? 15} ₪</div>
              ${order.deliveryCompanyCost == null ? `<div class="row">أي زيادة تُؤكّد مع الزبون قبل الإرسال</div>` : ""}
            `
            : shippingCost !== null
              ? `<div class="row"><strong>التوصيل:</strong> ${shippingCost} ₪</div>`
              : ""
      }
      <div class="total">${isLocalNablusDelivery && order.deliveryCompanyCost == null ? "الإجمالي المبدئي" : "الإجمالي"}: ${order.totalPrice} ₪</div>
      `}
    </div>
  </div>

  <div class="box">
    <div class="row"><strong>طريقة الدفع:</strong> ${
      order.paymentMethod === "bank_transfer"
        ? "تحويل بنكي"
        : order.paymentMethod === "local_store_cash"
          ? "نقدًا للمحل - ديلفري نابلس"
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
