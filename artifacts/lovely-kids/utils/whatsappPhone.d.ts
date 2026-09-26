export type WhatsappCountryCode = "970" | "972";

export function normalizeWhatsappLocalNumber(
  phone: string
): string;

export function buildCustomerWhatsappUrl(
  phone: string,
  countryCode: WhatsappCountryCode,
  orderId: number
): string;
