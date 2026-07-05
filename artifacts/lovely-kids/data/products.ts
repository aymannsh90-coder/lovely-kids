export interface SizeStock {
  size: string;
  outOfStock?: boolean;
}

export interface ColorVariant {
  color: string;
  hex: string;
  image?: string;
  sizes: SizeStock[];
}

export interface Product {
  id: string;
  name: string;
  nameAr: string;
  price: number;
  originalPrice?: number;
  image: string;
  images?: string[];
  category: string;
  ageGroup: string;
  gender?: "boys" | "girls" | null;
  sizes?: string[];
  colorVariants?: ColorVariant[];
  rating: number;
  reviews: number;
  isNew?: boolean;
  discount?: number;
  description: string;
  stock?: number | null;
}

export const AGE_GROUP_IDS = ["newborn", "infant", "toddler", "kids", "boys", "girls"] as const;
export const CATEGORY_IDS = ["all", "clothes", "stroller", "feeding", "bath", "toys", "accessories"] as const;

export type AgeGroupId = typeof AGE_GROUP_IDS[number];
export type CategoryId = typeof CATEGORY_IDS[number];

export interface AgeGroupLabel { label: string; sublabel: string; }

export const DEFAULT_AGE_GROUP_LABELS: Record<string, AgeGroupLabel> = {
  newborn: { label: "مولود جديد", sublabel: "0-3 أشهر" },
  infant:  { label: "رضيع",       sublabel: "3-12 شهر" },
  toddler: { label: "دارج",       sublabel: "1-3 سنوات" },
  kids:    { label: "أطفال",      sublabel: "3-6 سنوات" },
  boys:    { label: "أولاد",      sublabel: "+6 سنوات" },
  girls:   { label: "بنات",       sublabel: "+6 سنوات" },
};

export const DEFAULT_CATEGORY_LABELS: Record<string, string> = {
  all:         "الكل",
  clothes:     "ملابس",
  stroller:    "عربات",
  feeding:     "تغذية",
  bath:        "استحمام",
  toys:        "ألعاب",
  accessories: "إكسسوارات",
};

export const AGE_GROUP_ICONS: Record<string, string> = {
  newborn: "egg-outline",
  infant:  "body-outline",
  toddler: "walk-outline",
  kids:    "people-outline",
  boys:    "football-outline",
  girls:   "heart-outline",
};
