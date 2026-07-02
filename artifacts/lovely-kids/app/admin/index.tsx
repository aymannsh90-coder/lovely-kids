import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

const ADMIN_PASSWORD = "aymansh90";

export default function AdminLoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 16;

  const handleLogin = () => {
    if (password === ADMIN_PASSWORD) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setError(false);
      router.replace("/admin/products");
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(true);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View
        style={[
          styles.inner,
          { paddingTop: topPadding + 12, paddingBottom: bottomPadding },
        ]}
      >
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-forward" size={24} color={colors.foreground} />
        </Pressable>

        <View style={styles.content}>
          {/* Icon */}
          <View style={[styles.iconBox, { backgroundColor: colors.primary }]}>
            <Ionicons name="shield-checkmark" size={40} color="#fff" />
          </View>

          <Text style={[styles.title, { color: colors.foreground }]}>
            لوحة الإدارة
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            أدخل كلمة المرور للدخول
          </Text>

          {/* Password Input */}
          <View
            style={[
              styles.inputRow,
              {
                backgroundColor: colors.card,
                borderColor: error ? colors.destructive : colors.border,
              },
            ]}
          >
            <Pressable onPress={() => setShowPass((v) => !v)}>
              <Ionicons
                name={showPass ? "eye-off-outline" : "eye-outline"}
                size={20}
                color={colors.mutedForeground}
              />
            </Pressable>
            <TextInput
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                setError(false);
              }}
              placeholder="كلمة المرور"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry={!showPass}
              style={[styles.input, { color: colors.foreground }]}
              textAlign="right"
              onSubmitEditing={handleLogin}
              returnKeyType="done"
            />
            <Ionicons name="lock-closed-outline" size={20} color={colors.mutedForeground} />
          </View>

          {error && (
            <Text style={[styles.errorText, { color: colors.destructive }]}>
              كلمة المرور غير صحيحة
            </Text>
          )}

          <Pressable
            onPress={handleLogin}
            style={[styles.loginBtn, { backgroundColor: colors.primary }]}
          >
            <Ionicons name="log-in-outline" size={20} color="#fff" />
            <Text style={styles.loginBtnText}>دخول</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, paddingHorizontal: 24 },
  backBtn: { width: 40, height: 40, justifyContent: "center" },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  iconBox: {
    width: 80,
    height: 80,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  title: { fontSize: 26, fontWeight: "800" },
  subtitle: { fontSize: 14, marginBottom: 8 },
  inputRow: {
    width: "100%",
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  input: { flex: 1, fontSize: 16, padding: 0 },
  errorText: { fontSize: 13, fontWeight: "600" },
  loginBtn: {
    width: "100%",
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 16,
    marginTop: 8,
  },
  loginBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
