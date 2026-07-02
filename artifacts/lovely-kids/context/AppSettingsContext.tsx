import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { DEFAULT_AGE_GROUP_LABELS, DEFAULT_CATEGORY_LABELS, AgeGroupLabel } from "@/data/products";

export interface Offer {
  id: string;
  title: string;
  subtitle: string;
  badgeText: string;
  color: string;
  active: boolean;
}

export interface BankInfo {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  iban: string;
}

export interface AppSettings {
  primaryColor: string;
  backgroundColor: string;
  secondaryColor: string;
  accentColor: string;
  tabLabelHome: string;
  tabLabelProducts: string;
  tabLabelProfile: string;
  bannerTitle: string;
  bannerSubtitle: string;
  bannerColor: string;
  bannerBadge: string;
  offers: Offer[];
  ageGroupLabels: Record<string, AgeGroupLabel>;
  categoryLabels: Record<string, string>;
  bankInfo: BankInfo;
  whatsappNumber: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  primaryColor: "#E91E8C",
  backgroundColor: "#F0FAFE",
  secondaryColor: "#96DFEC",
  accentColor: "#96DFEC",
  tabLabelHome: "الرئيسية",
  tabLabelProducts: "المنتجات",
  tabLabelProfile: "حسابي",
  bannerTitle: "كل ما يحتاجه\nطفلك في مكان واحد",
  bannerSubtitle: "ملابس · عربات · كوتات · مستلزمات",
  bannerColor: "#E91E8C",
  bannerBadge: "خصم 20%",
  offers: [
    {
      id: "offer1",
      title: "خصم 20% على ملابس المواليد",
      subtitle: "لفترة محدودة فقط",
      badgeText: "20%",
      color: "#E91E8C",
      active: true,
    },
  ],
  ageGroupLabels: DEFAULT_AGE_GROUP_LABELS,
  categoryLabels: DEFAULT_CATEGORY_LABELS,
  bankInfo: {
    bankName: "",
    accountHolder: "",
    accountNumber: "",
    iban: "",
  },
  whatsappNumber: "97292376808",
};

interface AppSettingsContextType {
  settings: AppSettings;
  updateSettings: (partial: Partial<AppSettings>) => void;
  addOffer: (offer: Omit<Offer, "id">) => void;
  updateOffer: (offer: Offer) => void;
  deleteOffer: (id: string) => void;
  resetSettings: () => void;
}

const AppSettingsContext = createContext<AppSettingsContextType>({
  settings: DEFAULT_SETTINGS,
  updateSettings: () => {},
  addOffer: () => {},
  updateOffer: () => {},
  deleteOffer: () => {},
  resetSettings: () => {},
});

const STORAGE_KEY = "lovely_kids_app_settings";

export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((data) => {
      if (data) {
        try {
          const saved = JSON.parse(data) as Partial<AppSettings>;
          setSettings({ ...DEFAULT_SETTINGS, ...saved });
        } catch {
          // ignore
        }
      }
    });
  }, []);

  const save = useCallback((updated: AppSettings) => {
    setSettings(updated);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }, []);

  const updateSettings = useCallback(
    (partial: Partial<AppSettings>) => {
      setSettings((prev) => {
        const updated = { ...prev, ...partial };
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        return updated;
      });
    },
    []
  );

  const addOffer = useCallback((offer: Omit<Offer, "id">) => {
    setSettings((prev) => {
      const updated = {
        ...prev,
        offers: [
          ...prev.offers,
          { ...offer, id: Date.now().toString() + Math.random().toString(36).substr(2, 5) },
        ],
      };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const updateOffer = useCallback((offer: Offer) => {
    setSettings((prev) => {
      const updated = {
        ...prev,
        offers: prev.offers.map((o) => (o.id === offer.id ? offer : o)),
      };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const deleteOffer = useCallback((id: string) => {
    setSettings((prev) => {
      const updated = { ...prev, offers: prev.offers.filter((o) => o.id !== id) };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const resetSettings = useCallback(() => {
    save(DEFAULT_SETTINGS);
  }, [save]);

  return (
    <AppSettingsContext.Provider
      value={{ settings, updateSettings, addOffer, updateOffer, deleteOffer, resetSettings }}
    >
      {children}
    </AppSettingsContext.Provider>
  );
}

export function useAppSettings() {
  return useContext(AppSettingsContext);
}

export { DEFAULT_SETTINGS };
