import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  Image,
  Modal,
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
import { useAppSettings } from "@/context/AppSettingsContext";
import { useVisibleProducts } from "@/hooks/useVisibleProducts";
import { useColors } from "@/hooks/useColors";
import { isSizeOutOfStock } from "@/data/products";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

function calcDiscount(price: number, originalPrice?: number | null): number | null {
  if (!originalPrice || originalPrice <= 0 || originalPrice <= price) return null;
  const pct = Math.round(((originalPrice - price) / originalPrice) * 100);
  return pct > 0 ? Math.min(pct, 99) : null;
}

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { addItem } = useCart();
  const { toggleItem, isWishlisted } = useWishlist();
  const { settings } = useAppSettings();
  const { products, loading } = useVisibleProducts();

  const product = products.find((p) => p.id === id);

  const hasColorVariants = !!product?.colorVariants && product.colorVariants.length > 0;
  const [selectedColor, setSelectedColor] = useState<string | undefined>(undefined);
  const activeColorVariant = hasColorVariants
    ? product!.colorVariants!.find((c) => c.color === selectedColor)
    : undefined;
  const [selectedSize, setSelectedSize] = useState<string | undefined>(undefined);
  const [added, setAdded] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [cartModal, setCartModal] = useState(false);
  const flatRef = useRef<FlatList>(null);

  useEffect(() => {
    setSelectedSize(undefined);
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

  const allImages = [
    ...new Set([
      ...(product.images && product.images.length > 0
        ? product.images
        : [product.image]),
      ...(product.colorVariants ?? [])
        .map((variant) => variant.image)
        .filter((img): img is string => !!img),
    ]),
  ];

  const wishlisted = isWishlisted(product.id);
  const isOutOfStock = product.stock !== undefined && product.stock !== null && product.stock <= 0;
  const discountPct = calcDiscount(product.price, product.originalPrice);

  const needsColor = hasColorVariants && !activeColorVariant?.color;
  const needsSize = hasColorVariants
    ? !!activeColorVariant && activeColorVariant.sizes.length > 0 && !selectedSize
    : !!product.sizes && product.sizes.length > 0 && !selectedSize;
  const selectionIncomplete = needsColor || needsSize;

  const handleAddToCart = () => {
    if (isOutOfStock || selectionIncomplete) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    addItem({
      id: product.id,
      name: product.nameAr,
      price: product.price,
      image: activeColorVariant?.image ?? product.image,
      category: product.category,
      size: selectedSize,
      color: activeColorVariant?.color,
    });
    setCartModal(true);
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

          {!isOutOfStock && discountPct ? (
            <View style={[styles.discountBadge, { backgroundColor: colors.primary }]}>
              <Text style={styles.discountText}>خصم {discountPct}%</Text>
            </View>
          ) : null}

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
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                اللون {needsColor ? "(مطلوب)" : ""}
              </Text>
              <View style={styles.sizesRow}>
                {product.colorVariants!.map((cv) => (
                  <Pressable
                    key={cv.color}
                    onPress={() => {
                      if (isOutOfStock) return;

                      setSelectedColor(cv.color);

                      if (cv.image) {
                        const imageIndex = allImages.indexOf(cv.image);
                        if (imageIndex >= 0) {
                          flatRef.current?.scrollToIndex({
                            index: imageIndex,
                            animated: true,
                          });
                          setActiveIdx(imageIndex);
                        }
                      }
                    }}
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
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                المقاس {needsSize ? "(مطلوب)" : ""}
              </Text>
              <View style={styles.sizesRow}>
                {activeColorVariant.sizes.map((s) => {
                  const sizeOut = isSizeOutOfStock(s);
                  const disabled = isOutOfStock || sizeOut;
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
                          opacity: sizeOut ? 0.45 : isOutOfStock ? 0.5 : 1,
                        },
                      ]}
                    >
                      <Text style={{ color: selectedSize === s.size ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 13 }}>
                        {s.size}
                      </Text>
                      {sizeOut && (
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
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                المقاس {needsSize ? "(مطلوب)" : ""}
              </Text>
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
              { icon: "refresh-outline" as const, text: "إمكانية الاستبدال بالبضاعة السليمة" },
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
          <>
            {selectionIncomplete && (
              <Text style={[styles.selectionHint, { color: colors.primary }]}>
                {needsColor ? "يرجى اختيار اللون" : "يرجى اختيار المقاس"}
              </Text>
            )}
            <Pressable
              onPress={handleAddToCart}
              disabled={selectionIncomplete}
              style={[
                styles.addBtn,
                { backgroundColor: selectionIncomplete ? colors.muted : colors.primary },
              ]}
            >
              <Ionicons
                name="bag-add-outline"
                size={20}
                color={selectionIncomplete ? colors.mutedForeground : "#fff"}
              />
              <Text
                style={[
                  styles.addBtnText,
                  { color: selectionIncomplete ? colors.mutedForeground : "#fff" },
                ]}
              >
                أضف إلى السلة
              </Text>
            </Pressable>
          </>
        )}
      </View>

      {/* ── Added-to-cart modal ── */}
      <Modal
        transparent
        visible={cartModal}
        animationType="fade"
        onRequestClose={() => setCartModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setCartModal(false)}>
          <Pressable style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.modalIconWrap, { backgroundColor: colors.primary + "18" }]}>
              <Ionicons name="checkmark-circle" size={44} color={colors.primary} />
            </View>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>تمت الإضافة إلى السلة!</Text>
            <Text style={[styles.modalSub, { color: colors.mutedForeground }]}>{product.nameAr}</Text>

            <Pressable
              style={[styles.modalPrimaryBtn, { backgroundColor: colors.primary }]}
              onPress={() => { setCartModal(false); router.push("/cart"); }}
            >
              <Ionicons name="bag-check-outline" size={18} color="#fff" />
              <Text style={styles.modalPrimaryBtnText}>إتمام الشراء</Text>
            </Pressable>

            <Pressable
              style={[styles.modalSecondaryBtn, { borderColor: colors.border }]}
              onPress={() => setCartModal(false)}
            >
              <Text style={[styles.modalSecondaryBtnText, { color: colors.foreground }]}>متابعة التسوق</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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
  selectionHint: { fontSize: 12, fontWeight: "600", textAlign: "center", marginBottom: 8 },
  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center", alignItems: "center", padding: 24,
  },
  modalCard: {
    width: "100%", borderRadius: 24, borderWidth: 1,
    padding: 24, alignItems: "center", gap: 8,
  },
  modalIconWrap: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  modalTitle: { fontSize: 18, fontWeight: "800", textAlign: "center" },
  modalSub: { fontSize: 13, textAlign: "center", marginBottom: 8 },
  modalPrimaryBtn: {
    width: "100%", flexDirection: "row-reverse", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 14, borderRadius: 14, marginTop: 4,
  },
  modalPrimaryBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  modalSecondaryBtn: {
    width: "100%", alignItems: "center", justifyContent: "center",
    paddingVertical: 12, borderRadius: 14, borderWidth: 1, marginTop: 4,
  },
  modalSecondaryBtnText: { fontSize: 14, fontWeight: "600" },
});
