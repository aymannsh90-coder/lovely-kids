import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Platform,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { useProductCategories } from "@/hooks/useProductCategories";
import { useColors } from "@/hooks/useColors";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const BRAND_PINK = "#E91E8C";
const BRAND_BLUE = "#96DFEC";
const BRAND_BG = "#F0FAFE";
const BRAND_NAVY = "#172554";

function getCategoryEmoji(id: string, label: string): string | null {
  const text = label.trim().toLowerCase();

  if (id === "all" || text === "الكل") return null;

  if (text.includes("مستلزمات") && text.includes("بيبي"))
    return "🍼";

  if (
    text.includes("اطقم بيبي") ||
    text.includes("أطقم بيبي")
  )
    return "👶";

  if (text.includes("فستان") || text.includes("فساتين"))
    return "👗";

  if (
    text === "اطقم" ||
    text === "أطقم" ||
    text === "طقم"
  )
    return "👕👖";

  if (
    text.includes("بلاطين") ||
    text.includes("بناطيل") ||
    text.includes("بنطلون")
  )
    return "👖";

  if (text.includes("قمصان") || text.includes("قميص"))
    return "👔";

  if (
    text.includes("بلايز") ||
    text.includes("بلوز") ||
    text.includes("بلوزة")
  )
    return "👕";

  if (text.includes("تست"))
    return "⭐";

  return "⭐";
}

export function CategoryMenu() {
  const colors = useColors();
  const categories = useProductCategories();
  const { width } = useWindowDimensions();
  const { openCategories, category } = useLocalSearchParams<{
    openCategories?: string;
    category?: string;
  }>();

  const [visible, setVisible] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;

  const isWeb = Platform.OS === "web";
  const menuWidth = Math.min(width * 0.72, 300);
  const activeCategory = category || "all";

  const openMenu = () => {
    setVisible(true);
    requestAnimationFrame(() => {
      Animated.timing(progress, {
        toValue: 1,
        duration: 240,
        useNativeDriver: true,
      }).start();
    });
  };

  useEffect(() => {
    if (openCategories) {
      openMenu();
    }
  }, [openCategories]);

  const closeMenu = (afterClose?: () => void) => {
    Animated.timing(progress, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setVisible(false);
      afterClose?.();
    });
  };

  const openCategory = (categoryId: string) => {
    closeMenu(() => {
      router.push({
        pathname: "/(tabs)/products",
        params: { category: categoryId, fromMenu: "1" },
      });
    });
  };

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [menuWidth, 0],
  });

  return (
    <>
      <Pressable
        onPress={openMenu}
        style={styles.menuButton}
        accessibilityLabel="فتح قائمة التصنيفات"
      >
        <Ionicons name="menu-outline" size={28} color={colors.foreground} />
      </Pressable>

      <Modal
        visible={visible}
        transparent
        animationType="none"
        onRequestClose={() => closeMenu()}
      >
        <View style={styles.modalRoot}>
          <Animated.View
            style={[
              styles.backdrop,
              {
                opacity: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 0.35],
                }),
              },
            ]}
          >
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => closeMenu()}
            />
          </Animated.View>

          <Animated.View
            style={[
              styles.drawer,
              {
                width: menuWidth,
                backgroundColor: isWeb ? BRAND_BG : colors.background,
                borderLeftColor: isWeb ? BRAND_BLUE + "80" : colors.border,
                transform: [{ translateX }],
              },
            ]}
          >
            <View
              style={[
                styles.header,
                isWeb && styles.webHeader,
                {
                  borderBottomColor: isWeb
                    ? BRAND_BLUE + "70"
                    : colors.border,
                },
              ]}
            >
              <Pressable
                onPress={() => closeMenu()}
                style={[
                  styles.closeButton,
                  isWeb && styles.webCloseButton,
                  {
                    backgroundColor: isWeb ? "#FFFFFF" : colors.card,
                  },
                ]}
              >
                <Ionicons
                  name="close"
                  size={22}
                  color={isWeb ? BRAND_NAVY : colors.foreground}
                />
              </Pressable>

              {isWeb ? (
                <View style={styles.webTitleWrap}>
                  <Text style={styles.webSparkle}>✦</Text>
                  <Ionicons
                    name="heart-outline"
                    size={22}
                    color={BRAND_PINK}
                  />
                  <Text style={styles.webTitle}>التصنيفات</Text>
                </View>
              ) : (
                <Text style={[styles.title, { color: colors.foreground }]}>
                  التصنيفات
                </Text>
              )}
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[
                styles.categories,
                isWeb && styles.webCategories,
              ]}
            >
              {categories.map((categoryItem) => {
                const isSelected =
                  isWeb && categoryItem.id === activeCategory;

                if (!isWeb) {
                  return (
                    <Pressable
                      key={categoryItem.id}
                      onPress={() => openCategory(categoryItem.id)}
                      style={({ pressed }) => [
                        styles.categoryRow,
                        {
                          backgroundColor: pressed
                            ? colors.primary + "12"
                            : colors.background,
                          borderBottomColor: colors.border,
                        },
                      ]}
                    >
                      <Ionicons
                        name={
                          categoryItem.id === "all"
                            ? "grid-outline"
                            : "chevron-back-outline"
                        }
                        size={18}
                        color={
                          categoryItem.id === "all"
                            ? colors.primary
                            : colors.mutedForeground
                        }
                      />

                      <Text
                        style={[
                          styles.categoryText,
                          {
                            color:
                              categoryItem.id === "all"
                                ? colors.primary
                                : colors.foreground,
                          },
                        ]}
                      >
                        {categoryItem.label}
                      </Text>
                    </Pressable>
                  );
                }

                return (
                  <Pressable
                    key={categoryItem.id}
                    onPress={() => openCategory(categoryItem.id)}
                    style={({ pressed }) => [
                      styles.webCategoryCard,
                      {
                        backgroundColor: isSelected
                          ? pressed
                            ? "#FBDCEC"
                            : "#FFF0F7"
                          : pressed
                            ? "#F6FCFE"
                            : "#FFFFFF",
                        borderColor: isSelected
                          ? BRAND_PINK + "70"
                          : BRAND_BLUE + "65",
                        borderRightColor: isSelected
                          ? BRAND_PINK
                          : BRAND_BLUE + "65",
                        borderRightWidth: isSelected ? 4 : 1,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.webIconBubble,
                        {
                          backgroundColor: isSelected
                            ? BRAND_PINK + "18"
                            : BRAND_BLUE + "28",
                        },
                      ]}
                    >
                      {categoryItem.id === "all" ? (
                        <Ionicons
                          name="grid-outline"
                          size={19}
                          color={isSelected ? BRAND_PINK : "#25A9D6"}
                        />
                      ) : (
                        <Text
                          style={[
                            styles.categoryEmoji,
                            categoryItem.label.includes("طقم") ||
                            categoryItem.label.includes("أطقم") ||
                            categoryItem.label.includes("اطقم")
                              ? styles.categoryEmojiWide
                              : null,
                          ]}
                        >
                          {getCategoryEmoji(
                            categoryItem.id,
                            categoryItem.label,
                          )}
                        </Text>
                      )}
                    </View>

                    <Text
                      style={[
                        styles.webCategoryText,
                        {
                          color: isSelected
                            ? BRAND_PINK
                            : BRAND_NAVY,
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {categoryItem.label}
                    </Text>

                    <Ionicons
                      name="chevron-forward-outline"
                      size={18}
                      color={isSelected ? BRAND_PINK : "#25A9D6"}
                    />
                  </Pressable>
                );
              })}

              {isWeb && (
                <View style={styles.webFooter}>
                  <View style={styles.webFooterIcon}>
                    <Ionicons
                      name="heart"
                      size={21}
                      color={BRAND_PINK}
                    />
                  </View>

                  <View style={styles.webFooterTextWrap}>
                    <Text style={styles.webFooterTitle}>
                      كل ما يحتاجه طفلك
                    </Text>
                    <Text style={styles.webFooterSubtitle}>
                      بجودة عالية وحب كبير
                    </Text>
                  </View>

                  <Text style={styles.webFooterSparkles}>✦ ✧</Text>
                </View>
              )}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  menuButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
  },
  modalRoot: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },
  drawer: {
    position: "absolute",
    top: 0,
    right: Platform.OS === "web" ? 0 : undefined,
    start: Platform.OS === "web" ? undefined : 0,
    bottom: 0,
    height: "100%",
    borderLeftWidth: 1,
    elevation: 18,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: -4, height: 0 },
  },
  header: {
    paddingTop: 54,
    paddingHorizontal: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  webHeader: {
    paddingTop: 48,
    paddingHorizontal: 14,
    paddingBottom: 16,
    backgroundColor: "#F8FDFF",
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  webCloseButton: {
    borderWidth: 1,
    borderColor: BRAND_BLUE + "70",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
  },
  webTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  webTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: BRAND_NAVY,
  },
  webSparkle: {
    color: "#24B7C9",
    fontSize: 13,
    fontWeight: "900",
  },
  categories: {
    paddingBottom: 40,
  },
  webCategories: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 8,
  },
  categoryRow: {
    minHeight: 56,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  categoryText: {
    fontSize: 16,
    fontWeight: "700",
    textAlign: "right",
  },
  webCategoryCard: {
    minHeight: 54,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.035,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 2 },
  },
  webIconBubble: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  categoryEmoji: {
    fontSize: 18,
    lineHeight: 22,
    textAlign: "center",
  },
  categoryEmojiWide: {
    fontSize: 13,
  },
  webCategoryText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
    textAlign: "right",
  },
  webFooter: {
    marginTop: 12,
    minHeight: 74,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "#F8FDFF",
    borderWidth: 1,
    borderColor: BRAND_BLUE + "60",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  webFooterIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: BRAND_PINK + "16",
    alignItems: "center",
    justifyContent: "center",
  },
  webFooterTextWrap: {
    flex: 1,
  },
  webFooterTitle: {
    color: BRAND_PINK,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "right",
  },
  webFooterSubtitle: {
    marginTop: 2,
    color: "#64748B",
    fontSize: 10,
    fontWeight: "600",
    textAlign: "right",
  },
  webFooterSparkles: {
    color: "#25A9D6",
    fontSize: 12,
    fontWeight: "900",
  },
});
