import { useMemo } from "react";

import { useAppSettings } from "@/context/AppSettingsContext";
import { useProducts } from "@/context/ProductsContext";

export function useVisibleProducts() {
  const { products, ...rest } = useProducts();
  const { settings } = useAppSettings();
  const hidden = settings.hiddenCategories ?? [];

  const visibleProducts = useMemo(() => {
    const filtered =
      hidden.length > 0
        ? products.filter((p) => !hidden.includes(p.category))
        : products;

    const activeSeason = settings.activeSeason;

    return [...filtered].sort((a, b) => {
      const rank = (product: typeof a) => {
        if (product.isPinned) return 0;
        if (activeSeason && product.season === activeSeason) return 1;
        return 2;
      };

      return rank(a) - rank(b);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, JSON.stringify(hidden), settings.activeSeason]);

  return { ...rest, products: visibleProducts };
}
