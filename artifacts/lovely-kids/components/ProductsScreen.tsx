import {
  getResponsiveTopPadding,
  WEB_DESKTOP_MIN_WIDTH,
} from "@/utils/webLayout";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Dimensions,
  FlatList,
  SectionList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ProductCard } from "@/components/ProductCard";
import {
  CategoryMenu,
  DesktopCategorySidebar,
  DESKTOP_CATEGORY_SIDEBAR_WIDTH,
} from "@/components/CategoryMenu";
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
  const { width: viewportWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const isDesktopWeb =
    Platform.OS === "web" &&
    viewportWidth >= WEB_DESKTOP_MIN_WIDTH;

  const desktopWorkspaceWidth = isDesktopWeb
    ? Math.max(
        viewportWidth - DESKTOP_CATEGORY_SIDEBAR_WIDTH,
        0,
      )
    : viewportWidth;

  // Use the space left beside the permanent Desktop sidebar.
  const desktopContentWidth = Math.min(
    Math.max(desktopWorkspaceWidth - 48, 0),
    1450,
  );

  const desktopCardWidth = isDesktopWeb
    ? (desktopContentWidth - 32) / 3
    : (width - 48) / 2;

  const desktopShellStyle = isDesktopWeb
    ? {
        width: desktopContentWidth,
        alignSelf: "center" as const,
      }
    : null;

  const desktopFlushShellStyle = isDesktopWeb
    ? {
        width: desktopContentWidth,
        alignSelf: "center" as const,
        marginHorizontal: 0,
      }
    : null;
  const { products } = useVisibleProducts();
  const { settings } = useAppSettings();
  const categories = useProductCategories(offersOnly);
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
  const showCatalogNavigation = !isNewArrivalsView;

  const filtered = products.filter((p) => {
    const matchOffers = isOffersView
      ? p.showInOffers === true
      : Platform.OS !== "web" || p.showInOffers !== true;
    const matchNew = !isNewArrivalsView || p.isNew === true;
    const matchCat =
      selectedCategory === "all" || p.category === selectedCategory;
    const matchSeason =
      selectedSeason === "all" || p.season == null || p.season === selectedSeason;
    const matchGender =
      Platform.OS !== "web" ||
      selectedGender === null ||
      p.gender == null ||
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

  const shouldGroupByCategory =
  Platform.OS === "web" &&
  selectedCategory === "all" &&
  showCatalogNavigation;

const groupedSections = shouldGroupByCategory
  ? categories
      .filter((cat) => cat.id !== "all")
      .map((cat) => {
        const categoryProducts = filtered.filter(
          (product) => product.category === cat.id,
        );

        const groupSize = isDesktopWeb ? 3 : 2;

        return {
          id: cat.id,
          label: cat.label,
          data: Array.from(
            { length: Math.ceil(categoryProducts.length / groupSize) },
            (_, index) =>
              categoryProducts.slice(
                index * groupSize,
                index * groupSize + groupSize,
              ),
          ),
        };
      })
      .filter((section) => section.data.length > 0)
  : [];

const topPadding = getResponsiveTopPadding(insets.top);
  const productsTopPadding =
    isDesktopWeb ? 18 : topPadding + 12;

  const topContent = (
    <>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: productsTopPadding,
            backgroundColor: colors.background,
          },
          desktopShellStyle,
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
              ? "🔥 قسم العروض 🔥"
              : isNewArrivalsView
                ? "وصل حديثاً"
                : "المنتجات"}
          </Text>

          {Platform.OS === "web" && showCatalogNavigation && !isDesktopWeb ? (
            <View style={styles.headerMenuSlot}>
              <CategoryMenu offersOnly={isOffersView} />
            </View>
          ) : null}
        </View>
      </View>

      {/* Gender Tabs — Web only */}

      {Platform.OS === "web" && showCatalogNavigation ? (

        <View
          style={[
            styles.genderTabsRow,
            { borderColor: colors.border },
            desktopFlushShellStyle,
          ]}
        >

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
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
          desktopFlushShellStyle,
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
        contentContainerStyle={[
          styles.categoriesScroll,
          isDesktopWeb
            ? {
                flexGrow: 1,
                justifyContent: "center",
                paddingHorizontal: 0,
              }
            : null,
        ]}
        style={[
          {
            marginBottom: 8,
            height: 44,
            minHeight: 44,
            maxHeight: 44,
            flexShrink: 0,
          },
          Platform.OS === "web" ? { direction: "rtl" } : null,
          desktopFlushShellStyle,
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
        contentContainerStyle={[
          styles.categoriesScroll,
          isDesktopWeb
            ? {
                flexGrow: 1,
                justifyContent: "center",
                paddingHorizontal: 0,
              }
            : null,
        ]}
        style={[
          {
            marginBottom: 4,
            height: 44,
            minHeight: 44,
            maxHeight: 44,
            flexShrink: 0,
          },
          Platform.OS === "web" ? { direction: "rtl" } : null,
          desktopFlushShellStyle,
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
      <Text
        style={[
          styles.count,
          { color: colors.mutedForeground },
          desktopShellStyle,
        ]}
      >
        {filtered.length} منتج
      </Text>
    </>
  );

  if (shouldGroupByCategory) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <SectionList
          style={
            isDesktopWeb
              ? {
                  width: desktopWorkspaceWidth,
                  alignSelf: "flex-start",
                }
              : undefined
          }
          sections={groupedSections}
          keyExtractor={(row, index) => `${row[0]?.id ?? "row"}-${index}`}
          ListHeaderComponent={topContent}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
          renderSectionHeader={({ section }) => (
            <View
              style={[
                {
                  paddingHorizontal: 16,
                  paddingTop: 18,
                  paddingBottom: 10,
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  gap: 10,
                },
                isDesktopWeb
                  ? {
                      width: desktopContentWidth,
                      alignSelf: "center",
                      paddingHorizontal: 0,
                    }
                  : null,
              ]}
            >
              <View
                style={{
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  gap: 8,
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderWidth: 1,
                  borderRadius: 12,
                  paddingVertical: 8,
                  paddingHorizontal: 14,
                }}
              >
                <View
                  style={{
                    width: 4,
                    height: 22,
                    borderRadius: 2,
                    backgroundColor: colors.primary,
                  }}
                />
                <Text
                  style={{
                    color: colors.foreground,
                    fontSize: 18,
                    fontWeight: "900",
                    textAlign: "right",
                  }}
                >
                  {section.label}
                </Text>
              </View>

              <View
                style={{
                  flex: 1,
                  height: 1,
                  backgroundColor: colors.border,
                }}
              />
            </View>
          )}
          renderItem={({ item }) => (
            <View
              style={[
                styles.row,
                isDesktopWeb
                  ? {
                      width: desktopContentWidth,
                      alignSelf: "center",
                      paddingHorizontal: 0,
                      gap: 16,
                    }
                  : { paddingHorizontal: 16 },
              ]}
            >
              {item.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  style={{ width: desktopCardWidth }}
                  imageHeight={isDesktopWeb ? 300 : undefined}
                />
              ))}
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons
                name="search-outline"
                size={48}
                color={colors.mutedForeground}
              />
              <Text
                style={[styles.emptyText, { color: colors.mutedForeground }]}
              >
                لا توجد منتجات
              </Text>
            </View>
          }
        />

        {isDesktopWeb && showCatalogNavigation ? (
          <DesktopCategorySidebar offersOnly={isOffersView} />
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {Platform.OS !== "web" ? topContent : null}

      {/* Grid */}
      <FlatList
        style={
          isDesktopWeb
            ? {
                width: desktopWorkspaceWidth,
                alignSelf: "flex-start",
              }
            : undefined
        }
        key={isDesktopWeb ? "desktop-products-3" : "products-2"}
        data={filtered}
        keyExtractor={(item) => item.id}
        numColumns={isDesktopWeb ? 3 : 2}
        columnWrapperStyle={[
          styles.row,
          isDesktopWeb
            ? {
                width: desktopContentWidth,
                alignSelf: "center",
                paddingHorizontal: 0,
                gap: 16,
              }
            : Platform.OS === "web"
              ? { paddingHorizontal: 16 }
              : null,
        ]}
        ListHeaderComponent={Platform.OS === "web" ? topContent : null}
        contentContainerStyle={[
          Platform.OS === "web" ? null : styles.list,
          { paddingBottom: Platform.OS === "web" ? 100 : insets.bottom + 110 },
        ]}
        renderItem={({ item }) => (
          <ProductCard
            product={item}
            style={{ width: desktopCardWidth }}
                  imageHeight={isDesktopWeb ? 300 : undefined}
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

      {isDesktopWeb && showCatalogNavigation ? (
        <DesktopCategorySidebar offersOnly={isOffersView} />
      ) : null}
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
    position: "relative",
    minHeight: 38,
  },
  headerMenuSlot: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    justifyContent: "center",
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
