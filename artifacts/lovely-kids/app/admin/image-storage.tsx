import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppSettings } from "@/context/AppSettingsContext";
import { useColors } from "@/hooks/useColors";

type StorageProvider = "r2" | "supabase";

type ProviderCardProps = {
  value: StorageProvider;
  selected: boolean;
  title: string;
  subtitle: string;
  badge?: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
};

export default function ImageStorageSettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings, settingsReady, updateSettings } = useAppSettings();

  const [selected, setSelected] =
    useState<StorageProvider>("supabase");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!settingsReady) return;

    setSelected(
      settings.imageStorageProvider === "r2"
        ? "r2"
        : "supabase",
    );
  }, [settingsReady, settings.imageStorageProvider]);

  const save = async () => {
    if (saving) return;

    setSaving(true);
    setMessage("");

    const ok = await updateSettings({
      imageStorageProvider: selected,
    });

    setSaving(false);

    if (ok) {
      setMessage(
        selected === "r2"
          ? "✅ تم اعتماد Cloudflare R2 للصور الجديدة"
          : "✅ تم اعتماد Supabase للصور الجديدة",
      );
    } else {
      setMessage("❌ تعذر حفظ إعداد التخزين");
    }
  };

  const ProviderCard = ({
    selected: active,
    title,
    subtitle,
    badge,
    icon,
    onPress,
  }: ProviderCardProps) => (
    <Pressable
      onPress={onPress}
      style={[
        styles.providerCard,
        {
          backgroundColor: colors.card,
          borderColor: active
            ? colors.primary
            : colors.border,
          borderWidth: active ? 2 : 1,
        },
      ]}
    >
      <View style={styles.providerHeader}>
        <View
          style={[
            styles.radioOuter,
            {
              borderColor: active
                ? colors.primary
                : colors.mutedForeground,
            },
          ]}
        >
          {active ? (
            <View
              style={[
                styles.radioInner,
                { backgroundColor: colors.primary },
              ]}
            />
          ) : null}
        </View>

        <View style={styles.providerText}>
          <View style={styles.titleRow}>
            {badge ? (
              <View
                style={[
                  styles.badge,
                  { backgroundColor: colors.primary },
                ]}
              >
                <Text style={styles.badgeText}>
                  {badge}
                </Text>
              </View>
            ) : null}

            <Text
              style={[
                styles.providerTitle,
                { color: colors.foreground },
              ]}
            >
              {title}
            </Text>
          </View>

          <Text
            style={[
              styles.providerSubtitle,
              { color: colors.mutedForeground },
            ]}
          >
            {subtitle}
          </Text>
        </View>

        <Ionicons
          name={icon}
          size={30}
          color={active ? colors.primary : colors.mutedForeground}
        />
      </View>
    </Pressable>
  );

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top,
        },
      ]}
    >
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.card,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons
            name="arrow-forward"
            size={24}
            color={colors.foreground}
          />
        </Pressable>

        <Text
          style={[
            styles.headerTitle,
            { color: colors.foreground },
          ]}
        >
          تخزين الصور
        </Text>

        <View style={styles.backButton} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.infoCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <Ionicons
            name="information-circle-outline"
            size={25}
            color={colors.primary}
          />

          <View style={styles.infoText}>
            <Text
              style={[
                styles.infoTitle,
                { color: colors.foreground },
              ]}
            >
              مكان تخزين الصور الجديدة
            </Text>

            <Text
              style={[
                styles.infoDescription,
                { color: colors.mutedForeground },
              ]}
            >
              هذا الاختيار يطبق على الصور الجديدة فقط.
              الصور القديمة تبقى في مكانها الحالي وتستمر بالظهور
              بشكل طبيعي.
            </Text>
          </View>
        </View>

        <ProviderCard
          value="r2"
          selected={selected === "r2"}
          title="Cloudflare R2"
          subtitle="تخزين صور المنتجات واللوجو على R2"
          badge="موصى به"
          icon="cloud-outline"
          onPress={() => {
            setSelected("r2");
            setMessage("");
          }}
        />

        <ProviderCard
          value="supabase"
          selected={selected === "supabase"}
          title="Supabase Storage"
          subtitle="استخدام التخزين السابق في Supabase"
          icon="server-outline"
          onPress={() => {
            setSelected("supabase");
            setMessage("");
          }}
        />

        <View
          style={[
            styles.notice,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <Text
            style={[
              styles.noticeText,
              { color: colors.mutedForeground },
            ]}
          >
            • صور المنتجات واللوجو تتبع هذا الاختيار.
            {"\n"}
            • صور وفيديو الـ Hero تبقى على Supabase حالياً.
            {"\n"}
            • تغيير الخيار لا ينقل ولا يحذف الصور القديمة.
          </Text>
        </View>

        {message ? (
          <Text
            style={[
              styles.message,
              {
                color: message.startsWith("✅")
                  ? colors.foreground
                  : "#B00020",
              },
            ]}
          >
            {message}
          </Text>
        ) : null}

        <Pressable
          disabled={saving}
          onPress={save}
          style={[
            styles.saveButton,
            {
              backgroundColor: colors.primary,
              opacity: saving ? 0.65 : 1,
            },
          ]}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons
                name="save-outline"
                size={20}
                color="#fff"
              />
              <Text style={styles.saveText}>
                حفظ مكان التخزين
              </Text>
            </>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    minHeight: 58,
    borderBottomWidth: 1,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "800",
  },
  backButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    padding: 16,
    gap: 14,
    paddingBottom: 40,
  },
  infoCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    flexDirection: "row-reverse",
    alignItems: "flex-start",
    gap: 12,
  },
  infoText: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: "800",
    textAlign: "right",
    marginBottom: 6,
  },
  infoDescription: {
    fontSize: 13,
    lineHeight: 21,
    textAlign: "right",
  },
  providerCard: {
    borderRadius: 16,
    padding: 16,
  },
  providerHeader: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 12,
  },
  providerText: {
    flex: 1,
  },
  titleRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  providerTitle: {
    fontSize: 16,
    fontWeight: "800",
    textAlign: "right",
  },
  providerSubtitle: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: "right",
  },
  badge: {
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "800",
  },
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  notice: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  noticeText: {
    textAlign: "right",
    lineHeight: 23,
    fontSize: 13,
  },
  message: {
    textAlign: "center",
    fontSize: 14,
    fontWeight: "700",
  },
  saveButton: {
    minHeight: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row-reverse",
    gap: 8,
  },
  saveText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800",
  },
});
