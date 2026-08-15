import { useMemo } from "react";

import { useAppSettings } from "@/context/AppSettingsContext";
import {
  CATEGORY_IDS,
  DEFAULT_CATEGORY_LABELS,
} from "@/data/products";

export function useProductCategories(offersOnly = false) {
  const { settings } = useAppSettings();

  return useMemo(() => {
    const categoryLabels =
      settings.categoryLabels ?? DEFAULT_CATEGORY_LABELS;
    const hiddenCategories =
      settings.hiddenCategories ?? [];
    const customCategories =
      settings.customCategories ?? [];
    const regularCategoryOrder =
      settings.categoryOrder ?? [];

    const savedOffersOrder =
      settings.offersCategoryOrder ?? [];

    // أول مرة فقط: العروض تحافظ على الترتيب الحالي.
    // بعد الحفظ يصبح لها ترتيب مستقل تماماً.
    const categoryOrder =
      offersOnly && savedOffersOrder.length > 0
        ? savedOffersOrder
        : regularCategoryOrder;

    const availableCategoryIds = [...CATEGORY_IDS, ...customCategories]
      .filter(
        (id, index, ids) =>
          id !== "all" &&
          ids.indexOf(id) === index,
      );

    const orderedCategoryIds = [
      ...categoryOrder.filter((id) =>
        availableCategoryIds.includes(id),
      ),
      ...availableCategoryIds.filter(
        (id) => !categoryOrder.includes(id),
      ),
    ];

    return ["all", ...orderedCategoryIds]
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
    settings.categoryOrder,
    settings.offersCategoryOrder,
    offersOnly,
  ]);
}
