export type MetaPixelEvent =
  | "ViewContent"
  | "AddToCart"
  | "InitiateCheckout"
  | "Purchase";

export type MetaPixelParams = Record<string, unknown>;

export function trackMetaEvent(
  event: MetaPixelEvent,
  params: MetaPixelParams = {},
): void {
  const root = globalThis as typeof globalThis & {
    fbq?: (...args: unknown[]) => void;
  };

  if (typeof root.fbq !== "function") return;

  root.fbq("track", event, params);
}
