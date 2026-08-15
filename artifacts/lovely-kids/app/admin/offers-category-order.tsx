import { getResponsiveTopPadding } from "@/utils/webLayout";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppSettings } from "@/context/AppSettingsContext";
import {
  CATEGORY_IDS,
  DEFAULT_CATEGORY_LABELS,
} from "@/data/products";
import { useColors } from "@/hooks/useColors";

export default function OffersCategoryOrderScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings, updateSettings } = useAppSettings();

  const [localOrder, setLocalOrder] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const topPadding = getResponsiveTopPadding(insets.top);
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 20;

  const categories = useMemo(() => {
    const labels = settings.categoryLabels ?? DEFAULT_CATEGORY_LABELS;
    const hidden = settings.hiddenCategories ?? [];
    const custom = settings.customCategories ?? [];

    const ids = [...CATEGORY_IDS, ...custom].filter(
      (id, index, allIds) =>
        id !== "all" &&
        !hidden.includes(id) &&
        allIds.indexOf(id) === index,
    );

    return ids.map((id) => ({
      id,
      label:
        labels[id] ??
        DEFAULT_CATEGORY_LABELS[id] ??
        id,
    }));
  }, [
    settings.categoryLabels,
    settings.customCategories,
    settings.hiddenCategories,
  ]);

  useEffect(() => {
    const availableIds = categories.map((item) => item.id);
    const savedOffersOrder = settings.offersCategoryOrder ?? [];

    // إذا لم يتم حفظ ترتيب خاص للعروض بعد،
    // نبدأ من ترتيب كل المنتجات الحالي حتى لا يتغير الشكل فجأة.
    const baseOrder =
      savedOffersOrder.length > 0
        ? savedOffersOrder
        : settings.categoryOrder ?? [];

    setLocalOrder([
      ...baseOrder.filter((id) => availableIds.includes(id)),
      ...availableIds.filter((id) => !baseOrder.includes(id)),
    ]);

    setSaved(false);
  }, [
    categories,
    settings.categoryOrder,
    settings.offersCategoryOrder,
  ]);

  const orderedCategories = useMemo(() => {
    const byId = new Map(
      categories.map((category) => [category.id, category]),
    );

    return localOrder
      .map((id) => byId.get(id))
      .filter(
        (category): category is NonNullable<typeof category> =>
          !!category,
      );
  }, [categories, localOrder]);

  const moveCategory = (id: string, direction: -1 | 1) => {
    const currentIndex = localOrder.indexOf(id);
    const nextIndex = currentIndex + direction;

    if (
      currentIndex < 0 ||
      nextIndex < 0 ||
      nextIndex >= localOrder.length
    ) {
      return;
    }

    const next = [...localOrder];
    [next[currentIndex], next[nextIndex]] = [
      next[nextIndex],
      next[currentIndex],
    ];

    setLocalOrder(next);
    setSaved(false);
  };

  const saveOrder = async () => {
    setSaving(true);

    const ok = await updateSettings({
      offersCategoryOrder: localOrder,
    });

    setSaving(false);
    setSaved(ok);

    if (ok) {
      setTimeout(() => setSaved(false), 2500);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: bottomPadding }}
      showsVerticalScrollIndicator={false}
    >
      <View
        style={{
          paddingTop: topPadding + 12,
          paddingBottom: 16,
          paddingHorizontal: 18,
          backgroundColor: colors.primary,
          flexDirection: "row-reverse",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons
            name="arrow-forward"
            size={24}
            color="#fff"
          />
        </Pressable>

        <View style={{ alignItems: "center" }}>
          <Text
            style={{
              color: "#fff",
              fontSize: 20,
              fontWeight: "900",
            }}
          >
            ترتيب قسم العروض
          </Text>

          <Text
            style={{
              color: "#fff",
              opacity: 0.85,
              fontSize: 12,
              marginTop: 2,
            }}
          >
            ترتيب مستقل عن كل المنتجات
          </Text>
        </View>

        <View style={{ width: 24 }} />
      </View>

      <View
        style={{
          width: "100%",
          maxWidth: 850,
          alignSelf: "center",
          padding: 18,
          gap: 14,
        }}
      >
        <View
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 16,
            padding: 14,
            flexDirection: "row-reverse",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Ionicons
            name="information-circle-outline"
            size={24}
            color={colors.primary}
          />

          <Text
            style={{
              flex: 1,
              color: colors.mutedForeground,
              fontSize: 13,
              lineHeight: 21,
              textAlign: "right",
            }}
          >
            استخدم الأسهم لترتيب تبويبات وأقسام العروض.
            التصنيف الموجود في الأعلى سيظهر أولاً في قسم العروض،
            ولن يتغير ترتيب قسم كل المنتجات.
          </Text>
        </View>

        <View
          style={{
            flexDirection: "row-reverse",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 4,
          }}
        >
          <Text
            style={{
              color: colors.foreground,
              fontSize: 18,
              fontWeight: "900",
            }}
          >
            ترتيب التبويبات
          </Text>

          <Text
            style={{
              color: colors.mutedForeground,
              fontSize: 12,
            }}
          >
            {orderedCategories.length} تصنيف
          </Text>
        </View>

        {orderedCategories.map((category, index) => (
          <View
            key={category.id}
            style={{
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 16,
              padding: 14,
              flexDirection: "row-reverse",
              alignItems: "center",
              gap: 12,
            }}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                backgroundColor: colors.secondary,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{
                  color: colors.primary,
                  fontWeight: "900",
                  fontSize: 14,
                }}
              >
                {index + 1}
              </Text>
            </View>

            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: colors.foreground,
                  fontSize: 15,
                  fontWeight: "900",
                  textAlign: "right",
                }}
              >
                {category.label}
              </Text>

              <Text
                style={{
                  color: colors.mutedForeground,
                  fontSize: 11,
                  textAlign: "right",
                  marginTop: 2,
                }}
              >
                {index === 0
                  ? "يظهر أولاً في العروض"
                  : `الترتيب رقم ${index + 1}`}
              </Text>
            </View>

            <View
              style={{
                flexDirection: "row",
                gap: 7,
              }}
            >
              <Pressable
                disabled={index === 0}
                onPress={() => moveCategory(category.id, -1)}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 11,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: colors.background,
                  borderWidth: 1,
                  borderColor: colors.border,
                  opacity: index === 0 ? 0.35 : 1,
                }}
              >
                <Ionicons
                  name="arrow-up"
                  size={20}
                  color={colors.primary}
                />
              </Pressable>

              <Pressable
                disabled={index === orderedCategories.length - 1}
                onPress={() => moveCategory(category.id, 1)}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 11,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: colors.background,
                  borderWidth: 1,
                  borderColor: colors.border,
                  opacity:
                    index === orderedCategories.length - 1
                      ? 0.35
                      : 1,
                }}
              >
                <Ionicons
                  name="arrow-down"
                  size={20}
                  color={colors.primary}
                />
              </Pressable>
            </View>
          </View>
        ))}

        <Pressable
          disabled={saving}
          onPress={() => void saveOrder()}
          style={{
            backgroundColor: colors.primary,
            borderRadius: 15,
            paddingVertical: 15,
            alignItems: "center",
            justifyContent: "center",
            marginTop: 8,
            opacity: saving ? 0.65 : 1,
          }}
        >
          <Text
            style={{
              color: "#fff",
              fontSize: 16,
              fontWeight: "900",
            }}
          >
            {saving
              ? "جاري الحفظ..."
              : saved
                ? "✓ تم حفظ ترتيب العروض"
                : "حفظ ترتيب العروض"}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
