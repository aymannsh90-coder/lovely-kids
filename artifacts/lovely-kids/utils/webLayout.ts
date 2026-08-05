import { Platform } from "react-native";

export function getResponsiveTopPadding(nativeInset: number): number {
  if (Platform.OS !== "web") {
    return nativeInset;
  }

  if (typeof window === "undefined") {
    return 67;
  }

  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)").matches === true;
  const isMobileViewport = window.innerWidth <= 768;

  return isStandalone || isMobileViewport ? 24 : 67;
}
