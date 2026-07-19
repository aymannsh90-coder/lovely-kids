import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { API_BASE } from "@/constants/api";
import { useAuth } from "@/context/AuthContext";

export interface WishlistItem {
  id: string;
  name: string;
  price: number;
  image: string;
  category: string;
}

interface WishlistContextType {
  items: WishlistItem[];
  toggleItem: (item: WishlistItem) => void;
  isWishlisted: (id: string) => boolean;
  count: number;
}

const WishlistContext = createContext<WishlistContextType>({
  items: [],
  toggleItem: () => {},
  isWishlisted: () => false,
  count: 0,
});

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const { user, getAuthToken } = useAuth();
  const [items, setItems] = useState<WishlistItem[]>([]);
  const syncedForUserId = useRef<string | null>(null);

  useEffect(() => {
    if (user) return;

    let active = true;

    (async () => {
      try {
        const data = await AsyncStorage.getItem("wishlist");
        const parsed = data ? JSON.parse(data) : [];
        if (active) setItems(Array.isArray(parsed) ? parsed : []);
      } catch {
        await AsyncStorage.removeItem("wishlist").catch(() => {});
        if (active) setItems([]);
      }
    })();

    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      syncedForUserId.current = null;
      return;
    }
    if (syncedForUserId.current === user.id) return;
    syncedForUserId.current = user.id;

    (async () => {
      try {
        const token = await getAuthToken();
        if (!token) return;
        const headers = { Authorization: `Bearer ${token}` };

        const localData = await AsyncStorage.getItem("wishlist");
        const localItems: WishlistItem[] = localData ? JSON.parse(localData) : [];
        if (localItems.length > 0) {
          await Promise.all(
            localItems.map((item) =>
              fetch(`${API_BASE}/api/likes/${item.id}`, { method: "POST", headers }).catch(() => {})
            )
          );
          await AsyncStorage.removeItem("wishlist");
        }

        const res = await fetch(`${API_BASE}/api/likes`, { headers });
        if (!res.ok) return;
        const data = await res.json();
        const productIds: string[] = data.productIds ?? [];
        setItems(
          productIds.map((id) => ({ id, name: "", price: 0, image: "", category: "" }))
        );
      } catch {
        // keep previous state on network failure
      }
    })();
  }, [user, getAuthToken]);

  const toggleItem = useCallback(
    (item: WishlistItem) => {
      if (user) {
        setItems((prev) => {
          const exists = prev.some((i) => i.id === item.id);
          const updated = exists ? prev.filter((i) => i.id !== item.id) : [...prev, item];
          (async () => {
            const token = await getAuthToken();
            if (!token) return;
            const headers = { Authorization: `Bearer ${token}` };
            await fetch(`${API_BASE}/api/likes/${item.id}`, {
              method: exists ? "DELETE" : "POST",
              headers,
            }).catch(() => {});
          })();
          return updated;
        });
        return;
      }
      setItems((prev) => {
        const exists = prev.find((i) => i.id === item.id);
        const updated = exists ? prev.filter((i) => i.id !== item.id) : [...prev, item];
        AsyncStorage.setItem("wishlist", JSON.stringify(updated));
        return updated;
      });
    },
    [user, getAuthToken]
  );

  const isWishlisted = useCallback(
    (id: string) => items.some((i) => i.id === id),
    [items]
  );

  return (
    <WishlistContext.Provider
      value={{ items, toggleItem, isWishlisted, count: items.length }}
    >
      {children}
    </WishlistContext.Provider>
  );
}

export function useWishlist() {
  return useContext(WishlistContext);
}
