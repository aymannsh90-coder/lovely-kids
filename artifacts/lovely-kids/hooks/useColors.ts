import { useColorScheme } from "react-native";

import { useAppSettings } from "@/context/AppSettingsContext";
import baseColors from "@/constants/colors";

export function useColors() {
  const scheme = useColorScheme();
  const base =
    scheme === "dark" && "dark" in baseColors
      ? (baseColors as Record<string, typeof baseColors.light>).dark
      : baseColors.light;

  const { settings } = useAppSettings();

  return {
    ...base,
    radius: baseColors.radius,
    primary: settings.primaryColor,
    background: settings.backgroundColor,
    secondary: settings.secondaryColor,
    accent: settings.accentColor,
    muted:
      settings.backgroundColor === "#FFFFFF"
        ? "#F5F5F5"
        : settings.backgroundColor,
  };
}
