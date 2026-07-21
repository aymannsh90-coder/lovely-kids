import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ClerkProviderWrapper } from "@/components/ClerkProviderWrapper";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { WelcomeSplash } from "@/components/WelcomeSplash";
import { AppSettingsProvider } from "@/context/AppSettingsContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import { NewOrdersProvider } from "@/context/NewOrdersContext";
import { ProductsProvider } from "@/context/ProductsContext";
import { WishlistProvider } from "@/context/WishlistContext";
import { usePushNotifications } from "@/hooks/usePushNotifications";

SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({
  fade: true,
  duration: 400,
});

const queryClient = new QueryClient();

// Maximum time (ms) to wait for fonts before giving up and proceeding anyway.
const FONT_LOAD_TIMEOUT_MS = 5000;
// Maximum time (ms) the welcome splash can stay on screen no matter what.
const SPLASH_HARD_TIMEOUT_MS = 3500;

function RootLayoutNav() {
  const { user, getAuthToken } = useAuth();
  usePushNotifications(user?.phone, getAuthToken);
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="product/[id]" />
      <Stack.Screen name="cart" />
      <Stack.Screen name="wishlist" />
      <Stack.Screen name="search" />
      <Stack.Screen name="contact" />
      <Stack.Screen name="about" />
      <Stack.Screen name="admin/products" />
      <Stack.Screen name="admin/add-product" />
      <Stack.Screen name="admin/settings" />
      <Stack.Screen name="admin/offers" />
      <Stack.Screen name="admin/orders" />
      <Stack.Screen name="admin/categories" />
      <Stack.Screen name="admin/users" />
      <Stack.Screen name="admin/notifications" />
      <Stack.Screen name="admin/push-debug" />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    ionicons: require("../assets/fonts/Ionicons.ttf"),
    feather: require("../assets/fonts/Feather.ttf"),
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  // Safety: if fonts take too long, proceed anyway so the app never gets stuck.
  const [fontTimedOut, setFontTimedOut] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);

  useEffect(() => {
    console.log("[Startup] App startup begin");
    const t = setTimeout(() => {
      console.log("[Startup] Font load timed out — proceeding without fonts");
      setFontTimedOut(true);
    }, FONT_LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);

  const fontsReady = fontsLoaded || !!fontError || fontTimedOut;

  useEffect(() => {
    if (fontsReady) {
      console.log("[Startup] Fonts ready — hiding native splash");
      SplashScreen.hideAsync();
    }
  }, [fontsReady]);

  // Hard safety: splash must never stay on screen longer than SPLASH_HARD_TIMEOUT_MS
  // regardless of what happens inside WelcomeSplash or its contexts.
  useEffect(() => {
    if (!fontsReady) return;

    const t = setTimeout(() => {
      console.log("[Startup] Splash hard timeout — forcing dismiss");
      setShowWelcome(false);
    }, SPLASH_HARD_TIMEOUT_MS);

    return () => clearTimeout(t);
  }, [fontsReady]);

  if (!fontsReady) {
    return <View style={{ flex: 1, backgroundColor: "#E91E8C" }} />;
  }

  return (
    <ClerkProviderWrapper>
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <AppSettingsProvider>
                <ProductsProvider>
                  <CartProvider>
                    <WishlistProvider>
                      <NewOrdersProvider>
                        <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#E91E8C" }}>
                          {Platform.OS !== "web" ? (
                            <KeyboardProvider>
                              <RootLayoutNav />
                              {showWelcome && (
                                <WelcomeSplash
                                  onFinish={() => {
                                    console.log("[Startup] Splash finished");
                                    setShowWelcome(false);
                                  }}
                                />
                              )}
                            </KeyboardProvider>
                          ) : (
                            <>
                              <RootLayoutNav />
                              {showWelcome && (
                                <WelcomeSplash
                                  onFinish={() => {
                                    console.log("[Startup] Web splash finished");
                                    setShowWelcome(false);
                                  }}
                                />
                              )}
                            </>
                          )}
                        </GestureHandlerRootView>
                      </NewOrdersProvider>
                    </WishlistProvider>
                  </CartProvider>
                </ProductsProvider>
              </AppSettingsProvider>
            </AuthProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </ClerkProviderWrapper>
  );
}
