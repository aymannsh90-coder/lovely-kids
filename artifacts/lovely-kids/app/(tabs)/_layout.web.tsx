import { Ionicons } from "@expo/vector-icons";
import { router, Tabs } from "expo-router";
import React from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { useAppSettings } from "@/context/AppSettingsContext";
import { useCart } from "@/context/CartContext";
import { useColors } from "@/hooks/useColors";

export default function TabLayout() {
  const colors = useColors();
  const { settings } = useAppSettings();
  const { totalItems } = useCart();
  const { width } = useWindowDimensions();
  const isDesktopWeb = width >= 1200;

  const desktopHeader = () => (
    <View
      style={[
        desktopStyles.header,
        {
          backgroundColor: colors.background,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <View style={desktopStyles.headerShell}>
        <View style={desktopStyles.brandArea}>
          <Pressable
            onPress={() => router.push("/")}
            style={desktopStyles.logoButton}
          >
            <Image
              source={require("@/assets/images/lovely-kids-logo-horizontal.png")}
              style={desktopStyles.logo}
              resizeMode="contain"
            />
          </Pressable>
        </View>

        <View style={desktopStyles.nav}>
          <Pressable
            onPress={() => router.push("/")}
            style={desktopStyles.navButton}
          >
            <Ionicons name="home-outline" size={18} color={colors.primary} />
            <Text style={[desktopStyles.navText, { color: colors.foreground }]}>
              الرئيسية
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/products")}
            style={desktopStyles.navButton}
          >
            <Ionicons name="bag-outline" size={18} color={colors.primary} />
            <Text style={[desktopStyles.navText, { color: colors.foreground }]}>
              المنتجات
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/offers")}
            style={desktopStyles.navButton}
          >
            <Ionicons name="pricetag-outline" size={18} color={colors.primary} />
            <Text style={[desktopStyles.navText, { color: colors.foreground }]}>
              العروض
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/contact")}
            style={desktopStyles.navButton}
          >
            <Ionicons name="chatbubble-outline" size={18} color={colors.primary} />
            <Text style={[desktopStyles.navText, { color: colors.foreground }]}>
              تواصل معنا
            </Text>
          </Pressable>
        </View>

        <View style={desktopStyles.actions}>
          <Pressable
            onPress={() => router.push("/wishlist")}
            style={[
              desktopStyles.actionButton,
              { borderColor: colors.border },
            ]}
          >
            <Ionicons name="heart-outline" size={21} color={colors.foreground} />
          </Pressable>

          <Pressable
            onPress={() => router.push("/cart")}
            style={[
              desktopStyles.actionButton,
              { borderColor: colors.border },
            ]}
          >
            <Ionicons name="cart-outline" size={21} color={colors.foreground} />
            {totalItems > 0 ? (
              <View
                style={[
                  desktopStyles.cartBadge,
                  { backgroundColor: colors.primary },
                ]}
              >
                <Text style={desktopStyles.cartBadgeText}>
                  {totalItems > 99 ? "99+" : totalItems}
                </Text>
              </View>
            ) : null}
          </Pressable>

          <Pressable
            onPress={() => router.push("/profile")}
            style={[
              desktopStyles.actionButton,
              { borderColor: colors.border },
            ]}
          >
            <Ionicons name="person-outline" size={21} color={colors.foreground} />
          </Pressable>
        </View>
      </View>
    </View>
  );

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: isDesktopWeb,
        header: desktopHeader,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: colors.background,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 0,
          height: 84,
          display: isDesktopWeb ? "none" : "flex",
        },
        tabBarBackground: () => (
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: colors.background },
            ]}
          />
        ),
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
      }}
    >
      <Tabs.Screen
        name="profile"
        options={{
          title: settings.tabLabelProfile,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />{" "}
      <Tabs.Screen
        name="cart"
        options={{
          title: "السلة",
          tabBarBadge: totalItems > 0 ? totalItems : undefined,
          tabBarBadgeStyle: {
            backgroundColor: colors.primary,
            fontSize: 10,
            minWidth: 16,
            height: 16,
          },
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cart-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: settings.tabLabelProducts,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bag-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: settings.tabLabelHome,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}


const desktopStyles = StyleSheet.create({
  header: {
    height: 100,
    borderBottomWidth: 1,
    justifyContent: "center",
  },
  headerShell: {
    width: "100%",
    maxWidth: 1200,
    alignSelf: "center",
    paddingHorizontal: 16,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 24,
  },
  brandArea: {
    width: 205,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
  },
  logoButton: {
    width: 205,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  logo: {
    width: 185,
    height: 70,
  },
  nav: {
    flex: 1,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  navButton: {
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: 12,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  navText: {
    fontSize: 14,
    fontWeight: "700",
  },
  actions: {
    width: 205,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 8,
  },
  actionButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  cartBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  cartBadgeText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "800",
  },
});
