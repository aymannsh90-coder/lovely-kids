import type { AppSettings } from "@/context/AppSettingsContext";

const DEFAULT_BASE_URL = "https://lovelykids.net";

export function getProductShareUrl(productId: string, settings: AppSettings): string {
  const base = (settings.productShareBaseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return `${base}/product/${productId}`;
}
