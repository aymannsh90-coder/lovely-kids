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
  rewardForPromotionId?: number;
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
  | "quantity"
  | "clientKey"
  | "originalColor"
  | "originalSize"
>;

type OrderEditSelectionContextValue = {
  session: OrderEditSelectionSession | null;
  storeSelectionActive: boolean;
  startSelection: (
    session: OrderEditSelectionSession,
  ) => void;
  addSelectionItem: (
    item: AddSelectionItemInput,
  ) => void;
  endStoreSelection: () => void;
  clearSelection: () => void;
};

const OrderEditSelectionContext =
  createContext<OrderEditSelectionContextValue>({
    session: null,
    storeSelectionActive: false,
    startSelection: () => {},
    addSelectionItem: () => {},
    endStoreSelection: () => {},
    clearSelection: () => {},
  });

function selectionKey(
  item: Pick<
    OrderEditSelectionItem,
    "id" | "size" | "color" | "rewardForPromotionId"
  >,
) {
  return [
    item.id,
    item.color?.trim() ?? "",
    item.size?.trim() ?? "",
    item.rewardForPromotionId ?? "",
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
  const [
    storeSelectionActive,
    setStoreSelectionActive,
  ] = useState(false);

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
      setStoreSelectionActive(true);
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
      setStoreSelectionActive(false);
    },
    [],
  );

  const endStoreSelection =
    useCallback(() => {
      setStoreSelectionActive(false);
    }, []);

  const clearSelection =
    useCallback(() => {
      setSession(null);
      setStoreSelectionActive(false);
    }, []);

  return (
    <OrderEditSelectionContext.Provider
      value={{
        session,
        storeSelectionActive,
        startSelection,
        addSelectionItem,
        endStoreSelection,
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
