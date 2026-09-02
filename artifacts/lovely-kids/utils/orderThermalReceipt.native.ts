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

export async function printOrderThermalReceipt(): Promise<void> {
  throw new Error(
    "الطباعة الحرارية متاحة من كمبيوتر المحل المتصل بالطابعة",
  );
}
