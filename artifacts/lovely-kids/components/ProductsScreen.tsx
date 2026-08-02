import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
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
import { SEASON_IDS, DEFAULT_SEASON_LABELS, SEASON_ICONS } from "@/data/products";
import { useVisibleProducts } from "@/hooks/useVisibleProducts";
import { useProductCategories } from "@/hooks/useProductCategories";
import { useAppSettings } from "@/context/AppSettingsContext";
import { useColors } from "@/hooks/useColors";

const { width } = Dimensions.get("window");

export default function ProductsScreen({
  offersOnly = false,
  newOnly = false,
}: {
  offersOnly?: boolean;
  newOnly?: boolean;
}) {
  const { category, fromMenu } = useLocalSearchParams<{
    category?: string;
    fromMenu?: string;
  }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { products } = useVisibleProducts();
  const { settings } = useAppSettings();
  const categories = useProductCategories();
  const seasonLabels = settings.seasonLabels ?? DEFAULT_SEASON_LABELS;
  const seasons = SEASON_IDS.map((id) => ({
    id,
    label: seasonLabels[id] ?? DEFAULT_SEASON_LABELS[id],
  }));
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(
    typeof category === "string" ? category : "all",
  );
  const [selectedSeason, setSelectedSeason] = useState<"all" | "summer" | "winter">("all");
  const [selectedGender, setSelectedGender] = useState<null | "boys" | "girls">(null);

  useEffect(() => {
    if (typeof category === "string" && categories.some((c) => c.id === category)) {
      setSelectedCategory(category);
    }
  }, [category, categories]);

  useEffect(() => {
    if (selectedCategory !== "all" && !categories.some((c) => c.id === selectedCategory)) {
      setSelectedCategory("all");
    }
  }, [categories, selectedCategory]);

  const isOffersView = offersOnly;
  const isNewArrivalsView = newOnly;
  const isSpecialView = isOffersView || isNewArrivalsView;

  const filtered = products.filter((p) => {
    const matchOffers = !isOffersView || p.showInOffers === true;
    const matchNew = !isNewArrivalsView || p.isNew === true;
    const matchCat =
      selectedCategory === "all" || p.category === selectedCategory;
    const matchSeason =
      selectedSeason === "all" || p.season === selectedSeason;
    const matchGender =
      Platform.OS !== "web" ||
      selectedGender === null ||
      p.gender === selectedGender;
    const matchSearch =
      !search || p.nameAr.includes(search) || p.name.toLowerCase().includes(search.toLowerCase());
    return (
      matchOffers &&
      matchNew &&
      matchCat &&
      matchSeason &&
      matchGender &&
      matchSearch
    );
  });

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  const topContent = (
    <>
      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingTop: topPadding + 12, backgroundColor: colors.background },
        ]}
      >
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => {
              if (isSpecialView) {
                router.back();
                return;
              }

              if (fromMenu === "1") {
                router.replace({
                  pathname: "/(tabs)",
                  params: { openCategories: String(Date.now()) },
                });
                return;
              }

              router.replace("/(tabs)");
            }}
            style={styles.backButton}
            accessibilityLabel="رجوع"
          >
              <Ionicons
                name="arrow-forward-outline"
                size={24}
                color={colors.foreground}
              />
          </Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {isOffersView
              ? "🔥 العروض"
              : isNewArrivalsView
                ? "وصل حديثاً"
                : "المنتجات"}
          </Text>
        </View>
      </View>

      {/* Gender Tabs — Web only */}

      {Platform.OS === "web" && !isSpecialView ? (

        <View style={[styles.genderTabsRow, { borderColor: colors.border }]}>

          <Pressable

            onPress={() => setSelectedGender(null)}

            style={[

              styles.genderTab,

              selectedGender === null && { backgroundColor: colors.primary },

            ]}

          >

            <Text

              style={[

                styles.genderTabText,

                { color: selectedGender === null ? "#fff" : colors.foreground },

              ]}

            >

              الكل

            </Text>

          </Pressable>


          <Pressable

            onPress={() => setSelectedGender("boys")}

            style={[

              styles.genderTab,

              selectedGender === "boys" && { backgroundColor: "#3B82F6" },

            ]}

          >

            <Text style={styles.genderEmoji}>👦</Text>

            <Text

              style={[

                styles.genderTabText,

                { color: selectedGender === "boys" ? "#fff" : colors.foreground },

              ]}

            >

              ولادي

            </Text>

          </Pressable>


          <Pressable

            onPress={() => setSelectedGender("girls")}

            style={[

              styles.genderTab,

              selectedGender === "girls" && { backgroundColor: "#EC4899" },

            ]}

          >

            <Text style={styles.genderEmoji}>👧</Text>

            <Text

              style={[

                styles.genderTabText,

                { color: selectedGender === "girls" ? "#fff" : colors.foreground },

              ]}

            >

              بناتي

            </Text>

          </Pressable>

        </View>

      ) : null}
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
        style={[
          { marginBottom: 8, height: 44, minHeight: 44, maxHeight: 44, flexShrink: 0 },
          Platform.OS === "web" ? { direction: "rtl" } : null,
        ]}
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
        style={[
          { marginBottom: 4, height: 44, minHeight: 44, maxHeight: 44, flexShrink: 0 },
          Platform.OS === "web" ? { direction: "rtl" } : null,
        ]}
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
    </>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {Platform.OS !== "web" ? topContent : null}

      {/* Grid */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={[
          styles.row,
          Platform.OS === "web" ? { paddingHorizontal: 16 } : null,
        ]}
        ListHeaderComponent={Platform.OS === "web" ? topContent : null}
        contentContainerStyle={[
          Platform.OS === "web" ? null : styles.list,
          { paddingBottom: Platform.OS === "web" ? 100 : insets.bottom + 110 },
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
  headerRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
  },
  backButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 19,
  },
  title: { fontSize: 24, fontWeight: "800", textAlign: "right" },
  genderTabsRow: {
    flexDirection: "row-reverse",
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  genderTab: {
    flex: 1,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
  },
  genderEmoji: {
    fontSize: 18,
  },
  genderTabText: {
    fontSize: 14,
    fontWeight: "700",
  },
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
    paddingVertical: 4,
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "center",
  },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: 100,
    height: 36,
    paddingHorizontal: 8,
    borderRadius: 20,
    borderWidth: 1,
    flexShrink: 0,
    marginHorizontal: 5,
  },
  categoryText: { fontSize: 13, fontWeight: "600", lineHeight: 18, textAlign: "center" },
  count: {
    textAlign: "right",
    paddingHorizontal: 16,
    fontSize: 12,
    marginBottom: 8,
  },
  list: { paddingHorizontal: 16 },
  row: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 16 },
});
