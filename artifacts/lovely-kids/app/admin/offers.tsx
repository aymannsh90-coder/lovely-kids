import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ColorPickerButton } from "@/components/ColorPickerButton";
import { Offer, useAppSettings } from "@/context/AppSettingsContext";
import { useColors } from "@/hooks/useColors";

function OfferForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<Offer>;
  onSave: (o: Omit<Offer, "id">) => void;
  onCancel: () => void;
}) {
  const colors = useColors();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [subtitle, setSubtitle] = useState(initial?.subtitle ?? "");
  const [badge, setBadge] = useState(initial?.badgeText ?? "");
  const [color, setColor] = useState(initial?.color ?? "#E91E8C");
  const [active, setActive] = useState(initial?.active ?? true);

  return (
    <ScrollView
      style={[styles.formScroll, { backgroundColor: colors.background }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.formContent}>
        {[
          { label: "عنوان العرض", value: title, set: setTitle, placeholder: "خصم 30% على ملابس الأطفال" },
          { label: "وصف العرض", value: subtitle, set: setSubtitle, placeholder: "لفترة محدودة فقط" },
          { label: "نص الشارة (مثلاً: 30%)", value: badge, set: setBadge, placeholder: "30%" },
        ].map((f) => (
          <View key={f.label} style={styles.field}>
            <Text style={[styles.label, { color: colors.foreground }]}>{f.label}</Text>
            <TextInput
              value={f.value}
              onChangeText={f.set}
              placeholder={f.placeholder}
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              textAlign="right"
            />
          </View>
        ))}

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>لون العرض</Text>
          <ColorPickerButton value={color} title="لون العرض" onChange={setColor} />
        </View>

        <View style={[styles.toggleRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Switch
            value={active}
            onValueChange={setActive}
            trackColor={{ false: colors.muted, true: colors.primary }}
            thumbColor="#fff"
          />
          <Text style={[styles.toggleLabel, { color: colors.foreground }]}>العرض مفعّل</Text>
        </View>

        <View style={styles.btnRow}>
          <Pressable
            onPress={onCancel}
            style={[styles.cancelBtn, { backgroundColor: colors.muted }]}
          >
            <Text style={[styles.cancelBtnText, { color: colors.mutedForeground }]}>إلغاء</Text>
          </Pressable>
          <Pressable
            onPress={() => onSave({ title, subtitle, badgeText: badge, color, active })}
            style={[styles.saveBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.saveBtnText}>حفظ</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

export default function OffersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings, addOffer, updateOffer, deleteOffer } = useAppSettings();
  const [editing, setEditing] = useState<Offer | null | "new">(null);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 16;

  const handleDelete = (id: string) => {
    if (Platform.OS === "web") {
      if (window.confirm("حذف هذا العرض؟")) deleteOffer(id);
    } else {
      Alert.alert("حذف العرض", "هل تريد حذف هذا العرض؟", [
        { text: "إلغاء", style: "cancel" },
        { text: "حذف", style: "destructive", onPress: () => deleteOffer(id) },
      ]);
    }
  };

  if (editing === "new") {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPadding + 12, backgroundColor: colors.primary }]}>
          <Pressable onPress={() => setEditing(null)}>
            <Ionicons name="arrow-forward" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>عرض جديد</Text>
          <View style={{ width: 24 }} />
        </View>
        <OfferForm
          onSave={(o) => { addOffer(o); setEditing(null); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }}
          onCancel={() => setEditing(null)}
        />
      </View>
    );
  }

  if (editing !== null && typeof editing !== "string") {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPadding + 12, backgroundColor: colors.primary }]}>
          <Pressable onPress={() => setEditing(null)}>
            <Ionicons name="arrow-forward" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>تعديل العرض</Text>
          <View style={{ width: 24 }} />
        </View>
        <OfferForm
          initial={editing}
          onSave={(o) => { updateOffer({ ...o, id: editing.id }); setEditing(null); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }}
          onCancel={() => setEditing(null)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12, backgroundColor: colors.primary }]}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-forward" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>العروض الخاصة</Text>
        <Pressable onPress={() => setEditing("new")}>
          <Ionicons name="add-circle-outline" size={26} color="#fff" />
        </Pressable>
      </View>

      <FlatList
        data={settings.offers}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: bottomPadding }]}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="pricetag-outline" size={48} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              لا توجد عروض بعد
            </Text>
            <Pressable
              onPress={() => setEditing("new")}
              style={[styles.addBtnEmpty, { backgroundColor: colors.primary }]}
            >
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.addBtnText}>أضف عرضاً</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.offerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {/* Color stripe */}
            <View style={[styles.colorStripe, { backgroundColor: item.color }]}>
              <Text style={styles.badgeText}>{item.badgeText}</Text>
            </View>
            <View style={styles.offerInfo}>
              <View style={styles.offerHeader}>
                <View style={[styles.statusDot, { backgroundColor: item.active ? "#22c55e" : colors.mutedForeground }]} />
                <Text style={[styles.activeLabel, { color: item.active ? "#22c55e" : colors.mutedForeground }]}>
                  {item.active ? "مفعّل" : "معطّل"}
                </Text>
              </View>
              <Text style={[styles.offerTitle, { color: colors.foreground }]} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={[styles.offerSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                {item.subtitle}
              </Text>
            </View>
            <View style={styles.actions}>
              <Pressable onPress={() => setEditing(item)} style={[styles.actionBtn, { backgroundColor: colors.secondary }]}>
                <Ionicons name="pencil-outline" size={16} color={colors.foreground} />
              </Pressable>
              <Pressable onPress={() => handleDelete(item.id)} style={[styles.actionBtn, { backgroundColor: "#fee2e2" }]}>
                <Ionicons name="trash-outline" size={16} color={colors.destructive} />
              </Pressable>
            </View>
          </View>
        )}
        ListHeaderComponent={
          settings.offers.length > 0 ? (
            <Pressable
              onPress={() => setEditing("new")}
              style={[styles.addBtnTop, { backgroundColor: colors.primary }]}
            >
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.addBtnText}>إضافة عرض جديد</Text>
            </Pressable>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  headerTitle: { fontSize: 18, fontWeight: "800", color: "#fff" },
  list: { padding: 16, gap: 12 },
  offerCard: {
    flexDirection: "row-reverse",
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  colorStripe: {
    width: 60,
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
  },
  badgeText: { color: "#fff", fontWeight: "800", fontSize: 16, textAlign: "center" },
  offerInfo: { flex: 1, padding: 12, gap: 4, alignItems: "flex-end" },
  offerHeader: { flexDirection: "row-reverse", alignItems: "center", gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  activeLabel: { fontSize: 11, fontWeight: "600" },
  offerTitle: { fontSize: 14, fontWeight: "700", textAlign: "right" },
  offerSub: { fontSize: 12, textAlign: "right" },
  actions: { padding: 10, gap: 8, justifyContent: "center" },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: { alignItems: "center", paddingTop: 80, gap: 12 },
  emptyText: { fontSize: 16 },
  addBtnEmpty: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  addBtnTop: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  addBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  formScroll: { flex: 1 },
  formContent: { padding: 16, gap: 14 },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: "700", textAlign: "right" },
  input: {
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 14,
  },
  toggleRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  toggleLabel: { fontSize: 14, fontWeight: "600" },
  btnRow: { flexDirection: "row-reverse", gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  cancelBtnText: { fontSize: 15, fontWeight: "600" },
  saveBtn: { flex: 2, paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  saveBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
