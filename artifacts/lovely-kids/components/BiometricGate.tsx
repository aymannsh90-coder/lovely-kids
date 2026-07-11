import { useAuth } from "@clerk/expo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { BIOMETRIC_ENABLED_KEY } from "@/hooks/useBiometric";

// Resets when the JS runtime restarts (app force-quit + reopen).
// Prevents re-prompting when navigating between screens.
let sessionUnlocked = false;

type GateState = "checking" | "locked" | "open";

export function BiometricGate({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, signOut } = useAuth();
  const [gate, setGate] = useState<GateState>("checking");
  const [authenticating, setAuthenticating] = useState(false);
  const autoTriggered = useRef(false);

  const openGate = useCallback(() => {
    sessionUnlocked = true;
    setGate("open");
  }, []);

  const triggerAuth = useCallback(async () => {
    if (authenticating) return;
    setAuthenticating(true);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "افتح Lovely Kids باستخدام البصمة أو رمز الهاتف",
        cancelLabel: "إلغاء",
        fallbackLabel: "رمز الهاتف",
        disableDeviceFallback: false,
      });
      if (result.success) {
        openGate();
      }
    } catch {
      // stay locked — user can retry or sign out
    } finally {
      setAuthenticating(false);
    }
  }, [authenticating, openGate]);

  useEffect(() => {
    if (!isLoaded) return;
    if (Platform.OS === "web") { setGate("open"); return; }
    if (!isSignedIn) { sessionUnlocked = false; setGate("open"); return; }
    if (sessionUnlocked) { setGate("open"); return; }

    AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY).then((val) => {
      if (val === "true") {
        setGate("locked");
        if (!autoTriggered.current) {
          autoTriggered.current = true;
          triggerAuth();
        }
      } else {
        setGate("open");
      }
    });
  }, [isLoaded, isSignedIn, triggerAuth]);

  const handleSignOut = useCallback(async () => {
    sessionUnlocked = false;
    autoTriggered.current = false;
    await signOut();
    setGate("open");
  }, [signOut]);

  if (gate === "checking") {
    return <View style={styles.splash} />;
  }

  if (gate === "locked") {
    return (
      <View style={styles.lockScreen}>
        <Image
          source={require("@/assets/images/logo.jpg")}
          style={styles.logo}
          resizeMode="contain"
        />

        <View style={styles.iconCircle}>
          <Text style={styles.iconEmoji}>🔒</Text>
        </View>

        <Text style={styles.title}>Lovely Kids</Text>
        <Text style={styles.subtitle}>قم بالتحقق للمتابعة</Text>

        <Pressable
          onPress={triggerAuth}
          disabled={authenticating}
          style={[styles.biometricBtn, authenticating && { opacity: 0.7 }]}
        >
          {authenticating ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.biometricBtnText}>
              🔓 الدخول بالبصمة أو رمز الهاتف
            </Text>
          )}
        </Pressable>

        <Pressable onPress={handleSignOut} style={styles.signOutLink}>
          <Text style={styles.signOutText}>تسجيل الدخول بطريقة أخرى</Text>
        </Pressable>
      </View>
    );
  }

  return <>{children}</>;
}

const PRIMARY = "#E91E8C";

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: PRIMARY },
  lockScreen: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 16,
  },
  logo: { width: 160, height: 80, marginBottom: 8 },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: PRIMARY + "18",
    alignItems: "center",
    justifyContent: "center",
  },
  iconEmoji: { fontSize: 36 },
  title: { fontSize: 22, fontWeight: "800", color: "#1a1a1a" },
  subtitle: { fontSize: 15, color: "#888", marginBottom: 8 },
  biometricBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 32,
    alignItems: "center",
    width: "100%",
  },
  biometricBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  signOutLink: { marginTop: 8, padding: 8 },
  signOutText: { color: PRIMARY, fontSize: 14, fontWeight: "600" },
});
