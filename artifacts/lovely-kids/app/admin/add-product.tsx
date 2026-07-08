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

import { ColorPickerButton } from "@/components/ColorPickerButton";
import { useProducts } from "@/context/ProductsContext";
import { useAppSettings } from "@/context/AppSettingsContext";
import { CATEGORY_IDS, AGE_GROUP_IDS, DEFAULT_CATEGORY_LABELS, DEFAULT_AGE_GROUP_LABELS, DEFAULT_SEASON_LABELS, Product, ColorVariant } from "@/data/products";
import { useColors } from "@/hooks/useColors";

import { API_BASE } from "@/constants/api";

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
  const seasons: { id: "summer" | "winter"; label: string }[] = [
    { id: "summer", label: DEFAULT_SEASON_LABELS.summer },
    { id: "winter", label: DEFAULT_SEASON_LABELS.winter },
  ];

  const editProduct = productId ? products.find((p) => p.id === productId) : null;
  const isEdit = !!editProduct;

  const [nameAr, setNameAr] = useState(editProduct?.nameAr ?? "");
  const [name, setName] = useState(editProduct?.name ?? "");
  const [price, setPrice] = useState(editProduct?.price?.toString() ?? "");
  const [originalPrice, setOriginalPrice] = useState(editProduct?.originalPrice?.toString() ?? "");
  const [image, setImage] = useState(editProduct?.image ?? "");
  const [images, setImages] = useState<string[]>(editProduct?.images ?? []);
  const [description, setDescription] = useState(editProduct?.description ?? "");
  const [category, setCategory] = useState(editProduct?.category ?? "clothes");
  const [ageGroup, setAgeGroup] = useState(editProduct?.ageGroup ?? "newborn");
  const [gender, setGender] = useState<"boys" | "girls" | null>(editProduct?.gender ?? null);
  const [season, setSeason] = useState<"summer" | "winter" | null>(editProduct?.season ?? null);
  const [isNew, setIsNew] = useState(editProduct?.isNew ?? false);
  const [stock, setStock] = useState(
    editProduct?.stock !== undefined && editProduct?.stock !== null
      ? editProduct.stock.toString()
      : ""
  );
  const [sizes, setSizes] = useState<string[]>(editProduct?.sizes ?? []);
  const [sizeInput, setSizeInput] = useState("");
  const [colorVariants, setColorVariants] = useState<ColorVariant[]>(editProduct?.colorVariants ?? []);
  const [newColorName, setNewColorName] = useState("");
  const [newColorHex, setNewColorHex] = useState("#EF4444");
  const [colorSizeInputs, setColorSizeInputs] = useState<Record<number, string>>({});
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

  const addColorVariant = () => {
    const name = newColorName.trim();
    if (!name) return;
    if (colorVariants.some((c) => c.color === name)) { setNewColorName(""); return; }
    setColorVariants((prev) => [...prev, { color: name, hex: newColorHex, sizes: [] }]);
    setNewColorName("");
  };

  const removeColorVariant = (idx: number) => {
    setColorVariants((prev) => prev.filter((_, i) => i !== idx));
  };

  const addSizeToColor = (idx: number) => {
    const raw = (colorSizeInputs[idx] ?? "").trim().toUpperCase();
    if (!raw) return;
    setColorVariants((prev) =>
      prev.map((c, i) => {
        if (i !== idx) return c;
        if (c.sizes.some((s) => s.size === raw)) return c;
        return { ...c, sizes: [...c.sizes, { size: raw, outOfStock: false }] };
      })
    );
    setColorSizeInputs((prev) => ({ ...prev, [idx]: "" }));
  };

  const removeSizeFromColor = (idx: number, size: string) => {
    setColorVariants((prev) =>
      prev.map((c, i) => (i !== idx ? c : { ...c, sizes: c.sizes.filter((s) => s.size !== size) }))
    );
  };

  const toggleSizeOutOfStock = (idx: number, size: string) => {
    setColorVariants((prev) =>
      prev.map((c, i) =>
        i !== idx
          ? c
          : {
              ...c,
              sizes: c.sizes.map((s) => (s.size === size ? { ...s, outOfStock: !s.outOfStock } : s)),
            }
      )
    );
  };

  const handlePickColorImage = async (idx: number) => {
    const url = await uploadImage();
    if (!url) return;
    setColorVariants((prev) => prev.map((c, i) => (i !== idx ? c : { ...c, image: url })));
  };

  const removeColorImage = (idx: number) => {
    setColorVariants((prev) => prev.map((c, i) => (i !== idx ? c : { ...c, image: undefined })));
  };

  const uploadImage = async (): Promise<string | null> => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setErrors(["يجب السماح بالوصول إلى الصور لرفع صورة المنتج"]);
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      base64: true,
    });

    if (result.canceled || !result.assets[0]) return null;

    const asset = result.assets[0];
    const base64 = asset.base64;
    const mimeType = asset.mimeType ?? "image/jpeg";

    if (!base64) {
      setErrors(["تعذّر قراءة الصورة، جرب صورة أخرى"]);
      return null;
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

      const data = await res.json() as { url: string };
      const fullUrl = `${API_BASE}${data.url}`;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return fullUrl;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "فشل رفع الصورة";
      setErrors([msg]);
      return null;
    } finally {
      setUploading(false);
    }
  };

  const handleAddImage = async () => {
    const url = await uploadImage();
    if (!url) return;
    if (!image) {
      setImage(url);
    }
    setImages((prev) => [...prev, url]);
  };

  const handleReplaceImage = async (index: number) => {
    const url = await uploadImage();
    if (!url) return;
    setImages((prev) => {
      const updated = [...prev];
      updated[index] = url;
      return updated;
    });
    if (index === 0) setImage(url);
  };

  const handleRemoveImage = (index: number) => {
    setImages((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      if (index === 0 && updated.length > 0) setImage(updated[0]);
      else if (updated.length === 0) setImage("");
      return updated;
    });
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
        images: images.length > 0 ? images : [image.trim()],
        description: description.trim() || nameAr.trim(),
        category,
        ageGroup,
        gender,
        season,
        sizes,
        colorVariants,
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

        {/* Image Upload — Multi */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>صور المنتج *</Text>
          <Text style={[styles.hint, { color: colors.mutedForeground, marginBottom: 4 }]}>
            الصورة الأولى هي الصورة الرئيسية — يمكنك إضافة حتى 6 صور
          </Text>

          {/* Image Grid */}
          {images.length > 0 && (
            <View style={styles.imageGrid}>
              {images.map((img, idx) => (
                <View key={idx} style={[styles.gridItem, { borderColor: idx === 0 ? colors.primary : colors.border }]}>
                  {idx === 0 && (
                    <View style={[styles.mainBadge, { backgroundColor: colors.primary }]}>
                      <Text style={styles.mainBadgeText}>رئيسية</Text>
                    </View>
                  )}
                  <Image source={{ uri: img }} style={styles.gridImage} resizeMode="contain" />
                  <View style={styles.gridActions}>
                    <Pressable
                      onPress={() => handleReplaceImage(idx)}
                      disabled={uploading}
                      style={[styles.gridBtn, { backgroundColor: colors.primary + "20" }]}
                    >
                      <Ionicons name="camera-outline" size={14} color={colors.primary} />
                    </Pressable>
                    <Pressable
                      onPress={() => handleRemoveImage(idx)}
                      style={[styles.gridBtn, { backgroundColor: "#fee2e2" }]}
                    >
                      <Ionicons name="trash-outline" size={14} color="#ef4444" />
                    </Pressable>
                  </View>
                </View>
              ))}

              {/* Add more button */}
              {images.length < 6 && (
                <Pressable
                  onPress={handleAddImage}
                  disabled={uploading}
                  style={[styles.gridAddBtn, { borderColor: colors.primary, backgroundColor: colors.primary + "08" }]}
                >
                  {uploading ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <>
                      <Ionicons name="add-circle-outline" size={28} color={colors.primary} />
                      <Text style={[styles.gridAddText, { color: colors.primary }]}>إضافة</Text>
                    </>
                  )}
                </Pressable>
              )}
            </View>
          )}

          {/* First upload CTA when empty */}
          {images.length === 0 && (
            <Pressable
              onPress={handleAddImage}
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
                يمكنك إضافة حتى 6 صور للمنتج
              </Text>
            </Pressable>
          )}

          {/* Manual URL fallback */}
          <View style={[styles.urlRow, { borderColor: colors.border }]}>
            <Ionicons name="link-outline" size={14} color={colors.mutedForeground} />
            <Text style={[styles.urlLabel, { color: colors.mutedForeground }]}>أو أدخل رابط الصورة الرئيسية يدوياً</Text>
          </View>
          <TextInput
            value={image}
            onChangeText={(v) => {
              setImage(v);
              if (v && images.length === 0) setImages([v]);
              else if (v && images.length > 0) setImages((prev) => { const u = [...prev]; u[0] = v; return u; });
            }}
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

        {/* Colors & Sizes per color */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>الألوان والمقاسات (اختياري)</Text>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            أضيفي لوناً ثم مقاساته — اضغطي على المقاس لتعليمه "نفد المخزون" (يظهر بعلامة X للزبون)
          </Text>

          {/* Custom color picker for new color */}
          <ColorPickerButton value={newColorHex} title="لون هذا الخيار" onChange={setNewColorHex} />
          <View style={{ height: 10 }} />

          <View style={[styles.sizeInputRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Pressable onPress={addColorVariant} style={[styles.addSizeBtn, { backgroundColor: colors.primary }]}>
              <Ionicons name="add" size={18} color="#fff" />
            </Pressable>
            <TextInput
              value={newColorName}
              onChangeText={setNewColorName}
              onSubmitEditing={addColorVariant}
              placeholder="اسم اللون، مثال: أحمر"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.sizeTextInput, { color: colors.foreground }]}
              textAlign="right"
              returnKeyType="done"
            />
          </View>

          {colorVariants.length > 0 && (
            <View style={{ gap: 12, marginTop: 8 }}>
              {colorVariants.map((cv, idx) => (
                <View key={`${cv.color}-${idx}`} style={[styles.colorCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.colorCardHeader}>
                    <Pressable onPress={() => removeColorVariant(idx)} style={[styles.gridBtn, { backgroundColor: "#fee2e2" }]}>
                      <Ionicons name="trash-outline" size={14} color="#ef4444" />
                    </Pressable>
                    <View style={styles.colorCardTitle}>
                      <Text style={[styles.colorCardName, { color: colors.foreground }]}>{cv.color}</Text>
                      <View style={[styles.swatch, { backgroundColor: cv.hex, borderColor: colors.border, width: 20, height: 20 }]} />
                    </View>
                  </View>

                  <View style={styles.colorImageRow}>
                    {cv.image ? (
                      <View style={[styles.colorImageWrap, { borderColor: colors.border }]}>
                        <Image source={{ uri: cv.image }} style={styles.colorImageThumb} resizeMode="contain" />
                        <View style={styles.colorImageActions}>
                          <Pressable
                            onPress={() => handlePickColorImage(idx)}
                            disabled={uploading}
                            style={[styles.gridBtn, { backgroundColor: colors.primary + "20" }]}
                          >
                            <Ionicons name="camera-outline" size={14} color={colors.primary} />
                          </Pressable>
                          <Pressable
                            onPress={() => removeColorImage(idx)}
                            style={[styles.gridBtn, { backgroundColor: "#fee2e2" }]}
                          >
                            <Ionicons name="trash-outline" size={14} color="#ef4444" />
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => handlePickColorImage(idx)}
                        disabled={uploading}
                        style={[styles.colorImageAddBtn, { borderColor: colors.primary, backgroundColor: colors.primary + "08" }]}
                      >
                        {uploading ? (
                          <ActivityIndicator size="small" color={colors.primary} />
                        ) : (
                          <>
                            <Ionicons name="image-outline" size={16} color={colors.primary} />
                            <Text style={[styles.colorImageAddText, { color: colors.primary }]}>صورة لهذا اللون (اختياري)</Text>
                          </>
                        )}
                      </Pressable>
                    )}
                  </View>

                  <View style={[styles.sizeInputRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <Pressable onPress={() => addSizeToColor(idx)} style={[styles.addSizeBtn, { backgroundColor: colors.primary }]}>
                      <Ionicons name="add" size={16} color="#fff" />
                    </Pressable>
                    <TextInput
                      value={colorSizeInputs[idx] ?? ""}
                      onChangeText={(v) => setColorSizeInputs((prev) => ({ ...prev, [idx]: v }))}
                      onSubmitEditing={() => addSizeToColor(idx)}
                      placeholder="مقاس لهذا اللون، مثال: M"
                      placeholderTextColor={colors.mutedForeground}
                      style={[styles.sizeTextInput, { color: colors.foreground, fontSize: 13 }]}
                      textAlign="right"
                      returnKeyType="done"
                    />
                  </View>

                  {cv.sizes.length > 0 && (
                    <View style={styles.sizesWrap}>
                      {cv.sizes.map((s) => (
                        <View key={s.size} style={styles.colorSizeChipWrap}>
                          <Pressable
                            onPress={() => toggleSizeOutOfStock(idx, s.size)}
                            style={[
                              styles.sizeChip,
                              {
                                backgroundColor: s.outOfStock ? "#fee2e2" : colors.primary + "20",
                                borderColor: s.outOfStock ? "#ef4444" : colors.primary,
                              },
                            ]}
                          >
                            <Text style={[styles.sizeChipText, { color: s.outOfStock ? "#ef4444" : colors.primary }]}>
                              {s.size}
                            </Text>
                            {s.outOfStock && <Ionicons name="close" size={12} color="#ef4444" />}
                          </Pressable>
                          <Pressable onPress={() => removeSizeFromColor(idx, s.size)} style={styles.colorSizeRemoveBtn}>
                            <Ionicons name="close-circle" size={16} color={colors.mutedForeground} />
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  )}
                  <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                    اضغطي على المقاس لتبديل حالته (متوفر / نفد المخزون) — الدائرة الصغيرة لحذف المقاس
                  </Text>
                </View>
              ))}
            </View>
          )}
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

        {/* Season */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>الموسم</Text>
          <View style={styles.chipsWrap}>
            <Pressable
              onPress={() => setSeason(null)}
              style={[styles.chip, { backgroundColor: season === null ? colors.primary : colors.card, borderColor: season === null ? colors.primary : colors.border }]}
            >
              <Text style={{ color: season === null ? "#fff" : colors.foreground, fontSize: 13, fontWeight: "600" }}>
                بدون تحديد
              </Text>
            </Pressable>
            {seasons.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => setSeason(s.id)}
                style={[styles.chip, { backgroundColor: season === s.id ? colors.primary : colors.card, borderColor: season === s.id ? colors.primary : colors.border }]}
              >
                <Text style={{ color: season === s.id ? "#fff" : colors.foreground, fontSize: 13, fontWeight: "600" }}>
                  {s.label}
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
  imageGrid: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 10 },
  gridItem: { width: 100, height: 100, borderRadius: 12, borderWidth: 2, overflow: "hidden", position: "relative", backgroundColor: "#f8f8f8" },
  gridImage: { width: "100%", height: "100%" },
  mainBadge: { position: "absolute", top: 4, right: 4, zIndex: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  mainBadgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },
  gridActions: { position: "absolute", bottom: 4, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 6 },
  gridBtn: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  gridAddBtn: { width: 100, height: 100, borderRadius: 12, borderWidth: 2, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 4 },
  gridAddText: { fontSize: 11, fontWeight: "700" },
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
  swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 1 },
  colorCard: { borderRadius: 14, borderWidth: 1, padding: 12, gap: 10 },
  colorCardHeader: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between" },
  colorCardTitle: { flexDirection: "row-reverse", alignItems: "center", gap: 8 },
  colorCardName: { fontSize: 14, fontWeight: "700" },
  colorImageRow: { flexDirection: "row-reverse" },
  colorImageWrap: { flexDirection: "row-reverse", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, padding: 8 },
  colorImageThumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: "#f8f8f8" },
  colorImageActions: { flexDirection: "row-reverse", gap: 6 },
  colorImageAddBtn: { flexDirection: "row-reverse", alignItems: "center", gap: 6, borderWidth: 1, borderStyle: "dashed", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, alignSelf: "stretch", justifyContent: "center" },
  colorImageAddText: { fontSize: 12, fontWeight: "700" },
  colorSizeChipWrap: { flexDirection: "row-reverse", alignItems: "center" },
  colorSizeRemoveBtn: { marginRight: -6, marginLeft: 2 },
});
