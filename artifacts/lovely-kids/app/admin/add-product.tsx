import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
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
import { CATEGORY_IDS, AGE_GROUP_IDS, DEFAULT_CATEGORY_LABELS, DEFAULT_AGE_GROUP_LABELS, Product } from "@/data/products";
import { useColors } from "@/hooks/useColors";

const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

export default function AddProductScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { productId } = useLocalSearchParams<{ productId?: string }>();
  const { products, addProduct, updateProduct } = useProducts();
  const { settings } = useAppSettings();
  const categoryLabels = settings.categoryLabels ?? DEFAULT_CATEGORY_LABELS;
  const ageGroupLabels = settings.ageGroupLabels ?? DEFAULT_AGE_GROUP_LABELS;
  const categories = CATEGORY_IDS.filter((id) => id !== "all").map((id) => ({
    id,
    label: categoryLabels[id] ?? DEFAULT_CATEGORY_LABELS[id],
  }));
  const ageGroups = AGE_GROUP_IDS.map((id) => ({
    id,
    label: ageGroupLabels[id]?.label ?? DEFAULT_AGE_GROUP_LABELS[id].label,
  }));

  const editProduct = productId ? products.find((p) => p.id === productId) : null;
  const isEdit = !!editProduct;

  const [nameAr, setNameAr] = useState(editProduct?.nameAr ?? "");
  const [name, setName] = useState(editProduct?.name ?? "");
  const [price, setPrice] = useState(editProduct?.price?.toString() ?? "");
  const [originalPrice, setOriginalPrice] = useState(editProduct?.originalPrice?.toString() ?? "");
  const [image, setImage] = useState(editProduct?.image ?? "");
  const [description, setDescription] = useState(editProduct?.description ?? "");
  const [category, setCategory] = useState(editProduct?.category ?? "clothes");
  const [ageGroup, setAgeGroup] = useState(editProduct?.ageGroup ?? "newborn");
  const [gender, setGender] = useState<"boys" | "girls" | null>(editProduct?.gender ?? null);
  const [isNew, setIsNew] = useState(editProduct?.isNew ?? false);
  const [stock, setStock] = useState(
    editProduct?.stock !== undefined && editProduct?.stock !== null
      ? editProduct.stock.toString()
      : ""
  );
  const [sizes, setSizes] = useState<string[]>(editProduct?.sizes ?? []);
  const [sizeInput, setSizeInput] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 16;

  const addSize = () => {
    const s = sizeInput.trim().toUpperCase();
    if (!s) return;
    if (sizes.includes(s)) { setSizeInput(""); return; }
    setSizes((prev) => [...prev, s]);
    setSizeInput("");
  };

  const removeSize = (s: string) => setSizes((prev) => prev.filter((x) => x !== s));

  const handlePickAndUpload = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setErrors(["يجب السماح بالوصول إلى الصور لرفع صورة المنتج"]);
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      base64: true,
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    const base64 = asset.base64;
    const mimeType = asset.mimeType ?? "image/jpeg";

    if (!base64) {
      setErrors(["تعذّر قراءة الصورة، جرب صورة أخرى"]);
      return;
    }

    setUploading(true);
    setErrors([]);
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

      const data = await res.json() as { url: string; objectPath: string };
      const fullUrl = `${API_BASE}${data.url}`;
      setImage(fullUrl);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "فشل رفع الصورة";
      setErrors([msg]);
    } finally {
      setUploading(false);
    }
  };

  const validate = () => {
    const errs: string[] = [];
    if (!nameAr.trim()) errs.push("اسم المنتج بالعربي مطلوب");
    if (!price.trim() || isNaN(Number(price))) errs.push("السعر يجب أن يكون رقماً صحيحاً");
    if (!image.trim()) errs.push("صورة المنتج مطلوبة");
    if (stock.trim() && isNaN(Number(stock))) errs.push("الكمية يجب أن تكون رقماً صحيحاً");
    setErrors(errs);
    return errs.length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const productData: Omit<Product, "id"> = {
        nameAr: nameAr.trim(),
        name: name.trim() || nameAr.trim(),
        price: Number(price),
        originalPrice: originalPrice.trim() ? Number(originalPrice) : undefined,
        image: image.trim(),
        description: description.trim() || nameAr.trim(),
        category,
        ageGroup,
        gender,
        sizes,
        rating: editProduct?.rating ?? 4.8,
        reviews: editProduct?.reviews ?? 0,
        isNew,
        stock: stock.trim() ? Number(stock) : null,
      };

      if (isEdit && editProduct) {
        await updateProduct({ ...productData, id: editProduct.id });
      } else {
        await addProduct(productData);
      }
      router.back();
    } catch {
      setErrors(["فشل الحفظ، يرجى المحاولة مجدداً"]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: bottomPadding }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12, backgroundColor: colors.primary }]}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-forward" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.title}>{isEdit ? "تعديل المنتج" : "إضافة منتج جديد"}</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.form}>
        {/* Errors */}
        {errors.length > 0 && (
          <View style={[styles.errorBox, { backgroundColor: "#fee2e2", borderColor: colors.destructive }]}>
            {errors.map((e) => (
              <Text key={e} style={[styles.errorText, { color: colors.destructive }]}>• {e}</Text>
            ))}
          </View>
        )}

        {/* Name Arabic */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>اسم المنتج بالعربي *</Text>
          <TextInput
            value={nameAr}
            onChangeText={setNameAr}
            placeholder="مثال: فستان بنات ملون"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            textAlign="right"
          />
        </View>

        {/* Name English */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>اسم المنتج بالإنجليزي (اختياري)</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Colorful Girls Dress"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
          />
        </View>

        {/* Price Row */}
        <View style={styles.row}>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={[styles.label, { color: colors.foreground }]}>السعر (₪) *</Text>
            <TextInput
              value={price}
              onChangeText={setPrice}
              placeholder="85"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="numeric"
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              textAlign="right"
            />
          </View>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={[styles.label, { color: colors.foreground }]}>السعر الأصلي (₪)</Text>
            <TextInput
              value={originalPrice}
              onChangeText={setOriginalPrice}
              placeholder="120 (اختياري)"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="numeric"
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              textAlign="right"
            />
          </View>
        </View>

        {/* Stock */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>الكمية المتوفرة</Text>
          <View style={[styles.stockRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="cube-outline" size={18} color={colors.mutedForeground} />
            <TextInput
              value={stock}
              onChangeText={setStock}
              placeholder="اتركه فارغاً إن لم يكن هناك حد للكمية"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="numeric"
              style={[styles.stockInput, { color: colors.foreground }]}
              textAlign="right"
            />
          </View>
        </View>

        {/* Image Upload */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>صورة المنتج *</Text>

          {/* Preview if image set */}
          {image ? (
            <View style={styles.imagePreviewBox}>
              <Image source={{ uri: image }} style={styles.imagePreview} resizeMode="cover" />
              <View style={styles.imageActions}>
                <Pressable
                  onPress={handlePickAndUpload}
                  disabled={uploading}
                  style={[styles.imageActionBtn, { backgroundColor: colors.primary }]}
                >
                  {uploading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="camera-outline" size={16} color="#fff" />
                  )}
                  <Text style={styles.imageActionText}>
                    {uploading ? "جارٍ الرفع..." : "تغيير الصورة"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setImage("")}
                  style={[styles.imageActionBtn, { backgroundColor: "#fee2e2" }]}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.destructive} />
                  <Text style={[styles.imageActionText, { color: colors.destructive }]}>حذف</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={handlePickAndUpload}
              disabled={uploading}
              style={[styles.uploadBox, { borderColor: colors.primary, backgroundColor: colors.primary + "08" }]}
            >
              {uploading ? (
                <ActivityIndicator size="large" color={colors.primary} />
              ) : (
                <Ionicons name="cloud-upload-outline" size={40} color={colors.primary} />
              )}
              <Text style={[styles.uploadText, { color: colors.primary }]}>
                {uploading ? "جارٍ رفع الصورة..." : "اضغط لاختيار صورة من جهازك"}
              </Text>
              <Text style={[styles.uploadHint, { color: colors.mutedForeground }]}>
                ترفع تلقائياً — لا حاجة لأي موقع خارجي
              </Text>
            </Pressable>
          )}

          {/* Manual URL fallback */}
          <View style={[styles.urlRow, { borderColor: colors.border }]}>
            <Ionicons name="link-outline" size={14} color={colors.mutedForeground} />
            <Text style={[styles.urlLabel, { color: colors.mutedForeground }]}>أو أدخل رابطاً يدوياً</Text>
          </View>
          <TextInput
            value={image}
            onChangeText={setImage}
            placeholder="https://..."
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            autoCapitalize="none"
            keyboardType="url"
          />
        </View>

        {/* Description */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>وصف المنتج</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="وصف مختصر للمنتج..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            numberOfLines={3}
            style={[styles.input, styles.textArea, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            textAlign="right"
            textAlignVertical="top"
          />
        </View>

        {/* Sizes */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>المقاسات</Text>
          <View style={[styles.sizeInputRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Pressable onPress={addSize} style={[styles.addSizeBtn, { backgroundColor: colors.primary }]}>
              <Ionicons name="add" size={18} color="#fff" />
            </Pressable>
            <TextInput
              value={sizeInput}
              onChangeText={setSizeInput}
              onSubmitEditing={addSize}
              placeholder="مثال: S, M, L, XL, 0-3M"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.sizeTextInput, { color: colors.foreground }]}
              textAlign="right"
              returnKeyType="done"
            />
          </View>
          {sizes.length > 0 && (
            <View style={styles.sizesWrap}>
              {sizes.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => removeSize(s)}
                  style={[styles.sizeChip, { backgroundColor: colors.primary + "20", borderColor: colors.primary }]}
                >
                  <Ionicons name="close" size={12} color={colors.primary} />
                  <Text style={[styles.sizeChipText, { color: colors.primary }]}>{s}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            اكتب المقاس ثم اضغط + أو Enter — اضغط على المقاس لحذفه
          </Text>
        </View>

        {/* Gender */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>تصنيف المنتج</Text>
          <View style={[styles.genderRow, { borderColor: colors.border }]}>
            {[
              { value: null,    label: "للجميع", emoji: "🛍️" },
              { value: "boys",  label: "ولادي",  emoji: "👦" },
              { value: "girls", label: "بناتي",  emoji: "👧" },
            ].map((opt) => (
              <Pressable
                key={String(opt.value)}
                onPress={() => setGender(opt.value as typeof gender)}
                style={[
                  styles.genderOption,
                  gender === opt.value && {
                    backgroundColor:
                      opt.value === "boys" ? "#3B82F6" :
                      opt.value === "girls" ? "#EC4899" :
                      colors.primary,
                  },
                ]}
              >
                <Text style={{ fontSize: 20 }}>{opt.emoji}</Text>
                <Text style={[styles.genderOptionText, { color: gender === opt.value ? "#fff" : colors.foreground }]}>
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Category */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>الفئة</Text>
          <View style={styles.chipsWrap}>
            {categories.map((cat) => (
              <Pressable
                key={cat.id}
                onPress={() => setCategory(cat.id)}
                style={[styles.chip, { backgroundColor: category === cat.id ? colors.primary : colors.card, borderColor: category === cat.id ? colors.primary : colors.border }]}
              >
                <Text style={{ color: category === cat.id ? "#fff" : colors.foreground, fontSize: 13, fontWeight: "600" }}>
                  {cat.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Age Group */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>الفئة العمرية</Text>
          <View style={styles.chipsWrap}>
            {ageGroups.map((ag) => (
              <Pressable
                key={ag.id}
                onPress={() => setAgeGroup(ag.id)}
                style={[styles.chip, { backgroundColor: ageGroup === ag.id ? colors.primary : colors.card, borderColor: ageGroup === ag.id ? colors.primary : colors.border }]}
              >
                <Text style={{ color: ageGroup === ag.id ? "#fff" : colors.foreground, fontSize: 13, fontWeight: "600" }}>
                  {ag.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Is New Toggle */}
        <Pressable
          onPress={() => setIsNew((v) => !v)}
          style={[styles.toggleRow, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View style={[styles.toggle, { backgroundColor: isNew ? colors.primary : colors.muted }]}>
            {isNew && <Ionicons name="checkmark" size={14} color="#fff" />}
          </View>
          <Text style={[styles.toggleLabel, { color: colors.foreground }]}>منتج جديد (يظهر شارة "جديد")</Text>
        </Pressable>

        {/* Save Button */}
        <Pressable
          onPress={handleSave}
          disabled={saving || uploading}
          style={[styles.saveBtn, { backgroundColor: (saving || uploading) ? colors.mutedForeground : colors.primary }]}
        >
          <Ionicons name="checkmark-circle-outline" size={22} color="#fff" />
          <Text style={styles.saveBtnText}>
            {saving ? "جارٍ الحفظ..." : isEdit ? "حفظ التعديلات" : "إضافة المنتج"}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  header: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 16 },
  title: { fontSize: 18, fontWeight: "800", color: "#fff" },
  form: { padding: 16, gap: 16 },
  errorBox: { padding: 12, borderRadius: 12, borderWidth: 1, gap: 4 },
  errorText: { fontSize: 13, fontWeight: "600" },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: "700", textAlign: "right" },
  input: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1, fontSize: 14 },
  textArea: { height: 80, textAlignVertical: "top" },
  hint: { fontSize: 11, textAlign: "right" },
  row: { flexDirection: "row-reverse", gap: 10 },
  stockRow: { flexDirection: "row-reverse", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  stockInput: { flex: 1, fontSize: 14, padding: 0 },
  uploadBox: { borderWidth: 2, borderStyle: "dashed", borderRadius: 16, padding: 32, alignItems: "center", gap: 10 },
  uploadText: { fontSize: 15, fontWeight: "700", textAlign: "center" },
  uploadHint: { fontSize: 12, textAlign: "center" },
  imagePreviewBox: { borderRadius: 16, overflow: "hidden", gap: 0 },
  imagePreview: { width: "100%", height: 200, borderRadius: 16 },
  imageActions: { flexDirection: "row-reverse", gap: 8, marginTop: 8 },
  imageActionBtn: { flex: 1, flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10 },
  imageActionText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  urlRow: { flexDirection: "row-reverse", alignItems: "center", gap: 6, paddingVertical: 6, borderTopWidth: 1, marginTop: 4 },
  urlLabel: { fontSize: 12 },
  sizeInputRow: { flexDirection: "row-reverse", alignItems: "center", borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  addSizeBtn: { paddingHorizontal: 14, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  sizeTextInput: { flex: 1, fontSize: 14, paddingHorizontal: 12, paddingVertical: 12 },
  sizesWrap: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 8 },
  sizeChip: { flexDirection: "row-reverse", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  sizeChipText: { fontSize: 13, fontWeight: "700" },
  chipsWrap: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  toggleRow: { flexDirection: "row-reverse", alignItems: "center", gap: 12, padding: 14, borderRadius: 12, borderWidth: 1 },
  toggle: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  toggleLabel: { fontSize: 14, fontWeight: "600" },
  saveBtn: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 16, borderRadius: 16, marginTop: 8 },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  genderRow: { flexDirection: "row-reverse", borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  genderOption: { flex: 1, flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12 },
  genderOptionText: { fontSize: 14, fontWeight: "700" },
});
