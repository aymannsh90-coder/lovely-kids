import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { API_BASE } from "@/constants/api";
import { DateField } from "@/components/DateField";
import { useAppSettings } from "@/context/AppSettingsContext";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

type UploadResponse = {
  url: string;
  objectPath: string;
  type: "image" | "video";
};

function isValidDate(value: string): boolean {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function PromoPopupSettings() {
  const colors = useColors();
  const { getAuthToken } = useAuth();
  const { settings, settingsReady, updateSettings } = useAppSettings();

  const [enabled, setEnabled] = useState(settings.promoPopupEnabled ?? false);
  const [imageUrl, setImageUrl] = useState(settings.promoPopupImageUrl ?? "");
  const [link, setLink] = useState(settings.promoPopupLink ?? "");
  const [startDate, setStartDate] = useState(settings.promoPopupStartDate ?? "");
  const [endDate, setEndDate] = useState(settings.promoPopupEndDate ?? "");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const initialized = useRef(false);

  useEffect(() => {
    if (!settingsReady || initialized.current) return;

    initialized.current = true;
    setEnabled(settings.promoPopupEnabled ?? false);
    setImageUrl(settings.promoPopupImageUrl ?? "");
    setLink(settings.promoPopupLink ?? "");
    setStartDate(settings.promoPopupStartDate ?? "");
    setEndDate(settings.promoPopupEndDate ?? "");
  }, [settingsReady]);

  const removeStoredFile = async (objectPath: string) => {
    if (!objectPath) return true;

    const token = await getAuthToken();
    if (!token) return false;

    const res = await fetch(
      `${API_BASE}/api/hero-media/${encodeURIComponent(objectPath)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    return res.ok;
  };

  const uploadImage = async (
    uri: string,
    filename: string,
  ): Promise<UploadResponse> => {
    const token = await getAuthToken();
    if (!token) throw new Error("يجب تسجيل الدخول كمشرف");

    const response = await fetch(uri);
    const blob = await response.blob();

    const form = new FormData();
    form.append("file", blob, filename);

    const res = await fetch(`${API_BASE}/api/hero-media/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    });

    const data = (await res.json().catch(() => ({}))) as
      | UploadResponse
      | { error?: string };

    if (!res.ok || !("url" in data)) {
      throw new Error(
        "error" in data && data.error
          ? data.error
          : "فشل رفع صورة الإعلان",
      );
    }

    return data;
  };

  const pickImage = async () => {
    if (uploading) return;

    const permission =
      await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setMessage("يجب السماح بالوصول إلى الصور");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setUploading(true);
    setMessage("");

    let uploaded: UploadResponse | null = null;

    try {
      const sourceWidth = Math.max(asset.width ?? 1200, 1);
      const sourceHeight = Math.max(asset.height ?? 1200, 1);

      const actions =
        sourceWidth >= sourceHeight
          ? [{ resize: { width: Math.min(sourceWidth, 1400) } }]
          : [{ resize: { height: Math.min(sourceHeight, 1400) } }];

      const compressed = await manipulateAsync(
        asset.uri,
        actions,
        {
          compress: 0.8,
          format: SaveFormat.JPEG,
        },
      );

      uploaded = await uploadImage(
        compressed.uri,
        `popup-${Date.now()}.jpg`,
      );

      const oldPath = settings.promoPopupObjectPath ?? "";

      const saved = await updateSettings({
        promoPopupImageUrl: uploaded.url,
        promoPopupObjectPath: uploaded.objectPath,
      });

      if (!saved) {
        await removeStoredFile(uploaded.objectPath).catch(() => false);
        throw new Error("تعذر حفظ صورة الإعلان في الإعدادات");
      }

      setImageUrl(uploaded.url);

      if (oldPath && oldPath !== uploaded.objectPath) {
        await removeStoredFile(oldPath).catch(() => false);
      }

      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );

      setMessage("✅ تم رفع صورة الإعلان بنجاح");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "فشل رفع صورة الإعلان",
      );
    } finally {
      setUploading(false);
    }
  };

  const deleteImageNow = async () => {
    const oldPath = settings.promoPopupObjectPath ?? "";

    const saved = await updateSettings({
      promoPopupEnabled: false,
      promoPopupImageUrl: "",
      promoPopupObjectPath: "",
    });

    if (!saved) {
      setMessage("تعذر حذف الصورة من الإعدادات");
      return;
    }

    setEnabled(false);
    setImageUrl("");

    if (oldPath) {
      await removeStoredFile(oldPath).catch(() => false);
    }

    setMessage("✅ تم حذف صورة الإعلان");
  };

  const requestDeleteImage = () => {
    if (Platform.OS === "web") {
      if (window.confirm("هل تريد حذف صورة الإعلان؟")) {
        void deleteImageNow();
      }
      return;
    }

    Alert.alert(
      "حذف صورة الإعلان",
      "هل تريد حذف صورة الإعلان؟",
      [
        { text: "إلغاء", style: "cancel" },
        {
          text: "حذف",
          style: "destructive",
          onPress: () => void deleteImageNow(),
        },
      ],
    );
  };

  const save = async () => {
    const cleanStart = startDate.trim();
    const cleanEnd = endDate.trim();

    if (!isValidDate(cleanStart) || !isValidDate(cleanEnd)) {
      setMessage("صيغة التاريخ يجب أن تكون YYYY-MM-DD");
      return;
    }

    if (cleanStart && cleanEnd && cleanStart > cleanEnd) {
      setMessage("تاريخ البداية يجب أن يكون قبل تاريخ النهاية");
      return;
    }

    if (enabled && !imageUrl) {
      setMessage("ارفع صورة الإعلان أولاً قبل تفعيله");
      return;
    }

    setSaving(true);
    setMessage("");

    const ok = await updateSettings({
      promoPopupEnabled: enabled,
      promoPopupLink: link.trim(),
      promoPopupStartDate: cleanStart,
      promoPopupEndDate: cleanEnd,
    });

    setSaving(false);

    if (!ok) {
      setMessage("تعذر حفظ إعدادات الإعلان");
      return;
    }

    Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Success,
    );

    setMessage(
      enabled
        ? "✅ تم حفظ الإعلان وتفعيله"
        : "✅ تم حفظ إعدادات الإعلان",
    );
  };

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
        📣 الإعلان المنبثق عند فتح المتجر
      </Text>

      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text
              style={[
                styles.mainLabel,
                { color: colors.foreground },
              ]}
            >
              تفعيل الإعلان
            </Text>
            <Text
              style={[
                styles.helpText,
                { color: colors.mutedForeground },
              ]}
            >
              يظهر مرة واحدة فقط خلال جلسة الاستخدام
            </Text>
          </View>

          <Switch
            value={enabled}
            onValueChange={setEnabled}
            trackColor={{
              false: colors.muted,
              true: colors.primary,
            }}
            thumbColor="#fff"
          />
        </View>

        <View
          style={[
            styles.divider,
            { backgroundColor: colors.border },
          ]}
        />

        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={styles.preview}
            resizeMode="contain"
          />
        ) : (
          <View
            style={[
              styles.emptyPreview,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
              },
            ]}
          >
            <Ionicons
              name="image-outline"
              size={44}
              color={colors.mutedForeground}
            />
            <Text
              style={[
                styles.helpText,
                { color: colors.mutedForeground },
              ]}
            >
              لم يتم رفع صورة بعد
            </Text>
          </View>
        )}

        <View style={styles.actionRow}>
          <Pressable
            onPress={pickImage}
            disabled={uploading}
            style={[
              styles.actionButton,
              {
                backgroundColor: colors.primary,
                opacity: uploading ? 0.6 : 1,
              },
            ]}
          >
            {uploading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons
                name="cloud-upload-outline"
                size={19}
                color="#fff"
              />
            )}
            <Text style={styles.actionButtonText}>
              {uploading ? "جاري الرفع..." : "رفع / تغيير الصورة"}
            </Text>
          </Pressable>

          {imageUrl ? (
            <Pressable
              onPress={requestDeleteImage}
              style={[
                styles.deleteButton,
                { borderColor: "#ef4444" },
              ]}
            >
              <Ionicons
                name="trash-outline"
                size={18}
                color="#ef4444"
              />
              <Text style={styles.deleteText}>حذف الصورة</Text>
            </Pressable>
          ) : null}
        </View>

        <View
          style={[
            styles.divider,
            { backgroundColor: colors.border },
          ]}
        />

        <Text
          style={[
            styles.label,
            { color: colors.mutedForeground },
          ]}
        >
          رابط عند الضغط على الصورة — اختياري
        </Text>
        <TextInput
          value={link}
          onChangeText={setLink}
          placeholder="مثال: /products أو https://..."
          placeholderTextColor={colors.mutedForeground}
          style={[
            styles.input,
            {
              backgroundColor: colors.input,
              borderColor: colors.border,
              color: colors.foreground,
            },
          ]}
          textAlign="right"
          autoCapitalize="none"
        />

        <DateField
          label="تاريخ بداية العرض — اختياري"
          value={startDate}
          onChange={setStartDate}
          colors={colors}
        />

        <DateField
          label="تاريخ نهاية العرض — اختياري"
          value={endDate}
          onChange={setEndDate}
          colors={colors}
        />

        <Pressable
          onPress={save}
          disabled={saving}
          style={[
            styles.saveButton,
            {
              backgroundColor: saving
                ? colors.muted
                : colors.primary,
            },
          ]}
        >
          {saving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Ionicons
              name="save-outline"
              size={19}
              color="#fff"
            />
          )}

          <Text style={styles.saveButtonText}>
            {saving ? "جاري الحفظ..." : "حفظ إعدادات الإعلان"}
          </Text>
        </Pressable>

        {message ? (
          <Text
            style={[
              styles.message,
              {
                color: message.startsWith("✅")
                  ? "#16a34a"
                  : "#dc2626",
              },
            ]}
          >
            {message}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginHorizontal: 16,
    marginTop: 18,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "800",
    textAlign: "right",
    marginBottom: 9,
  },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  switchRow: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  switchText: {
    flex: 1,
  },
  mainLabel: {
    fontSize: 15,
    fontWeight: "800",
    textAlign: "right",
  },
  helpText: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: "right",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  preview: {
    width: "100%",
    height: 320,
    borderRadius: 14,
    backgroundColor: "#fff",
  },
  emptyPreview: {
    height: 180,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  actionRow: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    gap: 8,
    flexWrap: "wrap",
  },
  actionButton: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    flexGrow: 1,
  },
  actionButtonText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 13,
  },
  deleteButton: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  deleteText: {
    color: "#ef4444",
    fontWeight: "800",
    fontSize: 13,
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    textAlign: "right",
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  saveButton: {
    minHeight: 48,
    borderRadius: 12,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 4,
  },
  saveButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
  },
  message: {
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
});
