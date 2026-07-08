import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
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

import { API_BASE } from "@/constants/api";

export default function AdminProductsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { products, deleteProduct, adjustStock, adjustVariantStock } = useProducts();
  const { settings } = useAppSettings();
  const categoryLabels = settings.categoryLabels ?? DEFAULT_CATEGORY_LABELS;
  const ageGroupLabels = settings.ageGroupLabels ?? DEFAULT_AGE_GROUP_LABELS;

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 16;

  // Notification modal
  const [notifModal, setNotifModal] = useState(false);
  const [notifTitle, setNotifTitle] = useState("");
  const [notifBody, setNotifBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);

  // Stock modal
  const [stockProduct, setStockProduct] = useState<Product | null>(null);
  const [stockInput, setStockInput] = useState("");
  const [stockSaving, setStockSaving] = useState(false);

  // Per-color/size variant stock adjustment
  const [variantStockInputs, setVariantStockInputs] = useState<Record<string, string>>({});
  const [variantSaving, setVariantSaving] = useState<string | null>(null);
  const variantKey = (color: string, size: string) => `${color}|${size}`;

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

  const handleSendNotification = async () => {
    if (!notifTitle.trim() || !notifBody.trim()) {
      setSendResult("يرجى كتابة العنوان والنص");
      return;
    }
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/notifications/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: notifTitle.trim(), body: notifBody.trim() }),
      });
      const data = await res.json() as { sent?: number; total?: number; message?: string };
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (data.message) {
        setSendResult(data.message);
      } else {
        setSendResult(`✅ تم الإرسال بنجاح إلى ${data.sent} جهاز من أصل ${data.total}`);
        setNotifTitle("");
        setNotifBody("");
      }
    } catch {
      setSendResult("❌ فشل الإرسال، حاول مجدداً");
    } finally {
      setSending(false);
    }
  };

  const getCategoryLabel = (cat: string) =>
    categoryLabels[cat] ?? DEFAULT_CATEGORY_LABELS[cat] ?? cat;

  const getAgeLabel = (age: string) =>
    ageGroupLabels[age]?.label ?? DEFAULT_AGE_GROUP_LABELS[age]?.label ?? age;

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
        onPress={() => { setNotifModal(true); setSendResult(null); }}
        style={[styles.notifBanner, { backgroundColor: "#FF6B35" }]}
      >
        <Ionicons name="notifications-outline" size={20} color="#fff" />
        <Text style={styles.notifBannerText}>إرسال إشعار لجميع المستخدمين</Text>
        <Ionicons name="chevron-back-outline" size={18} color="#fff" />
      </Pressable>

      {/* Products List */}
      <FlatList
        data={products}
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
          const stockInfo = getStockLabel(item.stock);
          return (
            <View style={[styles.productRow, { backgroundColor: colors.card, borderColor: item.stock === 0 ? "#ef444440" : colors.border }]}>
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
                      const res = await fetch(`${API_BASE}/api/products/${stockProduct.id}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          name: stockProduct.name,
                          nameAr: stockProduct.nameAr,
                          price: stockProduct.price,
                          originalPrice: stockProduct.originalPrice ?? null,
                          image: stockProduct.image,
                          category: stockProduct.category,
                          ageGroup: stockProduct.ageGroup,
                          sizes: stockProduct.sizes ?? [],
                          rating: Math.round((stockProduct.rating ?? 4.8) * 10),
                          reviews: stockProduct.reviews ?? 0,
                          isNew: stockProduct.isNew ?? false,
                          discount: stockProduct.discount ?? null,
                          description: stockProduct.description ?? "",
                          stock: null,
                        }),
                      });
                      if (res.ok) {
                        const updated = await res.json();
                        setStockProduct(updated);
                        // update in context via adjustStock workaround
                      }
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

      {/* Notification Modal */}
      <Modal visible={notifModal} transparent animationType="slide" onRequestClose={() => setNotifModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: colors.card }]}>
            <View style={[styles.modalHeader, { backgroundColor: "#FF6B35" }]}>
              <Pressable onPress={() => setNotifModal(false)}>
                <Ionicons name="close" size={22} color="#fff" />
              </Pressable>
              <Text style={styles.modalTitle}>إرسال إشعار</Text>
              <Ionicons name="notifications" size={22} color="#fff" />
            </View>

            <View style={styles.modalBody}>
              <Text style={[styles.modalHint, { color: colors.mutedForeground }]}>
                سيصل الإشعار لجميع المستخدمين الذين فتحوا التطبيق على أجهزتهم
              </Text>

              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: colors.foreground }]}>عنوان الإشعار *</Text>
                <TextInput
                  value={notifTitle}
                  onChangeText={setNotifTitle}
                  placeholder="مثال: بضاعة جديدة وصلت! 🎉"
                  placeholderTextColor={colors.mutedForeground}
                  style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                  textAlign="right"
                />
              </View>

              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: colors.foreground }]}>نص الإشعار *</Text>
                <TextInput
                  value={notifBody}
                  onChangeText={setNotifBody}
                  placeholder="مثال: تفقد أحدث المنتجات والعروض المميزة الآن"
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  numberOfLines={3}
                  style={[styles.input, styles.textArea, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                  textAlign="right"
                  textAlignVertical="top"
                />
              </View>

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground, fontSize: 12 }]}>قوالب سريعة:</Text>
              <View style={styles.templates}>
                {[
                  { t: "بضاعة جديدة! 🎁", b: "تفقد أحدث المنتجات الوصلت للمتجر" },
                  { t: "عرض خاص! 🔥", b: "خصومات حصرية لفترة محدودة، لا تفوتها" },
                  { t: "تخفيضات! 💰", b: "أسعار مخفوضة على منتجات مختارة" },
                ].map((tpl, i) => (
                  <Pressable
                    key={i}
                    onPress={() => { setNotifTitle(tpl.t); setNotifBody(tpl.b); }}
                    style={[styles.templateChip, { backgroundColor: colors.muted, borderColor: colors.border }]}
                  >
                    <Text style={[styles.templateText, { color: colors.foreground }]}>{tpl.t}</Text>
                  </Pressable>
                ))}
              </View>

              {sendResult && (
                <View style={[styles.resultBox, { backgroundColor: colors.muted }]}>
                  <Text style={[styles.resultText, { color: colors.foreground }]}>{sendResult}</Text>
                </View>
              )}

              <Pressable
                onPress={handleSendNotification}
                disabled={sending}
                style={[styles.sendBtn, { backgroundColor: sending ? colors.mutedForeground : "#FF6B35" }]}
              >
                <Ionicons name="send-outline" size={20} color="#fff" />
                <Text style={styles.sendBtnText}>{sending ? "جارٍ الإرسال..." : "إرسال الإشعار"}</Text>
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
  header: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 16 },
  title: { fontSize: 18, fontWeight: "800", color: "#fff" },
  statsBar: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  statItem: { alignItems: "flex-end" },
  statNum: { fontSize: 22, fontWeight: "800" },
  statLabel: { fontSize: 12 },
  addBtn: { flexDirection: "row-reverse", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  addBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  notifBanner: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, marginHorizontal: 12, marginTop: 10, borderRadius: 14 },
  notifBannerText: { color: "#fff", fontWeight: "700", fontSize: 14, flex: 1, textAlign: "right", marginHorizontal: 8 },
  list: { padding: 12, gap: 10 },
  productRow: { flexDirection: "row-reverse", alignItems: "center", padding: 10, borderRadius: 14, borderWidth: 1, gap: 10 },
  productImage: { width: 60, height: 60, borderRadius: 10, resizeMode: "cover" },
  productInfo: { flex: 1, gap: 5, alignItems: "flex-end" },
  productName: { fontSize: 13, fontWeight: "700", textAlign: "right", lineHeight: 18 },
  tags: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 4 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tagText: { fontSize: 11, fontWeight: "600" },
  stockBadge: { flexDirection: "row-reverse", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, alignSelf: "flex-end" },
  stockBadgeText: { fontSize: 11, fontWeight: "700" },
  actions: { gap: 8 },
  actionBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 16 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalBox: { borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: "hidden" },
  modalHeader: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16 },
  modalTitle: { fontSize: 16, fontWeight: "800", color: "#fff", flex: 1, textAlign: "center" },
  modalScroll: { maxHeight: 560 },
  modalBody: { padding: 20, gap: 14, paddingBottom: 34 },
  variantSection: { gap: 10 },
  variantColorBox: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 8 },
  variantColorHeader: { flexDirection: "row-reverse", alignItems: "center", gap: 8 },
  variantColorSwatch: { width: 18, height: 18, borderRadius: 9, borderWidth: 1 },
  variantColorName: { fontSize: 14, fontWeight: "700" },
  variantSizeRow: { flexDirection: "row-reverse", alignItems: "center", gap: 8, borderTopWidth: 1, paddingTop: 8 },
  variantSizeLabel: { fontSize: 13, fontWeight: "700", width: 32 },
  variantSizeStock: { fontSize: 12, fontWeight: "700", flex: 1, textAlign: "right" },
  variantSizeActions: { flexDirection: "row-reverse", alignItems: "center", gap: 6 },
  variantStepBtn: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  variantSetInput: { width: 56, height: 30, borderRadius: 8, borderWidth: 1, fontSize: 13 },
  modalHint: { fontSize: 13, textAlign: "right", lineHeight: 20 },
  currentStockBox: { borderRadius: 16, borderWidth: 1.5, padding: 20, alignItems: "center", gap: 4 },
  currentStockLabel: { fontSize: 13, fontWeight: "600" },
  currentStockNum: { fontSize: 52, fontWeight: "900", lineHeight: 60 },
  currentStockUnit: { fontSize: 13 },
  sectionLabel: { fontSize: 14, fontWeight: "700", textAlign: "right" },
  quickBtns: { flexDirection: "row-reverse", gap: 8, flexWrap: "wrap" },
  quickBtn: { flex: 1, minWidth: 52, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  quickBtnText: { fontSize: 15, fontWeight: "800" },
  setRow: { flexDirection: "row-reverse", gap: 10 },
  setInput: { flex: 1, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1, fontSize: 15 },
  setBtn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  setBtnText: { fontSize: 15, fontWeight: "700" },
  unlimitedBtn: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderStyle: "dashed" },
  unlimitedText: { fontSize: 13, fontWeight: "600" },
  field: { gap: 6 },
  fieldLabel: { fontSize: 14, fontWeight: "700", textAlign: "right" },
  input: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1, fontSize: 14 },
  textArea: { height: 80 },
  templates: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 8 },
  templateChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  templateText: { fontSize: 13, fontWeight: "600" },
  resultBox: { padding: 12, borderRadius: 12, alignItems: "flex-end" },
  resultText: { fontSize: 14, fontWeight: "600", textAlign: "right" },
  sendBtn: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 16, borderRadius: 16, marginTop: 4 },
  sendBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
