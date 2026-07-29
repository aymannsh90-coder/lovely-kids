import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
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

export function CategoryMenu() {
  const colors = useColors();
  const categories = useProductCategories();
  const { width } = useWindowDimensions();
  const { openCategories } = useLocalSearchParams<{ openCategories?: string }>();
  const [visible, setVisible] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;

  const menuWidth = Math.min(width * 0.72, 300);

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
                backgroundColor: colors.background,
                borderLeftColor: colors.border,
                transform: [{ translateX }],
              },
            ]}
          >
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <Pressable
                onPress={() => closeMenu()}
                style={[styles.closeButton, { backgroundColor: colors.card }]}
              >
                <Ionicons name="close" size={22} color={colors.foreground} />
              </Pressable>

              <Text style={[styles.title, { color: colors.foreground }]}>
                التصنيفات
              </Text>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.categories}
            >
              {categories.map((category) => (
                <Pressable
                  key={category.id}
                  onPress={() => openCategory(category.id)}
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
                      category.id === "all"
                        ? "grid-outline"
                        : "chevron-back-outline"
                    }
                    size={18}
                    color={
                      category.id === "all"
                        ? colors.primary
                        : colors.mutedForeground
                    }
                  />

                  <Text
                    style={[
                      styles.categoryText,
                      {
                        color:
                          category.id === "all"
                            ? colors.primary
                            : colors.foreground,
                      },
                    ]}
                  >
                    {category.label}
                  </Text>
                </Pressable>
              ))}
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
    right: 0,
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
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
  },
  categories: {
    paddingBottom: 40,
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
});
