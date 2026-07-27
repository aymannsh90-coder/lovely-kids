import { useMemo } from "react";

import { useAppSettings } from "@/context/AppSettingsContext";
import {
  CATEGORY_IDS,
  DEFAULT_CATEGORY_LABELS,
} from "@/data/products";

export function useProductCategories() {
  const { settings } = useAppSettings();

  return useMemo(() => {
    const categoryLabels =
      settings.categoryLabels ?? DEFAULT_CATEGORY_LABELS;
    const hiddenCategories =
      settings.hiddenCategories ?? [];
    const customCategories =
      settings.customCategories ?? [];

    return [...CATEGORY_IDS, ...customCategories]
      .filter(
        (id) =>
          id === "all" ||
          !hiddenCategories.includes(id),
      )
      .map((id) => ({
        id,
        label:
          categoryLabels[id] ??
          DEFAULT_CATEGORY_LABELS[id] ??
          id,
      }));
  }, [
    settings.categoryLabels,
    settings.hiddenCategories,
    settings.customCategories,
  ]);
}
