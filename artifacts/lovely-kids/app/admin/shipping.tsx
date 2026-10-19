import { getResponsiveTopPadding } from "@/utils/webLayout";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppSettings } from "@/context/AppSettingsContext";
import { useColors } from "@/hooks/useColors";

export default function AdminShippingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings, updateSettings } = useAppSettings();

  const [customerDrafts, setCustomerDrafts] =
    useState<string[]>([]);
  const [companyDrafts, setCompanyDrafts] =
    useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const topPadding = getResponsiveTopPadding(insets.top);

  useEffect(() => {
    const zones = settings.shippingZones ?? [];

    setCustomerDrafts(
      zones.map(
        (zone) =>
          String(zone.cost),
      ),
    );

    setCompanyDrafts(
      zones.map(
        (zone) =>
          String(
            zone.companyCost ??
              zone.cost,
          ),
      ),
    );
  }, [settings.shippingZones]);

  const save = async () => {
    const zones = (settings.shippingZones ?? []).map((zone, index) => ({
      ...zone,

      // السعر الذي يظهر للزبون ويبقى مرجع عرض التوصيل.
      cost: Math.max(
        0,
        parseInt(
          customerDrafts[index] ||
            "0",
          10,
        ) || 0,
      ),

      // التكلفة الفعلية التي تدخل في حساب شركة التوصيل فقط.
      companyCost: Math.max(
        0,
        parseInt(
          companyDrafts[index] ??
            customerDrafts[index] ??
            "0",
          10,
        ) || 0,
      ),
    }));

    setSaving(true);
    const ok = await updateSettings({ shippingZones: zones });
    setSaving(false);

    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 12, backgroundColor: colors.primary }]}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-forward" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>أسعار التوصيل</Text>
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
            size={20}
            color={colors.primary}
          />
          <Text
            style={[
              styles.infoText,
              { color: colors.mutedForeground },
            ]}
          >
            السعر للزبون هو الذي يظهر في المتجر ويُستخدم في عروض التوصيل. التكلفة الفعلية للشركة داخلية فقط وتُثبت على الطرد عند إخراجه للتوصيل.
          </Text>
        </View>

        {(settings.shippingZones ?? []).map((zone, index) => (
          <View
            key={`${zone.label}-${index}`}
            style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={styles.zoneInfo}>
              <Text
                style={[
                  styles.label,
                  { color: colors.foreground },
                ]}
              >
                {zone.label}
              </Text>

            </View>

            <View style={styles.priceColumns}>
              <View
                style={[
                  styles.priceField,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.fieldLabel,
                    {
                      color:
                        colors.mutedForeground,
                    },
                  ]}
                >
                  السعر للزبون
                </Text>

                <View
                  style={[
                    styles.inputBox,
                    {
                      backgroundColor:
                        colors.background,
                      borderColor:
                        colors.border,
                    },
                  ]}
                >
                  <TextInput
                    value={
                      customerDrafts[index] ??
                      ""
                    }
                    onChangeText={(value) => {
                      const clean =
                        value.replace(
                          /\D/g,
                          "",
                        );

                      setCustomerDrafts(
                        (previous) => {
                          const next = [
                            ...previous,
                          ];

                          next[index] =
                            clean;

                          return next;
                        },
                      );
                    }}
                    keyboardType="number-pad"
                    style={[
                      styles.input,
                      {
                        color:
                          colors.foreground,
                      },
                    ]}
                  />

                  <Text
                    style={[
                      styles.currency,
                      {
                        color:
                          colors.foreground,
                      },
                    ]}
                  >
                    ₪
                  </Text>
                </View>
              </View>

              <View
                style={[
                  styles.priceField,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.fieldLabel,
                    {
                      color:
                        colors.mutedForeground,
                    },
                  ]}
                >
                  التكلفة الفعلية للشركة
                </Text>

                <View
                  style={[
                    styles.inputBox,
                    {
                      backgroundColor:
                        colors.background,
                      borderColor:
                        colors.border,
                    },
                  ]}
                >
                  <TextInput
                    value={
                      companyDrafts[index] ??
                      ""
                    }
                    onChangeText={(value) => {
                      const clean =
                        value.replace(
                          /\D/g,
                          "",
                        );

                      setCompanyDrafts(
                        (previous) => {
                          const next = [
                            ...previous,
                          ];

                          next[index] =
                            clean;

                          return next;
                        },
                      );
                    }}
                    keyboardType="number-pad"
                    style={[
                      styles.input,
                      {
                        color:
                          colors.foreground,
                      },
                    ]}
                  />

                  <Text
                    style={[
                      styles.currency,
                      {
                        color:
                          colors.foreground,
                      },
                    ]}
                  >
                    ₪
                  </Text>
                </View>
              </View>
            </View>
          </View>
        ))}

        <Pressable
          onPress={() => void save()}
          disabled={saving}
          style={[styles.saveBtn, { backgroundColor: saved ? "#22c55e" : colors.primary }]}
        >
          <Ionicons name={saved ? "checkmark-circle" : "save-outline"} size={20} color="#fff" />
          <Text style={styles.saveText}>
            {saving
              ? "جاري الحفظ..."
              : saved
                ? "تم الحفظ"
                : "حفظ أسعار وتكلفة التوصيل"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  body: {
    padding: 16,
    gap: 12,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
  },
  row: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "column",
    alignItems: "stretch",
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 14,
  },
  infoCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    gap: 8,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 19,
    textAlign: "right",
  },
  zoneInfo: {
    flex: 1,
    minWidth: Platform.OS === "web" ? 150 : undefined,
    justifyContent: "center",
    alignItems: "flex-end",
    gap: 4,
  },
  label: {
    fontWeight: "800",
    textAlign: "right",
  },
  priceColumns: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "stretch",
    justifyContent: Platform.OS === "web" ? "flex-start" : "space-between",
    flexWrap: "wrap",
    gap: 10,
  },
  priceField: {
    width: Platform.OS === "web" ? 160 : "48%",
    minWidth: 145,
    borderWidth: 1,
    borderRadius: 12,
    padding: 8,
    alignItems: "stretch",
    gap: 6,
  },
  fieldLabel: {
    width: "100%",
    minHeight: 32,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
    textAlign: "center",
    textAlignVertical: "center",
  },
  inputBox: {
    width: "100%",
    height: 44,
    borderWidth: 1,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
  },
  input: { flex: 1, textAlign: "center", fontSize: 15, fontWeight: "800" },
  currency: { fontWeight: "800" },
  saveBtn: {
    marginTop: 6,
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  saveText: { color: "#fff", fontWeight: "800" },
});
