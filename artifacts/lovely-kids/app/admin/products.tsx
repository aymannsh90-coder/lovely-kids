import { getResponsiveTopPadding } from "@/utils/webLayout";
import { Ionicons } from "@expo/vector-icons";
import { startWebBarcodeScanner } from "@/utils/webBarcodeScanner";
import * as Haptics from "expo-haptics";
import { useAudioPlayer } from "expo-audio";
import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useProducts } from "@/context/ProductsContext";
import { useAppSettings } from "@/context/AppSettingsContext";
import { useColors } from "@/hooks/useColors";
import { CATEGORY_IDS, AGE_GROUP_IDS, DEFAULT_CATEGORY_LABELS, DEFAULT_AGE_GROUP_LABELS, Product, isSizeOutOfStock } from "@/data/products";


export default function AdminProductsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const barcodeBeep = useAudioPlayer(require("../../assets/sounds/barcode-beep.wav"));
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const { products, updateProduct, deleteProduct, adjustStock, adjustVariantStock } = useProducts();
  const { settings } = useAppSettings();
  const categoryLabels = settings.categoryLabels ?? DEFAULT_CATEGORY_LABELS;
  const ageGroupLabels = settings.ageGroupLabels ?? DEFAULT_AGE_GROUP_LABELS;

  const topPadding = getResponsiveTopPadding(insets.top);
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 16;

  // Stock modal
  const [stockProduct, setStockProduct] = useState<Product | null>(null);
  const [stockInput, setStockInput] = useState("");
  const [stockSaving, setStockSaving] = useState(false);

  // Per-color/size variant stock adjustment
  const [variantStockInputs, setVariantStockInputs] = useState<Record<string, string>>({});
  const [variantSaving, setVariantSaving] = useState<string | null>(null);
  const [stockFilter, setStockFilter] = useState<"all" | "out">("all");
  const [search, setSearch] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [barcodeScanned, setBarcodeScanned] = useState(false);
  const variantKey = (color: string, size: string) => `${color}|${size}`;

  useEffect(() => {
    if (Platform.OS === "web" || !CameraView.isModernBarcodeScannerAvailable) return;

    const subscription = CameraView.onModernBarcodeScanned(({ data }) => {
      if (!data?.trim()) return;

      setSearch(data.trim());
      setStockFilter("all");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void barcodeBeep.seekTo(0).then(() => barcodeBeep.play()).catch(() => {});
    });

    return () => subscription.remove();
  }, [barcodeBeep]);

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
            "ean13", "ean8", "upc_a", "upc_e",
            "code128", "code39", "code93",
            "itf14", "codabar", "qr",
          ],
        });
      } catch {
        Alert.alert("الماسح", "تعذر فتح ماسح الباركود.");
      }
      return;
    }

    const permission = cameraPermission?.granted
      ? cameraPermission
      : await requestCameraPermission();

    if (!permission.granted) {
      Alert.alert("الكاميرا", "يجب السماح باستخدام الكاميرا لمسح الباركود.");
      return;
    }

    setBarcodeScanned(false);
    setScannerOpen(true);
  };

  const handleBarcodeScanned = (data: string) => {
    if (barcodeScanned) return;

    setBarcodeScanned(true);
    setSearch(data.trim());
    setStockFilter("all");
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    void barcodeBeep.seekTo(0).then(() => barcodeBeep.play()).catch(() => {});
    setScannerOpen(false);
  };

  useEffect(() => {
    if (Platform.OS !== "web" || !scannerOpen) return;

    let disposed = false;
    let controls: { stop: () => void } | undefined;

    const timer = setTimeout(() => {
      void startWebBarcodeScanner(
        "admin-products-barcode-video",
        (value) => {
          if (disposed) return;

          disposed = true;
          setBarcodeScanned(true);
          setSearch(value);
          setStockFilter("all");
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          void barcodeBeep.seekTo(0).then(() => barcodeBeep.play()).catch(() => {});
          setScannerOpen(false);
        }
      )
        .then((scannerControls) => {
          if (disposed) scannerControls.stop();
          else controls = scannerControls;
        })
        .catch(() => {
          if (!disposed) {
            setScannerOpen(false);
            Alert.alert("الكاميرا", "تعذر تشغيل كاميرا مسح الباركود.");
          }
        });
    }, 100);

    return () => {
      disposed = true;
      clearTimeout(timer);
      controls?.stop();
    };
  }, [scannerOpen, barcodeBeep]);

  const handleDelete = (id: string, name: string) => {
    if (Platform.OS === "web") {
      const confirmed = window.confirm(
        `هل أنت متأكدة من حذف "${name}"؟\nهذا الإجراء لا يمكن التراجع عنه.`
      );
      if (confirmed) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        deleteProduct(id);
      }
    } else {
      Alert.alert(
        "حذف المنتج",
        `هل أنت متأكدة من حذف "${name}"؟\nهذا الإجراء لا يمكن التراجع عنه.`,
        [
          { text: "إلغاء", style: "cancel" },
          {
            text: "حذف نهائياً",
            style: "destructive",
            onPress: () => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              deleteProduct(id);
            },
          },
        ]
      );
    }
  };

  const openStockModal = (product: Product) => {
    setStockProduct(product);
    setStockInput("");
    setStockSaving(false);
  };

  const closeStockModal = () => {
    setStockProduct(null);
    setStockInput("");
  };

  const handleQuickAdd = async (amount: number) => {
    if (!stockProduct) return;
    setStockSaving(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const updated = await adjustStock(stockProduct.id, "add", amount);
      setStockProduct(updated);
    } catch {
      // ignore
    } finally {
      setStockSaving(false);
    }
  };

  const handleSetStock = async () => {
    if (!stockProduct || !stockInput.trim()) return;
    const val = Number(stockInput.trim());
    if (isNaN(val) || val < 0) return;
    setStockSaving(true);
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const updated = await adjustStock(stockProduct.id, "set", val);
      setStockProduct(updated);
      setStockInput("");
    } catch {
      // ignore
    } finally {
      setStockSaving(false);
    }
  };

  const handleVariantAdjust = async (color: string, size: string, action: "set" | "add" | "subtract", amount: number) => {
    if (!stockProduct) return;
    const key = variantKey(color, size);
    setVariantSaving(key);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const updated = await adjustVariantStock(stockProduct.id, color, size, action, amount);
      setStockProduct(updated);
      if (action === "set") setVariantStockInputs((prev) => ({ ...prev, [key]: "" }));
    } catch {
      // ignore
    } finally {
      setVariantSaving(null);
    }
  };

  const getCategoryLabel = (cat: string) =>
    categoryLabels[cat] ?? DEFAULT_CATEGORY_LABELS[cat] ?? cat;

  const getAgeLabel = (age: string) =>
    ageGroupLabels[age]?.label ?? DEFAULT_AGE_GROUP_LABELS[age]?.label ?? age;

  const isProductOutOfStock = (product: Product) => {
    const sizes = product.colorVariants?.flatMap((cv) => cv.sizes ?? []) ?? [];
    if (sizes.length > 0) return sizes.every(isSizeOutOfStock);
    return product.stock === 0;
  };

  const filteredProducts = products.filter((product) => {
    if (stockFilter === "out" && !isProductOutOfStock(product)) return false;

    const query = search.trim().toLowerCase();
    if (!query) return true;

    return (
      product.nameAr.toLowerCase().includes(query) ||
      product.name.toLowerCase().includes(query) ||
      (product.productCode ?? "").toLowerCase().includes(query) ||
      (product.barcode ?? "").toLowerCase().includes(query) ||
      (product.additionalBarcodes ?? []).some((item) =>
        item.barcode.toLowerCase().includes(query)
      )
    );
  });

  const getStockLabel = (stock: number | null | undefined) => {
    if (stock === null || stock === undefined) return null;
    if (stock === 0) return { text: "نفد", color: "#ef4444" };
    if (stock <= 5) return { text: `${stock} قطعة`, color: "#FF9800" };
    return { text: `${stock} قطعة`, color: "#22c55e" };
  };

  const currentStock = stockProduct?.stock;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12, backgroundColor: colors.primary }]}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-forward" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.title}>إدارة المنتجات</Text>
        <Pressable onPress={() => router.push("/admin/settings")}>
          <Ionicons name="settings-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      {/* Stats & Actions */}
      <View style={[styles.statsBar, { backgroundColor: colors.secondary }]}>
        <View style={styles.statItem}>
          <Text style={[styles.statNum, { color: colors.foreground }]}>{products.length}</Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>منتج</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            onPress={() => router.push("/admin/users")}
            style={[styles.addBtn, { backgroundColor: "#6366f1" }]}
          >
            <Ionicons name="people-outline" size={18} color="#fff" />
            <Text style={styles.addBtnText}>المستخدمون</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/admin/orders")}
            style={[styles.addBtn, { backgroundColor: "#25D366" }]}
          >
            <Ionicons name="bag-outline" size={18} color="#fff" />
            <Text style={styles.addBtnText}>الطلبات</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/admin/add-product")}
            style={[styles.addBtn, { backgroundColor: colors.primary }]}
          >
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={styles.addBtnText}>إضافة منتج</Text>
          </Pressable>
        </View>
      </View>

      {/* Send Notification Button */}
      <Pressable
        onPress={() => router.push("/admin/notifications")}
        style={[styles.notifBanner, { backgroundColor: "#FF6B35" }]}
      >
        <Ionicons name="notifications-outline" size={20} color="#fff" />
        <Text style={styles.notifBannerText}>إرسال إشعار لجميع المستخدمين</Text>
        <Ionicons name="chevron-back-outline" size={18} color="#fff" />
      </Pressable>

      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <View
          style={{
            flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
            alignItems: "center",
            gap: 8,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
            borderRadius: 12,
            paddingHorizontal: 12,
          }}
        >
          <Ionicons name="search-outline" size={20} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="ابحث بالاسم أو الكود أو الباركود"
            placeholderTextColor={colors.mutedForeground}
            style={{ flex: 1, paddingVertical: 12, color: colors.foreground, textAlign: "right" }}
            autoCapitalize="none"
          />
          {search ? (
            <Pressable onPress={() => setSearch("")}>
              <Ionicons name="close-circle" size={20} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
          <Pressable onPress={handleOpenBarcodeScanner}>
            <Ionicons name="camera-outline" size={22} color={colors.primary} />
          </Pressable>
        </View>
      </View>

      <View style={{ flexDirection: Platform.OS === "web" ? "row-reverse" : "row", gap: 8, paddingHorizontal: 16, paddingVertical: 10 }}>
        <Pressable onPress={() => setStockFilter("all")}>
          <Text style={{ fontWeight: "700", color: stockFilter === "all" ? colors.primary : colors.foreground }}>
            الكل
          </Text>
        </Pressable>
        <Pressable onPress={() => setStockFilter("out")}>
          <Text style={{ fontWeight: "700", color: stockFilter === "out" ? "#ef4444" : colors.foreground }}>
            منتهي من المخزون
          </Text>
        </Pressable>
      </View>

      {/* Products List */}
      <FlatList
        data={filteredProducts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: bottomPadding }]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="cube-outline" size={48} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>لا توجد منتجات</Text>
          </View>
        }
        renderItem={({ item }) => {
          const productOutOfStock = isProductOutOfStock(item);
          const stockInfo = getStockLabel(item.stock);
          return (
            <View style={[
              styles.productRow,
              {
                backgroundColor: productOutOfStock ? "#ef444410" : colors.card,
                borderColor: productOutOfStock ? "#ef444460" : colors.border,
              },
            ]}>
              <Image source={{ uri: item.image }} style={styles.productImage} />

              <View style={styles.productInfo}>
                <Text style={[styles.productName, { color: colors.foreground }]} numberOfLines={2}>
                  {item.nameAr}
                </Text>
                <View style={styles.tags}>
                  <View style={[styles.tag, { backgroundColor: colors.muted }]}>
                    <Text style={[styles.tagText, { color: colors.primary }]}>{item.price} ₪</Text>
                  </View>
                  <View style={[styles.tag, { backgroundColor: colors.muted }]}>
                    <Text style={[styles.tagText, { color: colors.mutedForeground }]}>{getCategoryLabel(item.category)}</Text>
                  </View>
                  <View style={[styles.tag, { backgroundColor: colors.muted }]}>
                    <Text style={[styles.tagText, { color: colors.mutedForeground }]}>{getAgeLabel(item.ageGroup)}</Text>
                  </View>
                </View>

                {productOutOfStock ? (
                  <Text style={{ color: "#ef4444", fontSize: 12, fontWeight: "800" }}>
                    🔴 منتهي من المخزون
                  </Text>
                ) : null}

                {/* Stock Badge — tappable */}
                <Pressable
                  onPress={() => openStockModal(item)}
                  style={[
                    styles.stockBadge,
                    {
                      backgroundColor: stockInfo ? stockInfo.color + "20" : colors.muted,
                      borderColor: stockInfo ? stockInfo.color : colors.border,
                    },
                  ]}
                >
                  <Ionicons
                    name="cube-outline"
                    size={12}
                    color={stockInfo ? stockInfo.color : colors.mutedForeground}
                  />
                  <Text style={[styles.stockBadgeText, { color: stockInfo ? stockInfo.color : colors.mutedForeground }]}>
                    {stockInfo ? stockInfo.text : "بدون حد للكمية"}
                  </Text>
                  <Ionicons name="create-outline" size={12} color={stockInfo ? stockInfo.color : colors.mutedForeground} />
                </Pressable>
              </View>

              <View style={styles.actions}>
                <Pressable
                  onPress={() => router.push({ pathname: "/admin/add-product", params: { productId: item.id } })}
                  style={[styles.actionBtn, { backgroundColor: colors.secondary }]}
                >
                  <Ionicons name="pencil-outline" size={18} color={colors.foreground} />
                </Pressable>
                <Pressable
                  onPress={() => handleDelete(item.id, item.nameAr)}
                  style={[styles.actionBtn, { backgroundColor: "#fee2e2" }]}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.destructive} />
                </Pressable>
              </View>
            </View>
          );
        }}
      />

      {/* ── Stock Adjustment Modal ── */}
      <Modal
        visible={!!stockProduct}
        transparent
        animationType="slide"
        onRequestClose={closeStockModal}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <Pressable style={styles.modalOverlay} onPress={closeStockModal}>
            <Pressable
              style={[styles.modalBox, { backgroundColor: colors.card }]}
              onPress={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <View style={[styles.modalHeader, { backgroundColor: colors.primary }]}>
                <Pressable onPress={closeStockModal}>
                  <Ionicons name="close" size={22} color="#fff" />
                </Pressable>
                <Text style={styles.modalTitle} numberOfLines={1}>
                  الكمية — {stockProduct?.nameAr}
                </Text>
                <Ionicons name="cube-outline" size={22} color="#fff" />
              </View>

              <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
                {/* Per-color / per-size stock */}
                {!!stockProduct?.colorVariants && stockProduct.colorVariants.length > 0 && (
                  <View style={styles.variantSection}>
                    <Text style={[styles.sectionLabel, { color: colors.foreground }]}>الكمية حسب اللون والمقاس</Text>
                    <Text style={[styles.modalHint, { color: colors.mutedForeground }]}>
                      عدّلي الكمية عند بيع قطعة داخل المحل، أو عند وصول كمية جديدة
                    </Text>
                    {stockProduct.colorVariants.map((cv) => (
                      <View key={cv.color} style={[styles.variantColorBox, { borderColor: colors.border }]}>
                        <View style={styles.variantColorHeader}>
                          <View style={[styles.variantColorSwatch, { backgroundColor: cv.hex, borderColor: colors.border }]} />
                          <Text style={[styles.variantColorName, { color: colors.foreground }]}>{cv.color}</Text>
                        </View>
                        {cv.sizes.map((s) => {
                          const key = variantKey(cv.color, s.size);
                          const out = isSizeOutOfStock(s);
                          const saving = variantSaving === key;
                          return (
                            <View key={s.size} style={[styles.variantSizeRow, { borderColor: colors.border }]}>
                              <Text style={[styles.variantSizeLabel, { color: colors.foreground }]}>{s.size}</Text>
                              <Text style={[styles.variantSizeStock, { color: out ? "#ef4444" : colors.primary }]}>
                                {s.stock === null || s.stock === undefined ? "غير محدود" : `${s.stock} قطعة`}
                              </Text>
                              <View style={styles.variantSizeActions}>
                                <Pressable
                                  onPress={() => handleVariantAdjust(cv.color, s.size, "subtract", 1)}
                                  disabled={saving}
                                  style={[styles.variantStepBtn, { backgroundColor: colors.muted }]}
                                >
                                  <Ionicons name="remove" size={16} color={colors.foreground} />
                                </Pressable>
                                <Pressable
                                  onPress={() => handleVariantAdjust(cv.color, s.size, "add", 1)}
                                  disabled={saving}
                                  style={[styles.variantStepBtn, { backgroundColor: colors.muted }]}
                                >
                                  <Ionicons name="add" size={16} color={colors.foreground} />
                                </Pressable>
                                <TextInput
                                  value={variantStockInputs[key] ?? ""}
                                  onChangeText={(v) => setVariantStockInputs((prev) => ({ ...prev, [key]: v }))}
                                  placeholder="ضبط"
                                  placeholderTextColor={colors.mutedForeground}
                                  keyboardType="numeric"
                                  style={[styles.variantSetInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                                  textAlign="center"
                                  returnKeyType="done"
                                  onSubmitEditing={() => {
                                    const val = Number((variantStockInputs[key] ?? "").trim());
                                    if (!isNaN(val) && val >= 0) handleVariantAdjust(cv.color, s.size, "set", val);
                                  }}
                                />
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                )}

                {/* Current Stock Display */}
                <View style={[styles.currentStockBox, {
                  backgroundColor: currentStock === 0
                    ? "#ef444415"
                    : currentStock !== null && currentStock !== undefined && currentStock <= 5
                    ? "#FF980015"
                    : colors.secondary + "30",
                  borderColor: currentStock === 0
                    ? "#ef4444"
                    : currentStock !== null && currentStock !== undefined && currentStock <= 5
                    ? "#FF9800"
                    : colors.primary + "40",
                }]}>
                  <Text style={[styles.currentStockLabel, { color: colors.mutedForeground }]}>الكمية الحالية</Text>
                  <Text style={[styles.currentStockNum, {
                    color: currentStock === 0
                      ? "#ef4444"
                      : currentStock !== null && currentStock !== undefined && currentStock <= 5
                      ? "#FF9800"
                      : colors.primary,
                  }]}>
                    {currentStock === null || currentStock === undefined ? "—" : currentStock}
                  </Text>
                  <Text style={[styles.currentStockUnit, { color: colors.mutedForeground }]}>
                    {currentStock === 0 ? "نفد المخزون" : currentStock === null || currentStock === undefined ? "غير محدود" : "قطعة متبقية"}
                  </Text>
                </View>

                {/* Quick Add Buttons */}
                <Text style={[styles.sectionLabel, { color: colors.foreground }]}>إضافة سريعة ⚡</Text>
                <View style={styles.quickBtns}>
                  {[1, 5, 10, 20, 50].map((n) => (
                    <Pressable
                      key={n}
                      onPress={() => handleQuickAdd(n)}
                      disabled={stockSaving}
                      style={[styles.quickBtn, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "50" }]}
                    >
                      <Text style={[styles.quickBtnText, { color: colors.primary }]}>+{n}</Text>
                    </Pressable>
                  ))}
                </View>

                {/* Set Exact Value */}
                <Text style={[styles.sectionLabel, { color: colors.foreground }]}>ضبط الكمية على رقم محدد</Text>
                <View style={styles.setRow}>
                  <Pressable
                    onPress={handleSetStock}
                    disabled={stockSaving || !stockInput.trim()}
                    style={[styles.setBtn, {
                      backgroundColor: !stockInput.trim() ? colors.muted : colors.primary,
                    }]}
                  >
                    <Text style={[styles.setBtnText, { color: !stockInput.trim() ? colors.mutedForeground : "#fff" }]}>
                      تأكيد
                    </Text>
                  </Pressable>
                  <TextInput
                    value={stockInput}
                    onChangeText={setStockInput}
                    placeholder="اكتب الكمية..."
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="numeric"
                    style={[styles.setInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                    textAlign="right"
                    returnKeyType="done"
                    onSubmitEditing={handleSetStock}
                  />
                </View>

                {/* Reset to unlimited */}
                <Pressable
                  onPress={async () => {
                    if (!stockProduct) return;
                    setStockSaving(true);
                    try {
                        await updateProduct({ ...stockProduct, stock: null });
                        setStockProduct({ ...stockProduct, stock: null });
                    } catch { }
                    setStockSaving(false);
                  }}
                  style={[styles.unlimitedBtn, { borderColor: colors.border }]}
                >
                  <Ionicons name="infinite-outline" size={16} color={colors.mutedForeground} />
                  <Text style={[styles.unlimitedText, { color: colors.mutedForeground }]}>إزالة الحد (كمية غير محدودة)</Text>
                </Pressable>
              </ScrollView>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* Barcode Search Scanner */}
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
                  id: "admin-products-barcode-video",
                  autoPlay: true,
                  muted: true,
                  playsInline: true,
                  style: {
                    width: "100%",
                    height: 250,
                    objectFit: "cover",
                    backgroundColor: "#000",
                  },
                } as any
              )
            ) : (
              <CameraView
                style={{ width: "100%", height: 250 }}
                facing="back"
                barcodeScannerSettings={{
                  barcodeTypes: [
                    "ean13", "ean8", "upc_a", "upc_e",
                    "code128", "code39", "code93",
                    "itf14", "codabar", "qr",
                  ],
                }}
                onBarcodeScanned={
                  barcodeScanned
                    ? undefined
                    : ({ data }) => handleBarcodeScanned(data)
                }
              />
            )}

            <View style={{ padding: 14, alignItems: "center", gap: 10 }}>
              <Text style={{ color: "#fff", fontSize: 15, fontWeight: "800" }}>
                وجّه الكاميرا نحو الباركود أو QR
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
                <Text style={{ color: "#fff", fontWeight: "800" }}>إغلاق ✕</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 16 },
  title: { fontSize: 18, fontWeight: "800", color: "#fff" },
  statsBar: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  statItem: { alignItems: "flex-end" },
  statNum: { fontSize: 22, fontWeight: "800" },
  statLabel: { fontSize: 12 },
  addBtn: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  addBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  notifBanner: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, marginHorizontal: 12, marginTop: 10, borderRadius: 14 },
  notifBannerText: { color: "#fff", fontWeight: "700", fontSize: 14, flex: 1, textAlign: "right", marginHorizontal: 8 },
  list: { padding: 12, gap: 10 },
  productRow: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", padding: 10, borderRadius: 14, borderWidth: 1, gap: 10 },
  productImage: { width: 60, height: 60, borderRadius: 10, resizeMode: "cover" },
  productInfo: { flex: 1, gap: 5, alignItems: "flex-end" },
  productName: { fontSize: 13, fontWeight: "700", textAlign: "right", lineHeight: 18 },
  tags: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", flexWrap: "wrap", gap: 4 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tagText: { fontSize: 11, fontWeight: "600" },
  stockBadge: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, alignSelf: "flex-end" },
  stockBadgeText: { fontSize: 11, fontWeight: "700" },
  actions: { gap: 8 },
  actionBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 16 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalBox: { borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: "hidden" },
  modalHeader: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16 },
  modalTitle: { fontSize: 16, fontWeight: "800", color: "#fff", flex: 1, textAlign: "center" },
  modalScroll: { maxHeight: 560 },
  modalBody: { padding: 20, gap: 14, paddingBottom: 34 },
  variantSection: { gap: 10 },
  variantColorBox: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 8 },
  variantColorHeader: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", gap: 8 },
  variantColorSwatch: { width: 18, height: 18, borderRadius: 9, borderWidth: 1 },
  variantColorName: { fontSize: 14, fontWeight: "700" },
  variantSizeRow: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", gap: 8, borderTopWidth: 1, paddingTop: 8 },
  variantSizeLabel: { fontSize: 13, fontWeight: "700", width: 32 },
  variantSizeStock: { fontSize: 12, fontWeight: "700", flex: 1, textAlign: "right" },
  variantSizeActions: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", gap: 6 },
  variantStepBtn: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  variantSetInput: { width: 56, height: 30, borderRadius: 8, borderWidth: 1, fontSize: 13 },
  modalHint: { fontSize: 13, textAlign: "right", lineHeight: 20 },
  currentStockBox: { borderRadius: 16, borderWidth: 1.5, padding: 20, alignItems: "center", gap: 4 },
  currentStockLabel: { fontSize: 13, fontWeight: "600" },
  currentStockNum: { fontSize: 52, fontWeight: "900", lineHeight: 60 },
  currentStockUnit: { fontSize: 13 },
  sectionLabel: { fontSize: 14, fontWeight: "700", textAlign: "right" },
  quickBtns: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", gap: 8, flexWrap: "wrap" },
  quickBtn: { flex: 1, minWidth: 52, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  quickBtnText: { fontSize: 15, fontWeight: "800" },
  setRow: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", gap: 10 },
  setInput: { flex: 1, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1, fontSize: 15 },
  setBtn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  setBtnText: { fontSize: 15, fontWeight: "700" },
  unlimitedBtn: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderStyle: "dashed" },
  unlimitedText: { fontSize: 13, fontWeight: "600" },
  field: { gap: 6 },
  fieldLabel: { fontSize: 14, fontWeight: "700", textAlign: "right" },
  input: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1, fontSize: 14 },
  textArea: { height: 80 },
  templates: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", flexWrap: "wrap", gap: 8 },
  templateChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  templateText: { fontSize: 13, fontWeight: "600" },
  resultBox: { padding: 12, borderRadius: 12, alignItems: "flex-end" },
  resultText: { fontSize: 14, fontWeight: "600", textAlign: "right" },
  sendBtn: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 16, borderRadius: 16, marginTop: 4 },
  sendBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
