import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import {
  Dimensions,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ProductCard } from "@/components/ProductCard";
import { useProducts } from "@/context/ProductsContext";
import { useWishlist } from "@/context/WishlistContext";
import { useColors } from "@/hooks/useColors";

const { width } = Dimensions.get("window");

export default function WishlistScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { items } = useWishlist();
  const { products } = useProducts();

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const wishlisted = products.filter((p) => items.some((i) => i.id === p.id));

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 12 }]}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-forward" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>المفضلة</Text>
        <View style={{ width: 24 }} />
      </View>

      {wishlisted.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="heart-outline" size={64} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            المفضلة فارغة
          </Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            أضيفي المنتجات التي تعجبك هنا
          </Text>
          <Pressable
            onPress={() => router.push("/products")}
            style={[styles.shopBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.shopBtnText}>تصفحي المنتجات</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={wishlisted}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 16 },
          ]}
          renderItem={({ item }) => (
            <ProductCard product={item} style={{ width: (width - 48) / 2 }} />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: { fontSize: 20, fontWeight: "800" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  emptyTitle: { fontSize: 20, fontWeight: "700" },
  emptySub: { fontSize: 14, textAlign: "center" },
  shopBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 14,
    marginTop: 8,
  },
  shopBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  list: { paddingHorizontal: 16, paddingTop: 8 },
  row: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    marginBottom: 12,
  },
});
