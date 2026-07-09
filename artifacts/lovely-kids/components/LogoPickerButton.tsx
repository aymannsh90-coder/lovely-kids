import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import React, { useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";

import { API_BASE } from "@/constants/api";
import { useColors } from "@/hooks/useColors";

interface LogoPickerButtonProps {
  value: string;
  fallbackSource: number;
  onChange: (url: string) => void;
}

export function LogoPickerButton({ value, fallbackSource, onChange }: LogoPickerButtonProps) {
  const colors = useColors();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError("يجب السماح بالوصول إلى الصور لرفع الشعار");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      base64: true,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    const base64 = asset.base64;
    const mimeType = asset.mimeType ?? "image/jpeg";

    if (!base64) {
      setError("تعذّر قراءة الصورة، جرب صورة أخرى");
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/images/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64, mimeType }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "فشل الرفع");
      }

      const data = (await res.json()) as { url: string };
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onChange(data.url);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "فشل رفع الشعار";
      setError(msg);
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Pressable
        onPress={handlePick}
        style={[styles.logoBox, { backgroundColor: colors.background, borderColor: colors.border }]}
      >
        {uploading ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Image
            source={value ? { uri: value } : fallbackSource}
            style={styles.logoImage}
            resizeMode="contain"
          />
        )}
      </Pressable>
      <Pressable
        onPress={handlePick}
        disabled={uploading}
        style={[styles.changeBtn, { backgroundColor: colors.secondary }]}
      >
        <Ionicons name="image-outline" size={16} color={colors.foreground} />
        <Text style={[styles.changeBtnText, { color: colors.foreground }]}>
          {value ? "تغيير الشعار" : "رفع شعار"}
        </Text>
      </Pressable>
      {!!value && (
        <Pressable onPress={() => onChange("")} style={styles.resetBtn}>
          <Text style={[styles.resetBtnText, { color: colors.mutedForeground }]}>
            استخدام الشعار الافتراضي
          </Text>
        </Pressable>
      )}
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", gap: 10, paddingVertical: 4 },
  logoBox: {
    width: 96,
    height: 96,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logoImage: { width: 84, height: 84 },
  changeBtn: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  changeBtnText: { fontSize: 13, fontWeight: "700" },
  resetBtn: { paddingVertical: 2 },
  resetBtnText: { fontSize: 12, textDecorationLine: "underline" },
  errorText: { color: "#EF4444", fontSize: 12, textAlign: "center" },
});
