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

import { DEFAULT_AGE_GROUP_LABELS, DEFAULT_CATEGORY_LABELS, AgeGroupLabel } from "@/data/products";
import { API_BASE } from "@/constants/api";
import { useAuth } from "@/context/AuthContext";

const POLL_INTERVAL_MS = 20000;

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

export interface AboutFeature {
  title: string;
  desc: string;
}

export interface AboutInfo {
  intro: string;
  features: AboutFeature[];
}

export interface ContactInfo {
  storeName: string;
  storeTagline: string;
  phoneNumber: string;
  facebookUrl: string;
  instagramUrl: string;
  tiktokUrl: string;
  addressLine1: string;
  addressLine2: string;
  mapsUrl: string;
  workingHours: string;
  shippingInfo: string;
  returnPolicy: string;
}

export interface AppSettings {
  logoUrl: string;
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
  hiddenCategories: string[];
  bankInfo: BankInfo;
  whatsappNumber: string;
  contactInfo: ContactInfo;
  aboutInfo: AboutInfo;
}

const DEFAULT_SETTINGS: AppSettings = {
  logoUrl: "",
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
  hiddenCategories: [],
  bankInfo: {
    bankName: "",
    accountHolder: "",
    accountNumber: "",
    iban: "",
  },
  whatsappNumber: "97292376808",
  contactInfo: {
    storeName: "Lovely Kids",
    storeTagline: "كل ما يحتاجه طفلك في مكان واحد",
    phoneNumber: "092376808",
    facebookUrl: "https://www.facebook.com/lovely.kids.nablus1",
    instagramUrl: "https://www.instagram.com/lovely.kids.nablus",
    tiktokUrl: "https://www.tiktok.com/@lovely_kids_nablus",
    addressLine1: "نابلس · المركز التجاري",
    addressLine2: "شارع عمر المختار · طلعة بنك القدس",
    mapsUrl: "https://google.com/maps?cid=10801481858754571229",
    workingHours: "السبت - الخميس\n9:00 صباحاً - 9:00 مساءً",
    shippingInfo: "توصيل سريع لجميع المناطق\nشحن مجاني فوق 500 ₪",
    returnPolicy: "إمكانية الاستبدال بالبضاعة السليمة",
  },
  aboutInfo: {
    intro:
      "Lovely Kids متجر متخصص في ملابس ومستلزمات الأطفال في مدينة نابلس.\n" +
      "نقدم منتجات عالية الجودة بأسعار مناسبة لتلبية احتياجات كل مرحلة من\n" +
      "مراحل نمو طفلك.\n\n" +
      "📍 نابلس · المركز التجاري · شارع عمر المختار · طلعة بنك القدس\n" +
      "📞 09-237-6808",
    features: [
      { title: "جودة مضمونة", desc: "منتجات مختارة بعناية من أفضل العلامات التجارية" },
      { title: "توصيل سريع", desc: "نوصل لجميع مناطق فلسطين بأسرع وقت" },
      { title: "أسعار مناسبة", desc: "أفضل الأسعار مع ضمان الجودة العالية" },
      { title: "ضمان الاستبدال", desc: "إمكانية الاستبدال خلال 7 أيام من الاستلام" },
    ],
  },
};

interface AppSettingsContextType {
  settings: AppSettings;
  settingsReady: boolean;
  updateSettings: (partial: Partial<AppSettings>) => void;
  addOffer: (offer: Omit<Offer, "id">) => void;
  updateOffer: (offer: Offer) => void;
  deleteOffer: (id: string) => void;
  resetSettings: () => void;
}

const AppSettingsContext = createContext<AppSettingsContextType>({
  settings: DEFAULT_SETTINGS,
  settingsReady: false,
  updateSettings: () => {},
  addOffer: () => {},
  updateOffer: () => {},
  deleteOffer: () => {},
  resetSettings: () => {},
});

const STORAGE_KEY = "lovely_kids_app_settings";

export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const { getAuthToken } = useAuth();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const getAuthTokenRef = useRef(getAuthToken);
  getAuthTokenRef.current = getAuthToken;

  const applyRemote = useCallback((data: Partial<AppSettings>) => {
    const merged = { ...DEFAULT_SETTINGS, ...data };
    setSettings(merged);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    return merged;
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/settings`);
      if (!res.ok) return;
      const data = await res.json();
      applyRemote(data);
    } catch {
      // keep cached/local settings on network failure
    }
  }, [applyRemote]);

  useEffect(() => {
    (async () => {
      try {
        const cached = await AsyncStorage.getItem(STORAGE_KEY);
        if (cached) {
          const saved = JSON.parse(cached) as Partial<AppSettings>;
          setSettings({ ...DEFAULT_SETTINGS, ...saved });
        }
      } catch {
        // ignore
      }
      // Await the initial remote fetch before marking settings as ready so that
      // any consumer of settingsReady can be confident it has the server's latest
      // values (or falls back gracefully if the network is unavailable).
      await fetchSettings();
      setSettingsReady(true);
    })();
  }, [fetchSettings]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (AppState.currentState === "active") {
        fetchSettings();
      }
    }, POLL_INTERVAL_MS);

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") fetchSettings();
    });

    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [fetchSettings]);

  const pushSettings = useCallback(
    async (partial: Partial<AppSettings>) => {
      try {
        const authToken = await getAuthTokenRef.current();
        const res = await fetch(`${API_BASE}/api/settings`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify(partial),
        });
        if (res.ok) {
          const data = await res.json();
          applyRemote(data);
        }
      } catch {
        // ignore network errors, optimistic local update already applied
      }
    },
    [applyRemote]
  );

  const updateSettings = useCallback(
    (partial: Partial<AppSettings>) => {
      setSettings((prev) => {
        const updated = { ...prev, ...partial };
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        return updated;
      });
      pushSettings(partial);
    },
    [pushSettings]
  );

  const addOffer = useCallback(
    (offer: Omit<Offer, "id">) => {
      setSettings((prev) => {
        const offers = [
          ...prev.offers,
          { ...offer, id: Date.now().toString() + Math.random().toString(36).substr(2, 5) },
        ];
        const updated = { ...prev, offers };
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        pushSettings({ offers });
        return updated;
      });
    },
    [pushSettings]
  );

  const updateOffer = useCallback(
    (offer: Offer) => {
      setSettings((prev) => {
        const offers = prev.offers.map((o) => (o.id === offer.id ? offer : o));
        const updated = { ...prev, offers };
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        pushSettings({ offers });
        return updated;
      });
    },
    [pushSettings]
  );

  const deleteOffer = useCallback(
    (id: string) => {
      setSettings((prev) => {
        const offers = prev.offers.filter((o) => o.id !== id);
        const updated = { ...prev, offers };
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        pushSettings({ offers });
        return updated;
      });
    },
    [pushSettings]
  );

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS));
    pushSettings(DEFAULT_SETTINGS);
  }, [pushSettings]);

  return (
    <AppSettingsContext.Provider
      value={{ settings, settingsReady, updateSettings, addOffer, updateOffer, deleteOffer, resetSettings }}
    >
      {children}
    </AppSettingsContext.Provider>
  );
}

export function useAppSettings() {
  return useContext(AppSettingsContext);
}

export { DEFAULT_SETTINGS };
