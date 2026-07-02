import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React from "react";
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useCart } from "@/context/CartContext";
import { useWishlist } from "@/context/WishlistContext";
import { useColors } from "@/hooks/useColors";
import { Product } from "@/data/products";

interface Props {
  product: Product;
  style?: object;
}

export function ProductCard({ product, style }: Props) {
  const colors = useColors();
  const { addItem } = useCart();
  const { toggleItem, isWishlisted } = useWishlist();
  const wishlisted = isWishlisted(product.id);

  const isOutOfStock = product.stock !== undefined && product.stock !== null && product.stock <= 0;

  const handleAddToCart = () => {
    if (isOutOfStock) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    addItem({
      id: product.id,
      name: product.nameAr,
      price: product.price,
      image: product.image,
      category: product.category,
    });
  };

  const handleToggleWishlist = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggleItem({
      id: product.id,
      name: product.nameAr,
      price: product.price,
      image: product.image,
      category: product.category,
    });
  };

  return (
    <Pressable
      onPress={() => router.push({ pathname: "/product/[id]", params: { id: product.id } })}
      style={({ pressed }) => [
        styles.container,
        { backgroundColor: colors.card, borderColor: isOutOfStock ? colors.border : colors.border },
        pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
        style,
      ]}
    >
      <View style={styles.imageWrapper}>
        <Image source={{ uri: product.image }} style={[styles.image, isOutOfStock && styles.imageDimmed]} />

        {/* Out of Stock Overlay */}
        {isOutOfStock && (
          <View style={styles.outOfStockOverlay}>
            <Text style={styles.outOfStockText}>نفد المخزون</Text>
          </View>
        )}

        {/* Badges — only if in stock */}
        {!isOutOfStock && product.discount && (
          <View style={[styles.discountBadge, { backgroundColor: colors.primary }]}>
            <Text style={styles.discountText}>-{product.discount}%</Text>
          </View>
        )}
        {!isOutOfStock && product.isNew && !product.discount && (
          <View style={[styles.discountBadge, { backgroundColor: "#22c55e" }]}>
            <Text style={styles.discountText}>جديد</Text>
          </View>
        )}

        <Pressable
          onPress={handleToggleWishlist}
          style={[styles.wishlistBtn, { backgroundColor: colors.card }]}
          hitSlop={8}
        >
          <Ionicons
            name={wishlisted ? "heart" : "heart-outline"}
            size={18}
            color={wishlisted ? colors.primary : colors.mutedForeground}
          />
        </Pressable>
      </View>

      <View style={styles.info}>
        <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={2}>
          {product.nameAr}
        </Text>

        <View style={styles.ratingRow}>
          <Ionicons name="star" size={12} color="#F59E0B" />
          <Text style={[styles.rating, { color: colors.mutedForeground }]}>
            {product.rating} ({product.reviews})
          </Text>
        </View>

        <View style={styles.priceRow}>
          <View>
            <Text style={[styles.price, { color: isOutOfStock ? colors.mutedForeground : colors.primary }]}>
              {product.price} ₪
            </Text>
            {product.originalPrice && !isOutOfStock && (
              <Text style={[styles.originalPrice, { color: colors.mutedForeground }]}>
                {product.originalPrice} ₪
              </Text>
            )}
          </View>
          <Pressable
            onPress={handleAddToCart}
            disabled={isOutOfStock}
            style={[styles.addBtn, { backgroundColor: isOutOfStock ? colors.muted : colors.primary }]}
          >
            <Ionicons name={isOutOfStock ? "close" : "add"} size={18} color={isOutOfStock ? colors.mutedForeground : "#fff"} />
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
      },
      android: { elevation: 3 },
    }),
  },
  imageWrapper: {
    position: "relative",
    height: 160,
    backgroundColor: "#f8f8f8",
  },
  image: {
    width: "100%",
    height: "100%",
    resizeMode: "contain",
  },
  imageDimmed: {
    opacity: 0.45,
  },
  outOfStockOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  outOfStockText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 14,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    overflow: "hidden",
  },
  discountBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  discountText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  wishlistBtn: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  info: {
    padding: 12,
    gap: 6,
  },
  name: {
    fontSize: 13,
    fontWeight: "600",
    textAlign: "right",
    lineHeight: 18,
  },
  ratingRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 3,
  },
  rating: {
    fontSize: 11,
  },
  priceRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  price: {
    fontSize: 15,
    fontWeight: "700",
    textAlign: "right",
  },
  originalPrice: {
    fontSize: 11,
    textDecorationLine: "line-through",
    textAlign: "right",
  },
  addBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
});
