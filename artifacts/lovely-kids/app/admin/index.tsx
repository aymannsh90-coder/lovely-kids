import { getResponsiveTopPadding } from "@/utils/webLayout";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppSettings } from "@/context/AppSettingsContext";
import { API_BASE } from "@/constants/api";
import { useAuth } from "@/context/AuthContext";
import { useProducts } from "@/context/ProductsContext";
import { useColors } from "@/hooks/useColors";

const ADMIN_CARDS = [
  {
    label: "إدارة المنتجات",
    subtitle: "المنتجات والمخزون",
    icon: "cube-outline" as const,
    route: "/admin/products" as const,
  },
  {
    label: "ترتيب المنتجات",
    subtitle: "تحديد ترتيب ظهور المنتجات",
    icon: "swap-vertical-outline" as const,
    route: "/admin/product-ordering" as never,
  },
  {
    label: "الطلبات",
    subtitle: "متابعة طلبات الزبائن",
    icon: "bag-handle-outline" as const,
    route: "/admin/orders" as const,
  },
  {
    label: "المستخدمون",
    subtitle: "الحسابات والمستخدمون",
    icon: "people-outline" as const,
    route: "/admin/users" as const,
  },
  {
    label: "الإشعارات",
    subtitle: "إرسال الإشعارات",
    icon: "notifications-outline" as const,
    route: "/admin/notifications" as const,
  },
  {
    label: "قسم العروض 🔥",
    subtitle: "إدارة منتجات العروض",
    icon: "pricetag-outline" as const,
    route: "/admin/product-offers" as const,
  },
  {
    label: "ترتيب منتجات قسم العروض",
    subtitle: "ترتيب تبويبات وأقسام العروض",
    icon: "reorder-four-outline" as const,
    route: "/admin/offers-category-order" as never,
  },
  {
    label: "عرض التوصيل",
    subtitle: "الحد الأدنى والفترة وأسعار العرض",
    icon: "car-outline" as const,
    route: "/admin/shipping-promotion" as const,
  },
  {
    label: "أقسام الصفحة الرئيسية",
    subtitle: "إظهار وإخفاء أقسام الرئيسية",
    icon: "eye-outline" as const,
    route: "/admin/home-sections" as const,
  },
  {
    label: "إعدادات التطبيق",
    subtitle: "جميع الإعدادات",
    icon: "settings-outline" as const,
    route: "/admin/settings" as const,
  },
];

type VisitorAnalyticsStats = {
  today: number;
  last7Days: number;
  last30Days: number;
  total: number;
  countries: {
    country: string;
    visitors: number;
  }[];
};

const ANALYTICS_COUNTRY_LABELS: Record<string, string> = {
  PS: "فلسطين",
  IL: "إسرائيل",
  JO: "الأردن",
  EG: "مصر",
  SA: "السعودية",
  AE: "الإمارات",
  QA: "قطر",
  KW: "الكويت",
  TR: "تركيا",
  US: "الولايات المتحدة",
  CA: "كندا",
  DE: "ألمانيا",
  GB: "بريطانيا",
  XX: "غير معروف",
};

function analyticsCountryLabel(code: string) {
  return ANALYTICS_COUNTRY_LABELS[code] ?? code;
}

export default function AdminDashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, getAuthToken } = useAuth();
  const { products } = useProducts();
  const [showInventoryDetails, setShowInventoryDetails] = useState(false);
  const [visitorStats, setVisitorStats] =
    useState<VisitorAnalyticsStats | null>(null);
  const [visitorStatsLoading, setVisitorStatsLoading] =
    useState(false);
  const [showVisitorDetails, setShowVisitorDetails] =
    useState(false);
  const { settings, updateSettings } = useAppSettings();

  const topPadding = getResponsiveTopPadding(insets.top);
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 20;

  const activeCategories = useMemo(() => {
    const hidden = settings.hiddenCategories ?? [];
    return Object.entries(settings.categoryLabels ?? {})
      .filter(([id]) => id !== "all" && !hidden.includes(id))
      .map(([id, label]) => ({ id, label }));
  }, [settings.categoryLabels, settings.hiddenCategories]);

  const offersCount = useMemo(
    () => products.filter((product) => product.showInOffers === true).length,
    [products],
  );

  useEffect(() => {
    if (user?.isOwner !== true) {
      setVisitorStats(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      setVisitorStatsLoading(true);

      try {
        const token = await getAuthToken();
        if (!token) return;

        const response = await fetch(
          `${API_BASE}/api/analytics/summary`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );

        if (!response.ok) return;

        const data =
          (await response.json()) as VisitorAnalyticsStats;

        if (!cancelled) {
          setVisitorStats(data);
        }
      } catch {
        // لا نعطل لوحة الإدارة إذا تعطلت الإحصائيات مؤقتاً.
      } finally {
        if (!cancelled) {
          setVisitorStatsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.isOwner, getAuthToken]);

  const inventoryValue = useMemo(() => {
    const getProductQuantity = (
      product: (typeof products)[number],
    ): number | null => {
      const variantSizes =
        product.colorVariants?.flatMap((variant) => variant.sizes ?? []) ?? [];

      const allVariantStocksTracked =
        variantSizes.length > 0 &&
        variantSizes.every((size) => typeof size.stock === "number");

      const variantStock =
        allVariantStocksTracked
          ? variantSizes.reduce(
              (sum, size) => sum + Math.max(0, size.stock ?? 0),
              0,
            )
          : null;

      const generalStock =
        typeof product.stock === "number"
          ? Math.max(0, product.stock)
          : null;

      // عند وجود المخزون العام ومخزون المقاسات معاً:
      // كلاهما ينقص عند البيع، لذلك نأخذ الحد الفعلي ولا نجمعهما.
      if (generalStock !== null && variantStock !== null) {
        return Math.min(generalStock, variantStock);
      }

      if (generalStock !== null) return generalStock;
      if (variantStock !== null) return variantStock;

      return null;
    };

    let regularPieces = 0;
    let offerPieces = 0;
    let regularValue = 0;
    let offerValue = 0;
    const untrackedProducts: { id: string; name: string }[] = [];

    for (const product of products) {
      const quantity = getProductQuantity(product);

      if (quantity === null) {
        untrackedProducts.push({
          id: product.id,
          name: product.nameAr || product.name || `منتج #${product.id}`,
        });
        continue;
      }

      const value = quantity * Math.max(0, Number(product.price) || 0);

      if (product.showInOffers === true) {
        offerPieces += quantity;
        offerValue += value;
      } else {
        regularPieces += quantity;
        regularValue += value;
      }
    }

    return {
      regularPieces,
      offerPieces,
      totalPieces: regularPieces + offerPieces,
      regularValue,
      offerValue,
      totalValue: regularValue + offerValue,
      untrackedProducts,
    };
  }, [products]);

  const formatMoney = (value: number) =>
    `${Math.round(value).toLocaleString("en-US")} ₪`;



  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: bottomPadding }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: topPadding + 12,
            backgroundColor: colors.primary,
          },
        ]}
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-forward" size={24} color="#fff" />
        </Pressable>

        <View style={{ alignItems: "center" }}>
          <Text style={styles.headerTitle}>لوحة الإدارة</Text>
          <Text style={styles.headerSubtitle}>Lovely Kids</Text>
        </View>

        <View style={{ width: 24 }} />
      </View>

      <View style={styles.body}>
        {/* Summary */}
        <View
          style={[
            styles.summaryCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryNumber, { color: colors.primary }]}>
              {products.length}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>
              منتج
            </Text>
          </View>

          <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />

          <View style={styles.summaryItem}>
            <Text style={[styles.summaryNumber, { color: colors.primary }]}>
              {offersCount}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>
              في العروض
            </Text>
          </View>

          <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />

          <View style={styles.summaryItem}>
            <Text style={[styles.summaryNumber, { color: colors.primary }]}>
              {activeCategories.length}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>
              تصنيف نشط
            </Text>
          </View>
        </View>

        {user?.isOwner === true ? (
          <View
            style={{
              backgroundColor: colors.card,
              borderColor: colors.primary + "45",
              borderWidth: 1.5,
              borderRadius: 18,
              marginTop: 16,
              marginBottom: 8,
              overflow: "hidden",
            }}
          >
            <Pressable
              onPress={() => setShowInventoryDetails((prev) => !prev)}
              style={{
                padding: 16,
                flexDirection: "row-reverse",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <View
                style={{
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  gap: 9,
                }}
              >
                <View
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 21,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: colors.secondary,
                  }}
                >
                  <Ionicons
                    name="wallet-outline"
                    size={24}
                    color={colors.primary}
                  />
                </View>

                <View>
                  <Text
                    style={{
                      color: colors.foreground,
                      fontSize: 18,
                      fontWeight: "900",
                      textAlign: "right",
                    }}
                  >
                    قيمة المخزون
                  </Text>
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontSize: 12,
                      textAlign: "right",
                    }}
                  >
                    خاص بالمالك
                  </Text>
                </View>
              </View>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Text
                  style={{
                    color: colors.primary,
                    fontSize: 12,
                    fontWeight: "800",
                  }}
                >
                  {showInventoryDetails ? "إخفاء" : "عرض التفاصيل"}
                </Text>

                <Ionicons
                  name={
                    showInventoryDetails
                      ? "chevron-up-outline"
                      : "chevron-down-outline"
                  }
                  size={18}
                  color={colors.primary}
                />
              </View>
            </Pressable>

            {showInventoryDetails ? (
              <View
                style={{
                  paddingHorizontal: 16,
                  paddingBottom: 16,
                  gap: 14,
                }}
              >
                <View
                  style={{
                    height: 1,
                    backgroundColor: colors.border,
                  }}
                />

                <Text
                  style={{
                    color: colors.primary,
                    fontSize: 13,
                    fontWeight: "800",
                    textAlign: "right",
                  }}
                >
                  إجمالي المخزون:{" "}
                  {inventoryValue.totalPieces.toLocaleString("en-US")} قطعة
                </Text>

                <View
                  style={{
                    flexDirection: "row-reverse",
                    flexWrap: "wrap",
                    gap: 10,
                  }}
                >
                  <View
                    style={{
                      flex: 1,
                      minWidth: 130,
                      padding: 12,
                      borderRadius: 14,
                      backgroundColor: colors.background,
                      borderWidth: 1,
                      borderColor: colors.border,
                    }}
                  >
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontSize: 12,
                        textAlign: "right",
                      }}
                    >
                      كل المنتجات
                    </Text>
                    <Text
                      style={{
                        color: colors.foreground,
                        fontSize: 18,
                        fontWeight: "900",
                        textAlign: "right",
                        marginTop: 4,
                      }}
                    >
                      {formatMoney(inventoryValue.regularValue)}
                    </Text>
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontSize: 11,
                        textAlign: "right",
                        marginTop: 3,
                      }}
                    >
                      {inventoryValue.regularPieces.toLocaleString("en-US")} قطعة
                    </Text>
                  </View>

                  <View
                    style={{
                      flex: 1,
                      minWidth: 130,
                      padding: 12,
                      borderRadius: 14,
                      backgroundColor: colors.background,
                      borderWidth: 1,
                      borderColor: colors.border,
                    }}
                  >
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontSize: 12,
                        textAlign: "right",
                      }}
                    >
                      منتجات العروض
                    </Text>
                    <Text
                      style={{
                        color: colors.foreground,
                        fontSize: 18,
                        fontWeight: "900",
                        textAlign: "right",
                        marginTop: 4,
                      }}
                    >
                      {formatMoney(inventoryValue.offerValue)}
                    </Text>
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontSize: 11,
                        textAlign: "right",
                        marginTop: 3,
                      }}
                    >
                      {inventoryValue.offerPieces.toLocaleString("en-US")} قطعة
                    </Text>
                  </View>

                  <View
                    style={{
                      flex: 1,
                      minWidth: 130,
                      padding: 12,
                      borderRadius: 14,
                      backgroundColor: colors.primary + "10",
                      borderWidth: 1.5,
                      borderColor: colors.primary + "55",
                    }}
                  >
                    <Text
                      style={{
                        color: colors.primary,
                        fontSize: 12,
                        fontWeight: "800",
                        textAlign: "right",
                      }}
                    >
                      إجمالي قيمة البضاعة
                    </Text>
                    <Text
                      style={{
                        color: colors.primary,
                        fontSize: 21,
                        fontWeight: "900",
                        textAlign: "right",
                        marginTop: 4,
                      }}
                    >
                      {formatMoney(inventoryValue.totalValue)}
                    </Text>
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontSize: 11,
                        textAlign: "right",
                        marginTop: 3,
                      }}
                    >
                      {inventoryValue.totalPieces.toLocaleString("en-US")} قطعة
                    </Text>
                  </View>
                </View>

                {inventoryValue.untrackedProducts.length > 0 ? (
                  <View
                    style={{
                      flexDirection: "row-reverse",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Ionicons
                      name="information-circle-outline"
                      size={16}
                      color={colors.mutedForeground}
                    />
                    <Text
                      style={{
                        flex: 1,
                        color: colors.mutedForeground,
                        fontSize: 11,
                        textAlign: "right",
                      }}
                    >
                      يوجد {inventoryValue.untrackedProducts.length} منتج بدون كمية رقمية،
                      لذلك لم يدخل في قيمة المخزون.
                    </Text>

                    <View style={{ marginTop: 8, gap: 4 }}>
                      {inventoryValue.untrackedProducts.map((item) => (
                        <Pressable
                          key={item.id}
                          onPress={() =>
                            router.push({
                              pathname: "/admin/add-product",
                              params: { productId: item.id },
                            })
                          }
                          style={{
                            flexDirection: "row-reverse",
                            alignItems: "center",
                            gap: 5,
                            paddingVertical: 3,
                          }}
                        >
                          <Ionicons
                            name="create-outline"
                            size={15}
                            color={colors.primary}
                          />
                          <Text
                            style={{
                              flex: 1,
                              color: colors.primary,
                              fontSize: 12,
                              fontWeight: "800",
                              textAlign: "right",
                              textDecorationLine: "underline",
                            }}
                          >
                            {item.name}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {user?.isOwner === true ? (
          <View
            style={{
              backgroundColor: colors.card,
              borderColor: colors.primary + "45",
              borderWidth: 1.5,
              borderRadius: 18,
              marginTop: 12,
              marginBottom: 8,
              overflow: "hidden",
            }}
          >
            <Pressable
              onPress={() =>
                setShowVisitorDetails((prev) => !prev)
              }
              style={{
                padding: 16,
                flexDirection: "row-reverse",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <View
                style={{
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  gap: 10,
                  flex: 1,
                }}
              >
                <View
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 21,
                    backgroundColor: colors.primary + "16",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons
                    name="analytics-outline"
                    size={24}
                    color={colors.primary}
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: colors.foreground,
                      fontSize: 17,
                      fontWeight: "900",
                      textAlign: "right",
                    }}
                  >
                    إحصائيات الزوار
                  </Text>

                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontSize: 12,
                      textAlign: "right",
                      marginTop: 2,
                    }}
                  >
                    زوار فريدون • خاص بالمالك
                  </Text>
                </View>
              </View>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Text
                  style={{
                    color: colors.primary,
                    fontSize: 12,
                    fontWeight: "800",
                  }}
                >
                  {showVisitorDetails
                    ? "إخفاء"
                    : "عرض التفاصيل"}
                </Text>

                <Ionicons
                  name={
                    showVisitorDetails
                      ? "chevron-up"
                      : "chevron-down"
                  }
                  size={18}
                  color={colors.primary}
                />
              </View>
            </Pressable>

            {showVisitorDetails ? (
              <View
                style={{
                  paddingHorizontal: 16,
                  paddingBottom: 16,
                }}
              >
                {visitorStatsLoading && !visitorStats ? (
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      textAlign: "center",
                      paddingVertical: 12,
                    }}
                  >
                    جاري تحميل الإحصائيات...
                  </Text>
                ) : visitorStats ? (
                  <>
                    <View
                      style={{
                        flexDirection: "row-reverse",
                        flexWrap: "wrap",
                        gap: 8,
                      }}
                    >
                      {[
                        {
                          label: "اليوم",
                          value: visitorStats.today,
                        },
                        {
                          label: "آخر 7 أيام",
                          value: visitorStats.last7Days,
                        },
                        {
                          label: "آخر 30 يوم",
                          value: visitorStats.last30Days,
                        },
                        {
                          label: "إجمالي الزوار",
                          value: visitorStats.total,
                        },
                      ].map((item) => (
                        <View
                          key={item.label}
                          style={{
                            width: "48%",
                            flexGrow: 1,
                            backgroundColor: colors.background,
                            borderRadius: 13,
                            padding: 11,
                            borderWidth: 1,
                            borderColor: colors.border,
                          }}
                        >
                          <Text
                            style={{
                              color: colors.primary,
                              fontSize: 21,
                              fontWeight: "900",
                              textAlign: "center",
                            }}
                          >
                            {item.value.toLocaleString("en-US")}
                          </Text>

                          <Text
                            style={{
                              color: colors.mutedForeground,
                              fontSize: 11,
                              fontWeight: "700",
                              textAlign: "center",
                              marginTop: 3,
                            }}
                          >
                            {item.label}
                          </Text>
                        </View>
                      ))}
                    </View>

                    {visitorStats.countries.length > 0 ? (
                      <View
                        style={{
                          marginTop: 14,
                          borderTopWidth: 1,
                          borderTopColor: colors.border,
                          paddingTop: 12,
                        }}
                      >
                        <Text
                          style={{
                            color: colors.foreground,
                            fontSize: 14,
                            fontWeight: "900",
                            textAlign: "right",
                            marginBottom: 8,
                          }}
                        >
                          الدول • آخر 30 يوم
                        </Text>

                        {visitorStats.countries
                          .slice(0, 6)
                          .map((item) => (
                            <View
                              key={item.country}
                              style={{
                                flexDirection: "row-reverse",
                                justifyContent: "space-between",
                                paddingVertical: 5,
                              }}
                            >
                              <Text
                                style={{
                                  color: colors.foreground,
                                  fontWeight: "700",
                                }}
                              >
                                {analyticsCountryLabel(
                                  item.country,
                                )}
                              </Text>

                              <Text
                                style={{
                                  color: colors.primary,
                                  fontWeight: "900",
                                }}
                              >
                                {item.visitors.toLocaleString(
                                  "en-US",
                                )}{" "}
                                زائر
                              </Text>
                            </View>
                          ))}
                      </View>
                    ) : null}
                  </>
                ) : (
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      textAlign: "center",
                      paddingVertical: 8,
                    }}
                  >
                    لا توجد بيانات زوار حتى الآن.
                  </Text>
                )}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Main admin cards */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          الإدارة الرئيسية
        </Text>

        <View style={styles.cardsGrid}>
          {ADMIN_CARDS.map((item) => (
            <Pressable
              key={item.route}
              onPress={() => router.push(item.route)}
              style={[
                styles.adminCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              <View
                style={[
                  styles.iconCircle,
                  { backgroundColor: colors.secondary },
                ]}
              >
                <Ionicons name={item.icon} size={25} color={colors.primary} />
              </View>

              <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                {item.label}
              </Text>

              <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>
                {item.subtitle}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          إعدادات سريعة
        </Text>

        <View style={styles.quickGrid}>
          <Pressable
            onPress={() => router.push("/admin/season")}
            style={[styles.quickButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Ionicons name="partly-sunny-outline" size={28} color={colors.primary} />
            <Text style={[styles.quickButtonTitle, { color: colors.foreground }]}>الموسم النشط</Text>
            <Text style={[styles.quickButtonValue, { color: colors.mutedForeground }]}>
              {settings.activeSeason === "summer"
                ? "☀️ صيفي"
                : settings.activeSeason === "winter"
                  ? "❄️ شتوي"
                  : "غير محدد"}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/admin/shipping")}
            style={[styles.quickButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Ionicons name="car-outline" size={28} color={colors.primary} />
            <Text style={[styles.quickButtonTitle, { color: colors.foreground }]}>أسعار التوصيل</Text>
            <Text style={[styles.quickButtonValue, { color: colors.mutedForeground }]}>
              {(settings.shippingZones ?? []).map((zone) => `${zone.cost} ₪`).join(" · ")}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/admin/colors")}
            style={[styles.quickButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Ionicons name="color-palette-outline" size={28} color={colors.primary} />
            <Text style={[styles.quickButtonTitle, { color: colors.foreground }]}>ألوان التطبيق</Text>
            <View style={styles.colorDots}>
              {[settings.primaryColor, settings.backgroundColor, settings.secondaryColor].map((color, index) => (
                <View
                  key={`${color}-${index}`}
                  style={[styles.colorDot, { backgroundColor: color, borderColor: colors.border }]}
                />
              ))}
            </View>
          </Pressable>

          <Pressable
            onPress={() => router.push("/admin/promo-popup" as never)}
            style={[styles.quickButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Ionicons name="megaphone-outline" size={28} color={colors.primary} />
            <Text style={[styles.quickButtonTitle, { color: colors.foreground }]}>
              الإعلان المنبثق
            </Text>
            <Text style={[styles.quickButtonValue, { color: colors.mutedForeground }]}>
              {settings.promoPopupEnabled ? "مفعّل" : "غير مفعّل"}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/admin/hero" as never)}
            style={[styles.quickButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Ionicons name="images-outline" size={28} color={colors.primary} />
            <Text style={[styles.quickButtonTitle, { color: colors.foreground }]}>
              Hero Slider
            </Text>
            <Text style={[styles.quickButtonValue, { color: colors.mutedForeground }]}>
              {(settings.heroSlides ?? []).filter((slide) => slide.active).length} من 5 شرائح
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/admin/categories")}
            style={[styles.quickButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Ionicons name="grid-outline" size={28} color={colors.primary} />
            <Text style={[styles.quickButtonTitle, { color: colors.foreground }]}>أسماء التصنيفات</Text>
            <Text style={[styles.quickButtonValue, { color: colors.mutedForeground }]}>
              {activeCategories.length} تصنيف نشط
            </Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },

  header: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  headerTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "900",
  },
  headerSubtitle: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 11,
    marginTop: 2,
  },

  body: {
    padding: 14,
    gap: 14,
    width: "100%",
    maxWidth: 900,
    alignSelf: "center",
  },

  summaryCard: {
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 14,
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  summaryItem: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  summaryNumber: {
    fontSize: 22,
    fontWeight: "900",
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  summaryDivider: {
    width: 1,
    height: 38,
  },

  sectionTitle: {
    fontSize: 17,
    fontWeight: "900",
    textAlign: "right",
    marginTop: 2,
  },

  cardsGrid: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    flexWrap: "wrap",
    gap: 10,
  },
  adminCard: {
    flexGrow: 1,
    flexBasis: "46%",
    minWidth: 150,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    alignItems: "flex-end",
    gap: 7,
    minHeight: 132,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "900",
    textAlign: "right",
  },
  cardSubtitle: {
    fontSize: 11,
    lineHeight: 17,
    textAlign: "right",
  },

  quickCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  quickHeader: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    gap: 10,
  },
  quickTitle: {
    fontSize: 15,
    fontWeight: "900",
    textAlign: "right",
  },
  quickHint: {
    fontSize: 11,
    marginTop: 2,
    textAlign: "right",
  },

  seasonRow: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    gap: 10,
  },
  seasonBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  savedText: {
    color: "#16a34a",
    fontWeight: "700",
    fontSize: 12,
    textAlign: "center",
  },

  shippingRow: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    gap: 10,
  },
  shippingLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "right",
  },
  shippingInputWrap: {
    width: 105,
    height: 42,
    borderWidth: 1,
    borderRadius: 10,
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 8,
  },
  shippingInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: "800",
    paddingVertical: 0,
  },

  colorField: {
    gap: 6,
  },
  colorLabel: {
    fontSize: 13,
    fontWeight: "700",
    textAlign: "right",
  },

  saveQuickBtn: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 12,
    borderRadius: 12,
  },
  saveQuickText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 13,
  },

  categoryChips: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    flexWrap: "wrap",
    gap: 7,
  },
  categoryChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: "700",
  },

  manageBtn: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
  },
  manageBtnText: {
    fontSize: 13,
    fontWeight: "800",
  },
  quickGrid: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    flexWrap: "wrap",
    gap: 10,
  },
  quickButton: {
    flexGrow: 1,
    flexBasis: "46%",
    minWidth: 150,
    minHeight: 125,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  quickButtonTitle: {
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
  },
  quickButtonValue: {
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  colorDots: {
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
  },
  colorDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
  },

});
