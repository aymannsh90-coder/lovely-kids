import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
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

import { DateField } from "@/components/DateField";
import { useAppSettings } from "@/context/AppSettingsContext";
import { useColors } from "@/hooks/useColors";

export default function ShippingPromotionScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings, settingsReady, updateSettings } = useAppSettings();

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 20;

  const [enabled, setEnabled] = useState(
    settings.shippingPromotionEnabled === true,
  );
  const [threshold, setThreshold] = useState(
    String(settings.shippingPromotionThreshold ?? 500),
  );
  const [startDate, setStartDate] = useState(
    settings.shippingPromotionStartDate ?? "",
  );
  const [endDate, setEndDate] = useState(
    settings.shippingPromotionEndDate ?? "",
  );
  const [promoCosts, setPromoCosts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (settings.shippingZones ?? []).map((zone) => [
        zone.label,
        String(zone.promoCost ?? zone.cost),
      ]),
    ),
  );

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!settingsReady || initializedRef.current) return;

    initializedRef.current = true;
    setEnabled(settings.shippingPromotionEnabled === true);
    setThreshold(String(settings.shippingPromotionThreshold ?? 500));
    setStartDate(settings.shippingPromotionStartDate ?? "");
    setEndDate(settings.shippingPromotionEndDate ?? "");
    setPromoCosts(
      Object.fromEntries(
        (settings.shippingZones ?? []).map((zone) => [
          zone.label,
          String(zone.promoCost ?? zone.cost),
        ]),
      ),
    );
  }, [settingsReady, settings]);

  const isValidDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  };

  const handleSave = async () => {
    const thresholdText = threshold.trim();

    if (!/^\d+$/.test(thresholdText)) {
      Alert.alert(
        "قيمة غير صالحة",
        "أدخل الحد الأدنى كرقم صحيح. ويمكن وضع 0 لتطبيق العرض على جميع الطلبات.",
      );
      return;
    }

    const thresholdValue = Number(thresholdText);

    if (!Number.isSafeInteger(thresholdValue) || thresholdValue < 0) {
      Alert.alert(
        "قيمة غير صالحة",
        "الحد الأدنى يجب أن يكون 0 أو أكثر.",
      );
      return;
    }

    const cleanStartDate = startDate.trim();
    const cleanEndDate = endDate.trim();

    if (cleanStartDate && !isValidDate(cleanStartDate)) {
      Alert.alert(
        "تاريخ البداية غير صالح",
        "اكتب التاريخ بالشكل YYYY-MM-DD مثل 2026-08-01.",
      );
      return;
    }

    if (cleanEndDate && !isValidDate(cleanEndDate)) {
      Alert.alert(
        "تاريخ النهاية غير صالح",
        "اكتب التاريخ بالشكل YYYY-MM-DD مثل 2026-08-31.",
      );
      return;
    }

    if (
      cleanStartDate &&
      cleanEndDate &&
      cleanStartDate > cleanEndDate
    ) {
      Alert.alert(
        "الفترة غير صالحة",
        "تاريخ البداية يجب أن يكون قبل تاريخ النهاية أو مساويًا له.",
      );
      return;
    }

    for (const zone of settings.shippingZones ?? []) {
      const value = (
        promoCosts[zone.label] ??
        String(zone.promoCost ?? zone.cost)
      ).trim();

      if (!/^\d+$/.test(value)) {
        Alert.alert(
          "سعر عرض غير صالح",
          `أدخل سعر عرض صحيح لمنطقة ${zone.label}. ويمكن وضع 0 للشحن المجاني.`,
        );
        return;
      }

      const amount = Number(value);

      if (!Number.isSafeInteger(amount) || amount < 0) {
        Alert.alert(
          "سعر عرض غير صالح",
          `سعر عرض ${zone.label} يجب أن يكون 0 أو أكثر.`,
        );
        return;
      }
    }

    const shippingZones = (settings.shippingZones ?? []).map((zone) => ({
      ...zone,
      promoCost: Number(
        (
          promoCosts[zone.label] ??
          String(zone.promoCost ?? zone.cost)
        ).trim(),
      ),
    }));

    setSaving(true);

    const ok = await updateSettings({
      shippingPromotionEnabled: enabled,
      shippingPromotionThreshold: thresholdValue,
      shippingPromotionStartDate: cleanStartDate,
      shippingPromotionEndDate: cleanEndDate,
      shippingZones,
    });

    setSaving(false);

    if (!ok) {
      Alert.alert(
        "فشل حفظ عرض التوصيل",
        "تعذّر حفظ إعدادات عرض التوصيل في السيرفر.",
      );
      return;
    }

    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Success,
    );

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: bottomPadding }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
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
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-forward" size={24} color="#fff" />
        </Pressable>

        <Text style={styles.headerTitle}>🚚 عرض التوصيل</Text>

        <View style={{ width: 24 }} />
      </View>

      <View style={styles.content}>
        <View
          style={[
            styles.infoCard,
            {
              backgroundColor: colors.secondary,
              borderColor: colors.border,
            },
          ]}
        >
          <Ionicons
            name="information-circle-outline"
            size={22}
            color={colors.primary}
          />
          <Text style={[styles.infoText, { color: colors.foreground }]}>
            عند انتهاء الفترة أو إيقاف العرض ترجع أسعار التوصيل الأصلية
            تلقائياً.
          </Text>
        </View>

        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.toggleRow}>
            <Switch
              value={enabled}
              onValueChange={setEnabled}
              disabled={!settingsReady || saving}
            />

            <View style={styles.toggleText}>
              <Text style={[styles.labelStrong, { color: colors.foreground }]}>
                تشغيل عرض التوصيل
              </Text>
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                يمكنك تشغيل أو إيقاف العرض في أي وقت
              </Text>
            </View>
          </View>
        </View>

        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            شروط العرض
          </Text>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            الحد الأدنى لقيمة المشتريات
          </Text>

          <View style={styles.moneyRow}>
            <TextInput
              value={threshold}
              onChangeText={(value) =>
                setThreshold(value.replace(/\D/g, ""))
              }
              keyboardType="number-pad"
              style={[
                styles.input,
                {
                  backgroundColor: colors.input,
                  borderColor: colors.border,
                  color: colors.foreground,
                },
              ]}
              textAlign="center"
            />
            <Text style={[styles.currency, { color: colors.foreground }]}>
              ₪
            </Text>
          </View>

          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            ضع 0 لتطبيق عرض التوصيل على جميع الطلبات بدون حد أدنى.
          </Text>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <DateField
            label="من تاريخ"
            value={startDate}
            onChange={setStartDate}
            colors={colors}
          />

          <DateField
            label="إلى تاريخ"
            value={endDate}
            onChange={setEndDate}
            colors={colors}
          />
        </View>

        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            أسعار التوصيل خلال العرض
          </Text>

          {(settings.shippingZones ?? []).map((zone, index) => (
            <View key={zone.label}>
              {index > 0 ? (
                <View
                  style={[
                    styles.divider,
                    { backgroundColor: colors.border },
                  ]}
                />
              ) : null}

              <View style={styles.zoneRow}>
                <View style={styles.zoneInfo}>
                  <Text
                    style={[
                      styles.zoneName,
                      { color: colors.foreground },
                    ]}
                  >
                    {zone.label}
                  </Text>

                  <Text
                    style={[
                      styles.originalPrice,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    السعر الأصلي: {zone.cost} ₪
                  </Text>
                </View>

                <View style={styles.promoPriceBox}>
                  <Text
                    style={[
                      styles.promoLabel,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    سعر العرض
                  </Text>

                  <View style={styles.moneyRowSmall}>
                    <TextInput
                      value={
                        promoCosts[zone.label] ??
                        String(zone.promoCost ?? zone.cost)
                      }
                      onChangeText={(value) =>
                        setPromoCosts((previous) => ({
                          ...previous,
                          [zone.label]: value.replace(/\D/g, ""),
                        }))
                      }
                      keyboardType="number-pad"
                      style={[
                        styles.promoInput,
                        {
                          backgroundColor: colors.input,
                          borderColor: colors.border,
                          color: colors.foreground,
                        },
                      ]}
                      textAlign="center"
                    />

                    <Text
                      style={[
                        styles.currency,
                        { color: colors.foreground },
                      ]}
                    >
                      ₪
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          ))}

          <Text style={[styles.example, { color: colors.mutedForeground }]}>
            مثال: الضفة 20 ← 0 ₪، القدس 30 ← 12 ₪، الداخل 70 ← 50 ₪.
          </Text>
        </View>

        <Pressable
          onPress={() => void handleSave()}
          disabled={saving || !settingsReady}
          style={[
            styles.saveButton,
            {
              backgroundColor: saved
                ? "#22c55e"
                : saving || !settingsReady
                  ? colors.muted
                  : colors.primary,
            },
          ]}
        >
          <Ionicons
            name={
              saved
                ? "checkmark-circle"
                : saving
                  ? "hourglass-outline"
                  : "save-outline"
            }
            size={21}
            color="#fff"
          />

          <Text style={styles.saveText}>
            {saved
              ? "تم حفظ عرض التوصيل ✓"
              : saving
                ? "جاري الحفظ..."
                : "حفظ إعدادات عرض التوصيل"}
          </Text>
        </Pressable>

        <Text
          style={[
            styles.saveHint,
            { color: colors.mutedForeground },
          ]}
        >
          جميع التعديلات تُحفظ معاً بضغطة واحدة.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  header: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  headerTitle: {
    color: "#fff",
    fontSize: 19,
    fontWeight: "800",
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 16,
  },
  infoCard: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 21,
    textAlign: "right",
  },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "800",
    textAlign: "right",
  },
  toggleRow: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
  },
  toggleText: {
    flex: 1,
    alignItems: "flex-end",
  },
  labelStrong: {
    fontSize: 15,
    fontWeight: "800",
    textAlign: "right",
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
    textAlign: "right",
  },
  hint: {
    fontSize: 12,
    lineHeight: 19,
    textAlign: "right",
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
  },
  moneyRow: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    gap: 8,
  },
  moneyRowSmall: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    gap: 5,
  },
  currency: {
    fontSize: 14,
    fontWeight: "800",
  },
  divider: {
    height: 1,
    marginVertical: 4,
  },
  zoneRow: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  zoneInfo: {
    flex: 1,
    alignItems: "flex-end",
  },
  zoneName: {
    fontSize: 15,
    fontWeight: "800",
    textAlign: "right",
  },
  originalPrice: {
    marginTop: 4,
    fontSize: 12,
    textAlign: "right",
  },
  promoPriceBox: {
    alignItems: "center",
    gap: 4,
  },
  promoLabel: {
    fontSize: 11,
    fontWeight: "700",
  },
  promoInput: {
    width: 85,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 9,
    fontSize: 14,
  },
  example: {
    fontSize: 12,
    lineHeight: 20,
    textAlign: "right",
    marginTop: 4,
  },
  saveButton: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    paddingVertical: 15,
    borderRadius: 14,
  },
  saveText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800",
  },
  saveHint: {
    textAlign: "center",
    fontSize: 11,
    marginTop: -8,
  },
});
