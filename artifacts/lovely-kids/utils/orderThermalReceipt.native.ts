export interface ThermalOrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  invoiceDiscountMinor?: number;
  size?: string;
  color?: string;
  productCode?: string | null;
}

export interface ThermalOrder {
  id: number;
  exchangeOriginalOrderId?: number | null;
  exchangePublicId?: string | null;
  exchangeReturnNetMinor?: number | null;
  exchangeNewNetMinor?: number | null;
  exchangeDifferenceMinor?: number | null;
  exchangeDeliveryChargeMinor?: number | null;
  exchangeSettlementAmountMinor?: number | null;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  items: ThermalOrderItem[];
  totalPrice: number;
  shippingZone?: string;
  shippingCost?: number;
  shippingOriginalCost?: number | null;
  shippingPromotionDiscount?: number | null;
  notes?: string;
  paymentMethod: string;
  paymentStatus: string;
  createdAt: string;
}

export async function printOrderThermalReceipt(): Promise<void> {
  throw new Error(
    "الطباعة الحرارية متاحة من كمبيوتر المحل المتصل بالطابعة",
  );
}
