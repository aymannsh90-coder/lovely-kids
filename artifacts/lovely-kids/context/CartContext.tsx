import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export interface CartItem {
  id: string;
  name: string;
  price: number;
  image: string;
  quantity: number;
  size?: string;
  color?: string;
  category: string;
  rewardForPromotionId?: number;
}

interface CartContextType {
  items: CartItem[];
  addItem: (item: Omit<CartItem, "quantity">) => void;
  removeItem: (
    id: string,
    size?: string,
    color?: string,
    rewardForPromotionId?: number,
  ) => void;
  updateQuantity: (
    id: string,
    quantity: number,
    size?: string,
    color?: string,
    rewardForPromotionId?: number,
  ) => void;
  replaceItemVariant: (
    original: {
      id: string;
      size?: string;
      color?: string;
      rewardForPromotionId?: number;
    },
    replacement: Omit<CartItem, "quantity">,
    quantity?: number,
  ) => void;
  clearCart: () => void;
  totalItems: number;
  totalPrice: number;
}

const CartContext = createContext<CartContextType>({
  items: [],
  addItem: () => {},
  removeItem: () => {},
  updateQuantity: () => {},
  replaceItemVariant: () => {},
  clearCart: () => {},
  totalItems: 0,
  totalPrice: 0,
});

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    AsyncStorage.getItem("cart").then((data) => {
      if (data) setItems(JSON.parse(data));
    });
  }, []);

  const saveCart = useCallback((newItems: CartItem[]) => {
    setItems(newItems);
    AsyncStorage.setItem("cart", JSON.stringify(newItems));
  }, []);

  const matchesVariant = useCallback(
    (
      i: CartItem,
      item: {
        id: string;
        size?: string;
        color?: string;
        rewardForPromotionId?: number;
      },
    ) =>
      i.id === item.id &&
      i.size === item.size &&
      i.color === item.color &&
      i.rewardForPromotionId ===
        item.rewardForPromotionId,
    []
  );

  const addItem = useCallback(
    (item: Omit<CartItem, "quantity">) => {
      setItems((prev) => {
        const existing = prev.find((i) => matchesVariant(i, item));
        const updated = existing
          ? prev.map((i) =>
              matchesVariant(i, item) ? { ...i, quantity: i.quantity + 1 } : i
            )
          : [...prev, { ...item, quantity: 1 }];
        AsyncStorage.setItem("cart", JSON.stringify(updated));
        return updated;
      });
    },
    [matchesVariant]
  );

  const removeItem = useCallback(
    (
      id: string,
      size?: string,
      color?: string,
      rewardForPromotionId?: number,
    ) => {
      setItems((prev) => {
        const updated = prev.filter((i) =>
          !matchesVariant(i, {
            id,
            size,
            color,
            rewardForPromotionId,
          }),
        );
        AsyncStorage.setItem("cart", JSON.stringify(updated));
        return updated;
      });
    },
    [matchesVariant]
  );

  const updateQuantity = useCallback(
    (
      id: string,
      quantity: number,
      size?: string,
      color?: string,
      rewardForPromotionId?: number,
    ) => {
      setItems((prev) => {
        const target = {
          id,
          size,
          color,
          rewardForPromotionId,
        };

        const updated =
          quantity === 0
            ? prev.filter((i) => !matchesVariant(i, target))
            : prev.map((i) =>
                matchesVariant(i, target)
                  ? { ...i, quantity }
                  : i,
              );
        AsyncStorage.setItem("cart", JSON.stringify(updated));
        return updated;
      });
    },
    [matchesVariant]
  );

  const replaceItemVariant = useCallback(
    (
      original: {
        id: string;
        size?: string;
        color?: string;
        rewardForPromotionId?: number;
      },
      replacement: Omit<CartItem, "quantity">,
      quantity?: number,
    ) => {
      setItems((prev) => {
        const sourceIndex = prev.findIndex((item) =>
          matchesVariant(item, original),
        );

        if (sourceIndex < 0) return prev;

        const source = prev[sourceIndex];
        const replacementQuantity =
          Number.isInteger(quantity) && (quantity ?? 0) > 0
            ? quantity!
            : source.quantity;

        const next = [...prev];
        next.splice(sourceIndex, 1);

        const targetIndex = next.findIndex((item) =>
          matchesVariant(item, replacement),
        );

        if (targetIndex >= 0) {
          const target = next[targetIndex];
          next[targetIndex] = {
            ...target,
            ...replacement,
            quantity: target.quantity + replacementQuantity,
          };
        } else {
          next.splice(
            Math.min(sourceIndex, next.length),
            0,
            {
              ...replacement,
              quantity: replacementQuantity,
            },
          );
        }

        AsyncStorage.setItem("cart", JSON.stringify(next));
        return next;
      });
    },
    [matchesVariant],
  );

  const clearCart = useCallback(() => {
    saveCart([]);
  }, [saveCart]);

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
  const totalPrice = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        addItem,
        removeItem,
        updateQuantity,
        replaceItemVariant,
        clearCart,
        totalItems,
        totalPrice,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  return useContext(CartContext);
}
