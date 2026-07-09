import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  Dimensions,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ProductCard } from "@/components/ProductCard";
import { CATEGORY_IDS, DEFAULT_CATEGORY_LABELS, SEASON_IDS, DEFAULT_SEASON_LABELS, SEASON_ICONS } from "@/data/products";
import { useVisibleProducts } from "@/hooks/useVisibleProducts";
import { useAppSettings } from "@/context/AppSettingsContext";
import { useColors } from "@/hooks/useColors";

const { width } = Dimensions.get("window");

export default function ProductsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { products } = useVisibleProducts();
  const { settings } = useAppSettings();
  const categoryLabels = settings.categoryLabels ?? DEFAULT_CATEGORY_LABELS;
  const hiddenCategories = settings.hiddenCategories ?? [];
  const customCategories = settings.customCategories ?? [];
  const categories = [...CATEGORY_IDS, ...customCategories]
    .filter((id) => id === "all" || !hiddenCategories.includes(id))
    .map((id) => ({
      id,
      label: categoryLabels[id] ?? DEFAULT_CATEGORY_LABELS[id] ?? id,
    }));
  const seasonLabels = settings.seasonLabels ?? DEFAULT_SEASON_LABELS;
  const seasons = SEASON_IDS.map((id) => ({
    id,
    label: seasonLabels[id] ?? DEFAULT_SEASON_LABELS[id],
  }));
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedSeason, setSelectedSeason] = useState<"all" | "summer" | "winter">("all");

  useEffect(() => {
    if (selectedCategory !== "all" && !categories.some((c) => c.id === selectedCategory)) {
      setSelectedCategory("all");
    }
  }, [categories, selectedCategory]);

  const filtered = products.filter((p) => {
    const matchCat =
      selectedCategory === "all" || p.category === selectedCategory;
    const matchSeason =
      selectedSeason === "all" || p.season === selectedSeason;
    const matchSearch =
      !search || p.nameAr.includes(search) || p.name.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSeason && matchSearch;
  });

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingTop: topPadding + 12, backgroundColor: colors.background },
        ]}
      >
        <Text style={[styles.title, { color: colors.foreground }]}>المنتجات</Text>
      </View>

      {/* Search */}
      <View
        style={[
          styles.searchRow,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Ionicons name="search-outline" size={18} color={colors.mutedForeground} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="ابحث..."
          placeholderTextColor={colors.mutedForeground}
          style={[styles.searchInput, { color: colors.foreground }]}
          textAlign="right"
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch("")}>
            <Ionicons name="close-circle" size={18} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>

      {/* Categories */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoriesScroll}
      >
        {categories.map((cat) => (
          <Pressable
            key={cat.id}
            onPress={() => setSelectedCategory(cat.id)}
            style={[
              styles.categoryChip,
              {
                backgroundColor:
                  selectedCategory === cat.id ? colors.primary : colors.card,
                borderColor:
                  selectedCategory === cat.id ? colors.primary : colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.categoryText,
                {
                  color:
                    selectedCategory === cat.id ? "#fff" : colors.foreground,
                },
              ]}
            >
              {cat.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Seasons */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoriesScroll}
      >
        {seasons.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => setSelectedSeason(s.id)}
            style={[
              styles.categoryChip,
              {
                backgroundColor:
                  selectedSeason === s.id ? colors.primary : colors.card,
                borderColor:
                  selectedSeason === s.id ? colors.primary : colors.border,
              },
            ]}
          >
            <Ionicons
              name={SEASON_ICONS[s.id] as any}
              size={14}
              color={selectedSeason === s.id ? "#fff" : colors.foreground}
              style={{ marginLeft: 4 }}
            />
            <Text
              style={[
                styles.categoryText,
                {
                  color:
                    selectedSeason === s.id ? "#fff" : colors.foreground,
                },
              ]}
            >
              {s.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Count */}
      <Text style={[styles.count, { color: colors.mutedForeground }]}>
        {filtered.length} منتج
      </Text>

      {/* Grid */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: Platform.OS === "web" ? 100 : insets.bottom + 80 },
        ]}
        renderItem={({ item }) => (
          <ProductCard
            product={item}
            style={{ width: (width - 48) / 2 }}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="search-outline" size={48} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              لا توجد منتجات
            </Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: { fontSize: 24, fontWeight: "800", textAlign: "right" },
  searchRow: {
    marginHorizontal: 16,
    marginBottom: 12,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  categoriesScroll: {
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 12,
  },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  categoryText: { fontSize: 13, fontWeight: "600" },
  count: {
    textAlign: "right",
    paddingHorizontal: 16,
    fontSize: 12,
    marginBottom: 8,
  },
  list: { paddingHorizontal: 16 },
  row: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 16 },
});
