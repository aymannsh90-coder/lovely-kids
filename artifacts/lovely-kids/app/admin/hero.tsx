import { getResponsiveTopPadding } from "@/utils/webLayout";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { router } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { API_BASE } from "@/constants/api";
import {
  type HeroSlide,
  useAppSettings,
} from "@/context/AppSettingsContext";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

const MAX_SLIDES = 5;
const MAX_VIDEO_BYTES = 8 * 1024 * 1024;

type UploadResponse = {
  url: string;
  objectPath: string;
  type: "image" | "video";
};

function HeroVideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
    instance.muted = true;
    instance.play();
  });

  return (
    <VideoView
      player={player}
      style={styles.previewMedia}
      contentFit="cover"
      nativeControls={false}
    />
  );
}

function normalizeSlides(slides: HeroSlide[]): HeroSlide[] {
  return [...slides]
    .sort((a, b) => a.order - b.order)
    .map((slide, index) => ({
      ...slide,
      order: index + 1,
    }));
}

export default function AdminHeroScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings, updateSettings } = useAppSettings();
  const { getAuthToken } = useAuth();

  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const slides = normalizeSlides(settings.heroSlides ?? []);

  const topPadding = getResponsiveTopPadding(insets.top);
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 20;

  const removeStoredFile = async (objectPath: string): Promise<boolean> => {
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

  const uploadFormData = async (
    uri: string,
    mimeType: string,
    filename: string,
    webFile?: File,
  ): Promise<UploadResponse> => {
    const token = await getAuthToken();
    if (!token) throw new Error("يجب تسجيل الدخول كمشرف");

    const form = new FormData();

    if (Platform.OS === "web") {
      let blob: Blob;

      if (webFile) {
        blob = webFile;
      } else {
        const response = await fetch(uri);
        blob = await response.blob();
      }

      form.append("file", blob, filename);
    } else {
      form.append(
        "file",
        {
          uri,
          name: filename,
          type: mimeType,
        } as unknown as Blob,
      );
    }

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
          : "فشل رفع الملف",
      );
    }

    return data;
  };

  const prepareAndUploadImage = async (
    asset: ImagePicker.ImagePickerAsset,
  ): Promise<UploadResponse> => {
    const sourceWidth = Math.max(1, asset.width ?? 1200);
    const sourceHeight = Math.max(1, asset.height ?? 600);

    const sourceRatio = sourceWidth / sourceHeight;
    const targetRatio = 2;

    let cropWidth = sourceWidth;
    let cropHeight = sourceHeight;
    let originX = 0;
    let originY = 0;

    if (sourceRatio > targetRatio) {
      cropWidth = Math.round(sourceHeight * targetRatio);
      originX = Math.round((sourceWidth - cropWidth) / 2);
    } else if (sourceRatio < targetRatio) {
      cropHeight = Math.round(sourceWidth / targetRatio);
      originY = Math.round((sourceHeight - cropHeight) / 2);
    }

    const compressed = await manipulateAsync(
      asset.uri,
      [
        {
          crop: {
            originX,
            originY,
            width: cropWidth,
            height: cropHeight,
          },
        },
        {
          resize: {
            width: 1200,
            height: 600,
          },
        },
      ],
      {
        compress: 0.72,
        format: SaveFormat.JPEG,
      },
    );

    return uploadFormData(
      compressed.uri,
      "image/jpeg",
      `hero-${Date.now()}.jpg`,
    );
  };

  const addSlide = async () => {
    if (uploading || slides.length >= MAX_SLIDES) return;

    const permission =
      await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setMessage("يجب السماح بالوصول إلى الصور والفيديو");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      quality: 1,
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    const isVideo =
      asset.type === "video" ||
      asset.mimeType?.toLowerCase() === "video/mp4";

    if (
      isVideo &&
      asset.mimeType &&
      asset.mimeType.toLowerCase() !== "video/mp4"
    ) {
      setMessage("الفيديو يجب أن يكون بصيغة MP4");
      return;
    }

    if (
      isVideo &&
      asset.fileSize &&
      asset.fileSize > MAX_VIDEO_BYTES
    ) {
      setMessage("حجم الفيديو يجب ألا يتجاوز 8MB");
      return;
    }

    setUploading(true);
    setMessage("");

    let uploaded: UploadResponse | null = null;

    try {
      if (isVideo) {
        uploaded = await uploadFormData(
          asset.uri,
          "video/mp4",
          `hero-${Date.now()}.mp4`,
          Platform.OS === "web" ? asset.file : undefined,
        );
      } else {
        uploaded = await prepareAndUploadImage(asset);
      }

      const next = normalizeSlides([
        ...slides,
        {
          id:
            Date.now().toString() +
            Math.random().toString(36).slice(2, 7),
          type: uploaded.type,
          url: uploaded.url,
          objectPath: uploaded.objectPath,
          active: true,
          order: slides.length + 1,
        },
      ]);

      const saved = await updateSettings({ heroSlides: next });

      if (!saved) {
        await removeStoredFile(uploaded.objectPath).catch(() => false);
        throw new Error("تعذر حفظ إعدادات Hero");
      }

      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );

      setMessage(
        uploaded.type === "video"
          ? "✅ تم رفع الفيديو"
          : "✅ تم ضغط الصورة إلى 1200×600 ورفعها",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "حدث خطأ أثناء الرفع",
      );
    } finally {
      setUploading(false);
    }
  };

  const toggleSlide = async (slide: HeroSlide) => {
    setBusyId(slide.id);

    const next = slides.map((item) =>
      item.id === slide.id
        ? { ...item, active: !item.active }
        : item,
    );

    const saved = await updateSettings({ heroSlides: next });

    setMessage(
      saved
        ? "✅ تم تحديث حالة الشريحة"
        : "تعذر حفظ التعديل",
    );

    setBusyId(null);
  };

  const moveSlide = async (
    slide: HeroSlide,
    direction: -1 | 1,
  ) => {
    const current = normalizeSlides(slides);
    const index = current.findIndex(
      (item) => item.id === slide.id,
    );

    const target = index + direction;

    if (
      index < 0 ||
      target < 0 ||
      target >= current.length
    ) {
      return;
    }

    const swapped = [...current];
    [swapped[index], swapped[target]] = [
      swapped[target],
      swapped[index],
    ];

    const reorderedSlides = swapped.map((item, itemIndex) => ({
      ...item,
      order: itemIndex + 1,
    }));

    setBusyId(slide.id);
    const saved = await updateSettings({
      heroSlides: reorderedSlides,
    });

    setMessage(
      saved ? "✅ تم تغيير الترتيب" : "تعذر حفظ الترتيب",
    );

    setBusyId(null);
  };

  const deleteSlideNow = async (slide: HeroSlide) => {
    setBusyId(slide.id);
    setMessage("");

    try {
      const deleted = await removeStoredFile(
        slide.objectPath,
      );

      if (!deleted) {
        throw new Error(
          "تعذر حذف الملف من Supabase Storage",
        );
      }

      const next = normalizeSlides(
        slides.filter((item) => item.id !== slide.id),
      );

      const saved = await updateSettings({
        heroSlides: next,
      });

      if (!saved) {
        throw new Error(
          "تم حذف الملف من التخزين لكن تعذر تحديث الإعدادات",
        );
      }

      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );

      setMessage(
        "✅ تم حذف الملف نهائيًا من Storage والإعدادات",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "فشل حذف الشريحة",
      );
    } finally {
      setBusyId(null);
    }
  };

  const requestDelete = (slide: HeroSlide) => {
    if (Platform.OS === "web") {
      const confirmed =
        typeof window !== "undefined"
          ? window.confirm(
              "حذف هذه الشريحة نهائيًا من التخزين؟",
            )
          : true;

      if (confirmed) {
        void deleteSlideNow(slide);
      }

      return;
    }

    Alert.alert(
      "حذف الشريحة",
      "سيتم حذف الملف نهائيًا من التخزين ولن يبقى يشغل مساحة.",
      [
        { text: "إلغاء", style: "cancel" },
        {
          text: "حذف نهائي",
          style: "destructive",
          onPress: () => void deleteSlideNow(slide),
        },
      ],
    );
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        paddingBottom: bottomPadding,
      }}
      showsVerticalScrollIndicator={false}
    >
      <View
        style={[
          styles.header,
          {
            paddingTop: topPadding + 12,
            backgroundColor: colors.primary,
          },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
        >
          <Ionicons
            name="arrow-forward"
            size={24}
            color="#fff"
          />
        </Pressable>

        <View style={{ alignItems: "center" }}>
          <Text style={styles.headerTitle}>
            Hero Slider
          </Text>
          <Text style={styles.headerSubtitle}>
            صورة الغلاف الرئيسية
          </Text>
        </View>

        <View style={{ width: 24 }} />
      </View>

      <View style={styles.body}>
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
            size={22}
            color={colors.primary}
          />
          <View style={{ flex: 1 }}>
            <Text
              style={[
                styles.infoTitle,
                { color: colors.foreground },
              ]}
            >
              حتى 5 شرائح
            </Text>
            <Text
              style={[
                styles.infoText,
                { color: colors.mutedForeground },
              ]}
            >
              الصور تُقص وتُضغط تلقائيًا إلى 1200×600.
              الفيديو MP4 وبحد أقصى 8MB.
            </Text>
          </View>
        </View>

        {message ? (
          <Text
            style={[
              styles.message,
              { color: colors.foreground },
            ]}
          >
            {message}
          </Text>
        ) : null}

        {slides.map((slide, index) => (
          <View
            key={slide.id}
            style={[
              styles.slideCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.slideTopRow}>
              <View style={styles.orderBadge}>
                <Text style={styles.orderText}>
                  {index + 1}
                </Text>
              </View>

              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.slideTitle,
                    { color: colors.foreground },
                  ]}
                >
                  {slide.type === "video"
                    ? "🎬 فيديو"
                    : "🖼️ صورة"}
                </Text>
                <Text
                  style={[
                    styles.slideStatus,
                    {
                      color: slide.active
                        ? "#16a34a"
                        : colors.mutedForeground,
                    },
                  ]}
                >
                  {slide.active ? "مفعلة" : "مخفية"}
                </Text>
              </View>
            </View>

            <View
              style={[
                styles.preview,
                { backgroundColor: colors.muted },
              ]}
            >
              {slide.type === "video" ? (
                <HeroVideoPreview uri={slide.url} />
              ) : (
                <Image
                  source={{ uri: slide.url }}
                  style={styles.previewMedia}
                  resizeMode="cover"
                />
              )}
            </View>

            <View style={styles.actions}>
              <Pressable
                disabled={busyId === slide.id}
                onPress={() => void toggleSlide(slide)}
                style={[
                  styles.actionBtn,
                  {
                    borderColor: colors.border,
                    opacity:
                      busyId === slide.id ? 0.5 : 1,
                  },
                ]}
              >
                <Ionicons
                  name={
                    slide.active
                      ? "eye-off-outline"
                      : "eye-outline"
                  }
                  size={18}
                  color={colors.primary}
                />
                <Text
                  style={{
                    color: colors.foreground,
                    fontWeight: "700",
                    fontSize: 12,
                  }}
                >
                  {slide.active ? "إخفاء" : "إظهار"}
                </Text>
              </Pressable>

              <Pressable
                disabled={
                  busyId === slide.id || index === 0
                }
                onPress={() =>
                  void moveSlide(slide, -1)
                }
                style={[
                  styles.iconBtn,
                  {
                    borderColor: colors.border,
                    opacity:
                      index === 0 ||
                      busyId === slide.id
                        ? 0.35
                        : 1,
                  },
                ]}
              >
                <Ionicons
                  name="arrow-up"
                  size={18}
                  color={colors.foreground}
                />
              </Pressable>

              <Pressable
                disabled={
                  busyId === slide.id ||
                  index === slides.length - 1
                }
                onPress={() =>
                  void moveSlide(slide, 1)
                }
                style={[
                  styles.iconBtn,
                  {
                    borderColor: colors.border,
                    opacity:
                      index === slides.length - 1 ||
                      busyId === slide.id
                        ? 0.35
                        : 1,
                  },
                ]}
              >
                <Ionicons
                  name="arrow-down"
                  size={18}
                  color={colors.foreground}
                />
              </Pressable>

              <Pressable
                disabled={busyId === slide.id}
                onPress={() => requestDelete(slide)}
                style={[
                  styles.deleteBtn,
                  {
                    opacity:
                      busyId === slide.id ? 0.5 : 1,
                  },
                ]}
              >
                {busyId === slide.id ? (
                  <ActivityIndicator
                    size="small"
                    color="#dc2626"
                  />
                ) : (
                  <Ionicons
                    name="trash-outline"
                    size={18}
                    color="#dc2626"
                  />
                )}
              </Pressable>
            </View>
          </View>
        ))}

        {slides.length < MAX_SLIDES ? (
          <Pressable
            disabled={uploading}
            onPress={() => void addSlide()}
            style={[
              styles.addBtn,
              {
                backgroundColor: colors.primary,
                opacity: uploading ? 0.6 : 1,
              },
            ]}
          >
            {uploading ? (
              <ActivityIndicator
                size="small"
                color="#fff"
              />
            ) : (
              <Ionicons
                name="cloud-upload-outline"
                size={21}
                color="#fff"
              />
            )}

            <Text style={styles.addBtnText}>
              {uploading
                ? "جاري تجهيز ورفع الملف..."
                : "إضافة صورة أو فيديو"}
            </Text>
          </Pressable>
        ) : (
          <View
            style={[
              styles.limitCard,
              {
                backgroundColor: colors.muted,
                borderColor: colors.border,
              },
            ]}
          >
            <Text
              style={{
                color: colors.mutedForeground,
                textAlign: "center",
              }}
            >
              وصلت للحد الأقصى: 5 شرائح
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  headerTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "900",
  },
  headerSubtitle: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 11,
  },
  body: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    padding: 16,
    gap: 14,
  },
  infoCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "flex-start",
    gap: 10,
  },
  infoTitle: {
    fontSize: 15,
    fontWeight: "800",
    textAlign: "right",
  },
  infoText: {
    fontSize: 12,
    lineHeight: 19,
    textAlign: "right",
    marginTop: 3,
  },
  message: {
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  slideCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 12,
    gap: 12,
  },
  slideTopRow: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    gap: 10,
  },
  orderBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
  },
  orderText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "900",
  },
  slideTitle: {
    textAlign: "right",
    fontSize: 14,
    fontWeight: "800",
  },
  slideStatus: {
    textAlign: "right",
    fontSize: 11,
    marginTop: 2,
  },
  preview: {
    width: "100%",
    aspectRatio: 2,
    borderRadius: 14,
    overflow: "hidden",
  },
  previewMedia: {
    width: "100%",
    height: "100%",
  },
  actions: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    gap: 8,
  },
  actionBtn: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 10,
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteBtn: {
    marginLeft: "auto",
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: "#fee2e2",
    alignItems: "center",
    justifyContent: "center",
  },
  addBtn: {
    minHeight: 52,
    borderRadius: 16,
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    paddingHorizontal: 16,
  },
  addBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
  },
  limitCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
});
