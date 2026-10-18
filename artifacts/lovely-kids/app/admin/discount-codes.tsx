import { getResponsiveTopPadding } from "@/utils/webLayout";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
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
import { API_BASE } from "@/constants/api";
import { useAppSettings } from "@/context/AppSettingsContext";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

type DiscountCodeStats = {
  usageCount: number;
  activeOrdersCount: number;
  completedOrdersCount: number;
  cancelledOrdersCount: number;
  activeOrderValue: number;
  completedOrderValue: number;
  activeProductsNetSales: number;
  completedProductsNetSales: number;
  totalDiscountAmount: number;
  completedDiscountAmount: number;
  completedCogsKnownMinor: number;
  grossProfitMinor: number | null;
  deliveryImpactMinor: number;
  profitAfterDeliveryMinor: number | null;
  costCoveragePercent: number;
  costCoverageComplete: boolean;
};

type DiscountCode = {
  id: number;
  campaignName: string;
  code: string;
  discountPercent: number;
  isActive: boolean;
  stackWithShippingPromotion: boolean;
  startDate: string | null;
  endDate: string | null;
  stats: DiscountCodeStats;
};

function moneyMinor(value: number | null) {
  if (value === null) return "غير متوفر";

  return `${(value / 100).toFixed(2)} ₪`;
}

function money(value: number) {
  return `${value} ₪`;
}

export default function DiscountCodesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getAuthToken } = useAuth();
  const {
    settings,
    settingsReady,
    updateSettings,
  } = useAppSettings();

  const topPadding = getResponsiveTopPadding(insets.top);
  const bottomPadding =
    Platform.OS === "web" ? 34 : insets.bottom + 20;

  const [codes, setCodes] = useState<DiscountCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [savingCode, setSavingCode] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  const [campaignName, setCampaignName] = useState("");
  const [code, setCode] = useState("");
  const [percent, setPercent] = useState("5");
  const [stackWithShippingPromotion, setStackWithShippingPromotion] =
    useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const authorizedFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getAuthToken();

      if (!token) {
        throw new Error("يجب تسجيل الدخول");
      }

      return fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      });
    },
    [getAuthToken],
  );

  const loadCodes = useCallback(async () => {
    setLoading(true);

    try {
      const response = await authorizedFetch(
        "/api/admin/discount-codes",
      );

      const data = (await response.json().catch(() => [])) as
        | DiscountCode[]
        | { error?: string };

      if (!response.ok || !Array.isArray(data)) {
        throw new Error(
          !Array.isArray(data) && data.error
            ? data.error
            : "تعذر تحميل أكواد الخصم",
        );
      }

      setCodes(data);
    } catch (error) {
      Alert.alert(
        "أكواد الخصم",
        error instanceof Error
          ? error.message
          : "تعذر تحميل أكواد الخصم",
      );
    } finally {
      setLoading(false);
    }
  }, [authorizedFetch]);

  useEffect(() => {
    void loadCodes();
  }, [loadCodes]);

  const toggleGlobal = async (value: boolean) => {
    setSavingGlobal(true);

    const ok = await updateSettings({
      discountCodesEnabled: value,
    });

    setSavingGlobal(false);

    if (!ok) {
      Alert.alert(
        "أكواد الخصم",
        "تعذر حفظ حالة تفعيل أكواد الخصم",
      );
      return;
    }

    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Success,
    );
  };

  const createCode = async () => {
    const cleanCampaign = campaignName.trim();
    const cleanCode = code.trim().toUpperCase();
    const discountPercent = Number(percent);

    if (!cleanCampaign || !cleanCode) {
      Alert.alert(
        "بيانات ناقصة",
        "أدخل اسم الحملة وكود الخصم",
      );
      return;
    }

    if (
      !Number.isSafeInteger(discountPercent) ||
      discountPercent < 1 ||
      discountPercent > 100
    ) {
      Alert.alert(
        "نسبة غير صالحة",
        "نسبة الخصم يجب أن تكون رقمًا صحيحًا من 1 إلى 100",
      );
      return;
    }

    setSavingCode(true);

    try {
      const response = await authorizedFetch(
        "/api/admin/discount-codes",
        {
          method: "POST",
          body: JSON.stringify({
            campaignName: cleanCampaign,
            code: cleanCode,
            discountPercent,
            isActive: true,
            stackWithShippingPromotion,
            startDate: startDate.trim() || null,
            endDate: endDate.trim() || null,
          }),
        },
      );

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          data.error || "تعذر إنشاء كود الخصم",
        );
      }

      setCampaignName("");
      setCode("");
      setPercent("5");
      setStackWithShippingPromotion(false);
      setStartDate("");
      setEndDate("");

      await loadCodes();

      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );

      Alert.alert(
        "تم",
        "تم إنشاء كود الخصم بنجاح",
      );
    } catch (error) {
      Alert.alert(
        "أكواد الخصم",
        error instanceof Error
          ? error.message
          : "تعذر إنشاء كود الخصم",
      );
    } finally {
      setSavingCode(false);
    }
  };

  const patchCode = async (
    item: DiscountCode,
    patch: Partial<{
      isActive: boolean;
      stackWithShippingPromotion: boolean;
    }>,
  ) => {
    setUpdatingId(item.id);

    try {
      const response = await authorizedFetch(
        `/api/admin/discount-codes/${item.id}`,
        {
          method: "PATCH",
          body: JSON.stringify(patch),
        },
      );

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          data.error || "تعذر تعديل كود الخصم",
        );
      }

      await loadCodes();
    } catch (error) {
      Alert.alert(
        "أكواد الخصم",
        error instanceof Error
          ? error.message
          : "تعذر تعديل كود الخصم",
      );
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: bottomPadding }}
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

        <Text style={styles.headerTitle}>🎟️ أكواد الخصم</Text>

        <Pressable onPress={() => void loadCodes()} hitSlop={12}>
          <Ionicons name="refresh-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      <View style={styles.content}>
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
              value={settings.discountCodesEnabled === true}
              onValueChange={(value) => void toggleGlobal(value)}
              disabled={!settingsReady || savingGlobal}
            />

            <View style={styles.flexText}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                تفعيل أكواد الخصم
              </Text>
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                عند الإيقاف تختفي خانة كود الخصم من سلة المشتريات ولا يقبل السيرفر أي كود.
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
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>
            إضافة كود جديد
          </Text>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            اسم الحملة أو الشخص
          </Text>
          <TextInput
            value={campaignName}
            onChangeText={setCampaignName}
            placeholder="مثال: نغم"
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              {
                color: colors.foreground,
                backgroundColor: colors.input,
                borderColor: colors.border,
              },
            ]}
            textAlign="right"
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            كود الخصم
          </Text>
          <TextInput
            value={code}
            onChangeText={(value) =>
              setCode(
                value
                  .toUpperCase()
                  .replace(/[^A-Z0-9_-]/g, ""),
              )
            }
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="NAGHAM123"
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              {
                color: colors.foreground,
                backgroundColor: colors.input,
                borderColor: colors.border,
              },
            ]}
            textAlign="center"
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            نسبة الخصم %
          </Text>
          <TextInput
            value={percent}
            onChangeText={(value) =>
              setPercent(value.replace(/\D/g, ""))
            }
            keyboardType="number-pad"
            placeholder="5"
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              {
                color: colors.foreground,
                backgroundColor: colors.input,
                borderColor: colors.border,
              },
            ]}
            textAlign="center"
          />

          <View style={styles.toggleRow}>
            <Switch
              value={stackWithShippingPromotion}
              onValueChange={setStackWithShippingPromotion}
            />

            <View style={styles.flexText}>
              <Text style={[styles.labelStrong, { color: colors.foreground }]}>
                السماح مع عرض التوصيل
              </Text>
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                إذا كان مطفأ، استخدام هذا الكود يرجّع التوصيل للسعر الأصلي.
              </Text>
            </View>
          </View>

          <DateField
            label="من تاريخ — اختياري"
            value={startDate}
            onChange={setStartDate}
            colors={colors}
          />

          <DateField
            label="إلى تاريخ — اختياري"
            value={endDate}
            onChange={setEndDate}
            colors={colors}
          />

          <View
            style={{
              padding: 10,
              borderRadius: 10,
              backgroundColor: colors.secondary + "30",
            }}
          >
            <Text style={[styles.hint, { color: colors.foreground }]}>
              قاعدة الخصم: النسبة تُحسب على قيمة المشتريات فقط وتُنزّل دائماً لأسفل. مثال: 5.75 ₪ خصم تصبح 5 ₪.
            </Text>
          </View>

          <Pressable
            onPress={() => void createCode()}
            disabled={savingCode}
            style={[
              styles.primaryButton,
              {
                backgroundColor: savingCode
                  ? colors.muted
                  : colors.primary,
              },
            ]}
          >
            {savingCode ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Ionicons name="add-circle-outline" size={20} color="#fff" />
            )}
            <Text style={styles.primaryButtonText}>
              {savingCode ? "جاري الحفظ..." : "إضافة كود الخصم"}
            </Text>
          </Pressable>
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
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>
            الأكواد والتقارير
          </Text>

          {loading ? (
            <ActivityIndicator color={colors.primary} />
          ) : codes.length === 0 ? (
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              لا يوجد أكواد خصم حتى الآن.
            </Text>
          ) : (
            codes.map((item) => (
              <View
                key={item.id}
                style={[
                  styles.codeCard,
                  {
                    borderColor: item.isActive
                      ? colors.primary + "70"
                      : colors.border,
                    backgroundColor: colors.background,
                  },
                ]}
              >
                <View style={styles.codeHeader}>
                  <View style={styles.flexText}>
                    <Text style={[styles.codeName, { color: colors.foreground }]}>
                      {item.campaignName}
                    </Text>
                    <Text style={[styles.codeValue, { color: colors.primary }]}>
                      {item.code} · {item.discountPercent}%
                    </Text>
                  </View>

                  <Switch
                    value={item.isActive}
                    onValueChange={(value) =>
                      void patchCode(item, { isActive: value })
                    }
                    disabled={updatingId === item.id}
                  />
                </View>

                <View style={styles.toggleRow}>
                  <Switch
                    value={item.stackWithShippingPromotion}
                    onValueChange={(value) =>
                      void patchCode(item, {
                        stackWithShippingPromotion: value,
                      })
                    }
                    disabled={updatingId === item.id}
                  />

                  <View style={styles.flexText}>
                    <Text style={[styles.hint, { color: colors.foreground }]}>
                      يعمل مع عرض التوصيل
                    </Text>
                  </View>
                </View>

                <View style={styles.statsGrid}>
                  <View style={styles.statBox}>
                    <Text style={[styles.statValue, { color: colors.foreground }]}>
                      {item.stats.usageCount}
                    </Text>
                    <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                      مرات الاستخدام
                    </Text>
                  </View>

                  <View style={styles.statBox}>
                    <Text style={[styles.statValue, { color: colors.foreground }]}>
                      {item.stats.completedOrdersCount}
                    </Text>
                    <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                      طلبات مكتملة
                    </Text>
                  </View>

                  <View style={styles.statBox}>
                    <Text style={[styles.statValue, { color: "#DC2626" }]}>
                      {item.stats.cancelledOrdersCount}
                    </Text>
                    <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                      ملغية
                    </Text>
                  </View>

                  <View style={styles.statBox}>
                    <Text style={[styles.statValue, { color: colors.foreground }]}>
                      {money(item.stats.completedOrderValue)}
                    </Text>
                    <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                      قيمة المكتمل
                    </Text>
                  </View>

                  <View style={styles.statBox}>
                    <Text style={[styles.statValue, { color: "#DC2626" }]}>
                      -{money(item.stats.completedDiscountAmount)}
                    </Text>
                    <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                      خصومات ممنوحة
                    </Text>
                  </View>

                  <View style={styles.statBox}>
                    <Text
                      style={[
                        styles.statValue,
                        {
                          color:
                            item.stats.profitAfterDeliveryMinor === null
                              ? colors.mutedForeground
                              : "#16A34A",
                        },
                      ]}
                    >
                      {moneyMinor(item.stats.profitAfterDeliveryMinor)}
                    </Text>
                    <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                      الربح بعد التوصيل
                    </Text>
                  </View>
                </View>

                <View
                  style={{
                    paddingTop: 8,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                    gap: 4,
                  }}
                >
                  <Text style={[styles.hint, { color: colors.foreground }]}>
                    صافي مبيعات المنتجات المكتملة: {money(item.stats.completedProductsNetSales)}
                  </Text>
                  <Text style={[styles.hint, { color: colors.foreground }]}>
                    تكلفة البضاعة المعروفة: {moneyMinor(item.stats.completedCogsKnownMinor)}
                  </Text>
                  <Text style={[styles.hint, { color: colors.foreground }]}>
                    الربح الإجمالي قبل أثر التوصيل: {moneyMinor(item.stats.grossProfitMinor)}
                  </Text>
                  <Text
                    style={[
                      styles.hint,
                      {
                        color: item.stats.costCoverageComplete
                          ? "#16A34A"
                          : "#B45309",
                        fontWeight: "800",
                      },
                    ]}
                  >
                    تغطية التكلفة: {item.stats.costCoveragePercent}%
                    {item.stats.costCoverageComplete
                      ? " — مكتملة"
                      : " — الربح النهائي غير معتمد حتى تكتمل التكلفة"}
                  </Text>
                </View>

                <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                  الفترة: {item.startDate || "بدون بداية"} ← {item.endDate || "بدون نهاية"}
                </Text>
              </View>
            ))
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
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
    fontWeight: "900",
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 16,
  },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "900",
    textAlign: "right",
  },
  toggleRow: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  flexText: {
    flex: 1,
    alignItems: "flex-end",
  },
  labelStrong: {
    fontSize: 14,
    fontWeight: "900",
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
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  primaryButton: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "900",
  },
  codeCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 13,
    gap: 10,
  },
  codeHeader: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  codeName: {
    fontSize: 16,
    fontWeight: "900",
    textAlign: "right",
  },
  codeValue: {
    fontSize: 14,
    fontWeight: "900",
    marginTop: 3,
    textAlign: "right",
  },
  statsGrid: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: 8,
  },
  statBox: {
    minWidth: 125,
    flexGrow: 1,
    flexBasis: "30%",
    borderRadius: 10,
    padding: 9,
    alignItems: "flex-end",
  },
  statValue: {
    fontSize: 15,
    fontWeight: "900",
  },
  statLabel: {
    fontSize: 11,
    marginTop: 2,
  },
});
