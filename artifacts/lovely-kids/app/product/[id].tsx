import { getResponsiveTopPadding } from "@/utils/webLayout";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ProductCard } from "@/components/ProductCard";
import { useCart } from "@/context/CartContext";
import { useWishlist } from "@/context/WishlistContext";
import { useAppSettings } from "@/context/AppSettingsContext";
import { useVisibleProducts } from "@/hooks/useVisibleProducts";
import { useColors } from "@/hooks/useColors";
import { confirmDuplicateCartItem, showStockLimit } from "@/utils/cartPrompts";
import { Product, getAvailableStock, isSizeOutOfStock } from "@/data/products";
import { trackMetaEvent } from "@/utils/metaPixel";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

function calcDiscount(price: number, originalPrice?: number | null): number | null {
  if (!originalPrice || originalPrice <= 0 || originalPrice <= price) return null;
  const pct = Math.round(((originalPrice - price) / originalPrice) * 100);
  return pct > 0 ? Math.min(pct, 99) : null;
}

function normalizeArabic(value: string): string {
  return value
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

function inferProductGender(product: Product): "boys" | "girls" | null {
  if (product.gender) return product.gender;

  const name = normalizeArabic(product.nameAr);

  if (/(ولادي|اولاد|ولد)/.test(name)) return "boys";
  if (/(بناتي|بنات|بنت)/.test(name)) return "girls";

  return null;
}

const PRODUCT_TYPE_PATTERNS: Array<[string, RegExp]> = [
  ["dress", /(فستان|فساتين)/],
  ["set", /(طقم|اطقم)/],
  ["overall", /(افرهول|افرول|اوفرول)/],
  ["pajamas", /(بيجام|بجام)/],
  ["shirt", /(قميص|قمصان)/],
  ["tshirt", /(تي ?شيرت|تشيرت)/],
  ["blouse", /(بلوز|بلوزه)/],
  ["pants", /(بنطلون|بناطيل|بلاطين)/],
  ["shorts", /شورت/],
  ["skirt", /(تنوره|تنور)/],
  ["jacket", /(جاكيت|معطف)/],
  ["romper", /(سالوبت|رومبر)/],
  ["towel", /(بشكير|بشاكير)/],
  ["bib", /(قبه|مريله)/],
];

function inferProductType(product: Product): string | null {
  const name = normalizeArabic(product.nameAr);

  for (const [type, pattern] of PRODUCT_TYPE_PATTERNS) {
    if (pattern.test(name)) return type;
  }

  return null;
}

function normalizeSize(value: string, ageGroup: string): string | null {
  let size = normalizeArabic(value)
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/أشهر|اشهر|شهور|شهر/g, "m")
    .replace(/سنوات|سنين|سنه/g, "y")
    .replace(/\s+/g, "")
    .toLowerCase();

  if (!size || /one.?size/.test(size)) return null;

  if (/^\d+(?:-\d+)?$/.test(size)) {
    const unit =
      ageGroup === "newborn" || ageGroup === "infant"
        ? "m"
        : "y";
    size = `${unit}:${size}`;
  } else if (/^\d+(?:-\d+)?m$/.test(size)) {
    size = `m:${size.slice(0, -1)}`;
  } else if (/^\d+(?:-\d+)?y$/.test(size)) {
    size = `y:${size.slice(0, -1)}`;
  }

  return size;
}

function getProductSizes(product: Product): Set<string> {
  const rawSizes = [
    ...(product.sizes ?? []),
    ...(product.colorVariants ?? []).flatMap((variant) =>
      (variant.sizes ?? []).map((entry) => entry.size),
    ),
  ];

  return new Set(
    rawSizes
      .map((size) => normalizeSize(String(size), product.ageGroup))
      .filter((size): size is string => !!size),
  );
}

function isProductFullyOutOfStock(product: Product): boolean {
  const variantSizes =
    product.colorVariants?.flatMap((variant) => variant.sizes ?? []) ?? [];

  if (variantSizes.length > 0) {
    return variantSizes.every(isSizeOutOfStock);
  }

  return (
    product.stock !== undefined &&
    product.stock !== null &&
    product.stock <= 0
  );
}

function similarityScore(current: Product, candidate: Product): number {
  if (candidate.id === current.id || isProductFullyOutOfStock(candidate)) {
    return -1;
  }

  const currentGender = inferProductGender(current);
  const candidateGender = inferProductGender(candidate);

  if (
    currentGender &&
    candidateGender &&
    currentGender !== candidateGender
  ) {
    return -1;
  }

  const currentSizes = getProductSizes(current);
  const candidateSizes = getProductSizes(candidate);

  let sharedSizes = 0;
  for (const size of currentSizes) {
    if (candidateSizes.has(size)) sharedSizes += 1;
  }

  const sameAgeGroup = candidate.ageGroup === current.ageGroup;

  // المنتج المقترح يجب أن يكون من نفس الفئة العمرية
  // أو يشارك المنتج الحالي بمقاس فعلي.
  if (!sameAgeGroup && sharedSizes === 0) {
    return -1;
  }

  let score = 0;

  const currentType = inferProductType(current);
  const candidateType = inferProductType(candidate);

  if (currentType && candidateType && currentType === candidateType) {
    score += 8;
  }

  if (currentGender && candidateGender && currentGender === candidateGender) {
    score += 5;
  } else if (currentGender && !candidateGender) {
    score += 1;
  }

  if (sameAgeGroup) score += 5;

  if (sharedSizes > 0) {
    score += Math.min(5, 2 + sharedSizes);
  }

  if (current.category === candidate.category) score += 1;

  if (
    current.season &&
    candidate.season &&
    current.season === candidate.season
  ) {
    score += 1;
  }

  return score;
}

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const { width: viewportWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const isDesktopWeb =
    Platform.OS === "web" && viewportWidth >= 1200;

  const desktopProductWidth = Math.min(
    Math.max(viewportWidth - 64, 0),
    1280,
  );

  const desktopGalleryWidth = Math.min(
    620,
    Math.floor(desktopProductWidth * 0.5),
  );

  const desktopInfoWidth =
    desktopProductWidth - desktopGalleryWidth - 36;

  const carouselPageWidth = isDesktopWeb
    ? desktopGalleryWidth
    : SCREEN_WIDTH;
  const { addItem, items } = useCart();
  const { toggleItem, isWishlisted } = useWishlist();
  const { settings } = useAppSettings();
  const { products, loading } = useVisibleProducts();

  const product = products.find((p) => p.id === id);

  const similarProducts = useMemo(() => {
    if (!product || Platform.OS !== "web") return [];

    return products
      .map((candidate) => ({
        product: candidate,
        score: similarityScore(product, candidate),
      }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((entry) => entry.product);
  }, [product, products]);

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

  useEffect(() => {
    if (!product) return;

    trackMetaEvent("ViewContent", {
      content_ids: [product.id],
      content_name: product.nameAr,
      content_category: product.category,
      content_type: "product",
      value: product.price,
      currency: "ILS",
    });
  }, [product?.id]);

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

    const selectedColor = activeColorVariant?.color;
    const availableStock = getAvailableStock(
      product,
      selectedSize,
      selectedColor,
    );

    const existing = items.find(
      (item) =>
        item.id === product.id &&
        item.size === selectedSize &&
        item.color === selectedColor,
    );

    const performAdd = () => {
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );
      addItem({
        id: product.id,
        name: product.nameAr,
        price: product.price,
        image: activeColorVariant?.image ?? product.image,
        category: product.category,
        size: selectedSize,
        color: selectedColor,
      });
      trackMetaEvent("AddToCart", {
        content_ids: [product.id],
        content_name: product.nameAr,
        content_category: product.category,
        content_type: "product",
        value: product.price,
        currency: "ILS",
      });

      setCartModal(true);
    };

    if (
      availableStock !== null &&
      (existing?.quantity ?? 0) >= availableStock
    ) {
      showStockLimit(availableStock);
      return;
    }

    if (existing) {
      confirmDuplicateCartItem(performAdd);
      return;
    }

    performAdd();
  };

  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom + 16;
  const topOffset = getResponsiveTopPadding(insets.top);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View
          style={
            isDesktopWeb
              ? {
                  width: desktopProductWidth,
                  alignSelf: "center",
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: 36,
                  paddingTop: 28,
                  paddingBottom: 30,
                }
              : undefined
          }
        >

        {/* ── Image Carousel ── */}
        <View
          style={[
            styles.carouselWrapper,
            isDesktopWeb
              ? { width: desktopGalleryWidth, flexShrink: 0 }
              : null,
          ]}
        >
          <FlatList
            ref={flatRef}
            data={allImages}
            keyExtractor={(_, i) => String(i)}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            getItemLayout={(_, index) => ({
              length: carouselPageWidth,
              offset: carouselPageWidth * index,
              index,
            })}
            onMomentumScrollEnd={(e) => {
              const idx = Math.round(
                e.nativeEvent.contentOffset.x / carouselPageWidth,
              );
              setActiveIdx(idx);
            }}
            renderItem={({ item }) => (
              <View
                style={[
                  styles.imageSlide,
                  { width: carouselPageWidth },
                  isDesktopWeb
                    ? {
                        height: 600,
                        borderRadius: 24,
                        overflow: "hidden",
                      }
                    : null,
                  isOutOfStock && styles.imageDimmed,
                ]}
              >
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
            style={[
              styles.backBtn,
              {
                top: isDesktopWeb ? 14 : topOffset + 8,
                backgroundColor: colors.card,
              },
            ]}
          >
            <Ionicons name="arrow-forward" size={22} color={colors.foreground} />
          </Pressable>

          {/* Wishlist Button */}
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              toggleItem({ id: product.id, name: product.nameAr, price: product.price, image: product.image, category: product.category });
            }}
            style={[
              styles.wishlistBtn,
              {
                top: isDesktopWeb ? 14 : topOffset + 8,
                backgroundColor: colors.card,
              },
            ]}
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
        <View
          style={[
            styles.content,
            { backgroundColor: colors.background },
            isDesktopWeb
              ? {
                  width: desktopInfoWidth,
                  maxWidth: desktopInfoWidth,
                  paddingHorizontal: 0,
                  paddingTop: 8,
                  paddingBottom: 0,
                }
              : null,
          ]}
        >
          <Text
            style={[
              styles.name,
              { color: colors.foreground },
              isDesktopWeb ? styles.desktopName : null,
            ]}
          >
            {product.nameAr}
          </Text>

          <View style={styles.priceRow}>
            <Text
              style={[
                styles.price,
                {
                  color: isOutOfStock
                    ? colors.mutedForeground
                    : colors.primary,
                },
                isDesktopWeb ? styles.desktopPrice : null,
              ]}
            >
              {product.price} ₪
            </Text>
            {product.originalPrice && !isOutOfStock && (
              <Text style={[styles.originalPrice, { color: colors.mutedForeground }]}>{product.originalPrice} ₪</Text>
            )}
          </View>

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
                    <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 11 }}>{cv.color}</Text>
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
                      <Text style={{ color: selectedSize === s.size ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 12 }}>
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
                    <Text style={{ color: selectedSize === size ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 12 }}>
                      {size}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <View
            style={[
              styles.detailCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              تفاصيل المنتج
            </Text>
            <Text style={[styles.description, { color: colors.mutedForeground }]}>
              {product.description}
            </Text>
          </View>

          {(product.facebookUrl || product.instagramUrl || product.tiktokUrl) ? (
            <View
              style={[
                styles.socialCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontSize: 13,
                  fontWeight: "600",
                  textAlign: "right",
                  marginBottom: 8,
                }}
              >
                {product.facebookUrl && !product.instagramUrl && !product.tiktokUrl
                  ? "لمشاهدة المنتج على صفحة الفيس بوك"
                  : product.instagramUrl && !product.facebookUrl && !product.tiktokUrl
                    ? "لمشاهدة المنتج على صفحة الإنستغرام"
                    : product.tiktokUrl && !product.facebookUrl && !product.instagramUrl
                      ? "لمشاهدة المنتج على صفحة التيك توك"
                      : "لمشاهدة المنتج على صفحاتنا"}
              </Text>

              <View
                style={{
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  gap: 10,
                }}
              >
              {product.facebookUrl ? (
                <Pressable
                  onPress={() => void Linking.openURL(product.facebookUrl!)}
                  accessibilityLabel="فتح رابط Facebook"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: colors.card,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Ionicons name="logo-facebook" size={21} color="#1877F2" />
                </Pressable>
              ) : null}

              {product.instagramUrl ? (
                <Pressable
                  onPress={() => void Linking.openURL(product.instagramUrl!)}
                  accessibilityLabel="فتح رابط Instagram"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: colors.card,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Ionicons name="logo-instagram" size={21} color="#E1306C" />
                </Pressable>
              ) : null}

              {product.tiktokUrl ? (
                <Pressable
                  onPress={() => void Linking.openURL(product.tiktokUrl!)}
                  accessibilityLabel="فتح رابط TikTok"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: colors.card,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Ionicons name="logo-tiktok" size={21} color={colors.foreground} />
                </Pressable>
              ) : null}
              </View>
            </View>
          ) : null}


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

          {Platform.OS === "web" && similarProducts.length > 0 ? (
            <View style={styles.similarSection}>
              <View style={styles.similarHeader}>
                <Text style={[styles.similarTitle, { color: colors.foreground }]}>
                  قد يعجبك أيضًا
                </Text>
                <Text style={[styles.similarSubtitle, { color: colors.mutedForeground }]}>
                  منتجات مشابهة مناسبة لنفس العمر
                </Text>
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.similarList}
              >
                {similarProducts.map((item) => (
                  <ProductCard
                    key={item.id}
                    product={item}
                    style={styles.similarCard}
                  />
                ))}
              </ScrollView>
            </View>
          ) : null}
        </View>

        </View>
      </ScrollView>

      {/* Add to Cart Footer */}
      <View
        style={[
          styles.footer,
          {
            backgroundColor: colors.background,
            borderColor: colors.border,
            paddingBottom: isDesktopWeb ? 16 : bottomPad,
          },
          isDesktopWeb
            ? {
                width: desktopProductWidth,
                alignSelf: "center",
                borderWidth: 1,
                borderRadius: 18,
                marginBottom: 18,
              }
            : null,
        ]}
      >
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
          <Pressable
            style={[
              styles.modalCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
              isDesktopWeb
                ? {
                    maxWidth: 560,
                    paddingHorizontal: 28,
                    paddingVertical: 26,
                  }
                : null,
            ]}
          >
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
    height: Platform.OS === "web" ? 420 : 340,
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
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 18, gap: 8, width: "100%", maxWidth: 760, alignSelf: "center" },
  name: { fontSize: 18, fontWeight: "800", textAlign: "right", lineHeight: 25 },
  desktopName: {
    fontSize: 24,
    lineHeight: 34,
    marginBottom: 4,
  },
  priceRow: { flexDirection: "row-reverse", alignItems: "center", gap: 12 },
  price: { fontSize: 22, fontWeight: "800" },
  desktopPrice: {
    fontSize: 30,
  },
  originalPrice: { fontSize: 14, textDecorationLine: "line-through" },
  sectionTitle: { fontSize: 14, fontWeight: "700", textAlign: "right" },
  description: { fontSize: 13, textAlign: "right", lineHeight: 20 },
  detailCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 7,
    marginTop: 4,
  },
  socialCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginTop: 2,
    marginBottom: 2,
  },
  sizesRow: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 8 },
  sizeChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, borderWidth: 1 },
  sizeChipWithMark: { position: "relative", overflow: "hidden" },
  sizeOutOfStockOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    alignItems: "center", justifyContent: "center",
  },
  colorSwatchOuter: {
    flexDirection: "row-reverse", alignItems: "center", gap: 6,
    paddingHorizontal: 9, paddingVertical: 5, borderRadius: 18, borderWidth: 2,
  },
  colorSwatchInner: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: "rgba(0,0,0,0.15)" },
  featuresBox: { borderRadius: 12, padding: 14, gap: 10, borderWidth: 1, marginTop: 4 },
  featureRow: { flexDirection: "row-reverse", alignItems: "center", gap: 10 },
  featureText: { fontSize: 13, textAlign: "right" },
  similarSection: {
    marginTop: 14,
    gap: 10,
  },
  similarHeader: {
    alignItems: "flex-end",
    gap: 2,
  },
  similarTitle: {
    fontSize: 18,
    fontWeight: "800",
    textAlign: "right",
  },
  similarSubtitle: {
    fontSize: 12,
    fontWeight: "500",
    textAlign: "right",
  },
  similarList: {
    gap: 12,
    paddingVertical: 4,
    paddingHorizontal: 1,
  },
  similarCard: {
    width: 205,
    flexShrink: 0,
  },
  footer: { paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1 },
  addBtn: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 14, borderRadius: 16 },
  addBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  outOfStockBtn: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 14, borderRadius: 16, borderWidth: 1 },
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
