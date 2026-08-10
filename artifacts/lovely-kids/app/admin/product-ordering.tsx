import { getResponsiveTopPadding } from "@/utils/webLayout";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppSettings } from "@/context/AppSettingsContext";
import { useProducts } from "@/context/ProductsContext";
import { useColors } from "@/hooks/useColors";
import { useProductCategories } from "@/hooks/useProductCategories";

export default function ProductOrderingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { products } = useProducts();
  const { settings, updateSettings } = useAppSettings();
  const categories = useProductCategories().filter((item) => item.id !== "all");

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [localOrder, setLocalOrder] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const topPadding = getResponsiveTopPadding(insets.top);
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 20;

  useEffect(() => {
    if (!selectedCategory && categories.length > 0) {
      setSelectedCategory(categories[0].id);
    }
  }, [categories, selectedCategory]);

  const categoryProducts = useMemo(
    () =>
      selectedCategory
        ? products.filter((product) => product.category === selectedCategory)
        : [],
    [products, selectedCategory],
  );

  const pinnedProducts = useMemo(
    () => categoryProducts.filter((product) => product.isPinned === true),
    [categoryProducts],
  );

  const movableProducts = useMemo(
    () => categoryProducts.filter((product) => product.isPinned !== true),
    [categoryProducts],
  );

  useEffect(() => {
    if (!selectedCategory) {
      setLocalOrder([]);
      return;
    }

    const savedOrder =
      settings.productOrderByCategory?.[selectedCategory] ?? [];

    const availableIds = movableProducts.map((product) => product.id);

    setLocalOrder([
      ...savedOrder.filter((id) => availableIds.includes(id)),
      ...availableIds.filter((id) => !savedOrder.includes(id)),
    ]);

    setSaved(false);
  }, [
    selectedCategory,
    movableProducts,
    settings.productOrderByCategory,
  ]);

  const orderedMovableProducts = useMemo(() => {
    const byId = new Map(movableProducts.map((product) => [product.id, product]));

    return localOrder
      .map((id) => byId.get(id))
      .filter((product): product is NonNullable<typeof product> => !!product);
  }, [localOrder, movableProducts]);

  const moveProduct = (id: string, direction: -1 | 1) => {
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
    if (!selectedCategory) return;

    setSaving(true);

    const ok = await updateSettings({
      productOrderByCategory: {
        ...(settings.productOrderByCategory ?? {}),
        [selectedCategory]: localOrder,
      },
    });

    setSaving(false);
    setSaved(ok);

    if (ok) {
      setTimeout(() => setSaved(false), 2500);
    }
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: bottomPadding }}
      showsVerticalScrollIndicator={false}
    >
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

        <Text style={styles.headerTitle}>ترتيب المنتجات</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.body}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          اختر الصنف
        </Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categories}
        >
          {categories.map((category) => {
            const active = selectedCategory === category.id;

            return (
              <Pressable
                key={category.id}
                onPress={() => setSelectedCategory(category.id)}
                style={[
                  styles.categoryChip,
                  {
                    backgroundColor: active ? colors.primary : colors.card,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={{
                    color: active ? "#fff" : colors.foreground,
                    fontWeight: "800",
                  }}
                >
                  {category.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View
          style={[
            styles.infoCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Ionicons name="information-circle-outline" size={22} color={colors.primary} />
          <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
            المنتجات المثبتة تبقى في الأعلى تلقائياً. استخدم الأسهم لترتيب باقي المنتجات.
          </Text>
        </View>

        {pinnedProducts.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              المنتجات المثبتة
            </Text>

            {pinnedProducts.map((product) => (
              <View
                key={product.id}
                style={[
                  styles.productRow,
                  { backgroundColor: colors.card, borderColor: colors.primary },
                ]}
              >
                <Image source={{ uri: product.image }} style={styles.image} />

                <View style={styles.productInfo}>
                  <Text style={[styles.productName, { color: colors.foreground }]}>
                    {product.nameAr}
                  </Text>
                  <Text style={{ color: colors.primary, fontWeight: "800" }}>
                    📌 مثبت
                  </Text>
                </View>
              </View>
            ))}
          </>
        )}

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          ترتيب باقي المنتجات
        </Text>

        {orderedMovableProducts.length === 0 ? (
          <View
            style={[
              styles.emptyCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={{ color: colors.mutedForeground }}>
              لا توجد منتجات في هذا الصنف
            </Text>
          </View>
        ) : (
          orderedMovableProducts.map((product, index) => (
            <View
              key={product.id}
              style={[
                styles.productRow,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View
                style={[
                  styles.number,
                  { backgroundColor: colors.secondary },
                ]}
              >
                <Text style={{ color: colors.foreground, fontWeight: "900" }}>
                  {index + 1}
                </Text>
              </View>

              <Image source={{ uri: product.image }} style={styles.image} />

              <View style={styles.productInfo}>
                <Text
                  style={[styles.productName, { color: colors.foreground }]}
                  numberOfLines={2}
                >
                  {product.nameAr}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                  {product.price} ₪
                </Text>
              </View>

              <View style={styles.actions}>
                <Pressable
                  disabled={index === 0}
                  onPress={() => moveProduct(product.id, -1)}
                  style={[
                    styles.arrow,
                    {
                      backgroundColor: colors.secondary,
                      opacity: index === 0 ? 0.35 : 1,
                    },
                  ]}
                >
                  <Ionicons name="arrow-up" size={19} color={colors.foreground} />
                </Pressable>

                <Pressable
                  disabled={index === orderedMovableProducts.length - 1}
                  onPress={() => moveProduct(product.id, 1)}
                  style={[
                    styles.arrow,
                    {
                      backgroundColor: colors.secondary,
                      opacity:
                        index === orderedMovableProducts.length - 1 ? 0.35 : 1,
                    },
                  ]}
                >
                  <Ionicons name="arrow-down" size={19} color={colors.foreground} />
                </Pressable>
              </View>
            </View>
          ))
        )}

        <Pressable
          onPress={saveOrder}
          disabled={!selectedCategory || saving}
          style={[
            styles.saveButton,
            { backgroundColor: saved ? "#22c55e" : colors.primary },
          ]}
        >
          <Ionicons
            name={saved ? "checkmark-circle-outline" : "save-outline"}
            size={21}
            color="#fff"
          />
          <Text style={styles.saveText}>
            {saving ? "جارٍ الحفظ..." : saved ? "تم الحفظ" : "حفظ الترتيب"}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  headerTitle: { color: "#fff", fontSize: 20, fontWeight: "900" },
  body: {
    width: "100%",
    maxWidth: 900,
    alignSelf: "center",
    padding: 16,
    gap: 12,
  },
  sectionTitle: { fontSize: 17, fontWeight: "900", textAlign: "right" },
  categories: { gap: 8, paddingVertical: 4 },
  categoryChip: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  infoCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
  },
  infoText: { flex: 1, fontSize: 13, fontWeight: "600", textAlign: "right" },
  productRow: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    gap: 10,
  },
  number: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  image: { width: 58, height: 58, borderRadius: 10 },
  productInfo: { flex: 1, gap: 4 },
  productName: { fontSize: 14, fontWeight: "800", textAlign: "right" },
  actions: { flexDirection: "row", gap: 6 },
  arrow: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 24,
    alignItems: "center",
  },
  saveButton: {
    marginTop: 8,
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  saveText: { color: "#fff", fontSize: 15, fontWeight: "900" },
});
