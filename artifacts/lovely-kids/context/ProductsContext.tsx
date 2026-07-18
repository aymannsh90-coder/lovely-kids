import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { AppState } from "react-native";

import { Product } from "@/data/products";

import { API_BASE } from "@/constants/api";
import { useAuth } from "@/context/AuthContext";

const POLL_INTERVAL_MS = 300000;

interface ProductsContextType {
  products: Product[];
  loading: boolean;
  addProduct: (product: Omit<Product, "id">) => Promise<void>;
  updateProduct: (product: Product) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
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
  refreshProducts: async () => {},
  adjustStock: async () => ({} as Product),
  adjustVariantStock: async () => ({} as Product),
});

function toInsertBody(product: Omit<Product, "id">) {
  return {
    name: product.name,
    nameAr: product.nameAr,
    price: product.price,
    originalPrice: product.originalPrice ?? null,
    image: product.image,
    images: product.images ?? [],
    category: product.category,
    ageGroup: product.ageGroup,
    gender: product.gender ?? null,
    sizes: product.sizes ?? [],
    colorVariants: product.colorVariants ?? [],
    rating: Math.round((product.rating ?? 4.8) * 10),
    reviews: product.reviews ?? 0,
    isNew: product.isNew ?? false,
    discount: product.discount ?? null,
    description: product.description ?? "",
    stock: product.stock !== undefined ? product.stock : null,
  };
}

export function ProductsProvider({ children }: { children: React.ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const { getAuthToken } = useAuth();
  const getAdminHeaders = useCallback(async () => {
    const token = await getAuthToken();
    if (!token) throw new Error("يجب تسجيل الدخول كمشرف");
    return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  }, [getAuthToken]);

  const refreshProducts = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/products`);
      if (!res.ok) throw new Error("فشل تحميل المنتجات");
      const data: Product[] = await res.json();
      setProducts(data);
    } catch (e) {
      console.warn("ProductsContext: failed to load products", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProducts();
  }, [refreshProducts]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (AppState.currentState === "active") {
        refreshProducts();
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refreshProducts]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        refreshProducts();
      }
    });
    return () => subscription.remove();
  }, [refreshProducts]);

  const addProduct = useCallback(async (product: Omit<Product, "id">) => {
    const headers = await getAdminHeaders();
    const res = await fetch(`${API_BASE}/api/products`, {
      method: "POST",
      headers,
      body: JSON.stringify(toInsertBody(product)),
    });
    if (!res.ok) throw new Error("فشل إضافة المنتج");
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
    if (!res.ok) throw new Error("فشل تعديل المنتج");
    const updated: Product = await res.json();
    setProducts((prev) => prev.map((p) => (p.id === product.id ? updated : p)));
  }, [getAdminHeaders]);

  const deleteProduct = useCallback(async (id: string) => {
    const headers = await getAdminHeaders();
    const res = await fetch(`${API_BASE}/api/products/${id}`, { method: "DELETE", headers });
    if (!res.ok) throw new Error("فشل حذف المنتج");
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
      value={{ products, loading, addProduct, updateProduct, deleteProduct, refreshProducts, adjustStock, adjustVariantStock }}
    >
      {children}
    </ProductsContext.Provider>
  );
}

export function useProducts() {
  return useContext(ProductsContext);
}
