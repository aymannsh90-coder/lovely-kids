import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useCart } from "@/context/CartContext";
import { useWishlist } from "@/context/WishlistContext";
import { useVisibleProducts } from "@/hooks/useVisibleProducts";
import { useColors } from "@/hooks/useColors";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { addItem } = useCart();
  const { toggleItem, isWishlisted } = useWishlist();
  const { products, loading } = useVisibleProducts();

  const product = products.find((p) => p.id === id);

  const hasColorVariants = !!product?.colorVariants && product.colorVariants.length > 0;
  const [selectedColor, setSelectedColor] = useState<string | undefined>(
    hasColorVariants ? product!.colorVariants![0].color : undefined
  );
  const activeColorVariant = hasColorVariants
    ? product!.colorVariants!.find((c) => c.color === selectedColor) ?? product!.colorVariants![0]
    : undefined;
  const [selectedSize, setSelectedSize] = useState<string | undefined>(
    activeColorVariant
      ? activeColorVariant.sizes.find((s) => !s.outOfStock)?.size
      : product?.sizes?.[0]
  );
  const [added, setAdded] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const flatRef = useRef<FlatList>(null);

  useEffect(() => {
    if (!activeColorVariant) return;
    const firstAvailable = activeColorVariant.sizes.find((s) => !s.outOfStock)?.size;
    setSelectedSize(firstAvailable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedColor]);

  if (!product) {
    return (
      <View
        style={[
          styles.container,
          styles.center,
          { backgroundColor: colors.background, paddingTop: insets.top },
        ]}
      >
        {loading ? (
          <Text style={{ color: colors.mutedForeground, fontSize: 15 }}>
            جاري التحميل...
          </Text>
        ) : (
          <>
            <Ionicons name="alert-circle-outline" size={48} color={colors.mutedForeground} />
            <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "700" }}>
              المنتج غير متوفر
            </Text>
            <Pressable
              onPress={() => router.back()}
              style={[styles.backToShop, { backgroundColor: colors.primary }]}
            >
              <Text style={styles.backToShopText}>الرجوع</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  const allImages = product.images && product.images.length > 0
    ? product.images
    : [product.image];

  const wishlisted = isWishlisted(product.id);
  const isOutOfStock = product.stock !== undefined && product.stock !== null && product.stock <= 0;

  const handleAddToCart = () => {
    if (isOutOfStock) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    addItem({
      id: product.id,
      name: product.nameAr,
      price: product.price,
      image: product.image,
      category: product.category,
      size: selectedSize,
      color: activeColorVariant?.color,
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom + 16;
  const topOffset = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* ── Image Carousel ── */}
        <View style={styles.carouselWrapper}>
          <FlatList
            ref={flatRef}
            data={allImages}
            keyExtractor={(_, i) => String(i)}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
              setActiveIdx(idx);
            }}
            renderItem={({ item }) => (
              <View style={[styles.imageSlide, isOutOfStock && styles.imageDimmed]}>
                <Image
                  source={{ uri: item }}
                  style={styles.slideImage}
                  resizeMode="contain"
                />
              </View>
            )}
          />

          {/* Dots */}
          {allImages.length > 1 && (
            <View style={styles.dots}>
              {allImages.map((_, i) => (
                <Pressable
                  key={i}
                  onPress={() => {
                    flatRef.current?.scrollToIndex({ index: i, animated: true });
                    setActiveIdx(i);
                  }}
                  style={[
                    styles.dot,
                    { backgroundColor: i === activeIdx ? colors.primary : colors.border },
                  ]}
                />
              ))}
            </View>
          )}

          {/* Out of stock overlay */}
          {isOutOfStock && (
            <View style={styles.outOfStockOverlay}>
              <Ionicons name="close-circle-outline" size={36} color="#fff" />
              <Text style={styles.outOfStockLabel}>نفد المخزون</Text>
            </View>
          )}

          {/* Back Button */}
          <Pressable
            onPress={() => router.back()}
            style={[styles.backBtn, { top: topOffset + 8, backgroundColor: colors.card }]}
          >
            <Ionicons name="arrow-forward" size={22} color={colors.foreground} />
          </Pressable>

          {/* Wishlist Button */}
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              toggleItem({ id: product.id, name: product.nameAr, price: product.price, image: product.image, category: product.category });
            }}
            style={[styles.wishlistBtn, { top: topOffset + 8, backgroundColor: colors.card }]}
          >
            <Ionicons
              name={wishlisted ? "heart" : "heart-outline"}
              size={22}
              color={wishlisted ? colors.primary : colors.foreground}
            />
          </Pressable>

          {!isOutOfStock && product.discount && (
            <View style={[styles.discountBadge, { backgroundColor: colors.primary }]}>
              <Text style={styles.discountText}>-{product.discount}%</Text>
            </View>
          )}

          {/* Thumbnail strip */}
          {allImages.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.thumbStrip}
              style={[styles.thumbBar, { backgroundColor: colors.background }]}
            >
              {allImages.map((img, i) => (
                <Pressable
                  key={i}
                  onPress={() => {
                    flatRef.current?.scrollToIndex({ index: i, animated: true });
                    setActiveIdx(i);
                  }}
                  style={[
                    styles.thumb,
                    {
                      borderColor: i === activeIdx ? colors.primary : colors.border,
                      backgroundColor: "#f8f8f8",
                    },
                  ]}
                >
                  <Image source={{ uri: img }} style={styles.thumbImg} resizeMode="contain" />
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>

        {/* Content */}
        <View style={[styles.content, { backgroundColor: colors.background }]}>
          <Text style={[styles.name, { color: colors.foreground }]}>{product.nameAr}</Text>

          <View style={styles.ratingRow}>
            {[1, 2, 3, 4, 5].map((s) => (
              <Ionicons key={s} name={s <= Math.floor(product.rating) ? "star" : "star-outline"} size={16} color="#F59E0B" />
            ))}
            <Text style={[styles.ratingText, { color: colors.mutedForeground }]}>({product.reviews} تقييم)</Text>
          </View>

          <View style={styles.priceRow}>
            <Text style={[styles.price, { color: isOutOfStock ? colors.mutedForeground : colors.primary }]}>
              {product.price} ₪
            </Text>
            {product.originalPrice && !isOutOfStock && (
              <Text style={[styles.originalPrice, { color: colors.mutedForeground }]}>{product.originalPrice} ₪</Text>
            )}
          </View>

          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>الوصف</Text>
          <Text style={[styles.description, { color: colors.mutedForeground }]}>{product.description}</Text>

          {hasColorVariants && (
            <>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>اللون</Text>
              <View style={styles.sizesRow}>
                {product.colorVariants!.map((cv) => (
                  <Pressable
                    key={cv.color}
                    onPress={() => !isOutOfStock && setSelectedColor(cv.color)}
                    style={[
                      styles.colorSwatchOuter,
                      {
                        borderColor: selectedColor === cv.color ? colors.primary : colors.border,
                        opacity: isOutOfStock ? 0.5 : 1,
                      },
                    ]}
                  >
                    <View style={[styles.colorSwatchInner, { backgroundColor: cv.hex }]} />
                    <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 12 }}>{cv.color}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {hasColorVariants && activeColorVariant && activeColorVariant.sizes.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>المقاس</Text>
              <View style={styles.sizesRow}>
                {activeColorVariant.sizes.map((s) => {
                  const disabled = isOutOfStock || s.outOfStock;
                  return (
                    <Pressable
                      key={s.size}
                      onPress={() => !disabled && setSelectedSize(s.size)}
                      disabled={disabled}
                      style={[
                        styles.sizeChip,
                        styles.sizeChipWithMark,
                        {
                          backgroundColor: selectedSize === s.size ? colors.primary : colors.card,
                          borderColor: selectedSize === s.size ? colors.primary : colors.border,
                          opacity: s.outOfStock ? 0.45 : isOutOfStock ? 0.5 : 1,
                        },
                      ]}
                    >
                      <Text style={{ color: selectedSize === s.size ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 13 }}>
                        {s.size}
                      </Text>
                      {s.outOfStock && (
                        <View style={styles.sizeOutOfStockOverlay}>
                          <Ionicons name="close" size={26} color="#ef4444" />
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {!hasColorVariants && product.sizes && product.sizes.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>المقاس</Text>
              <View style={styles.sizesRow}>
                {product.sizes.map((size) => (
                  <Pressable
                    key={size}
                    onPress={() => !isOutOfStock && setSelectedSize(size)}
                    style={[
                      styles.sizeChip,
                      {
                        backgroundColor: selectedSize === size ? colors.primary : colors.card,
                        borderColor: selectedSize === size ? colors.primary : colors.border,
                        opacity: isOutOfStock ? 0.5 : 1,
                      },
                    ]}
                  >
                    <Text style={{ color: selectedSize === size ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 13 }}>
                      {size}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <View style={[styles.featuresBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            {[
              { icon: "shield-checkmark-outline" as const, text: "جودة مضمونة 100%" },
              { icon: "refresh-outline" as const, text: "إمكانية الاستبدال خلال 7 أيام" },
              { icon: "rocket-outline" as const, text: "شحن سريع لجميع المناطق" },
            ].map((f) => (
              <View key={f.text} style={styles.featureRow}>
                <Ionicons name={f.icon} size={16} color={colors.primary} />
                <Text style={[styles.featureText, { color: colors.foreground }]}>{f.text}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* Add to Cart Footer */}
      <View style={[styles.footer, { backgroundColor: colors.background, borderColor: colors.border, paddingBottom: bottomPad }]}>
        {isOutOfStock ? (
          <View style={[styles.outOfStockBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Ionicons name="close-circle-outline" size={20} color={colors.mutedForeground} />
            <Text style={[styles.outOfStockBtnText, { color: colors.mutedForeground }]}>نفد المخزون</Text>
          </View>
        ) : (
          <Pressable
            onPress={handleAddToCart}
            style={[styles.addBtn, { backgroundColor: added ? "#22c55e" : colors.primary }]}
          >
            <Ionicons name={added ? "checkmark" : "bag-add-outline"} size={20} color="#fff" />
            <Text style={styles.addBtnText}>{added ? "تمت الإضافة!" : "أضف إلى السلة"}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  backToShop: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14, marginTop: 8 },
  backToShopText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  carouselWrapper: { position: "relative" },
  imageSlide: {
    width: SCREEN_WIDTH,
    height: 320,
    backgroundColor: "#f8f8f8",
    alignItems: "center",
    justifyContent: "center",
  },
  slideImage: { width: "100%", height: "100%" },
  imageDimmed: { opacity: 0.45 },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  thumbBar: { maxHeight: 72 },
  thumbStrip: { paddingHorizontal: 12, gap: 8, paddingVertical: 6 },
  thumb: {
    width: 58,
    height: 58,
    borderRadius: 10,
    borderWidth: 2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbImg: { width: "100%", height: "100%" },
  outOfStockOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center", justifyContent: "center", gap: 8,
  },
  outOfStockLabel: { color: "#fff", fontSize: 20, fontWeight: "800" },
  backBtn: {
    position: "absolute", right: 16,
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3,
  },
  wishlistBtn: {
    position: "absolute", left: 16,
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3,
  },
  discountBadge: { position: "absolute", bottom: 16, left: 16, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  discountText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  content: { padding: 20, gap: 12 },
  name: { fontSize: 22, fontWeight: "800", textAlign: "right", lineHeight: 30 },
  ratingRow: { flexDirection: "row-reverse", alignItems: "center", gap: 4 },
  ratingText: { fontSize: 13, marginRight: 4 },
  priceRow: { flexDirection: "row-reverse", alignItems: "center", gap: 12 },
  price: { fontSize: 26, fontWeight: "800" },
  originalPrice: { fontSize: 16, textDecorationLine: "line-through" },
  sectionTitle: { fontSize: 16, fontWeight: "700", textAlign: "right" },
  description: { fontSize: 14, textAlign: "right", lineHeight: 22 },
  sizesRow: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 8 },
  sizeChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  sizeChipWithMark: { position: "relative", overflow: "hidden" },
  sizeOutOfStockOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    alignItems: "center", justifyContent: "center",
  },
  colorSwatchOuter: {
    flexDirection: "row-reverse", alignItems: "center", gap: 6,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 2,
  },
  colorSwatchInner: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: "rgba(0,0,0,0.15)" },
  featuresBox: { borderRadius: 12, padding: 14, gap: 10, borderWidth: 1, marginTop: 4 },
  featureRow: { flexDirection: "row-reverse", alignItems: "center", gap: 10 },
  featureText: { fontSize: 13, textAlign: "right" },
  footer: { padding: 16, borderTopWidth: 1 },
  addBtn: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 16, borderRadius: 16 },
  addBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  outOfStockBtn: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 16, borderRadius: 16, borderWidth: 1 },
  outOfStockBtnText: { fontSize: 16, fontWeight: "700" },
});
