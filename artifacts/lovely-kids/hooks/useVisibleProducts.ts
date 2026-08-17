import { useMemo } from "react";

import { useAppSettings } from "@/context/AppSettingsContext";
import { useProducts } from "@/context/ProductsContext";

export function useVisibleProducts() {
  const { products, ...rest } = useProducts();
  const { settings } = useAppSettings();
  const hidden = settings.hiddenCategories ?? [];

  const visibleProducts = useMemo(() => {
    const availableProducts = products.filter(
      (p) => !p.isHidden && !p.deletedAt
    );

    const filtered =
      hidden.length > 0
        ? availableProducts.filter((p) => !hidden.includes(p.category))
        : availableProducts;

    const activeSeason = settings.activeSeason;

    const orders = settings.productOrderByCategory ?? {};

    return [...filtered].sort((a, b) => {
      const manualIndex = (product: typeof a) =>
        product.category ? (orders[product.category] ?? []).indexOf(product.id) : -1;

      const rank = (product: typeof a) => {
        if (product.isPinned) return 0;
        if (manualIndex(product) >= 0) return 1;
        if (activeSeason && product.season === activeSeason) return 2;
        return 3;
      };

      const rankA = rank(a);
      const rankB = rank(b);
      if (rankA != rankB) return rankA - rankB;
      if (rankA === 1 && a.category === b.category) return manualIndex(a) - manualIndex(b);
      return 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, JSON.stringify(hidden), settings.activeSeason, JSON.stringify(settings.productOrderByCategory ?? {})]);

  return { ...rest, products: visibleProducts };
}
