/**
 * Read-only design review surface for the social publishing refactor.
 * This route is available ONLY on the exact Cloudflare branch-preview hostname.
 * It does not read admin tokens, call owner APIs, or perform any publishing.
 * Remove this page before merging the refactor into production.
 */
import React, { useState } from "react";
import { Image, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useProducts } from "@/context/ProductsContext";
import { useColors } from "@/hooks/useColors";

const REVIEW_HOST = "refactor-social-publishing-p.lovely-kids.pages.dev";
const DISPLAY_BATCH = 100;
type PlatformChoice = "facebook" | "instagram";
type TypeChoice = "post" | "story";

export default function SocialPublishingDesignPreview() {
  const colors = useColors();
  const { products } = useProducts();
  const [platform, setPlatform] = useState<PlatformChoice>("facebook");
  const [contentType, setContentType] = useState<TypeChoice>("post");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(DISPLAY_BATCH);
  const [selected, setSelected] = useState<string[]>([]);
  const [intro, setIntro] = useState("🛍️ موديلات مختارة من Lovely Kids");
  const [showPreview, setShowPreview] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Never present a mock administrator tool outside the known preview host.
  const permitted = Platform.OS === "web" &&
    typeof window !== "undefined" && window.location.hostname === REVIEW_HOST;
  if (!permitted) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: colors.foreground, textAlign: "center" }}>
          هذه المعاينة متاحة على نطاق مراجعة التصميم فقط.
        </Text>
      </View>
    );
  }

  // All data is sourced from the public product list. No owner-only data is read.
  const available = products.filter(product => !product.isHidden && !product.deletedAt);
  const q = query.trim().toLowerCase();
  const filtered = available.filter(product => !q ||
    (product.nameAr || "").toLowerCase().includes(q) ||
    (product.name || "").toLowerCase().includes(q) ||
    String(product.productCode || "").toLowerCase().includes(q) ||
    String(product.id) === q
  );
  const visible = filtered.slice(0, limit);
  const selectedItems = selected.flatMap(id => {
    const product = available.find(p => p.id === id);
    return product ? [product] : [];
  });
  const canPreview = selected.length > 0 &&
    (platform === "facebook" ||
      (contentType === "story" ? selected.length <= 10 : selected.length >= 2 && selected.length <= 10));

  const surface = { borderColor: colors.border, borderWidth: 1, backgroundColor: colors.card, borderRadius: 14, padding: 14, gap: 10 } as const;
  const heading = { color: colors.foreground, fontWeight: "800" as const, textAlign: "right" as const, fontSize: 16 };
  const muted = { color: colors.mutedForeground, textAlign: "right" as const, fontSize: 12 };
  const accent = { backgroundColor: colors.primary, borderRadius: 11, alignItems: "center" as const, paddingVertical: 13, paddingHorizontal: 12 };
  const changeSelection = (id: string) => {
    setSelected(items => items.includes(id) ? items.filter(x => x !== id) : [...items, id]);
    setShowPreview(false);
  };

  return (
    <ScrollView style={{ backgroundColor: colors.background, flex: 1 }}
      contentContainerStyle={{ alignSelf: "center", width: "100%", maxWidth: 860, paddingHorizontal: 16, paddingTop: 24, paddingBottom: 48, gap: 14 }}>
      <Text style={{ color: colors.foreground, textAlign: "right", fontWeight: "800", fontSize: 24 }}>
        مركز النشر — Lovely Kids
      </Text>
      <View style={{ borderWidth: 1, borderColor: "#D97706", borderRadius: 12, padding: 12, backgroundColor: colors.card, gap: 4 }}>
        <Text style={{ color: "#B45309", fontWeight: "800", textAlign: "right" }}>
          معاينة تصميم فقط — النشر معطّل بالكامل
        </Text>
        <Text style={muted}>
          هذه شاشة للمراجعة بدون تسجيل دخول. الصور من قائمة المنتجات العامة.
          لن تنشر أي صور أو قصص ولن تغيّر بيانات المحل أو R2 أو الإعلانات.
          صفحة الإدارة الحقيقية ما زالت محمية بحساب المالك.
        </Text>
      </View>

      <View style={surface}>
        <Text style={heading}>1. اختيار المنصة</Text>
        <View style={{ flexDirection: "row-reverse", gap: 10 }}>
          {(["facebook", "instagram"] as const).map(value => (
            <Pressable key={value}
              onPress={() => { setPlatform(value); setShowPreview(false); }}
              accessibilityRole="button"
              style={{ ...accent, flex: 1, borderWidth: 1,
                borderColor: platform === value ? colors.primary : colors.border,
                backgroundColor: platform === value ? colors.primary : colors.background }}>
              <Text style={{ color: platform === value ? "#fff" : colors.foreground, fontWeight: "800" }}>
                {value === "facebook" ? "فيسبوك" : "إنستغرام"}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={heading}>2. نوع النشر</Text>
        <View style={{ flexDirection: "row-reverse", gap: 10 }}>
          {(["post", "story"] as const).map(value => (
            <Pressable key={value}
              onPress={() => { setContentType(value); setShowPreview(false); }}
              accessibilityRole="button"
              style={{ ...accent, flex: 1, borderWidth: 1,
                borderColor: contentType === value ? colors.primary : colors.border,
                backgroundColor: contentType === value ? colors.primary : colors.background }}>
              <Text style={{ color: contentType === value ? "#fff" : colors.foreground, fontWeight: "800" }}>
                {value === "post" ? "منشور صور" : "قصص (Stories)"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={surface}>
        <View style={{ flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ ...heading, flex: 1 }}>3. اختيار الموديلات ({selected.length} مختار)</Text>
          <Pressable onPress={() => { setSelected([]); setShowPreview(false); }}
            disabled={!selected.length} accessibilityRole="button"
            style={{ borderWidth: 1, borderColor: colors.border, padding: 9, borderRadius: 9, opacity: selected.length ? 1 : 0.4 }}>
            <Text style={{ color: colors.foreground, fontWeight: "700" }}>مسح الكل</Text>
          </Pressable>
        </View>
        {selected.length > 0 && (
          <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: 6 }}>
            {selected.slice(0, 8).map(id => (
              <Pressable onPress={() => changeSelection(id)} key={id}
                style={{ borderColor: colors.border, borderWidth: 1, padding: 8, borderRadius: 9 }}>
                <Text style={{ color: colors.foreground }}>#{id} ×</Text>
              </Pressable>
            ))}
            {selected.length > 8 && <Text style={muted}>و{selected.length - 8} موديلات أخرى</Text>}
          </View>
        )}
        <TextInput value={query}
          onChangeText={value => { setQuery(value); setLimit(DISPLAY_BATCH); }}
          placeholder="ابحث باسم الصنف أو الكود أو رقم الموديل"
          placeholderTextColor={colors.mutedForeground}
          style={{ color: colors.foreground, textAlign: "right", borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10 }}
        />
        <ScrollView nestedScrollEnabled style={{ maxHeight: 340 }}>
          {visible.map(product => (
            <Pressable key={product.id} onPress={() => changeSelection(product.id)}
              style={{ flexDirection: "row-reverse", alignItems: "center", gap: 10, borderBottomColor: colors.border, borderBottomWidth: 1, paddingVertical: 8 }}>
              <Image source={{ uri: product.image }} style={{ width: 62, height: 62, borderRadius: 9 }} />
              <View style={{ flex: 1, alignItems: "flex-end" }}>
                <Text style={{ color: colors.foreground, fontWeight: "700", textAlign: "right" }}>{product.nameAr}</Text>
                <Text style={muted}>#{product.id} · {product.price} ₪</Text>
              </View>
              <Text style={{ color: colors.primary, fontSize: 22 }}>{selected.includes(product.id) ? "☑" : "□"}</Text>
            </Pressable>
          ))}
          {filtered.length === 0 && <Text style={muted}>لا توجد موديلات مطابقة</Text>}
        </ScrollView>
        {filtered.length > limit && (
          <Pressable onPress={() => setLimit(x => x + DISPLAY_BATCH)}
            style={{ borderWidth: 1, borderColor: colors.border, padding: 10, borderRadius: 9, alignItems: "center" }}>
            <Text style={{ color: colors.primary, fontWeight: "700" }}>عرض المزيد ({filtered.length - limit} موديل)</Text>
          </Pressable>
        )}
        <Text style={muted}>
          {platform === "facebook" ? "فيسبوك: بدون حدّ 10 من نظامنا." :
            "إنستغرام: قصص 1–10 صور، ومنشور Carousel من 2 إلى 10 صور."}
        </Text>
      </View>

      <View style={surface}>
        <Text style={heading}>4. {platform === "facebook" ? "فيسبوك" : "إنستغرام"} — {contentType === "post" ? "منشور صور" : "نشر القصص"}</Text>
        {platform === "facebook" && contentType === "post" && (
          <TextInput value={intro} multiline
            onChangeText={value => { setIntro(value); setShowPreview(false); }}
            style={{ color: colors.foreground, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, minHeight: 64, textAlign: "right" }}
          />
        )}
        <Text style={muted}>
          {contentType === "story" ? "كل موديل سيظهر كقصة مستقلة باستخدام الصورة الأصلية دون رفع نسخ جديدة إلى R2." :
            platform === "facebook" ? "ستظهر جميع الصور المختارة في منشور واحد، مع وصف لكل صورة." :
            "منشور إنستغرام متعدد الصور (Carousel) مع وصف واحد."}
        </Text>
        {!canPreview && (
          <Text style={{ ...muted, color: "#D97706" }}>
            {selected.length === 0 ? "اختَر موديلًا واحدًا على الأقل." :
              "عدد الصور المختارة غير مناسب لنوع النشر الحالي على إنستغرام."}
          </Text>
        )}
        <Pressable onPress={() => setShowPreview(true)} disabled={!canPreview}
          accessibilityRole="button" style={{ ...accent, opacity: canPreview ? 1 : 0.4 }}>
          <Text style={{ color: "#fff", fontWeight: "800" }}>معاينة {selected.length} صور — بدون نشر</Text>
        </Pressable>
        {showPreview && (
          <View style={{ gap: 10 }}>
            <Text style={heading}>صور المعاينة ({selectedItems.length})</Text>
            {(expanded ? selectedItems : selectedItems.slice(0, 8)).map(product => (
              <View key={product.id} style={{ flexDirection: "row-reverse", alignItems: "center", gap: 10,
                borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 8 }}>
                <Image source={{ uri: product.image }} resizeMode="contain"
                  style={{ width: 90, height: contentType === "story" ? 150 : 90, borderRadius: 8 }} />
                <Text style={{ flex: 1, textAlign: "right", color: colors.foreground }}>{product.nameAr} (#{product.id})</Text>
              </View>
            ))}
            {selectedItems.length > 8 && (
              <Pressable onPress={() => setExpanded(value => !value)} style={{ padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 9 }}>
                <Text style={{ color: colors.primary, textAlign: "center", fontWeight: "700" }}>
                  {expanded ? "عرض مختصر" : "عرض جميع الصور"}
                </Text>
              </Pressable>
            )}
            <Text style={muted}>في الوضع الفعلي يظهر زر تأكيد النشر هنا بعد المعاينة.</Text>
          </View>
        )}
        <View style={{ ...accent, backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1 }}>
          <Text style={{ color: colors.mutedForeground, fontWeight: "800" }}>النشر الفعلي غير متاح في معاينة التصميم</Text>
        </View>
      </View>
      <View style={surface}>
        <Text style={heading}>إعدادات متقدمة — فحص اتصال فيسبوك وإنستغرام</Text>
        <Text style={muted}>أدوات فحص الاتصال الفعلية تتطلب حساب المالك، ولن تظهر في المعاينة العامة.</Text>
      </View>
    </ScrollView>
  );
}
