import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Dimensions,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ProductCard } from "@/components/ProductCard";
import { useVisibleProducts } from "@/hooks/useVisibleProducts";
import { useColors } from "@/hooks/useColors";

const { width } = Dimensions.get("window");

const POPULAR = ["ملابس مولود", "عربة أطفال", "طقم ولادي", "بنطلون", "طقم بنات"];

export default function SearchScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { products } = useVisibleProducts();
  const [query, setQuery] = useState("");

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  const results = query.trim()
    ? products.filter(
        (p) =>
          p.nameAr.includes(query) ||
          p.name.toLowerCase().includes(query.toLowerCase())
      )
    : [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Search header */}
      <View style={[styles.header, { paddingTop: topPadding + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-forward" size={24} color={colors.foreground} />
        </Pressable>
        <View
          style={[
            styles.searchBox,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Ionicons name="search-outline" size={18} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="ابحثي عن أي منتج..."
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground }]}
            autoFocus
            textAlign="right"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")}>
              <Ionicons name="close-circle" size={18} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
      </View>

      {query.trim() === "" ? (
        <View style={styles.suggestSection}>
          <Text style={[styles.suggestTitle, { color: colors.foreground }]}>
            البحث الشائع
          </Text>
          <View style={styles.chips}>
            {POPULAR.map((term) => (
              <Pressable
                key={term}
                onPress={() => setQuery(term)}
                style={[
                  styles.chip,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Ionicons name="trending-up-outline" size={14} color={colors.primary} />
                <Text style={[styles.chipText, { color: colors.foreground }]}>
                  {term}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : results.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="search-outline" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            لا توجد نتائج لـ "{query}"
          </Text>
        </View>
      ) : (
        <FlatList
          data={results}
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
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  searchBox: {
    flex: 1,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  input: { flex: 1, fontSize: 14, padding: 0 },
  suggestSection: { padding: 16 },
  suggestTitle: { fontSize: 16, fontWeight: "700", textAlign: "right", marginBottom: 12 },
  chips: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: { fontSize: 13 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyText: { fontSize: 15, textAlign: "center" },
  list: { paddingHorizontal: 16, paddingTop: 8 },
  row: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    marginBottom: 12,
  },
});
