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

export const AGE_GROUPS = AGE_GROUP_IDS.map((id) => ({
  id,
  label: DEFAULT_AGE_GROUP_LABELS[id].label,
  sublabel: DEFAULT_AGE_GROUP_LABELS[id].sublabel,
  icon: "child" as const,
}));

export const CATEGORIES = CATEGORY_IDS.map((id) => ({
  id,
  label: DEFAULT_CATEGORY_LABELS[id],
}));

export const PRODUCTS: Product[] = [
  {
    id: "1",
    name: "Newborn Gift Set",
    nameAr: "طقم هدية مولود جديد",
    price: 85,
    originalPrice: 120,
    image: "https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=400",
    category: "clothes",
    ageGroup: "newborn",
    sizes: ["0-3M", "3-6M"],
    rating: 4.9,
    reviews: 128,
    isNew: true,
    discount: 29,
    description: "طقم هدية متكامل للمولود الجديد يشمل ملابس وإكسسوارات عالية الجودة",
  },
  {
    id: "2",
    name: "Baby Stroller Premium",
    nameAr: "عربة أطفال بريميوم",
    price: 450,
    image: "https://images.unsplash.com/photo-1586769852836-bc069f19e1b6?w=400",
    category: "stroller",
    ageGroup: "infant",
    sizes: [],
    rating: 4.7,
    reviews: 89,
    description: "عربة أطفال فاخرة بتصميم عصري وميزات متطورة للراحة والأمان",
  },
  {
    id: "3",
    name: "Feeding Set",
    nameAr: "طقم تغذية متكامل",
    price: 65,
    originalPrice: 85,
    image: "https://images.unsplash.com/photo-1584464491033-06628f3a6b7b?w=400",
    category: "feeding",
    ageGroup: "infant",
    sizes: [],
    rating: 4.8,
    reviews: 234,
    discount: 24,
    description: "طقم تغذية شامل يتضمن زجاجات وأدوات التغذية الآمنة للرضع",
  },
];
