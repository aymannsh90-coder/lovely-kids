import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DateField } from "@/components/DateField";
import { API_BASE } from "@/constants/api";
import {
  DEFAULT_CATEGORY_LABELS,
} from "@/data/products";
import { useAuth } from "@/context/AuthContext";
import { useProducts } from "@/context/ProductsContext";
import { useColors } from "@/hooks/useColors";
import { getResponsiveTopPadding } from "@/utils/webLayout";

type PromotionKind =
  | "buy_x_get_y"
  | "percent_off"
  | "bundle_price";

type RewardMode =
  | "free"
  | "percent_off"
  | "fixed_price";

type PromotionRow = {
  id: number;
  name: string;
  publicLabel: string;
  description: string | null;
  kind: PromotionKind;
  scope:
    | "all_products"
    | "selected_products";
  channel:
    | "web"
    | "pos"
    | "both";
  status:
    | "draft"
    | "active"
    | "archived";

  buyQuantity: number | null;
  rewardQuantity: number | null;
  rewardMode: RewardMode | null;
  rewardPercent: number | null;
  rewardPriceMinor: number | null;
  rewardSelectionMode:
    | "cheapest"
    | "customer_choice";

  percentOff: number | null;

  bundleQuantity: number | null;
  bundlePriceMinor: number | null;

  repeatable: boolean;
  maxApplicationsPerOrder:
    | number
    | null;

  stackWithOtherPromotions: boolean;
  stackWithDiscountCodes: boolean;
  stackWithShippingPromotion: boolean;

  priority: number;

  startsAt: string | null;
  endsAt: string | null;

  qualifyingProductIds: number[];
  rewardProductIds: number[];
  excludedProductIds: number[];
};

type ProductSelectorProps = {
  title: string;
  hint?: string;
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
};

function isoDateOnly(
  value:
    | string
    | null
    | undefined,
) {
  if (!value) return "";

  const date = new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return "";
  }

  const year =
    date.getFullYear();
  const month =
    String(
      date.getMonth() + 1,
    ).padStart(2, "0");
  const day =
    String(
      date.getDate(),
    ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function localDateIso(
  value: string,
  endOfDay: boolean,
) {
  const clean =
    value.trim();

  if (!clean) return null;

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      clean,
    )
  ) {
    throw new Error(
      "التاريخ يجب أن يكون بصيغة YYYY-MM-DD",
    );
  }

  const date = new Date(
    `${clean}T${endOfDay ? "23:59:59" : "00:00:00"}`,
  );

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    throw new Error(
      "التاريخ غير صالح",
    );
  }

  return date.toISOString();
}

function moneyInputToMinor(
  value: string,
) {
  const number =
    Number(
      value
        .trim()
        .replace(",", "."),
    );

  if (
    !Number.isFinite(number) ||
    number < 0
  ) {
    return null;
  }

  return Math.round(
    number * 100,
  );
}

function minorToMoney(
  value:
    | number
    | null
    | undefined,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return (
    value / 100
  ).toFixed(
    value % 100 === 0
      ? 0
      : 2,
  );
}

function numberInput(
  value: string,
  fallback: number,
) {
  const parsed =
    Number(value);

  return Number.isSafeInteger(
    parsed,
  ) &&
    parsed > 0
    ? parsed
    : fallback;
}

function humanKind(
  row: PromotionRow,
) {
  if (
    row.kind ===
    "percent_off"
  ) {
    return `خصم ${row.percentOff ?? 0}%`;
  }

  if (
    row.kind ===
    "bundle_price"
  ) {
    return `${row.bundleQuantity ?? 0} بسعر ${minorToMoney(
      row.bundlePriceMinor,
    )} ₪`;
  }

  if (
    row.rewardMode ===
    "free"
  ) {
    return `${row.buyQuantity ?? 0}+${row.rewardQuantity ?? 0} مجانًا`;
  }

  if (
    row.rewardMode ===
    "percent_off"
  ) {
    return `اشتري ${row.buyQuantity ?? 0} والمكافأة بخصم ${row.rewardPercent ?? 0}%`;
  }

  return `اشتري ${row.buyQuantity ?? 0} والمكافأة بـ${minorToMoney(
    row.rewardPriceMinor,
  )} ₪`;
}

export default function PromotionsAdminScreen() {
  const colors =
    useColors();
  const insets =
    useSafeAreaInsets();
  const {
    getAuthToken,
    user,
  } = useAuth();
  const {
    products,
  } = useProducts();

  const [
    promotions,
    setPromotions,
  ] = useState<
    PromotionRow[]
  >([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    editingId,
    setEditingId,
  ] = useState<
    number | null
  >(null);

  const [name, setName] =
    useState("");
  const [
    publicLabel,
    setPublicLabel,
  ] = useState("");
  const [
    description,
    setDescription,
  ] = useState("");

  const [kind, setKind] =
    useState<PromotionKind>(
      "buy_x_get_y",
    );

  const [scope, setScope] =
    useState<
      | "all_products"
      | "selected_products"
    >("selected_products");

  const [channel, setChannel] =
    useState<
      | "web"
      | "pos"
      | "both"
    >("both");

  const [status, setStatus] =
    useState<
      | "draft"
      | "active"
      | "archived"
    >("draft");

  const [
    buyQuantity,
    setBuyQuantity,
  ] = useState("4");
  const [
    rewardQuantity,
    setRewardQuantity,
  ] = useState("1");
  const [
    rewardMode,
    setRewardMode,
  ] = useState<RewardMode>(
    "free",
  );
  const [
    rewardPercent,
    setRewardPercent,
  ] = useState("50");
  const [
    rewardPrice,
    setRewardPrice,
  ] = useState("10");
  const [
    rewardSelectionMode,
    setRewardSelectionMode,
  ] = useState<
    | "cheapest"
    | "customer_choice"
  >("cheapest");

  const [
    percentOff,
    setPercentOff,
  ] = useState("10");

  const [
    bundleQuantity,
    setBundleQuantity,
  ] = useState("3");
  const [
    bundlePrice,
    setBundlePrice,
  ] = useState("100");

  const [
    repeatable,
    setRepeatable,
  ] = useState(true);
  const [
    maxApplications,
    setMaxApplications,
  ] = useState("");

  const [
    stackWithOtherPromotions,
    setStackWithOtherPromotions,
  ] = useState(false);
  const [
    stackWithDiscountCodes,
    setStackWithDiscountCodes,
  ] = useState(false);
  const [
    stackWithShippingPromotion,
    setStackWithShippingPromotion,
  ] = useState(true);

  const [
    priority,
    setPriority,
  ] = useState("100");

  const [
    startDate,
    setStartDate,
  ] = useState("");
  const [
    endDate,
    setEndDate,
  ] = useState("");

  const [
    qualifyingIds,
    setQualifyingIds,
  ] = useState(
    new Set<number>(),
  );
  const [
    separateRewardPool,
    setSeparateRewardPool,
  ] = useState(false);
  const [
    rewardIds,
    setRewardIds,
  ] = useState(
    new Set<number>(),
  );
  const [
    excludedIds,
    setExcludedIds,
  ] = useState(
    new Set<number>(),
  );

  const authorizedFetch =
    useCallback(
      async (
        path: string,
        init?: RequestInit,
      ) => {
        const token =
          await getAuthToken();

        if (!token) {
          throw new Error(
            "يجب تسجيل الدخول كمشرف",
          );
        }

        return fetch(
          `${API_BASE}${path}`,
          {
            ...init,
            headers: {
              "Content-Type":
                "application/json",
              Authorization:
                `Bearer ${token}`,
              ...(init?.headers ??
                {}),
            },
          },
        );
      },
      [getAuthToken],
    );

  const loadPromotions =
    useCallback(
      async () => {
        setLoading(true);

        try {
          const response =
            await authorizedFetch(
              "/api/admin/promotions",
            );

          const data =
            (await response
              .json()
              .catch(
                () => [],
              )) as
              | PromotionRow[]
              | {
                  error?: string;
                };

          if (
            !response.ok ||
            !Array.isArray(
              data,
            )
          ) {
            throw new Error(
              !Array.isArray(
                data,
              ) &&
                data.error
                ? data.error
                : "تعذر تحميل العروض",
            );
          }

          setPromotions(
            data,
          );
        } catch (error) {
          Alert.alert(
            "العروض",
            error instanceof
              Error
              ? error.message
              : "تعذر تحميل العروض",
          );
        } finally {
          setLoading(
            false,
          );
        }
      },
      [authorizedFetch],
    );

  useEffect(() => {
    void loadPromotions();
  }, [loadPromotions]);

  const resetEditor =
    useCallback(() => {
      setEditingId(null);
      setName("");
      setPublicLabel("");
      setDescription("");
      setKind(
        "buy_x_get_y",
      );
      setScope(
        "selected_products",
      );
      setChannel("both");
      setStatus("draft");
      setBuyQuantity("4");
      setRewardQuantity(
        "1",
      );
      setRewardMode("free");
      setRewardPercent(
        "50",
      );
      setRewardPrice("10");
      setRewardSelectionMode(
        "cheapest",
      );
      setPercentOff("10");
      setBundleQuantity(
        "3",
      );
      setBundlePrice(
        "100",
      );
      setRepeatable(true);
      setMaxApplications(
        "",
      );
      setStackWithOtherPromotions(
        false,
      );
      setStackWithDiscountCodes(
        false,
      );
      setStackWithShippingPromotion(
        true,
      );
      setPriority("100");
      setStartDate("");
      setEndDate("");
      setQualifyingIds(
        new Set(),
      );
      setSeparateRewardPool(
        false,
      );
      setRewardIds(
        new Set(),
      );
      setExcludedIds(
        new Set(),
      );
    }, []);

  const editPromotion =
    (
      row: PromotionRow,
    ) => {
      setEditingId(
        row.id,
      );
      setName(row.name);
      setPublicLabel(
        row.publicLabel,
      );
      setDescription(
        row.description ??
          "",
      );
      setKind(row.kind);
      setScope(row.scope);
      setChannel(
        row.channel,
      );
      setStatus(
        row.status,
      );
      setBuyQuantity(
        String(
          row.buyQuantity ??
            4,
        ),
      );
      setRewardQuantity(
        String(
          row.rewardQuantity ??
            1,
        ),
      );
      setRewardMode(
        row.rewardMode ??
          "free",
      );
      setRewardPercent(
        String(
          row.rewardPercent ??
            50,
        ),
      );
      setRewardPrice(
        minorToMoney(
          row.rewardPriceMinor,
        ) || "10",
      );
      setRewardSelectionMode(
        row.rewardSelectionMode ??
          "cheapest",
      );
      setPercentOff(
        String(
          row.percentOff ??
            10,
        ),
      );
      setBundleQuantity(
        String(
          row.bundleQuantity ??
            3,
        ),
      );
      setBundlePrice(
        minorToMoney(
          row.bundlePriceMinor,
        ) || "100",
      );
      setRepeatable(
        row.repeatable,
      );
      setMaxApplications(
        row.maxApplicationsPerOrder
          ? String(
              row.maxApplicationsPerOrder,
            )
          : "",
      );
      setStackWithOtherPromotions(
        row.stackWithOtherPromotions,
      );
      setStackWithDiscountCodes(
        row.stackWithDiscountCodes,
      );
      setStackWithShippingPromotion(
        row.stackWithShippingPromotion,
      );
      setPriority(
        String(
          row.priority,
        ),
      );
      setStartDate(
        isoDateOnly(
          row.startsAt,
        ),
      );
      setEndDate(
        isoDateOnly(
          row.endsAt,
        ),
      );
      setQualifyingIds(
        new Set(
          row.qualifyingProductIds,
        ),
      );
      setSeparateRewardPool(
        row.rewardProductIds
          .length > 0,
      );
      setRewardIds(
        new Set(
          row.rewardProductIds,
        ),
      );
      setExcludedIds(
        new Set(
          row.excludedProductIds,
        ),
      );
    };

  const payload = () => {
    const cleanName =
      name.trim();
    const cleanLabel =
      publicLabel.trim();

    if (
      !cleanName ||
      !cleanLabel
    ) {
      throw new Error(
        "اسم العرض والنص الظاهر للزبون مطلوبان",
      );
    }

    const parsedPriority =
      Number(priority);

    if (
      !Number.isSafeInteger(
        parsedPriority,
      ) ||
      parsedPriority < 0
    ) {
      throw new Error(
        "أولوية العرض غير صالحة",
      );
    }

    const parsedMax =
      maxApplications.trim()
        ? Number(
            maxApplications,
          )
        : null;

    if (
      parsedMax !== null &&
      (
        !Number.isSafeInteger(
          parsedMax,
        ) ||
        parsedMax <= 0
      )
    ) {
      throw new Error(
        "الحد الأقصى للتكرار غير صالح",
      );
    }

    const body: Record<
      string,
      unknown
    > = {
      name: cleanName,
      publicLabel:
        cleanLabel,
      description:
        description.trim() ||
        null,
      kind,
      scope,
      channel,
      status,
      repeatable,
      maxApplicationsPerOrder:
        parsedMax,
      stackWithOtherPromotions,
      stackWithDiscountCodes,
      stackWithShippingPromotion,
      priority:
        parsedPriority,
      startsAt:
        localDateIso(
          startDate,
          false,
        ),
      endsAt:
        localDateIso(
          endDate,
          true,
        ),
      qualifyingProductIds:
        scope ===
        "selected_products"
          ? [
              ...qualifyingIds,
            ]
          : [],
      rewardProductIds:
        separateRewardPool
          ? [
              ...rewardIds,
            ]
          : [],
      excludedProductIds:
        scope ===
        "all_products"
          ? [
              ...excludedIds,
            ]
          : [],
      rewardSelectionMode,
    };

    if (
      kind ===
      "buy_x_get_y"
    ) {
      body.buyQuantity =
        numberInput(
          buyQuantity,
          0,
        );
      body.rewardQuantity =
        numberInput(
          rewardQuantity,
          0,
        );
      body.rewardMode =
        rewardMode;

      if (
        body.buyQuantity ===
          0 ||
        body.rewardQuantity ===
          0
      ) {
        throw new Error(
          "كميات العرض غير صالحة",
        );
      }

      if (
        rewardMode ===
        "percent_off"
      ) {
        const value =
          Number(
            rewardPercent,
          );

        if (
          !Number.isSafeInteger(
            value,
          ) ||
          value < 1 ||
          value > 100
        ) {
          throw new Error(
            "نسبة خصم المكافأة يجب أن تكون بين 1 و100",
          );
        }

        body.rewardPercent =
          value;
      }

      if (
        rewardMode ===
        "fixed_price"
      ) {
        const value =
          moneyInputToMinor(
            rewardPrice,
          );

        if (
          value === null
        ) {
          throw new Error(
            "سعر المكافأة غير صالح",
          );
        }

        body.rewardPriceMinor =
          value;
      }
    }

    if (
      kind ===
      "percent_off"
    ) {
      const value =
        Number(
          percentOff,
        );

      if (
        !Number.isSafeInteger(
          value,
        ) ||
        value < 1 ||
        value > 100
      ) {
        throw new Error(
          "نسبة الخصم يجب أن تكون بين 1 و100",
        );
      }

      body.percentOff =
        value;
    }

    if (
      kind ===
      "bundle_price"
    ) {
      const quantity =
        Number(
          bundleQuantity,
        );
      const priceMinor =
        moneyInputToMinor(
          bundlePrice,
        );

      if (
        !Number.isSafeInteger(
          quantity,
        ) ||
        quantity < 2 ||
        priceMinor === null
      ) {
        throw new Error(
          "إعدادات سعر الباكج غير صالحة",
        );
      }

      body.bundleQuantity =
        quantity;
      body.bundlePriceMinor =
        priceMinor;
    }

    return body;
  };

  const save =
    async () => {
      setSaving(true);

      try {
        const body =
          payload();

        const response =
          await authorizedFetch(
            editingId ===
            null
              ? "/api/admin/promotions"
              : `/api/admin/promotions/${editingId}`,
            {
              method:
                editingId ===
                null
                  ? "POST"
                  : "PATCH",
              body:
                JSON.stringify(
                  body,
                ),
            },
          );

        const data =
          (await response
            .json()
            .catch(
              () => ({}),
            )) as {
            error?: string;
            conflict?: {
              productName?: string;
              promotionName?: string;
            };
          };

        if (
          !response.ok
        ) {
          throw new Error(
            data.error ||
              (
                data.conflict
                  ? `الصنف ${data.conflict.productName ?? ""} موجود ضمن ${data.conflict.promotionName ?? "عرض آخر"}`
                  : "تعذر حفظ العرض"
              ),
          );
        }

        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );

        resetEditor();
        await loadPromotions();

        Alert.alert(
          "تم",
          "تم حفظ العرض بنجاح.",
        );
      } catch (error) {
        Alert.alert(
          "تعذر حفظ العرض",
          error instanceof
              Error
            ? error.message
            : "حدث خطأ غير متوقع",
        );
      } finally {
        setSaving(false);
      }
    };

  const archive =
    async (
      row: PromotionRow,
    ) => {
      try {
        const response =
          await authorizedFetch(
            `/api/admin/promotions/${row.id}`,
            {
              method:
                "PATCH",
              body:
                JSON.stringify({
                  name: row.name,
                  publicLabel:
                    row.publicLabel,
                  description:
                    row.description,
                  kind: row.kind,
                  scope: row.scope,
                  channel:
                    row.channel,
                  status:
                    "archived",
                  buyQuantity:
                    row.buyQuantity,
                  rewardQuantity:
                    row.rewardQuantity,
                  rewardMode:
                    row.rewardMode,
                  rewardPercent:
                    row.rewardPercent,
                  rewardPriceMinor:
                    row.rewardPriceMinor,
                  rewardSelectionMode:
                    row.rewardSelectionMode,
                  percentOff:
                    row.percentOff,
                  bundleQuantity:
                    row.bundleQuantity,
                  bundlePriceMinor:
                    row.bundlePriceMinor,
                  repeatable:
                    row.repeatable,
                  maxApplicationsPerOrder:
                    row.maxApplicationsPerOrder,
                  stackWithOtherPromotions:
                    row.stackWithOtherPromotions,
                  stackWithDiscountCodes:
                    row.stackWithDiscountCodes,
                  stackWithShippingPromotion:
                    row.stackWithShippingPromotion,
                  priority:
                    row.priority,
                  startsAt:
                    row.startsAt,
                  endsAt:
                    row.endsAt,
                  qualifyingProductIds:
                    row.qualifyingProductIds,
                  rewardProductIds:
                    row.rewardProductIds,
                  excludedProductIds:
                    row.excludedProductIds,
                }),
            },
          );

        const data =
          (await response
            .json()
            .catch(
              () => ({}),
            )) as {
            error?: string;
          };

        if (
          !response.ok
        ) {
          throw new Error(
            data.error ||
              "تعذر أرشفة العرض",
          );
        }

        if (
          editingId ===
          row.id
        ) {
          resetEditor();
        }

        await loadPromotions();
      } catch (error) {
        Alert.alert(
          "العروض",
          error instanceof
              Error
            ? error.message
            : "تعذر أرشفة العرض",
        );
      }
    };

  const remove =
    async (
      row: PromotionRow,
    ) => {
      const perform =
        async () => {
          try {
            const response =
              await authorizedFetch(
                `/api/admin/promotions/${row.id}`,
                {
                  method:
                    "DELETE",
                },
              );

            const data =
              (await response
                .json()
                .catch(
                  () => ({}),
                )) as {
                error?: string;
              };

            if (
              !response.ok
            ) {
              throw new Error(
                data.error ||
                  "تعذر حذف العرض",
              );
            }

            if (
              editingId ===
              row.id
            ) {
              resetEditor();
            }

            await loadPromotions();
          } catch (error) {
            Alert.alert(
              "العروض",
              error instanceof
                  Error
                ? error.message
                : "تعذر حذف العرض",
            );
          }
        };

      if (
        Platform.OS ===
        "web"
      ) {
        if (
          window.confirm(
            `حذف العرض "${row.name}"؟`,
          )
        ) {
          await perform();
        }

        return;
      }

      Alert.alert(
        "حذف العرض",
        `حذف "${row.name}"؟`,
        [
          {
            text: "إلغاء",
            style: "cancel",
          },
          {
            text: "حذف",
            style:
              "destructive",
            onPress: () => {
              void perform();
            },
          },
        ],
      );
    };

  const topPadding =
    getResponsiveTopPadding(
      insets.top,
    );

  if (
    user &&
    !user.isAdmin
  ) {
    return (
      <View
        style={[
          styles.center,
          {
            backgroundColor:
              colors.background,
          },
        ]}
      >
        <Text
          style={{
            color:
              colors.foreground,
          }}
        >
          هذه الصفحة متاحة للإدارة فقط.
        </Text>
      </View>
    );
  }

  function ProductSelector({
    title,
    hint,
    selected,
    onChange,
  }: ProductSelectorProps) {
    const [query, setQuery] =
      useState("");

    const [
      category,
      setCategory,
    ] = useState("all");

    const categories =
      useMemo(
        () => [
          "all",
          ...[
            ...new Set(
              products
                .filter(
                  (product) =>
                    !product.deletedAt,
                )
                .map(
                  (product) =>
                    product.category,
                )
                .filter(
                  (value) =>
                    Boolean(value),
                ),
            ),
          ].sort(),
        ],
        [products],
      );

    const matching =
      useMemo(() => {
        const q =
          query
            .trim()
            .toLowerCase();

        return products
          .filter(
            (product) =>
              !product.deletedAt,
          )
          .filter(
            (product) =>
              category ===
                "all" ||
              product.category ===
                category,
          )
          .filter(
            (product) =>
              !q ||
              product.nameAr
                .toLowerCase()
                .includes(q) ||
              (
                product.productCode ??
                ""
              )
                .toLowerCase()
                .includes(q) ||
              (
                product.barcode ??
                ""
              )
                .toLowerCase()
                .includes(q),
          );
      }, [
        query,
        category,
        products,
      ]);

    const visible =
      useMemo(
        () =>
          matching.slice(
            0,
            120,
          ),
        [matching],
      );

    const toggle = (
      id: number,
    ) => {
      const next =
        new Set(selected);

      if (
        next.has(id)
      ) {
        next.delete(id);
      } else {
        next.add(id);
      }

      onChange(next);
    };

    return (
      <View
        style={[
          styles.selector,
          {
            borderColor:
              colors.border,
            backgroundColor:
              colors.card,
          },
        ]}
      >
        <Text
          style={[
            styles.sectionTitle,
            {
              color:
                colors.foreground,
            },
          ]}
        >
          {title} ({selected.size})
        </Text>

        {hint ? (
          <Text
            style={[
              styles.hint,
              {
                color:
                  colors.mutedForeground,
              },
            ]}
          >
            {hint}
          </Text>
        ) : null}

        <TextInput
          value={query}
          onChangeText={
            setQuery
          }
          placeholder="ابحث بالاسم أو الكود أو الباركود"
          placeholderTextColor={
            colors.mutedForeground
          }
          style={[
            styles.input,
            {
              backgroundColor:
                colors.input,
              borderColor:
                colors.border,
              color:
                colors.foreground,
            },
          ]}
          textAlign="right"
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            gap: 8,
            paddingVertical: 4,
          }}
        >
          {categories.map((value) => {
            const active = category === value;

            return (
              <Pressable
                key={value}
                onPress={() => setCategory(value)}
                style={{
                  borderWidth: 1,
                  borderColor: active ? colors.primary : colors.border,
                  backgroundColor: active ? colors.primary + "12" : colors.background,
                  borderRadius: 999,
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                }}
              >
                <Text
                  style={{
                    color: active ? colors.primary : colors.foreground,
                    fontWeight: active ? "800" : "600",
                    fontSize: 12,
                  }}
                >
                  {value === "all"
                    ? "كل الأقسام"
                    : DEFAULT_CATEGORY_LABELS[value] ?? value}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Text
          style={{
            color: colors.mutedForeground,
            fontSize: 11,
            textAlign: "right",
          }}
        >
          {category === "all"
            ? "النتائج المطابقة: " + matching.length
            : "قسم " + (DEFAULT_CATEGORY_LABELS[category] ?? category) + " · " + matching.length + " صنف"}
        </Text>

        <View
          style={
            styles.inlineActions
          }
        >
          <Pressable
            onPress={() => {
              const next =
                new Set(
                  selected,
                );

              matching.forEach(
                (product) => {
                  const id =
                    Number(
                      product.id,
                    );

                  if (
                    Number.isSafeInteger(
                      id,
                    )
                  ) {
                    next.add(id);
                  }
                },
              );

              onChange(next);
            }}
          >
            <Text
              style={{
                color:
                  colors.primary,
                fontWeight:
                  "800",
              }}
            >
              تحديد النتائج
            </Text>
          </Pressable>

          <Pressable
            onPress={() => {
              const next =
                new Set(
                  selected,
                );

              matching.forEach(
                (product) =>
                  next.delete(
                    Number(
                      product.id,
                    ),
                  ),
              );

              onChange(next);
            }}
          >
            <Text
              style={{
                color:
                  "#DC2626",
                fontWeight:
                  "800",
              }}
            >
              إلغاء النتائج
            </Text>
          </Pressable>
        </View>

        <ScrollView
          nestedScrollEnabled
          style={{
            maxHeight: 330,
          }}
        >
          {visible.map(
            (product) => {
              const id =
                Number(
                  product.id,
                );

              const active =
                selected.has(
                  id,
                );

              return (
                <Pressable
                  key={
                    product.id
                  }
                  onPress={() =>
                    toggle(id)
                  }
                  style={[
                    styles.productRow,
                    {
                      borderBottomColor:
                        colors.border,
                      backgroundColor:
                        active
                          ? colors.primary +
                            "10"
                          : "transparent",
                    },
                  ]}
                >
                  <Ionicons
                    name={
                      active
                        ? "checkbox"
                        : "square-outline"
                    }
                    size={21}
                    color={
                      active
                        ? colors.primary
                        : colors.mutedForeground
                    }
                  />

                  <View
                    style={{
                      flex: 1,
                    }}
                  >
                    <Text
                      style={{
                        color:
                          colors.foreground,
                        fontWeight:
                          "700",
                        textAlign:
                          "right",
                      }}
                    >
                      {
                        product.nameAr
                      }
                    </Text>

                    <Text
                      style={{
                        color:
                          colors.mutedForeground,
                        fontSize:
                          11,
                        textAlign:
                          "right",
                      }}
                    >
                      {product.productCode ||
                        product.barcode ||
                        `#${product.id}`}
                    </Text>
                  </View>
                </Pressable>
              );
            },
          )}
        </ScrollView>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor:
            colors.background,
        },
      ]}
    >
      <View
        style={[
          styles.header,
          {
            paddingTop:
              topPadding + 12,
            backgroundColor:
              colors.primary,
          },
        ]}
      >
        <Pressable
          onPress={() =>
            router.back()
          }
        >
          <Ionicons
            name="arrow-forward"
            size={24}
            color="#fff"
          />
        </Pressable>

        <Text
          style={
            styles.headerTitle
          }
        >
          عروض الكمية والخصومات
        </Text>

        <Pressable
          onPress={
            resetEditor
          }
        >
          <Ionicons
            name="add-circle-outline"
            size={26}
            color="#fff"
          />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: 14,
          paddingBottom:
            insets.bottom +
            40,
          gap: 14,
          maxWidth: 1100,
          width: "100%",
          alignSelf:
            "center",
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            styles.card,
            {
              backgroundColor:
                colors.card,
              borderColor:
                colors.border,
            },
          ]}
        >
          <Text
            style={[
              styles.cardTitle,
              {
                color:
                  colors.foreground,
              },
            ]}
          >
            {editingId
              ? `تعديل العرض #${editingId}`
              : "إضافة عرض جديد"}
          </Text>

          <TextInput
            value={name}
            onChangeText={
              setName
            }
            placeholder="اسم داخلي: أفرهولات نيو بورن"
            placeholderTextColor={
              colors.mutedForeground
            }
            style={[
              styles.input,
              {
                backgroundColor:
                  colors.input,
                borderColor:
                  colors.border,
                color:
                  colors.foreground,
              },
            ]}
            textAlign="right"
          />

          <TextInput
            value={
              publicLabel
            }
            onChangeText={
              setPublicLabel
            }
            placeholder="النص الظاهر: عرض 4+1"
            placeholderTextColor={
              colors.mutedForeground
            }
            style={[
              styles.input,
              {
                backgroundColor:
                  colors.input,
                borderColor:
                  colors.border,
                color:
                  colors.foreground,
              },
            ]}
            textAlign="right"
          />

          <TextInput
            value={
              description
            }
            onChangeText={
              setDescription
            }
            placeholder="وصف مختصر للعرض (اختياري)"
            placeholderTextColor={
              colors.mutedForeground
            }
            style={[
              styles.input,
              {
                backgroundColor:
                  colors.input,
                borderColor:
                  colors.border,
                color:
                  colors.foreground,
                minHeight: 74,
              },
            ]}
            multiline
            textAlign="right"
          />

          <Text
            style={[
              styles.label,
              {
                color:
                  colors.mutedForeground,
              },
            ]}
          >
            نوع العرض
          </Text>

          <View
            style={
              styles.chipRow
            }
          >
            {([
              [
                "buy_x_get_y",
                "اشتري X وخذ Y",
              ],
              [
                "percent_off",
                "خصم نسبة",
              ],
              [
                "bundle_price",
                "سعر باكج",
              ],
            ] as const).map(
              ([
                value,
                label,
              ]) => (
                <ChoiceChip
                  key={
                    value
                  }
                  label={
                    label
                  }
                  selected={
                    kind ===
                    value
                  }
                  onPress={() =>
                    setKind(
                      value,
                    )
                  }
                  colors={
                    colors
                  }
                />
              ),
            )}
          </View>

          {kind ===
          "buy_x_get_y" ? (
            <>
              <View
                style={
                  styles.twoColumns
                }
              >
                <NumberField
                  label="اشتري X"
                  value={
                    buyQuantity
                  }
                  onChange={
                    setBuyQuantity
                  }
                  colors={
                    colors
                  }
                />

                <NumberField
                  label="احصل على Y"
                  value={
                    rewardQuantity
                  }
                  onChange={
                    setRewardQuantity
                  }
                  colors={
                    colors
                  }
                />
              </View>

              <Text
                style={[
                  styles.label,
                  {
                    color:
                      colors.mutedForeground,
                  },
                ]}
              >
                نوع المكافأة
              </Text>

              <View
                style={
                  styles.chipRow
                }
              >
                {([
                  [
                    "free",
                    "مجاني",
                  ],
                  [
                    "percent_off",
                    "خصم نسبة",
                  ],
                  [
                    "fixed_price",
                    "سعر نهائي",
                  ],
                ] as const).map(
                  ([
                    value,
                    label,
                  ]) => (
                    <ChoiceChip
                      key={
                        value
                      }
                      label={
                        label
                      }
                      selected={
                        rewardMode ===
                        value
                      }
                      onPress={() =>
                        setRewardMode(
                          value,
                        )
                      }
                      colors={
                        colors
                      }
                    />
                  ),
                )}
              </View>

              {rewardMode ===
              "percent_off" ? (
                <NumberField
                  label="نسبة خصم المكافأة %"
                  value={
                    rewardPercent
                  }
                  onChange={
                    setRewardPercent
                  }
                  colors={
                    colors
                  }
                />
              ) : null}

              {rewardMode ===
              "fixed_price" ? (
                <NumberField
                  label="السعر النهائي للمكافأة ₪"
                  value={
                    rewardPrice
                  }
                  onChange={
                    setRewardPrice
                  }
                  colors={
                    colors
                  }
                  decimal
                />
              ) : null}

              <Text
                style={[
                  styles.label,
                  {
                    color:
                      colors.mutedForeground,
                  },
                ]}
              >
                اختيار المكافأة
              </Text>

              <View
                style={
                  styles.chipRow
                }
              >
                <ChoiceChip
                  label="الأرخص تلقائيًا"
                  selected={
                    rewardSelectionMode ===
                    "cheapest"
                  }
                  onPress={() =>
                    setRewardSelectionMode(
                      "cheapest",
                    )
                  }
                  colors={
                    colors
                  }
                />

                <ChoiceChip
                  label="الزبون يختار"
                  selected={
                    rewardSelectionMode ===
                    "customer_choice"
                  }
                  onPress={() =>
                    setRewardSelectionMode(
                      "customer_choice",
                    )
                  }
                  colors={
                    colors
                  }
                />
              </View>
            </>
          ) : null}

          {kind ===
          "percent_off" ? (
            <NumberField
              label="نسبة الخصم %"
              value={
                percentOff
              }
              onChange={
                setPercentOff
              }
              colors={
                colors
              }
            />
          ) : null}

          {kind ===
          "bundle_price" ? (
            <View
              style={
                styles.twoColumns
              }
            >
              <NumberField
                label="عدد القطع"
                value={
                  bundleQuantity
                }
                onChange={
                  setBundleQuantity
                }
                colors={
                  colors
                }
              />

              <NumberField
                label="سعر الباكج ₪"
                value={
                  bundlePrice
                }
                onChange={
                  setBundlePrice
                }
                colors={
                  colors
                }
                decimal
              />
            </View>
          ) : null}

          <Text
            style={[
              styles.label,
              {
                color:
                  colors.mutedForeground,
              },
            ]}
          >
            نطاق الأصناف
          </Text>

          <View
            style={
              styles.chipRow
            }
          >
            <ChoiceChip
              label="أصناف محددة"
              selected={
                scope ===
                "selected_products"
              }
              onPress={() =>
                setScope(
                  "selected_products",
                )
              }
              colors={
                colors
              }
            />
            <ChoiceChip
              label="كل الأصناف"
              selected={
                scope ===
                "all_products"
              }
              onPress={() =>
                setScope(
                  "all_products",
                )
              }
              colors={
                colors
              }
            />
          </View>

          <Text
            style={[
              styles.label,
              {
                color:
                  colors.mutedForeground,
              },
            ]}
          >
            القناة
          </Text>

          <View
            style={
              styles.chipRow
            }
          >
            {([
              [
                "both",
                "المتجر + POS",
              ],
              [
                "web",
                "المتجر فقط",
              ],
              [
                "pos",
                "POS فقط",
              ],
            ] as const).map(
              ([
                value,
                label,
              ]) => (
                <ChoiceChip
                  key={
                    value
                  }
                  label={
                    label
                  }
                  selected={
                    channel ===
                    value
                  }
                  onPress={() =>
                    setChannel(
                      value,
                    )
                  }
                  colors={
                    colors
                  }
                />
              ),
            )}
          </View>

          <View
            style={
              styles.twoColumns
            }
          >
            <DateField
              label="بداية العرض"
              value={
                startDate
              }
              onChange={
                setStartDate
              }
              colors={
                colors
              }
            />

            <DateField
              label="نهاية العرض"
              value={
                endDate
              }
              onChange={
                setEndDate
              }
              colors={
                colors
              }
            />
          </View>

          <Text
            style={[
              styles.label,
              {
                color:
                  colors.mutedForeground,
              },
            ]}
          >
            الحالة
          </Text>

          <View
            style={
              styles.chipRow
            }
          >
            <ChoiceChip
              label="مسودة"
              selected={
                status ===
                "draft"
              }
              onPress={() =>
                setStatus(
                  "draft",
                )
              }
              colors={
                colors
              }
            />
            <ChoiceChip
              label="فعال"
              selected={
                status ===
                "active"
              }
              onPress={() =>
                setStatus(
                  "active",
                )
              }
              colors={
                colors
              }
            />
          </View>

          <SettingSwitch
            label="يتكرر تلقائيًا"
            hint="مثال: 4+1 يصبح 8+2 إذا توفرت الكمية."
            value={
              repeatable
            }
            onChange={
              setRepeatable
            }
            colors={
              colors
            }
          />

          {repeatable ? (
            <NumberField
              label="أقصى عدد مرات في الفاتورة (فارغ = بلا حد)"
              value={
                maxApplications
              }
              onChange={
                setMaxApplications
              }
              colors={
                colors
              }
            />
          ) : null}

          <SettingSwitch
            label="يسمح بالجمع مع عروض أخرى"
            hint="مفيد للخصم العام؛ عروض الأصناف تبقى محمية من التعارض."
            value={
              stackWithOtherPromotions
            }
            onChange={
              setStackWithOtherPromotions
            }
            colors={
              colors
            }
          />

          <SettingSwitch
            label="يسمح بكود خصم"
            value={
              stackWithDiscountCodes
            }
            onChange={
              setStackWithDiscountCodes
            }
            colors={
              colors
            }
          />

          <SettingSwitch
            label="يسمح بعرض التوصيل"
            value={
              stackWithShippingPromotion
            }
            onChange={
              setStackWithShippingPromotion
            }
            colors={
              colors
            }
          />

          <NumberField
            label="الأولوية (الأعلى يطبق أولًا)"
            value={
              priority
            }
            onChange={
              setPriority
            }
            colors={
              colors
            }
          />
        </View>

        {scope ===
        "selected_products" ? (
          <>
            <ProductSelector
              title="الأصناف المؤهلة للعرض"
              hint="أي صنف تختاره هنا لا يمكن إدخاله في عرض أصناف آخر بفترة متداخلة."
              selected={
                qualifyingIds
              }
              onChange={
                setQualifyingIds
              }
            />

            {kind ===
            "buy_x_get_y" ? (
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor:
                      colors.card,
                    borderColor:
                      colors.border,
                  },
                ]}
              >
                <SettingSwitch
                  label="مجموعة مكافآت مختلفة"
                  hint="اتركه مغلقًا إذا كانت الهدية/المكافأة من نفس أصناف العرض."
                  value={
                    separateRewardPool
                  }
                  onChange={
                    setSeparateRewardPool
                  }
                  colors={
                    colors
                  }
                />
              </View>
            ) : null}

            {kind ===
              "buy_x_get_y" &&
            separateRewardPool ? (
              <ProductSelector
                title="أصناف المكافأة"
                hint="مثال: اشترِ الصنف A واحصل على B بسعر خاص."
                selected={
                  rewardIds
                }
                onChange={
                  setRewardIds
                }
              />
            ) : null}
          </>
        ) : (
          <ProductSelector
            title="استثناءات من العرض العام"
            hint="اختياري: الأصناف هنا لا تحصل على الخصم العام."
            selected={
              excludedIds
            }
            onChange={
              setExcludedIds
            }
          />
        )}

        <View
          style={
            styles.saveActions
          }
        >
          <Pressable
            onPress={() =>
              void save()
            }
            disabled={
              saving
            }
            style={[
              styles.saveButton,
              {
                backgroundColor:
                  colors.primary,
                opacity:
                  saving
                    ? 0.7
                    : 1,
              },
            ]}
          >
            {saving ? (
              <ActivityIndicator
                color="#fff"
              />
            ) : (
              <Text
                style={
                  styles.saveButtonText
                }
              >
                {editingId
                  ? "حفظ التعديلات"
                  : "إنشاء العرض"}
              </Text>
            )}
          </Pressable>

          {editingId ? (
            <Pressable
              onPress={
                resetEditor
              }
              style={[
                styles.secondaryButton,
                {
                  borderColor:
                    colors.border,
                },
              ]}
            >
              <Text
                style={{
                  color:
                    colors.foreground,
                  fontWeight:
                    "800",
                }}
              >
                إلغاء التعديل
              </Text>
            </Pressable>
          ) : null}
        </View>

        <Text
          style={[
            styles.listTitle,
            {
              color:
                colors.foreground,
            },
          ]}
        >
          العروض الحالية
        </Text>

        {loading ? (
          <ActivityIndicator
            color={
              colors.primary
            }
          />
        ) : promotions.length ===
          0 ? (
          <Text
            style={{
              color:
                colors.mutedForeground,
              textAlign:
                "center",
            }}
          >
            لا توجد عروض بعد.
          </Text>
        ) : (
          promotions.map(
            (row) => (
              <View
                key={row.id}
                style={[
                  styles.promotionRow,
                  {
                    backgroundColor:
                      colors.card,
                    borderColor:
                      colors.border,
                  },
                ]}
              >
                <View
                  style={{
                    flex: 1,
                    gap: 4,
                  }}
                >
                  <Text
                    style={{
                      color:
                        colors.foreground,
                      fontWeight:
                        "900",
                      textAlign:
                        "right",
                      fontSize:
                        15,
                    }}
                  >
                    {row.publicLabel}
                  </Text>

                  <Text
                    style={{
                      color:
                        colors.mutedForeground,
                      textAlign:
                        "right",
                      fontSize:
                        12,
                    }}
                  >
                    {row.name} · {humanKind(row)} · {row.channel}
                  </Text>

                  <Text
                    style={{
                      color:
                        row.status ===
                        "active"
                          ? "#16A34A"
                          : row.status ===
                              "archived"
                            ? "#64748B"
                            : "#D97706",
                      fontWeight:
                        "800",
                      textAlign:
                        "right",
                      fontSize:
                        12,
                    }}
                  >
                    {row.status ===
                    "active"
                      ? "فعال"
                      : row.status ===
                          "archived"
                        ? "مؤرشف"
                        : "مسودة"}
                    {" · "}
                    {row.scope ===
                    "all_products"
                      ? `كل الأصناف - ${row.excludedProductIds.length} مستثنى`
                      : `${row.qualifyingProductIds.length} صنف مشارك`}
                  </Text>
                </View>

                <View
                  style={
                    styles.rowActions
                  }
                >
                  {row.status !==
                  "archived" ? (
                    <Pressable
                      onPress={() =>
                        editPromotion(
                          row,
                        )
                      }
                      style={[
                        styles.iconButton,
                        {
                          borderColor:
                            colors.primary +
                            "55",
                        },
                      ]}
                    >
                      <Ionicons
                        name="create-outline"
                        size={19}
                        color={
                          colors.primary
                        }
                      />
                    </Pressable>
                  ) : null}

                  {row.status !==
                  "archived" ? (
                    <Pressable
                      onPress={() =>
                        void archive(
                          row,
                        )
                      }
                      style={[
                        styles.iconButton,
                        {
                          borderColor:
                            "#D97706",
                        },
                      ]}
                    >
                      <Ionicons
                        name="archive-outline"
                        size={19}
                        color="#D97706"
                      />
                    </Pressable>
                  ) : null}

                  <Pressable
                    onPress={() =>
                      void remove(
                        row,
                      )
                    }
                    style={[
                      styles.iconButton,
                      {
                        borderColor:
                          "#DC2626",
                      },
                    ]}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={19}
                      color="#DC2626"
                    />
                  </Pressable>
                </View>
              </View>
            ),
          )
        )}
      </ScrollView>
    </View>
  );
}

function ChoiceChip({
  label,
  selected,
  onPress,
  colors,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  colors: ReturnType<
    typeof useColors
  >;
}) {
  return (
    <Pressable
      onPress={
        onPress
      }
      style={[
        styles.choiceChip,
        {
          backgroundColor:
            selected
              ? colors.primary
              : colors.input,
          borderColor:
            selected
              ? colors.primary
              : colors.border,
        },
      ]}
    >
      <Text
        style={{
          color:
            selected
              ? "#fff"
              : colors.foreground,
          fontWeight:
            "800",
          fontSize: 12,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function NumberField({
  label,
  value,
  onChange,
  colors,
  decimal = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  colors: ReturnType<
    typeof useColors
  >;
  decimal?: boolean;
}) {
  return (
    <View
      style={{
        flex: 1,
        minWidth: 160,
        gap: 7,
      }}
    >
      <Text
        style={[
          styles.label,
          {
            color:
              colors.mutedForeground,
          },
        ]}
      >
        {label}
      </Text>

      <TextInput
        value={
          value
        }
        onChangeText={
          onChange
        }
        keyboardType={
          decimal
            ? "decimal-pad"
            : "number-pad"
        }
        style={[
          styles.input,
          {
            backgroundColor:
              colors.input,
            borderColor:
              colors.border,
            color:
              colors.foreground,
          },
        ]}
        textAlign="right"
      />
    </View>
  );
}

function SettingSwitch({
  label,
  hint,
  value,
  onChange,
  colors,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  colors: ReturnType<
    typeof useColors
  >;
}) {
  return (
    <View
      style={
        styles.switchRow
      }
    >
      <Switch
        value={value}
        onValueChange={
          onChange
        }
        trackColor={{
          false:
            colors.border,
          true:
            colors.primary,
        }}
      />

      <View
        style={{
          flex: 1,
        }}
      >
        <Text
          style={{
            color:
              colors.foreground,
            fontWeight:
              "800",
            textAlign:
              "right",
          }}
        >
          {label}
        </Text>

        {hint ? (
          <Text
            style={[
              styles.hint,
              {
                color:
                  colors.mutedForeground,
              },
            ]}
          >
            {hint}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles =
  StyleSheet.create({
    container: {
      flex: 1,
    },
    center: {
      flex: 1,
      alignItems:
        "center",
      justifyContent:
        "center",
      padding: 24,
    },
    header: {
      minHeight: 72,
      paddingHorizontal:
        16,
      paddingBottom: 13,
      flexDirection:
        "row-reverse",
      alignItems: "center",
      justifyContent:
        "space-between",
    },
    headerTitle: {
      color: "#fff",
      fontSize: 18,
      fontWeight: "900",
      textAlign:
        "center",
    },
    card: {
      borderWidth: 1,
      borderRadius: 16,
      padding: 14,
      gap: 12,
    },
    cardTitle: {
      fontSize: 17,
      fontWeight: "900",
      textAlign:
        "right",
    },
    sectionTitle: {
      fontSize: 15,
      fontWeight: "900",
      textAlign:
        "right",
    },
    label: {
      fontSize: 12,
      fontWeight: "700",
      textAlign:
        "right",
    },
    hint: {
      fontSize: 11,
      lineHeight: 17,
      textAlign:
        "right",
    },
    input: {
      minHeight: 46,
      borderWidth: 1,
      borderRadius: 11,
      paddingHorizontal:
        12,
      fontSize: 14,
    },
    chipRow: {
      flexDirection:
        "row-reverse",
      flexWrap: "wrap",
      gap: 8,
    },
    choiceChip: {
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal:
        12,
      paddingVertical: 8,
    },
    twoColumns: {
      flexDirection:
        "row-reverse",
      flexWrap: "wrap",
      gap: 10,
    },
    switchRow: {
      flexDirection:
        "row-reverse",
      alignItems:
        "center",
      gap: 10,
    },
    selector: {
      borderWidth: 1,
      borderRadius: 16,
      padding: 12,
      gap: 10,
    },
    inlineActions: {
      flexDirection:
        "row-reverse",
      justifyContent:
        "space-between",
      gap: 12,
    },
    productRow: {
      flexDirection:
        "row-reverse",
      alignItems:
        "center",
      gap: 10,
      paddingVertical:
        9,
      paddingHorizontal:
        4,
      borderBottomWidth:
        StyleSheet.hairlineWidth,
    },
    saveActions: {
      flexDirection:
        "row-reverse",
      gap: 10,
      flexWrap: "wrap",
    },
    saveButton: {
      flex: 1,
      minWidth: 180,
      minHeight: 48,
      borderRadius: 12,
      alignItems:
        "center",
      justifyContent:
        "center",
      paddingHorizontal:
        16,
    },
    saveButtonText: {
      color: "#fff",
      fontWeight: "900",
      fontSize: 15,
    },
    secondaryButton: {
      minHeight: 48,
      minWidth: 120,
      borderWidth: 1,
      borderRadius: 12,
      alignItems:
        "center",
      justifyContent:
        "center",
      paddingHorizontal:
        16,
    },
    listTitle: {
      fontSize: 18,
      fontWeight: "900",
      textAlign:
        "right",
      marginTop: 6,
    },
    promotionRow: {
      borderWidth: 1,
      borderRadius: 14,
      padding: 12,
      flexDirection:
        "row-reverse",
      alignItems:
        "center",
      gap: 12,
    },
    rowActions: {
      flexDirection:
        "row",
      gap: 7,
    },
    iconButton: {
      width: 38,
      height: 38,
      borderRadius: 10,
      borderWidth: 1,
      alignItems:
        "center",
      justifyContent:
        "center",
    },
  });
