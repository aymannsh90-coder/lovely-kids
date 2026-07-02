import * as Haptics from "expo-haptics";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Vibration } from "react-native";

const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

interface NewOrdersContextType {
  newCount: number;
  latestOrderId: number | null;
  clearNew: () => void;
}

const NewOrdersContext = createContext<NewOrdersContextType>({
  newCount: 0,
  latestOrderId: null,
  clearNew: () => {},
});

export function NewOrdersProvider({ children }: { children: React.ReactNode }) {
  const [newCount, setNewCount] = useState(0);
  const [latestOrderId, setLatestOrderId] = useState<number | null>(null);
  const lastSeenIdRef = useRef<number | null>(null);
  const initialLoadRef = useRef(true);

  const fetchAndDetect = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/orders`);
      if (!res.ok) return;
      const orders: { id: number; status: string }[] = await res.json();
      if (!Array.isArray(orders) || orders.length === 0) return;

      const newestId = orders[0].id;

      if (initialLoadRef.current) {
        // First load — just record what's already there, don't notify
        lastSeenIdRef.current = newestId;
        initialLoadRef.current = false;
        return;
      }

      if (lastSeenIdRef.current !== null && newestId > lastSeenIdRef.current) {
        // Count how many orders are newer than last seen
        const freshCount = orders.filter((o) => o.id > lastSeenIdRef.current!).length;
        setNewCount((prev) => prev + freshCount);
        setLatestOrderId(newestId);
        lastSeenIdRef.current = newestId;

        // Haptic + vibration notification
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Vibration.vibrate([0, 300, 100, 300, 100, 500]);
      }
    } catch {
      // Ignore network errors silently
    }
  }, []);

  useEffect(() => {
    fetchAndDetect();
    const interval = setInterval(fetchAndDetect, 20000); // every 20s
    return () => clearInterval(interval);
  }, [fetchAndDetect]);

  const clearNew = useCallback(() => {
    setNewCount(0);
    setLatestOrderId(null);
  }, []);

  return (
    <NewOrdersContext.Provider value={{ newCount, latestOrderId, clearNew }}>
      {children}
    </NewOrdersContext.Provider>
  );
}

export function useNewOrders() {
  return useContext(NewOrdersContext);
}
