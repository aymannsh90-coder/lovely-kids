import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppSettings } from "@/context/AppSettingsContext";
import { useProducts } from "@/context/ProductsContext";
import { useColors } from "@/hooks/useColors";

export default function ProductOffersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { products, updateProduct } = useProducts();
  const { settings, updateSettings } = useAppSettings();

  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toggleSaving, setToggleSaving] = useState(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 16;

  const offerProducts = useMemo(() => {
    const q = query.trim().toLowerCase();

    return products
      .filter((product) => product.showInOffers === true)
      .filter((product) => {
        if (!q) return true;

        return (
          product.nameAr.toLowerCase().includes(q) ||
          product.name.toLowerCase().includes(q) ||
          (product.productCode ?? "").toLowerCase().includes(q) ||
          (product.barcode ?? "").toLowerCase().includes(q)
        );
      });
  }, [products, query]);

  const toggleSection = async (value: boolean) => {
    setToggleSaving(true);

    const ok = await updateSettings({
      productOffersSectionEnabled: value,
    });

    setToggleSaving(false);

    if (!ok) {
      Alert.alert("تعذر الحفظ", "لم يتم حفظ حالة ظهور قسم العروض.");
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const removeFromOffers = async (id: string) => {
    const product = products.find((item) => item.id === id);
    if (!product) return;

    setBusyId(id);

    try {
      await updateProduct({
        ...product,
        showInOffers: false,
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert(
        "تعذر الإزالة",
        error instanceof Error ? error.message : "حدث خطأ أثناء إزالة المنتج من العروض",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
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

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>إدارة العروض</Text>
          <Text style={styles.headerSub}>
            {products.filter((p) => p.showInOffers).length} منتج
          </Text>
        </View>

        <Ionicons name="flame-outline" size={25} color="#fff" />
      </View>

      <FlatList
        data={offerProducts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: bottomPadding },
        ]}
        ListHeaderComponent={
          <>
            <View
              style={[
                styles.visibilityCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              <Switch
                value={settings.productOffersSectionEnabled ?? false}
                onValueChange={toggleSection}
                disabled={toggleSaving}
                trackColor={{
                  false: colors.muted,
                  true: colors.primary,
                }}
                thumbColor="#fff"
              />

              <View style={styles.visibilityText}>
                <Text
                  style={[
                    styles.visibilityTitle,
                    { color: colors.foreground },
                  ]}
                >
                  إظهار قسم العروض للمستخدمين
                </Text>
                <Text
                  style={[
                    styles.visibilityHint,
                    { color: colors.mutedForeground },
                  ]}
                >
                  إخفاء القسم لا يزيل المنتجات المحفوظة داخله
                </Text>
              </View>
            </View>

            <View
              style={[
                styles.searchBox,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              <Ionicons
                name="search-outline"
                size={19}
                color={colors.mutedForeground}
              />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="بحث بالاسم أو الكود أو الباركود"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.searchInput, { color: colors.foreground }]}
                textAlign="right"
              />
            </View>

            <View style={styles.sectionHeader}>
              <Text
                style={[
                  styles.sectionTitle,
                  { color: colors.foreground },
                ]}
              >
                المنتجات الموجودة في العروض
              </Text>
            </View>
          </>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons
              name="flame-outline"
              size={52}
              color={colors.mutedForeground}
            />
            <Text
              style={[
                styles.emptyTitle,
                { color: colors.foreground },
              ]}
            >
              لا توجد منتجات ضمن العروض
            </Text>
            <Text
              style={[
                styles.emptyHint,
                { color: colors.mutedForeground },
              ]}
            >
              افتح المنتج وفعّل خيار "إضافة إلى العروض"
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View
            style={[
              styles.productCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <Image source={{ uri: item.image }} style={styles.image} />

            <View style={styles.productInfo}>
              <Text
                style={[
                  styles.productName,
                  { color: colors.foreground },
                ]}
                numberOfLines={2}
              >
                {item.nameAr}
              </Text>

              <View style={styles.priceRow}>
                <Text
                  style={[
                    styles.price,
                    { color: colors.primary },
                  ]}
                >
                  {item.price} ₪
                </Text>

                {item.originalPrice ? (
                  <Text
                    style={[
                      styles.originalPrice,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {item.originalPrice} ₪
                  </Text>
                ) : null}
              </View>

              <View style={styles.actions}>
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: "/admin/add-product",
                      params: { productId: item.id },
                    })
                  }
                  style={[
                    styles.editButton,
                    { backgroundColor: colors.secondary },
                  ]}
                >
                  <Ionicons
                    name="pencil-outline"
                    size={17}
                    color={colors.foreground}
                  />
                  <Text
                    style={[
                      styles.editText,
                      { color: colors.foreground },
                    ]}
                  >
                    تعديل
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => void removeFromOffers(item.id)}
                  disabled={busyId === item.id}
                  style={styles.removeButton}
                >
                  <Ionicons
                    name="close-circle-outline"
                    size={17}
                    color="#ef4444"
                  />
                  <Text style={styles.removeText}>
                    {busyId === item.id
                      ? "جارٍ الإزالة..."
                      : "إزالة من العروض"}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  headerCenter: {
    alignItems: "center",
    gap: 2,
  },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "800",
  },
  headerSub: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 11,
  },
  list: {
    padding: 16,
    gap: 10,
  },
  visibilityCard: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  visibilityText: {
    flex: 1,
    alignItems: "flex-end",
    marginLeft: 12,
    gap: 3,
  },
  visibilityTitle: {
    fontSize: 14,
    fontWeight: "800",
    textAlign: "right",
  },
  visibilityHint: {
    fontSize: 11,
    textAlign: "right",
  },
  searchBox: {
    flexDirection: "row-reverse",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 11,
    marginRight: 8,
    fontSize: 14,
  },
  sectionHeader: {
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "800",
    textAlign: "right",
  },
  productCard: {
    flexDirection: "row-reverse",
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
    gap: 12,
  },
  image: {
    width: 82,
    height: 82,
    borderRadius: 11,
    resizeMode: "cover",
  },
  productInfo: {
    flex: 1,
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 6,
  },
  productName: {
    fontSize: 14,
    fontWeight: "800",
    textAlign: "right",
  },
  priceRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
  },
  price: {
    fontSize: 14,
    fontWeight: "800",
  },
  originalPrice: {
    fontSize: 12,
    textDecorationLine: "line-through",
  },
  actions: {
    flexDirection: "row-reverse",
    gap: 8,
  },
  editButton: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
  },
  editText: {
    fontSize: 12,
    fontWeight: "700",
  },
  removeButton: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
    backgroundColor: "#fee2e2",
  },
  removeText: {
    color: "#ef4444",
    fontSize: 12,
    fontWeight: "700",
  },
  empty: {
    alignItems: "center",
    paddingTop: 60,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "800",
  },
  emptyHint: {
    fontSize: 13,
    textAlign: "center",
  },
});
