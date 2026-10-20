import React, {
  createContext,
  useCallback,
  useContext,
  useState,
} from "react";

export type OrderEditSelectionItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  size?: string;
  color?: string;
  clientKey: string;
  originalColor?: string;
  originalSize?: string;
};

type OrderEditSelectionSession = {
  orderId: number;
  trackingToken?: string;
  items: OrderEditSelectionItem[];
};

type AddSelectionItemInput = Omit<
  OrderEditSelectionItem,
  "quantity"
>;

type OrderEditSelectionContextValue = {
  session: OrderEditSelectionSession | null;
  startSelection: (
    session: OrderEditSelectionSession,
  ) => void;
  addSelectionItem: (
    item: AddSelectionItemInput,
  ) => void;
  clearSelection: () => void;
};

const OrderEditSelectionContext =
  createContext<OrderEditSelectionContextValue>({
    session: null,
    startSelection: () => {},
    addSelectionItem: () => {},
    clearSelection: () => {},
  });

function selectionKey(
  item: Pick<
    OrderEditSelectionItem,
    "id" | "size" | "color"
  >,
) {
  return [
    item.id,
    item.color?.trim() ?? "",
    item.size?.trim() ?? "",
  ].join("::");
}

export function OrderEditSelectionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, setSession] =
    useState<OrderEditSelectionSession | null>(
      null,
    );

  const startSelection = useCallback(
    (
      nextSession: OrderEditSelectionSession,
    ) => {
      setSession({
        ...nextSession,
        items: nextSession.items.map(
          (item) => ({ ...item }),
        ),
      });
    },
    [],
  );

  const addSelectionItem = useCallback(
    (item: AddSelectionItemInput) => {
      setSession((current) => {
        if (!current) return current;

        const key =
          selectionKey(item);

        const existing =
          current.items.find(
            (entry) =>
              selectionKey(entry) === key,
          );

        const items = existing
          ? current.items.map(
              (entry) =>
                selectionKey(entry) === key
                  ? {
                      ...entry,
                      quantity:
                        Math.min(
                          99,
                          entry.quantity + 1,
                        ),
                    }
                  : entry,
            )
          : [
              ...current.items,
              {
                ...item,
                quantity: 1,
                clientKey:
                  `store-${item.id}-${Date.now()}`,
              },
            ];

        return {
          ...current,
          items,
        };
      });
    },
    [],
  );

  const clearSelection =
    useCallback(() => {
      setSession(null);
    }, []);

  return (
    <OrderEditSelectionContext.Provider
      value={{
        session,
        startSelection,
        addSelectionItem,
        clearSelection,
      }}
    >
      {children}
    </OrderEditSelectionContext.Provider>
  );
}

export function useOrderEditSelection() {
  return useContext(
    OrderEditSelectionContext,
  );
}
