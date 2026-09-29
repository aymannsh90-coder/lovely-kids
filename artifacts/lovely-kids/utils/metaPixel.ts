export type MetaPixelEvent =
  | "ViewContent"
  | "AddToCart"
  | "InitiateCheckout"
  | "Purchase";

export type MetaPixelParams = Record<string, unknown>;

export type MetaPixelEventOptions = {
  eventId?: string;
};

export function trackMetaEvent(
  event: MetaPixelEvent,
  params: MetaPixelParams = {},
  options: MetaPixelEventOptions = {},
): void {
  const root = globalThis as typeof globalThis & {
    fbq?: (...args: unknown[]) => void;
  };

  if (typeof root.fbq !== "function") return;

  if (options.eventId) {
    root.fbq(
      "track",
      event,
      params,
      { eventID: options.eventId },
    );
    return;
  }

  root.fbq("track", event, params);
}
