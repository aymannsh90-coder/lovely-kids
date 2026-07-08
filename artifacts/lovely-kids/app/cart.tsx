import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppSettings } from "@/context/AppSettingsContext";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { useColors } from "@/hooks/useColors";

import { API_BASE } from "@/constants/api";

type Step = "cart" | "checkout" | "payment" | "success";

export default function CartScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings } = useAppSettings();
  const { user, updateProfile } = useAuth();
  const { items, updateQuantity, removeItem, totalPrice, totalItems, clearCart } = useCart();

  const [step, setStep] = useState<Step>("cart");
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cod" | "bank_transfer">("cod");
  const [orderId, setOrderId] = useState<number | null>(null);
  const [proofUploading, setProofUploading] = useState(false);
  const [proofUploaded, setProofUploaded] = useState(false);
  const [savedTotal, setSavedTotal] = useState(0);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 16;

  useEffect(() => {
    if (step === "checkout" && user) {
      if (!name.trim() && user.name) setName(user.name);
      if (!phone.trim() && user.phone) setPhone(user.phone);
      if (!address.trim() && user.deliveryAddress) setAddress(user.deliveryAddress);
    }
  }, [step]);

  const bank = settings.bankInfo;
  const hasBankInfo = bank.bankName || bank.accountNumber;
  const whatsapp = settings.whatsappNumber || "97292376808";

  const handleCheckout = async () => {
    if (!name.trim() || !phone.trim() || !address.trim()) return;
    setLoading(true);

    const currentTotal = totalPrice;
    const currentItems = [...items];

    try {
      const res = await fetch(`${API_BASE}/api/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: name.trim(),
          customerPhone: phone.trim(),
          customerAddress: address.trim(),
          notes: notes.trim() || null,
          items: currentItems.map((i) => ({
            id: i.id,
            name: i.name,
            price: i.price,
            quantity: i.quantity,
            image: i.image,
            size: i.size,
            color: i.color,
          })),
          totalPrice: currentTotal,
          status: "new",
          paymentMethod,
          paymentStatus: paymentMethod === "cod" ? "pending" : "awaiting_transfer",
        }),
      });
      if (res.ok) {
        const order = await res.json();
        setOrderId(order.id);
      }
    } catch {
      // ignore
    }

    const itemsList = currentItems
      .map((i) => {
        const variant = [i.color ? `لون ${i.color}` : null, i.size ? `مقاس ${i.size}` : null].filter(Boolean).join("، ");
        return `• ${i.name} x${i.quantity} — ${i.price * i.quantity}₪${variant ? ` (${variant})` : ""}`;
      })
      .join("\n");

    const payLabel = paymentMethod === "bank_transfer" ? "💳 تحويل بنكي" : "💵 الدفع عند الاستلام";
    const message = encodeURIComponent(
      `🛍️ *طلب جديد من Lovely Kids*\n\n` +
      `👤 الاسم: ${name}\n` +
      `📞 الهاتف: ${phone}\n` +
      `📍 العنوان: ${address}\n` +
      (notes ? `📝 ملاحظات: ${notes}\n` : "") +
      `💳 طريقة الدفع: ${payLabel}\n` +
      `\n──────────────\n` +
      `${itemsList}\n` +
      `──────────────\n` +
      `💰 *الإجمالي: ${currentTotal}₪*`
    );

    setSavedTotal(currentTotal);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    clearCart();
    setLoading(false);

    if (user && !user.deliveryAddress && address.trim()) {
      const savedAddr = address.trim();
      setTimeout(() => {
        Alert.alert(
          "حفظ عنوان التوصيل",
          "هل تريد حفظ هذا العنوان لاستخدامه في طلباتك القادمة؟",
          [
            { text: "لا", style: "cancel" },
            { text: "حفظ", onPress: () => updateProfile({ deliveryAddress: savedAddr }).catch(() => {}) },
          ]
        );
      }, 1200);
    }

    if (paymentMethod === "bank_transfer") {
      setStep("payment");
    } else {
      setStep("success");
    }

    setTimeout(() => {
      Linking.openURL(`https://wa.me/${whatsapp}?text=${message}`).catch(() => {});
    }, 800);
  };

  const handleUploadProof = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("تنبيه", "يجب السماح بالوصول إلى الصور لرفع وصل التحويل");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.5,
      base64: true,
    });

    if (result.canceled || !result.assets[0]) return;

    const base64 = result.assets[0].base64;
    if (!base64 || !orderId) return;

    setProofUploading(true);
    try {
      const res = await fetch(`${API_BASE}/api/orders/${orderId}/payment-proof`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentProof: `data:image/jpeg;base64,${base64}` }),
      });
      if (res.ok) {
        setProofUploaded(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {
      Alert.alert("خطأ", "فشل رفع الوصل، تأكد من اتصالك بالإنترنت");
    } finally {
      setProofUploading(false);
    }
  };

  // ── Payment / Bank Transfer Screen ──
  if (step === "payment") {
    return (
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={[styles.center, { paddingBottom: bottomPadding, paddingTop: topPadding + 20 }]}
      >
        <View style={[styles.successIcon, { backgroundColor: "#22c55e20" }]}>
          <Ionicons name="checkmark-circle" size={72} color="#22c55e" />
        </View>
        <Text style={[styles.successTitle, { color: colors.foreground }]}>تم استلام طلبك!</Text>
        <Text style={[styles.successSub, { color: colors.mutedForeground }]}>
          أكمل خطوة التحويل البنكي لتأكيد طلبك
        </Text>

        {/* Bank Info Card */}
        <View style={[styles.bankCard, { backgroundColor: colors.card, borderColor: colors.primary + "40" }]}>
          <View style={styles.bankHeader}>
            <Ionicons name="card-outline" size={22} color={colors.primary} />
            <Text style={[styles.bankTitle, { color: colors.foreground }]}>بيانات التحويل البنكي</Text>
          </View>

          {hasBankInfo ? (
            <View style={styles.bankRows}>
              {bank.bankName ? (
                <BankRow icon="business-outline" label="اسم البنك" value={bank.bankName} colors={colors} />
              ) : null}
              {bank.accountHolder ? (
                <BankRow icon="person-outline" label="اسم صاحب الحساب" value={bank.accountHolder} colors={colors} />
              ) : null}
              {bank.accountNumber ? (
                <BankRow icon="document-text-outline" label="رقم الحساب" value={bank.accountNumber} colors={colors} />
              ) : null}
              {bank.iban ? (
                <BankRow icon="globe-outline" label="IBAN" value={bank.iban} colors={colors} />
              ) : null}
            </View>
          ) : (
            <Text style={[styles.noBankText, { color: colors.mutedForeground }]}>
              يرجى التواصل مع المتجر عبر واتساب للحصول على بيانات التحويل
            </Text>
          )}

          <View style={[styles.amountRow, { backgroundColor: colors.primary + "15", borderRadius: 10 }]}>
            <Text style={[styles.amountLabel, { color: colors.foreground }]}>المبلغ المطلوب</Text>
            <Text style={[styles.amountValue, { color: colors.primary }]}>{savedTotal}₪</Text>
          </View>
        </View>

        {/* Upload Receipt */}
        <View style={[styles.uploadCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.uploadTitle, { color: colors.foreground }]}>
            {proofUploaded ? "✅ تم رفع وصل التحويل" : "ارفع وصل التحويل"}
          </Text>
          <Text style={[styles.uploadSub, { color: colors.mutedForeground }]}>
            {proofUploaded
              ? "سيقوم المتجر بمراجعة الوصل وتأكيد طلبك قريباً"
              : "بعد التحويل، ارفع صورة الوصل لتأكيد دفعك"}
          </Text>

          {!proofUploaded && (
            <Pressable
              onPress={handleUploadProof}
              disabled={proofUploading}
              style={[styles.uploadBtn, { backgroundColor: proofUploading ? colors.muted : colors.primary }]}
            >
              {proofUploading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
              )}
              <Text style={styles.uploadBtnText}>
                {proofUploading ? "جاري الرفع..." : "رفع صورة الوصل"}
              </Text>
            </Pressable>
          )}
        </View>

        <Pressable
          onPress={() => { setStep("success"); router.push("/"); }}
          style={[styles.backHomeBtn, { backgroundColor: proofUploaded ? colors.primary : colors.secondary }]}
        >
          <Text style={[styles.backHomeBtnText, { color: proofUploaded ? "#fff" : colors.foreground }]}>
            {proofUploaded ? "العودة للرئيسية" : "سأرفع الوصل لاحقاً"}
          </Text>
        </Pressable>
      </ScrollView>
    );
  }

  // ── Success Screen (COD) ──
  if (step === "success") {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <View style={[styles.successIcon, { backgroundColor: "#22c55e20" }]}>
          <Ionicons name="checkmark-circle" size={72} color="#22c55e" />
        </View>
        <Text style={[styles.successTitle, { color: colors.foreground }]}>تم استلام طلبك!</Text>
        <Text style={[styles.successSub, { color: colors.mutedForeground }]}>
          سيتم التواصل معك قريباً على رقم الهاتف المُدخل
        </Text>
        <View style={[styles.successInfo, { backgroundColor: colors.secondary + "40", borderColor: colors.secondary }]}>
          <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
          <Text style={[styles.successInfoText, { color: colors.foreground }]}>
            تم إرسال تفاصيل طلبك عبر WhatsApp للمتجر
          </Text>
        </View>
        <Pressable
          onPress={() => { setStep("cart"); router.push("/"); }}
          style={[styles.backHomeBtn, { backgroundColor: colors.primary }]}
        >
          <Text style={styles.backHomeBtnText}>العودة للرئيسية</Text>
        </Pressable>
      </View>
    );
  }

  // ── Checkout Form ──
  if (step === "checkout") {
    const canSubmit = name.trim().length > 0 && phone.trim().length > 0 && address.trim().length > 0;
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPadding + 12 }]}>
          <Pressable onPress={() => setStep("cart")}>
            <Ionicons name="arrow-forward" size={24} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>تفاصيل الطلب</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView
          contentContainerStyle={[styles.formContent, { paddingBottom: bottomPadding + 20 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Order Summary */}
          <View style={[styles.orderSummary, { backgroundColor: colors.secondary + "30", borderColor: colors.secondary }]}>
            <Text style={[styles.orderSummaryTitle, { color: colors.foreground }]}>
              ملخص الطلب ({totalItems} منتج)
            </Text>
            {items.map((item) => (
              <View key={`${item.id}-${item.color ?? ""}-${item.size ?? ""}`} style={styles.summaryItem}>
                <Text style={[styles.summaryItemPrice, { color: colors.primary }]}>
                  {item.price * item.quantity}₪
                </Text>
                <Text style={[styles.summaryItemName, { color: colors.foreground }]} numberOfLines={1}>
                  {item.name} x{item.quantity}
                </Text>
              </View>
            ))}
            <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
              <Text style={[styles.totalAmount, { color: colors.primary }]}>{totalPrice}₪</Text>
              <Text style={[styles.totalText, { color: colors.foreground }]}>الإجمالي</Text>
            </View>
          </View>

          {/* Form Fields */}
          <Text style={[styles.formSection, { color: colors.foreground }]}>بيانات التوصيل</Text>

          {[
            { label: "الاسم الكامل *", value: name, set: setName, placeholder: "محمد أحمد", icon: "person-outline" },
            { label: "رقم الهاتف *", value: phone, set: setPhone, placeholder: "059XXXXXXX", icon: "call-outline", keyType: "phone-pad" as const },
            { label: "العنوان *", value: address, set: setAddress, placeholder: "المدينة، الشارع، رقم المنزل", icon: "location-outline" },
          ].map((f) => (
            <View key={f.label} style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{f.label}</Text>
              <View style={[styles.inputRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name={f.icon as "person-outline"} size={18} color={colors.mutedForeground} />
                <TextInput
                  value={f.value}
                  onChangeText={f.set}
                  placeholder={f.placeholder}
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType={f.keyType}
                  style={[styles.input, { color: colors.foreground }]}
                  textAlign="right"
                />
              </View>
            </View>
          ))}

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>ملاحظات (اختياري)</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="أي ملاحظات إضافية..."
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={3}
              style={[styles.notesInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              textAlign="right"
              textAlignVertical="top"
            />
          </View>

          {/* Payment Method */}
          <Text style={[styles.formSection, { color: colors.foreground }]}>طريقة الدفع</Text>
          <View style={styles.paymentOptions}>
            <Pressable
              onPress={() => setPaymentMethod("cod")}
              style={[
                styles.payOption,
                {
                  backgroundColor: paymentMethod === "cod" ? colors.primary + "15" : colors.card,
                  borderColor: paymentMethod === "cod" ? colors.primary : colors.border,
                },
              ]}
            >
              <Ionicons name="cash-outline" size={24} color={paymentMethod === "cod" ? colors.primary : colors.mutedForeground} />
              <Text style={[styles.payOptionTitle, { color: paymentMethod === "cod" ? colors.primary : colors.foreground }]}>
                الدفع عند الاستلام
              </Text>
              <Text style={[styles.payOptionSub, { color: colors.mutedForeground }]}>ادفع نقداً عند وصول الطلب</Text>
              {paymentMethod === "cod" && (
                <Ionicons name="checkmark-circle" size={20} color={colors.primary} style={styles.payCheck} />
              )}
            </Pressable>

            <Pressable
              onPress={() => setPaymentMethod("bank_transfer")}
              style={[
                styles.payOption,
                {
                  backgroundColor: paymentMethod === "bank_transfer" ? colors.primary + "15" : colors.card,
                  borderColor: paymentMethod === "bank_transfer" ? colors.primary : colors.border,
                },
              ]}
            >
              <Ionicons name="card-outline" size={24} color={paymentMethod === "bank_transfer" ? colors.primary : colors.mutedForeground} />
              <Text style={[styles.payOptionTitle, { color: paymentMethod === "bank_transfer" ? colors.primary : colors.foreground }]}>
                تحويل بنكي
              </Text>
              <Text style={[styles.payOptionSub, { color: colors.mutedForeground }]}>حوّل المبلغ وارفع وصل التحويل</Text>
              {paymentMethod === "bank_transfer" && (
                <Ionicons name="checkmark-circle" size={20} color={colors.primary} style={styles.payCheck} />
              )}
            </Pressable>
          </View>

          {/* Confirm Button */}
          <Pressable
            onPress={handleCheckout}
            disabled={loading || !canSubmit}
            style={[
              styles.confirmBtn,
              { backgroundColor: canSubmit ? colors.primary : colors.muted, opacity: loading ? 0.8 : 1 }
            ]}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Ionicons name="logo-whatsapp" size={22} color="#fff" />
            )}
            <Text style={styles.confirmBtnText}>
              {loading ? "جاري الإرسال..." : "تأكيد الطلب وإرساله عبر واتساب"}
            </Text>
          </Pressable>

          {!canSubmit && (
            <Text style={[styles.validationHint, { color: colors.mutedForeground }]}>
              * يرجى ملء جميع الحقول المطلوبة
            </Text>
          )}
        </ScrollView>
      </View>
    );
  }

  // ── Cart ──
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 12 }]}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-forward" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>سلة التسوق</Text>
        {items.length > 0 && (
          <Pressable onPress={clearCart}>
            <Text style={[styles.clearText, { color: colors.primary }]}>مسح الكل</Text>
          </Pressable>
        )}
      </View>

      {items.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="bag-outline" size={64} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>السلة فارغة</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            أضيفي منتجات لإتمام الطلب
          </Text>
          <Pressable
            onPress={() => router.push("/products")}
            style={[styles.shopBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.shopBtnText}>تصفحي المنتجات</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <FlatList
            data={items}
            keyExtractor={(item) => `${item.id}-${item.color ?? ""}-${item.size ?? ""}`}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <View style={[styles.cartItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Pressable onPress={() => removeItem(item.id, item.size, item.color)} style={styles.removeBtn}>
                  <Ionicons name="close" size={16} color={colors.mutedForeground} />
                </Pressable>
                <View style={styles.itemRight}>
                  <Text style={[styles.itemName, { color: colors.foreground }]}>{item.name}</Text>
                  {(item.size || item.color) && (
                    <Text style={[styles.itemSize, { color: colors.mutedForeground }]}>
                      {[item.color ? `اللون: ${item.color}` : null, item.size ? `المقاس: ${item.size}` : null]
                        .filter(Boolean)
                        .join(" — ")}
                    </Text>
                  )}
                  <Text style={[styles.itemPrice, { color: colors.primary }]}>
                    {item.price * item.quantity} ₪
                  </Text>
                </View>
                <Image source={{ uri: item.image }} style={styles.itemImage} />
                <View style={styles.quantityRow}>
                  <Pressable
                    onPress={() => updateQuantity(item.id, item.quantity + 1, item.size, item.color)}
                    style={[styles.qtyBtn, { backgroundColor: colors.primary }]}
                  >
                    <Ionicons name="add" size={16} color="#fff" />
                  </Pressable>
                  <Text style={[styles.qty, { color: colors.foreground }]}>{item.quantity}</Text>
                  <Pressable
                    onPress={() => updateQuantity(item.id, item.quantity - 1, item.size, item.color)}
                    style={[styles.qtyBtn, { backgroundColor: item.quantity === 1 ? colors.muted : colors.primary }]}
                  >
                    <Ionicons name="remove" size={16} color={item.quantity === 1 ? colors.mutedForeground : "#fff"} />
                  </Pressable>
                </View>
              </View>
            )}
          />

          <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: bottomPadding }]}>
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>{totalItems} منتج</Text>
              <Text style={[styles.summaryValue, { color: colors.foreground }]}>المجموع</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={[styles.totalPrice, { color: colors.primary }]}>{totalPrice} ₪</Text>
              <Text style={[styles.totalLabel, { color: colors.foreground }]}>الإجمالي</Text>
            </View>
            {totalPrice >= 500 && (
              <View style={[styles.freeShipping, { backgroundColor: "#22c55e20" }]}>
                <Ionicons name="rocket-outline" size={16} color="#22c55e" />
                <Text style={{ color: "#22c55e", fontSize: 13, fontWeight: "600" }}>الشحن مجاني</Text>
              </View>
            )}
            <Pressable
              onPress={() => setStep("checkout")}
              style={[styles.orderBtn, { backgroundColor: colors.primary }]}
            >
              <Ionicons name="arrow-back" size={20} color="#fff" />
              <Text style={styles.orderBtnText}>متابعة الطلب</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

function BankRow({ icon, label, value, colors }: { icon: string; label: string; value: string; colors: any }) {
  return (
    <View style={styles.bankRow}>
      <View style={{ flex: 1, alignItems: "flex-end" }}>
        <Text style={[styles.bankRowLabel, { color: colors.mutedForeground }]}>{label}</Text>
        <Text style={[styles.bankRowValue, { color: colors.foreground }]} selectable>{value}</Text>
      </View>
      <Ionicons name={icon as "card-outline"} size={18} color={colors.primary} style={{ marginTop: 2 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  header: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: { fontSize: 20, fontWeight: "800" },
  clearText: { fontSize: 14, fontWeight: "600" },
  emptyTitle: { fontSize: 20, fontWeight: "700" },
  emptySub: { fontSize: 14 },
  shopBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14, marginTop: 8 },
  shopBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  list: { padding: 16, gap: 12 },
  cartItem: {
    flexDirection: "row-reverse",
    alignItems: "center",
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    position: "relative",
  },
  removeBtn: { position: "absolute", top: 8, left: 8, zIndex: 1 },
  itemImage: { width: 70, height: 70, borderRadius: 12, resizeMode: "cover" },
  itemRight: { flex: 1, gap: 4, alignItems: "flex-end" },
  itemName: { fontSize: 14, fontWeight: "700", textAlign: "right" },
  itemSize: { fontSize: 12 },
  itemPrice: { fontSize: 15, fontWeight: "700" },
  quantityRow: { flexDirection: "column", alignItems: "center", gap: 8 },
  qtyBtn: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  qty: { fontSize: 16, fontWeight: "700" },
  summary: { padding: 16, borderTopWidth: 1, gap: 10 },
  summaryRow: { flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center" },
  summaryLabel: { fontSize: 14 },
  summaryValue: { fontSize: 14, fontWeight: "600" },
  totalPrice: { fontSize: 24, fontWeight: "800" },
  totalLabel: { fontSize: 16, fontWeight: "700" },
  freeShipping: { flexDirection: "row-reverse", alignItems: "center", gap: 6, padding: 10, borderRadius: 10, justifyContent: "center" },
  orderBtn: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: 16, marginTop: 4 },
  orderBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  formContent: { padding: 16, gap: 14 },
  orderSummary: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 8 },
  orderSummaryTitle: { fontSize: 15, fontWeight: "700", textAlign: "right", marginBottom: 4 },
  summaryItem: { flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center" },
  summaryItemName: { fontSize: 13, textAlign: "right", flex: 1 },
  summaryItemPrice: { fontSize: 13, fontWeight: "700", marginLeft: 8 },
  totalRow: { flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, paddingTop: 8, marginTop: 4 },
  totalAmount: { fontSize: 20, fontWeight: "800" },
  totalText: { fontSize: 15, fontWeight: "700" },
  formSection: { fontSize: 16, fontWeight: "800", textAlign: "right" },
  fieldGroup: { gap: 6 },
  fieldLabel: { fontSize: 14, fontWeight: "600", textAlign: "right" },
  inputRow: { flexDirection: "row-reverse", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  input: { flex: 1, fontSize: 15, padding: 0 },
  notesInput: { borderRadius: 12, borderWidth: 1, padding: 12, fontSize: 14, minHeight: 80 },
  paymentOptions: { gap: 10 },
  payOption: { borderRadius: 14, borderWidth: 2, padding: 14, gap: 4, alignItems: "flex-end", position: "relative" },
  payOptionTitle: { fontSize: 15, fontWeight: "700", textAlign: "right" },
  payOptionSub: { fontSize: 12, textAlign: "right" },
  payCheck: { position: "absolute", top: 12, left: 12 },
  confirmBtn: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 18, borderRadius: 16, marginTop: 8 },
  confirmBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  validationHint: { fontSize: 13, textAlign: "center", marginTop: 6 },
  successIcon: { width: 100, height: 100, borderRadius: 50, alignItems: "center", justifyContent: "center" },
  successTitle: { fontSize: 24, fontWeight: "800" },
  successSub: { fontSize: 14, textAlign: "center", maxWidth: 280 },
  successInfo: { flexDirection: "row-reverse", alignItems: "center", gap: 10, padding: 14, borderRadius: 14, borderWidth: 1, marginTop: 8 },
  successInfoText: { fontSize: 13, textAlign: "right", flex: 1 },
  backHomeBtn: { paddingHorizontal: 32, paddingVertical: 14, borderRadius: 16, marginTop: 8 },
  backHomeBtnText: { fontSize: 16, fontWeight: "700" },
  bankCard: { width: "100%", borderRadius: 16, borderWidth: 1.5, padding: 16, gap: 12 },
  bankHeader: { flexDirection: "row-reverse", alignItems: "center", gap: 8 },
  bankTitle: { fontSize: 16, fontWeight: "800" },
  bankRows: { gap: 10 },
  bankRow: { flexDirection: "row-reverse", alignItems: "flex-start", gap: 10 },
  bankRowLabel: { fontSize: 11, marginBottom: 2 },
  bankRowValue: { fontSize: 15, fontWeight: "700" },
  noBankText: { fontSize: 13, textAlign: "right", lineHeight: 20 },
  amountRow: { flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center", padding: 12 },
  amountLabel: { fontSize: 14, fontWeight: "600" },
  amountValue: { fontSize: 22, fontWeight: "800" },
  uploadCard: { width: "100%", borderRadius: 16, borderWidth: 1, padding: 16, gap: 10, alignItems: "flex-end" },
  uploadTitle: { fontSize: 15, fontWeight: "700", textAlign: "right" },
  uploadSub: { fontSize: 13, textAlign: "right" },
  uploadBtn: { flexDirection: "row-reverse", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
  uploadBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
});
