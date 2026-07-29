import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useAudioPlayer } from "expo-audio";
import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppSettings } from "@/context/AppSettingsContext";
import { useProducts } from "@/context/ProductsContext";
import { useColors } from "@/hooks/useColors";
import { startWebBarcodeScanner } from "@/utils/webBarcodeScanner";

export default function ProductOffersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { products, updateProduct } = useProducts();
  const { settings, updateSettings } = useAppSettings();

  const barcodeBeep = useAudioPlayer(
    require("../../assets/sounds/barcode-beep.wav"),
  );
  const [cameraPermission, requestCameraPermission] =
    useCameraPermissions();

  const [query, setQuery] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [barcodeScanned, setBarcodeScanned] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toggleSaving, setToggleSaving] = useState(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 16;

  const displayedProducts = useMemo(() => {
    const q = query.trim().toLowerCase();

    if (!q) {
      return products.filter(
        (product) => product.showInOffers === true,
      );
    }

    return products.filter((product) => {
      const matchesAdditionalBarcode =
        (product.additionalBarcodes ?? []).some((item) =>
          (item.barcode ?? "").toLowerCase().includes(q),
        );

      return (
        product.nameAr.toLowerCase().includes(q) ||
        product.name.toLowerCase().includes(q) ||
        (product.productCode ?? "").toLowerCase().includes(q) ||
        (product.barcode ?? "").toLowerCase().includes(q) ||
        matchesAdditionalBarcode
      );
    });
  }, [products, query]);

  const applyScannedBarcode = useCallback(
    (rawValue: string) => {
      const value = rawValue.trim();
      if (!value) return false;

      const product = products.find(
        (item) =>
          (item.barcode ?? "").trim() === value ||
          (item.additionalBarcodes ?? []).some(
            (barcodeItem) =>
              (barcodeItem.barcode ?? "").trim() === value,
          ),
      );

      if (!product) {
        Alert.alert(
          "المنتج غير موجود",
          `لم يتم العثور على منتج بالباركود: ${value}`,
        );
        return false;
      }

      setQuery(value);
      return true;
    },
    [products],
  );

  const playScanFeedback = useCallback(() => {
    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Success,
    );
    void barcodeBeep
      .seekTo(0)
      .then(() => barcodeBeep.play())
      .catch(() => {});
  }, [barcodeBeep]);

  useEffect(() => {
    if (
      Platform.OS === "web" ||
      !CameraView.isModernBarcodeScannerAvailable
    ) {
      return;
    }

    const subscription =
      CameraView.onModernBarcodeScanned(({ data }) => {
        if (!data?.trim()) return;

        if (applyScannedBarcode(data)) {
          playScanFeedback();
        }
      });

    return () => subscription.remove();
  }, [applyScannedBarcode, playScanFeedback]);

  const handleOpenBarcodeScanner = async () => {
    if (Platform.OS === "web") {
      setBarcodeScanned(false);
      setScannerOpen(true);
      return;
    }

    if (CameraView.isModernBarcodeScannerAvailable) {
      try {
        await CameraView.launchScanner({
          barcodeTypes: [
            "ean13",
            "ean8",
            "upc_a",
            "upc_e",
            "code128",
            "code39",
            "code93",
            "itf14",
            "codabar",
            "qr",
          ],
        });
      } catch {
        Alert.alert(
          "تعذر فتح الكاميرا",
          "تعذر فتح ماسح الباركود",
        );
      }
      return;
    }

    const permission = cameraPermission?.granted
      ? cameraPermission
      : await requestCameraPermission();

    if (!permission.granted) {
      Alert.alert(
        "صلاحية الكاميرا",
        "يجب السماح باستخدام الكاميرا لمسح الباركود",
      );
      return;
    }

    setBarcodeScanned(false);
    setScannerOpen(true);
  };

  const handleBarcodeScanned = (data: string) => {
    if (barcodeScanned) return;

    setBarcodeScanned(true);

    if (applyScannedBarcode(data)) {
      playScanFeedback();
    }

    setScannerOpen(false);
  };

  useEffect(() => {
    if (Platform.OS !== "web" || !scannerOpen) return;

    let disposed = false;
    let controls: { stop: () => void } | undefined;

    const timer = setTimeout(() => {
      void startWebBarcodeScanner(
        "product-offers-barcode-video",
        (value) => {
          if (disposed) return;

          disposed = true;
          setBarcodeScanned(true);

          if (applyScannedBarcode(value)) {
            playScanFeedback();
          }

          setScannerOpen(false);
        },
      )
        .then((scannerControls) => {
          if (disposed) scannerControls.stop();
          else controls = scannerControls;
        })
        .catch(() => {
          if (!disposed) {
            setScannerOpen(false);
            Alert.alert(
              "تعذر تشغيل الكاميرا",
              "تعذر تشغيل كاميرا مسح الباركود",
            );
          }
        });
    }, 100);

    return () => {
      disposed = true;
      clearTimeout(timer);
      controls?.stop();
    };
  }, [scannerOpen, applyScannedBarcode, playScanFeedback]);

  const toggleSection = async (value: boolean) => {
    setToggleSaving(true);

    const ok = await updateSettings({
      productOffersSectionEnabled: value,
    });

    setToggleSaving(false);

    if (!ok) {
      Alert.alert("تعذر الحفظ", "لم يتم حفظ حالة ظهور قسم العروض.");
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const addToOffers = async (id: string) => {
    const product = products.find((item) => item.id === id);
    if (!product) return;

    setBusyId(id);

    try {
      await updateProduct({
        ...product,
        showInOffers: true,
      });

      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );
    } catch (error) {
      Alert.alert(
        "تعذر الإضافة",
        error instanceof Error
          ? error.message
          : "حدث خطأ أثناء إضافة المنتج إلى العروض",
      );
    } finally {
      setBusyId(null);
    }
  };

  const removeFromOffers = async (id: string) => {
    const product = products.find((item) => item.id === id);
    if (!product) return;

    setBusyId(id);

    try {
      await updateProduct({
        ...product,
        showInOffers: false,
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert(
        "تعذر الإزالة",
        error instanceof Error ? error.message : "حدث خطأ أثناء إزالة المنتج من العروض",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: topPadding + 12,
            backgroundColor: colors.primary,
          },
        ]}
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-forward" size={24} color="#fff" />
        </Pressable>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>إدارة العروض</Text>
          <Text style={styles.headerSub}>
            {products.filter((p) => p.showInOffers).length} منتج
          </Text>
        </View>

        <Ionicons name="flame-outline" size={25} color="#fff" />
      </View>

      <FlatList
        data={displayedProducts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: bottomPadding },
        ]}
        ListHeaderComponent={
          <>
            <View
              style={[
                styles.visibilityCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              <Switch
                value={settings.productOffersSectionEnabled ?? false}
                onValueChange={toggleSection}
                disabled={toggleSaving}
                trackColor={{
                  false: colors.muted,
                  true: colors.primary,
                }}
                thumbColor="#fff"
              />

              <View style={styles.visibilityText}>
                <Text
                  style={[
                    styles.visibilityTitle,
                    { color: colors.foreground },
                  ]}
                >
                  إظهار قسم العروض للمستخدمين
                </Text>
                <Text
                  style={[
                    styles.visibilityHint,
                    { color: colors.mutedForeground },
                  ]}
                >
                  إخفاء القسم لا يزيل المنتجات المحفوظة داخله
                </Text>
              </View>
            </View>

            <View
              style={[
                styles.searchBox,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              <Ionicons
                name="search-outline"
                size={19}
                color={colors.mutedForeground}
              />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="بحث بالاسم أو الكود أو الباركود"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.searchInput, { color: colors.foreground }]}
                textAlign="right"
              />

              <Pressable
                onPress={() => void handleOpenBarcodeScanner()}
                hitSlop={8}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: colors.primary,
                }}
              >
                <Ionicons name="scan-outline" size={21} color="#fff" />
              </Pressable>
            </View>

            <View style={styles.sectionHeader}>
              <Text
                style={[
                  styles.sectionTitle,
                  { color: colors.foreground },
                ]}
              >
                {query.trim()
                  ? "نتيجة البحث"
                  : "المنتجات الموجودة في العروض"}
              </Text>
            </View>
          </>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons
              name="flame-outline"
              size={52}
              color={colors.mutedForeground}
            />
            <Text
              style={[
                styles.emptyTitle,
                { color: colors.foreground },
              ]}
            >
              {query.trim()
                ? "لم يتم العثور على منتج"
                : "لا توجد منتجات ضمن العروض"}
            </Text>
            <Text
              style={[
                styles.emptyHint,
                { color: colors.mutedForeground },
              ]}
            >
              {query.trim()
                ? "جرّب اسمًا أو كودًا أو باركودًا آخر"
                : "امسح باركود المنتج أو ابحث عنه لإضافته"}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View
            style={[
              styles.productCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <Image source={{ uri: item.image }} style={styles.image} />

            <View style={styles.productInfo}>
              <Text
                style={[
                  styles.productName,
                  { color: colors.foreground },
                ]}
                numberOfLines={2}
              >
                {item.nameAr}
              </Text>

              <View style={styles.priceRow}>
                <Text
                  style={[
                    styles.price,
                    { color: colors.primary },
                  ]}
                >
                  {item.price} ₪
                </Text>

                {item.originalPrice ? (
                  <Text
                    style={[
                      styles.originalPrice,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {item.originalPrice} ₪
                  </Text>
                ) : null}
              </View>

              <View style={styles.actions}>
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: "/admin/add-product",
                      params: { productId: item.id },
                    })
                  }
                  style={[
                    styles.editButton,
                    { backgroundColor: colors.secondary },
                  ]}
                >
                  <Ionicons
                    name="pencil-outline"
                    size={17}
                    color={colors.foreground}
                  />
                  <Text
                    style={[
                      styles.editText,
                      { color: colors.foreground },
                    ]}
                  >
                    تعديل
                  </Text>
                </Pressable>

                {item.showInOffers ? (
                  <Pressable
                    onPress={() => void removeFromOffers(item.id)}
                    disabled={busyId === item.id}
                    style={styles.removeButton}
                  >
                    <Ionicons
                      name="close-circle-outline"
                      size={17}
                      color="#ef4444"
                    />
                    <Text style={styles.removeText}>
                      {busyId === item.id
                        ? "جارٍ الإزالة..."
                        : "إزالة من العروض"}
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => void addToOffers(item.id)}
                    disabled={busyId === item.id}
                    style={[
                      styles.editButton,
                      { backgroundColor: colors.primary },
                    ]}
                  >
                    <Ionicons
                      name="add-circle-outline"
                      size={17}
                      color="#fff"
                    />
                    <Text
                      style={[
                        styles.editText,
                        { color: "#fff" },
                      ]}
                    >
                      {busyId === item.id
                        ? "جارٍ الإضافة..."
                        : "إضافة للعروض"}
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        )}
      />

      <Modal
        visible={scannerOpen}
        animationType="fade"
        onRequestClose={() => setScannerOpen(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.72)",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <View
            style={{
              width: Platform.OS === "web" ? 360 : "92%",
              maxWidth: 420,
              borderRadius: 18,
              overflow: "hidden",
              backgroundColor: "#111",
            }}
          >
            {Platform.OS === "web" ? (
              React.createElement(
                "video",
                {
                  id: "product-offers-barcode-video",
                  autoPlay: true,
                  muted: true,
                  playsInline: true,
                  style: {
                    width: "100%",
                    height: 250,
                    objectFit: "cover",
                    backgroundColor: "#000",
                  },
                } as any,
              )
            ) : (
              <CameraView
                style={{ width: "100%", height: 250 }}
                facing="back"
                barcodeScannerSettings={{
                  barcodeTypes: [
                    "ean13",
                    "ean8",
                    "upc_a",
                    "upc_e",
                    "code128",
                    "code39",
                    "code93",
                    "itf14",
                    "codabar",
                    "qr",
                  ],
                }}
                onBarcodeScanned={
                  barcodeScanned
                    ? undefined
                    : ({ data }) => handleBarcodeScanned(data)
                }
              />
            )}

            <View
              style={{
                padding: 14,
                alignItems: "center",
                gap: 10,
              }}
            >
              <Text
                style={{
                  color: "#fff",
                  fontSize: 15,
                  fontWeight: "800",
                }}
              >
                وجّه الكاميرا نحو باركود المنتج
              </Text>

              <Pressable
                onPress={() => setScannerOpen(false)}
                style={{
                  backgroundColor: "#333",
                  paddingHorizontal: 24,
                  paddingVertical: 10,
                  borderRadius: 22,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "800" }}>
                  إغلاق ✕
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  headerCenter: {
    alignItems: "center",
    gap: 2,
  },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "800",
  },
  headerSub: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 11,
  },
  list: {
    padding: 16,
    gap: 10,
  },
  visibilityCard: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  visibilityText: {
    flex: 1,
    alignItems: "flex-end",
    marginLeft: 12,
    gap: 3,
  },
  visibilityTitle: {
    fontSize: 14,
    fontWeight: "800",
    textAlign: "right",
  },
  visibilityHint: {
    fontSize: 11,
    textAlign: "right",
  },
  searchBox: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 11,
    marginRight: 8,
    fontSize: 14,
  },
  sectionHeader: {
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "800",
    textAlign: "right",
  },
  productCard: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
    gap: 12,
  },
  image: {
    width: 82,
    height: 82,
    borderRadius: 11,
    resizeMode: "cover",
  },
  productInfo: {
    flex: 1,
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 6,
  },
  productName: {
    fontSize: 14,
    fontWeight: "800",
    textAlign: "right",
  },
  priceRow: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    gap: 8,
  },
  price: {
    fontSize: 14,
    fontWeight: "800",
  },
  originalPrice: {
    fontSize: 12,
    textDecorationLine: "line-through",
  },
  actions: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    gap: 8,
  },
  editButton: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
  },
  editText: {
    fontSize: 12,
    fontWeight: "700",
  },
  removeButton: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
    backgroundColor: "#fee2e2",
  },
  removeText: {
    color: "#ef4444",
    fontSize: 12,
    fontWeight: "700",
  },
  empty: {
    alignItems: "center",
    paddingTop: 60,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "800",
  },
  emptyHint: {
    fontSize: 13,
    textAlign: "center",
  },
});
