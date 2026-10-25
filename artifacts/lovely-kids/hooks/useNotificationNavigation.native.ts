import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect } from "react";

function notificationUrl(
  data: Record<string, unknown> | undefined,
): string | null {
  if (!data) return null;

  if (
    typeof data.url === "string" &&
    data.url.startsWith("/")
  ) {
    return data.url;
  }

  const type =
    typeof data.type === "string"
      ? data.type
      : "";

  const orderId =
    typeof data.orderId === "string"
      ? data.orderId
      : "";

  const productId =
    typeof data.productId === "string"
      ? data.productId
      : "";

  if (type === "new_order" && orderId) {
    return `/admin/orders?orderId=${encodeURIComponent(orderId)}`;
  }

  if (
    type === "back_in_stock" &&
    productId
  ) {
    return `/product/${encodeURIComponent(productId)}`;
  }

  if (type === "order_status") {
    return "/my-orders";
  }

  if (type === "admin_notification") {
    return "/";
  }

  return null;
}

function openNotificationResponse(
  response:
    | Notifications.NotificationResponse
    | null
    | undefined,
) {
  const data =
    response?.notification.request.content
      .data as
      | Record<string, unknown>
      | undefined;

  const url =
    notificationUrl(data);

  if (url) {
    router.push(url as never);
  }
}

export function useNotificationNavigation() {
  useEffect(() => {
    let active = true;

    void Notifications
      .getLastNotificationResponseAsync()
      .then((response) => {
        if (active) {
          openNotificationResponse(
            response,
          );
        }
      })
      .catch(() => {});

    const subscription =
      Notifications
        .addNotificationResponseReceivedListener(
          (response) => {
            openNotificationResponse(
              response,
            );
          },
        );

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
}
