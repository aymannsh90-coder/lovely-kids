import { Platform } from "react-native";

export const WEB_TABLET_MIN_WIDTH = 768;
export const WEB_DESKTOP_MIN_WIDTH = 1200;

export type WebViewport = "phone" | "tablet" | "desktop";

export function getWebViewport(width: number): WebViewport {
  if (width >= WEB_DESKTOP_MIN_WIDTH) return "desktop";
  if (width >= WEB_TABLET_MIN_WIDTH) return "tablet";
  return "phone";
}

export function getResponsiveTopPadding(nativeInset: number): number {
  if (Platform.OS !== "web") {
    return nativeInset;
  }

  if (typeof window === "undefined") {
    return 67;
  }

  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)").matches === true;

  const isMobileViewport =
    window.innerWidth < WEB_TABLET_MIN_WIDTH;

  return isStandalone || isMobileViewport ? 24 : 67;
}
