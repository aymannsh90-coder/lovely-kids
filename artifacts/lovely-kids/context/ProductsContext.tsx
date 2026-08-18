import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";

import { Product } from "@/data/products";

import { API_BASE } from "@/constants/api";
import { useAuth } from "@/context/AuthContext";

const PUBLIC_PRODUCTS_CACHE_KEY = "lovely_kids_public_products_v1";
const PUBLIC_PRODUCTS_CACHE_TS_KEY = "lovely_kids_public_products_ts_v1";
const PUBLIC_PRODUCTS_STALE_MS = 5 * 60 * 1000;

interface ProductsContextType {
  products: Product[];
  loading: boolean;
  addProduct: (product: Omit<Product, "id">) => Promise<void>;
  updateProduct: (product: Product) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  setProductHidden: (id: string, hidden: boolean) => Promise<Product>;
  restoreProduct: (id: string) => Promise<Product>;
  permanentlyDeleteProduct: (id: string) => Promise<void>;
  refreshProducts: () => Promise<void>;
  adjustStock: (id: string, action: "set" | "add" | "subtract", amount: number) => Promise<Product>;
  adjustVariantStock: (
    id: string,
    color: string,
    size: string,
    action: "set" | "add" | "subtract",
    amount: number
  ) => Promise<Product>;
}

const ProductsContext = createContext<ProductsContextType>({
  products: [],
  loading: true,
  addProduct: async () => {},
  updateProduct: async () => {},
  deleteProduct: async () => {},
  setProductHidden: async () => ({} as Product),
  restoreProduct: async () => ({} as Product),
  permanentlyDeleteProduct: async () => {},
  refreshProducts: async () => {},
  adjustStock: async () => ({} as Product),
  adjustVariantStock: async () => ({} as Product),
});

function toInsertBody(product: Omit<Product, "id">) {
  return {
    name: product.name,
    nameAr: product.nameAr,
    productCode: product.productCode?.trim() || null,
    barcode: product.barcode?.trim() || null,
    additionalBarcodes: (product.additionalBarcodes ?? []).map((item) => ({
      barcode: item.barcode.trim(),
      color: item.color?.trim() || null,
      size: item.size?.trim() || null,
    })),
    price: product.price,
    originalPrice: product.originalPrice ?? null,
    image: product.image,
    images: product.images ?? [],
    category: product.category,
    ageGroup: product.ageGroup,
    gender: product.gender ?? null,
    season: product.season ?? null,
    sizes: product.sizes ?? [],
    colorVariants: product.colorVariants ?? [],
    rating: Math.round((product.rating ?? 4.8) * 10),
    reviews: product.reviews ?? 0,
    isPinned: product.isPinned ?? false,
    showInOffers: product.showInOffers ?? false,
    facebookUrl: product.facebookUrl?.trim() || null,
    instagramUrl: product.instagramUrl?.trim() || null,
    tiktokUrl: product.tiktokUrl?.trim() || null,
    isNew: product.isNew ?? false,
    newUntil: product.newUntil ?? null,
    discount: product.discount ?? null,
    description: product.description ?? "",
    stock: product.stock !== undefined ? product.stock : null,
  };
}

export function ProductsProvider({ children }: { children: React.ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const { getAuthToken, user } = useAuth();
  const lastSuccessfulFetchAtRef = useRef(0);
  const getAdminHeaders = useCallback(async () => {
    const token = await getAuthToken();
    if (!token) throw new Error("يجب تسجيل الدخول كمشرف");
    return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  }, [getAuthToken]);

  const refreshProducts = useCallback(async () => {
    try {
      const adminHeaders = user?.isAdmin
        ? await getAdminHeaders()
        : undefined;

      const res = await fetch(
        user?.isAdmin
          ? `${API_BASE}/api/products/admin`
          : `${API_BASE}/api/products`,
        adminHeaders ? { headers: adminHeaders } : undefined,
      );

      if (!res.ok) throw new Error("فشل تحميل المنتجات");

      let data: Product[] = await res.json();

      if (user?.isAdmin) {
        try {
          const headers = adminHeaders!;
          const barcodeRes = await fetch(
            `${API_BASE}/api/products/barcodes`,
            { headers },
          );

          if (!barcodeRes.ok) {
            throw new Error("فشل تحميل الباركودات الإضافية");
          }

          const barcodeRows: Array<{
            productId: string;
            barcode: string;
            color: string | null;
            size: string | null;
          }> = await barcodeRes.json();

          const barcodesByProduct = new Map<
            string,
            Array<{
              barcode: string;
              color: string | null;
              size: string | null;
            }>
          >();

          for (const row of barcodeRows) {
            const items = barcodesByProduct.get(row.productId) ?? [];
            items.push({
              barcode: row.barcode,
              color: row.color,
              size: row.size,
            });
            barcodesByProduct.set(row.productId, items);
          }

          data = data.map((product) => ({
            ...product,
            additionalBarcodes:
              barcodesByProduct.get(product.id) ?? [],
          }));
        } catch (error) {
          console.warn(
            "ProductsContext: failed to load additional barcodes",
            error,
          );
        }
      }

      setProducts(data);

      const now = Date.now();
      lastSuccessfulFetchAtRef.current = now;

      if (!user?.isAdmin) {
        void AsyncStorage.multiSet([
          [PUBLIC_PRODUCTS_CACHE_KEY, JSON.stringify(data)],
          [PUBLIC_PRODUCTS_CACHE_TS_KEY, String(now)],
        ]);
      }
    } catch (e) {
      console.warn("ProductsContext: failed to load products", e);
    } finally {
      setLoading(false);
    }
  }, [getAdminHeaders, user?.isAdmin]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!user?.isAdmin) {
        try {
          const values = await AsyncStorage.multiGet([
            PUBLIC_PRODUCTS_CACHE_KEY,
            PUBLIC_PRODUCTS_CACHE_TS_KEY,
          ]);

          const cached = values[0]?.[1];
          const cachedAt = Number(values[1]?.[1] ?? 0);

          if (cached) {
            const parsed = JSON.parse(cached) as Product[];

            if (!cancelled && Array.isArray(parsed)) {
              setProducts(parsed);
              setLoading(false);
            }

            lastSuccessfulFetchAtRef.current = cachedAt;

            if (
              cachedAt > 0 &&
              Date.now() - cachedAt < PUBLIC_PRODUCTS_STALE_MS
            ) {
              return;
            }
          }
        } catch {
          // Ignore local cache failures and use the network.
        }
      }

      if (!cancelled) {
        await refreshProducts();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshProducts, user?.isAdmin]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;

      const stale =
        Date.now() - lastSuccessfulFetchAtRef.current >=
        PUBLIC_PRODUCTS_STALE_MS;

      if (user?.isAdmin || stale) {
        void refreshProducts();
      }
    });

    return () => subscription.remove();
  }, [refreshProducts, user?.isAdmin]);

  const addProduct = useCallback(async (product: Omit<Product, "id">) => {
    const headers = await getAdminHeaders();
    const res = await fetch(`${API_BASE}/api/products`, {
      method: "POST",
      headers,
      body: JSON.stringify(toInsertBody(product)),
    });
    if (!res.ok) {
      let message = "فشل إضافة المنتج";
      try {
        const data = (await res.json()) as { error?: string };
        if (data.error) message = data.error;
      } catch {}
      throw new Error(message);
    }
    const created: Product = await res.json();
    setProducts((prev) => [created, ...prev]);
  }, [getAdminHeaders]);

  const updateProduct = useCallback(async (product: Product) => {
    const headers = await getAdminHeaders();
    const res = await fetch(`${API_BASE}/api/products/${product.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(toInsertBody(product)),
    });
    if (!res.ok) {
      let message = "فشل تعديل المنتج";
      try {
        const data = (await res.json()) as { error?: string };
        if (data.error) message = data.error;
      } catch {}
      throw new Error(message);
    }
    const updated: Product = await res.json();
    setProducts((prev) => prev.map((p) => (p.id === product.id ? updated : p)));
  }, [getAdminHeaders]);

  const deleteProduct = useCallback(async (id: string) => {
    const headers = await getAdminHeaders();
    const res = await fetch(`${API_BASE}/api/products/${id}`, {
      method: "DELETE",
      headers,
    });
    if (!res.ok) throw new Error("فشل نقل المنتج إلى سلة المحذوفات");
    const updated: Product = await res.json();
    setProducts((prev) => prev.map((p) => (p.id === id ? updated : p)));
  }, [getAdminHeaders]);

  const setProductHidden = useCallback(async (id: string, hidden: boolean) => {
    const headers = await getAdminHeaders();
    const res = await fetch(`${API_BASE}/api/products/${id}/visibility`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ hidden }),
    });
    if (!res.ok) throw new Error("فشل تغيير حالة ظهور المنتج");
    const updated: Product = await res.json();
    setProducts((prev) => prev.map((p) => (p.id === id ? updated : p)));
    return updated;
  }, [getAdminHeaders]);

  const restoreProduct = useCallback(async (id: string) => {
    const headers = await getAdminHeaders();
    const res = await fetch(`${API_BASE}/api/products/${id}/restore`, {
      method: "PATCH",
      headers,
    });
    if (!res.ok) throw new Error("فشل استرجاع المنتج");
    const updated: Product = await res.json();
    setProducts((prev) => prev.map((p) => (p.id === id ? updated : p)));
    return updated;
  }, [getAdminHeaders]);

  const permanentlyDeleteProduct = useCallback(async (id: string) => {
    const headers = await getAdminHeaders();
    const res = await fetch(`${API_BASE}/api/products/${id}/permanent`, {
      method: "DELETE",
      headers,
    });
    if (!res.ok) throw new Error("فشل الحذف النهائي");
    setProducts((prev) => prev.filter((p) => p.id !== id));
  }, [getAdminHeaders]);

  const adjustStock = useCallback(async (id: string, action: "set" | "add" | "subtract", amount: number): Promise<Product> => {
    const headers = await getAdminHeaders();
    const res = await fetch(`${API_BASE}/api/products/${id}/stock`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ action, amount }),
    });
    if (!res.ok) throw new Error("فشل تعديل الكمية");
    const updated: Product = await res.json();
    setProducts((prev) => prev.map((p) => (p.id === id ? updated : p)));
    return updated;
  }, [getAdminHeaders]);

  const adjustVariantStock = useCallback(async (
    id: string,
    color: string,
    size: string,
    action: "set" | "add" | "subtract",
    amount: number
  ): Promise<Product> => {
    const headers = await getAdminHeaders();
    const res = await fetch(`${API_BASE}/api/products/${id}/variant-stock`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ color, size, action, amount }),
    });
    if (!res.ok) throw new Error("فشل تعديل كمية المقاس");
    const updated: Product = await res.json();
    setProducts((prev) => prev.map((p) => (p.id === id ? updated : p)));
    return updated;
  }, [getAdminHeaders]);

  return (
    <ProductsContext.Provider
      value={{
        products,
        loading,
        addProduct,
        updateProduct,
        deleteProduct,
        setProductHidden,
        restoreProduct,
        permanentlyDeleteProduct,
        refreshProducts,
        adjustStock,
        adjustVariantStock,
      }}
    >
      {children}
    </ProductsContext.Provider>
  );
}

export function useProducts() {
  return useContext(ProductsContext);
}
