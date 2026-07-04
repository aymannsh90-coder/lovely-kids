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

const POLL_INTERVAL_MS = 20000;

interface ProductsContextType {
  products: Product[];
  loading: boolean;
  addProduct: (product: Omit<Product, "id">) => Promise<void>;
  updateProduct: (product: Product) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  refreshProducts: () => Promise<void>;
  adjustStock: (id: string, action: "set" | "add" | "subtract", amount: number) => Promise<Product>;
}

const ProductsContext = createContext<ProductsContextType>({
  products: [],
  loading: true,
  addProduct: async () => {},
  updateProduct: async () => {},
  deleteProduct: async () => {},
  refreshProducts: async () => {},
  adjustStock: async () => ({} as Product),
});

function toInsertBody(product: Omit<Product, "id">) {
  return {
    name: product.name,
    nameAr: product.nameAr,
    price: product.price,
    originalPrice: product.originalPrice ?? null,
    image: product.image,
    category: product.category,
    ageGroup: product.ageGroup,
    sizes: product.sizes ?? [],
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
    const res = await fetch(`${API_BASE}/api/products`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toInsertBody(product)),
    });
    if (!res.ok) throw new Error("فشل إضافة المنتج");
    const created: Product = await res.json();
    setProducts((prev) => [created, ...prev]);
  }, []);

  const updateProduct = useCallback(async (product: Product) => {
    const res = await fetch(`${API_BASE}/api/products/${product.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toInsertBody(product)),
    });
    if (!res.ok) throw new Error("فشل تعديل المنتج");
    const updated: Product = await res.json();
    setProducts((prev) => prev.map((p) => (p.id === product.id ? updated : p)));
  }, []);

  const deleteProduct = useCallback(async (id: string) => {
    const res = await fetch(`${API_BASE}/api/products/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("فشل حذف المنتج");
    setProducts((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const adjustStock = useCallback(async (id: string, action: "set" | "add" | "subtract", amount: number): Promise<Product> => {
    const res = await fetch(`${API_BASE}/api/products/${id}/stock`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, amount }),
    });
    if (!res.ok) throw new Error("فشل تعديل الكمية");
    const updated: Product = await res.json();
    setProducts((prev) => prev.map((p) => (p.id === id ? updated : p)));
    return updated;
  }, []);

  return (
    <ProductsContext.Provider
      value={{ products, loading, addProduct, updateProduct, deleteProduct, refreshProducts, adjustStock }}
    >
      {children}
    </ProductsContext.Provider>
  );
}

export function useProducts() {
  return useContext(ProductsContext);
}
