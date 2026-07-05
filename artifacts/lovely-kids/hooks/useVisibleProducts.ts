import { useMemo } from "react";

import { useAppSettings } from "@/context/AppSettingsContext";
import { useProducts } from "@/context/ProductsContext";

export function useVisibleProducts() {
  const { products, ...rest } = useProducts();
  const { settings } = useAppSettings();
  const hidden = settings.hiddenCategories ?? [];

  const visibleProducts = useMemo(
    () => (hidden.length > 0 ? products.filter((p) => !hidden.includes(p.category)) : products),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, JSON.stringify(hidden)]
  );

  return { ...rest, products: visibleProducts };
}
