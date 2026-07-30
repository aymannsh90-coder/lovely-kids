export type NavigationGroup =
  "sales" | "purchases" | "inventory" | "parties" | "finance" | "reports";

export interface PosNavigationItem {
  key: string;
  group: NavigationGroup;
  path: string;
  title: string;
  description: string;
  icon: string;
  requiresOpenSession: boolean;
  status: "ready" | "planned";
}

export const navigationGroups: Array<{
  key: NavigationGroup;
  title: string;
  description: string;
}> = [
  {
    key: "sales",
    title: "المبيعات",
    description: "عمليات البيع والمردودات والفواتير اليومية.",
  },
  {
    key: "purchases",
    title: "المشتريات",
    description: "فواتير الموردين ومردودات المشتريات.",
  },
  {
    key: "inventory",
    title: "الأصناف والمخزون",
    description: "الأصناف والكميات وحركات المخزون.",
  },
  {
    key: "parties",
    title: "الزبائن والموردون",
    description: "إدارة بيانات الزبائن والموردين وحساباتهم.",
  },
  {
    key: "finance",
    title: "الصندوق والمالية",
    description: "المصروفات والشيكات وإدارة يوم العمل.",
  },
  {
    key: "reports",
    title: "التقارير",
    description: "تقارير المبيعات والمخزون والحسابات.",
  },
];

export const posNavigation: PosNavigationItem[] = [
  {
    key: "new-sale",
    group: "sales",
    path: "/sales/new",
    title: "فاتورة مبيعات",
    description: "مسح باركود الأصناف وإنشاء فاتورة بيع جديدة.",
    icon: "🧾",
    requiresOpenSession: true,
    status: "ready",
  },
  {
    key: "sales-returns",
    group: "sales",
    path: "/sales/returns",
    title: "مردودات المبيعات",
    description: "مرتجع بباركود الفاتورة أو باركود الصنف.",
    icon: "↩️",
    requiresOpenSession: true,
    status: "planned",
  },
  {
    key: "invoice-check",
    group: "sales",
    path: "/sales/invoice-check",
    title: "فحص فاتورة",
    description: "مسح باركود الفاتورة وعرض تفاصيلها الكاملة.",
    icon: "🔎",
    requiresOpenSession: false,
    status: "ready",
  },
  {
    key: "today-sales",
    group: "sales",
    path: "/sales/today",
    title: "مبيعات اليوم",
    description: "الفواتير وملخص اليوم وتقرير المحاسبة A4.",
    icon: "📋",
    requiresOpenSession: true,
    status: "ready",
  },
  {
    key: "new-purchase",
    group: "purchases",
    path: "/purchases/new",
    title: "فاتورة مشتريات",
    description: "إدخال مشتريات جديدة من الموردين.",
    icon: "🛒",
    requiresOpenSession: false,
    status: "planned",
  },
  {
    key: "purchase-returns",
    group: "purchases",
    path: "/purchases/returns",
    title: "مردودات المشتريات",
    description: "إرجاع أصناف إلى المورد وربطها بفاتورة الشراء.",
    icon: "📦",
    requiresOpenSession: false,
    status: "planned",
  },
  {
    key: "products",
    group: "inventory",
    path: "/inventory/products",
    title: "الأصناف",
    description: "إضافة الأصناف وتعديل الأسعار والباركود والمتغيرات.",
    icon: "👕",
    requiresOpenSession: false,
    status: "planned",
  },
  {
    key: "stock",
    group: "inventory",
    path: "/inventory/stock",
    title: "المخزون",
    description: "فحص الكميات وحركات الإدخال والإخراج والتسويات.",
    icon: "🏬",
    requiresOpenSession: false,
    status: "planned",
  },
  {
    key: "customers",
    group: "parties",
    path: "/parties/customers",
    title: "الزبائن",
    description: "بيانات الزبائن والمشتريات والأرصدة.",
    icon: "👨‍👩‍👧",
    requiresOpenSession: false,
    status: "planned",
  },
  {
    key: "suppliers",
    group: "parties",
    path: "/parties/suppliers",
    title: "الموردون",
    description: "بيانات الموردين والمشتريات والحسابات.",
    icon: "🚚",
    requiresOpenSession: false,
    status: "planned",
  },
  {
    key: "expenses",
    group: "finance",
    path: "/finance/expenses",
    title: "مصروفات اليوم",
    description: "تسجيل المصروفات والسحوبات من الصندوق.",
    icon: "💸",
    requiresOpenSession: true,
    status: "planned",
  },
  {
    key: "checks",
    group: "finance",
    path: "/finance/checks",
    title: "الشيكات",
    description: "متابعة الشيكات المستلمة والمدفوعة ومواعيدها.",
    icon: "📝",
    requiresOpenSession: false,
    status: "planned",
  },
  {
    key: "cash-session",
    group: "finance",
    path: "/cash-session",
    title: "فتح وإغلاق اليوم",
    description: "إدارة جلسة الصندوق ورصيد البداية والإغلاق.",
    icon: "💰",
    requiresOpenSession: false,
    status: "ready",
  },
  {
    key: "reports",
    group: "reports",
    path: "/reports",
    title: "التقارير",
    description: "تقارير المبيعات والمشتريات والمخزون والحسابات.",
    icon: "📊",
    requiresOpenSession: false,
    status: "planned",
  },
];

export function findNavigationItem(pathname: string) {
  return posNavigation.find((item) => item.path === pathname);
}
