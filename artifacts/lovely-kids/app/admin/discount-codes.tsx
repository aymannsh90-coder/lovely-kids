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
  completedCogsKnownMinor: number | null;
  grossProfitMinor: number | null;
  deliveryImpactMinor: number | null;
  profitAfterDeliveryMinor: number | null;
  campaignNetProfitMinor: number | null;
  campaignRoiPercent: number | null;
  campaignPerformance:
    | "profitable"
    | "loss"
    | "break_even"
    | "unknown"
    | "hidden";
  costCoveragePercent: number | null;
  costCoverageComplete: boolean | null;
};

type CodeFilter = "active" | "archived" | "all";

type DiscountCode = {
  id: number;
  campaignName: string;
  code: string;
  discountPercent: number;
  campaignCostMinor: number | null;
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

function compactMinorInput(
  value: number | null,
) {
  if (
    value === null ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    return "0";
  }

  const shekels =
    value / 100;

  return Number.isInteger(shekels)
    ? String(shekels)
    : shekels.toFixed(2);
}

function campaignPerformanceLabel(
  value: DiscountCodeStats["campaignPerformance"],
) {
  switch (value) {
    case "profitable":
      return "الحملة مربحة";
    case "loss":
      return "الحملة خاسرة";
    case "break_even":
      return "الحملة على نقطة التعادل";
    case "hidden":
      return "خاص بالمالك";
    default:
      return "الجدوى غير مكتملة";
  }
}

export default function DiscountCodesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, getAuthToken } = useAuth();
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
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [codeFilter, setCodeFilter] = useState<CodeFilter>("active");

  const [campaignName, setCampaignName] = useState("");
  const [code, setCode] = useState("");
  const [percent, setPercent] = useState("5");
  const [campaignCostInput, setCampaignCostInput] =
    useState("0");
  const [stackWithShippingPromotion, setStackWithShippingPromotion] =
    useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);

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

  const resetEditor = () => {
    setEditingId(null);
    setCampaignName("");
    setCode("");
    setPercent("5");
    setCampaignCostInput("0");
    setStackWithShippingPromotion(false);
    setStartDate("");
    setEndDate("");
  };

  const startEditing = (item: DiscountCode) => {
    setEditingId(item.id);
    setCampaignName(item.campaignName);
    setCode(item.code);
    setPercent(String(item.discountPercent));
    setCampaignCostInput(
      compactMinorInput(
        item.campaignCostMinor,
      ),
    );
    setStackWithShippingPromotion(
      item.stackWithShippingPromotion,
    );
    setStartDate(item.startDate ?? "");
    setEndDate(item.endDate ?? "");
  };

  const createCode = async () => {
    const cleanCampaign = campaignName.trim();
    const cleanCode = code.trim().toUpperCase();
    const discountPercent = Number(percent);

    const normalizedCampaignCost =
      campaignCostInput
        .trim()
        .replace(",", ".");

    const campaignCostShekels =
      normalizedCampaignCost === ""
        ? 0
        : Number(
            normalizedCampaignCost,
          );

    const campaignCostMinor =
      Math.round(
        campaignCostShekels *
          100,
      );

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

    if (
      !Number.isFinite(
        campaignCostShekels,
      ) ||
      campaignCostShekels < 0 ||
      !Number.isSafeInteger(
        campaignCostMinor,
      ) ||
      campaignCostMinor >
        2_147_483_647
    ) {
      Alert.alert(
        "تكلفة الحملة",
        "أدخل تكلفة إعلان صحيحة أو اتركها صفر",
      );
      return;
    }

    setSavingCode(true);

    try {
      const response = await authorizedFetch(
        editingId === null
          ? "/api/admin/discount-codes"
          : `/api/admin/discount-codes/${editingId}`,
        {
          method: editingId === null ? "POST" : "PATCH",
          body: JSON.stringify({
            campaignName: cleanCampaign,
            code: cleanCode,
            discountPercent,
            ...(user?.isOwner === true
              ? { campaignCostMinor }
              : {}),
            ...(editingId === null ? { isActive: true } : {}),
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

      const wasEditing =
        editingId !== null;

      resetEditor();

      await loadCodes();

      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );

      Alert.alert(
        "تم",
        wasEditing
          ? "تم تعديل كود الخصم بنجاح"
          : "تم إنشاء كود الخصم بنجاح",
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

  const deleteUnusedCode = async (item: DiscountCode) => {
    setDeletingId(item.id);

    try {
      const response = await authorizedFetch(
        `/api/admin/discount-codes/${item.id}`,
        {
          method: "DELETE",
        },
      );

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          data.error || "تعذر حذف كود الخصم",
        );
      }

      if (editingId === item.id) {
        resetEditor();
      }

      setPendingDeleteId(null);
      await loadCodes();

      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );

      Alert.alert(
        "تم الحذف",
        `تم حذف الكود ${item.code} نهائيًا لأنه لم يُستخدم في أي طلب.`,
      );
    } catch (error) {
      Alert.alert(
        "حذف كود الخصم",
        error instanceof Error
          ? error.message
          : "تعذر حذف كود الخصم",
      );
    } finally {
      setDeletingId(null);
    }
  };

  const activeCodesCount =
    codes.filter((item) => item.isActive).length;
  const archivedCodesCount =
    codes.length - activeCodesCount;

  const filteredCodes =
    codes.filter((item) => {
      if (codeFilter === "active") return item.isActive;
      if (codeFilter === "archived") return !item.isActive;
      return true;
    });

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
          <View style={styles.codeHeader}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              {editingId === null ? "إضافة كود جديد" : "تعديل كود الخصم"}
            </Text>

            {editingId !== null ? (
              <Pressable
                onPress={resetEditor}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                }}
              >
                <Text style={{ color: "#DC2626", fontWeight: "800" }}>
                  إلغاء التعديل
                </Text>
              </Pressable>
            ) : null}
          </View>

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

          {user?.isOwner === true ? (
            <>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>
                تكلفة الإعلان / المشهور (₪)
              </Text>
              <TextInput
                value={campaignCostInput}
                onChangeText={(value) =>
                  setCampaignCostInput(
                    value.replace(
                      /[^0-9.,]/g,
                      "",
                    ),
                  )
                }
                keyboardType="decimal-pad"
                placeholder="مثال: 200"
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
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                تُخصم تكلفة الحملة مرة واحدة من ربح الطلبات لمعرفة صافي جدوى الإعلان.
              </Text>
            </>
          ) : null}

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
              {savingCode
                ? "جاري الحفظ..."
                : editingId === null
                  ? "إضافة كود الخصم"
                  : "حفظ تعديلات الكود"}
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

          <View style={styles.filterRow}>
            {(
              [
                {
                  key: "active" as const,
                  label: `الفعالة (${activeCodesCount})`,
                },
                {
                  key: "archived" as const,
                  label: `المؤرشفة (${archivedCodesCount})`,
                },
                {
                  key: "all" as const,
                  label: `الكل (${codes.length})`,
                },
              ] satisfies Array<{
                key: CodeFilter;
                label: string;
              }>
            ).map((option) => {
              const selected = codeFilter === option.key;

              return (
                <Pressable
                  key={option.key}
                  onPress={() => setCodeFilter(option.key)}
                  style={[
                    styles.filterButton,
                    {
                      backgroundColor: selected
                        ? colors.primary
                        : colors.input,
                      borderColor: selected
                        ? colors.primary
                        : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.filterButtonText,
                      {
                        color: selected
                          ? "#fff"
                          : colors.foreground,
                      },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {loading ? (
            <ActivityIndicator color={colors.primary} />
          ) : codes.length === 0 ? (
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              لا يوجد أكواد خصم حتى الآن.
            </Text>
          ) : filteredCodes.length === 0 ? (
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              {codeFilter === "active"
                ? "لا يوجد أكواد فعالة."
                : codeFilter === "archived"
                  ? "لا يوجد أكواد مؤرشفة."
                  : "لا يوجد أكواد خصم."}
            </Text>
          ) : (
            filteredCodes.map((item) => (
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
                    <View style={styles.codeTitleRow}>
                      <Text style={[styles.codeName, { color: colors.foreground }]}>
                        {item.campaignName}
                      </Text>
                      <View
                        style={[
                          styles.statusBadge,
                          {
                            backgroundColor: item.isActive
                              ? "#22C55E18"
                              : colors.input,
                          },
                        ]}
                      >
                        <Text
                          style={{
                            color: item.isActive
                              ? "#16A34A"
                              : colors.mutedForeground,
                            fontSize: 11,
                            fontWeight: "900",
                          }}
                        >
                          {item.isActive ? "فعال" : "مؤرشف"}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.codeValue, { color: colors.primary }]}>
                      {item.code} · {item.discountPercent}%
                    </Text>
                  </View>
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

                  {user?.isOwner === true ? (
                    <>
                      <View style={styles.statBox}>
                        <Text
                          style={[
                            styles.statValue,
                            { color: "#B45309" },
                          ]}
                        >
                          {moneyMinor(item.campaignCostMinor)}
                        </Text>
                        <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                          تكلفة الحملة
                        </Text>
                      </View>

                      <View style={styles.statBox}>
                        <Text
                          style={[
                            styles.statValue,
                            {
                              color:
                                item.stats.campaignNetProfitMinor === null
                                  ? colors.mutedForeground
                                  : item.stats.campaignNetProfitMinor >= 0
                                    ? "#16A34A"
                                    : "#DC2626",
                            },
                          ]}
                        >
                          {moneyMinor(item.stats.campaignNetProfitMinor)}
                        </Text>
                        <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                          صافي ربح الحملة
                        </Text>
                      </View>

                      <View style={styles.statBox}>
                        <Text
                          style={[
                            styles.statValue,
                            {
                              color:
                                item.stats.campaignRoiPercent === null
                                  ? colors.mutedForeground
                                  : item.stats.campaignRoiPercent >= 0
                                    ? "#16A34A"
                                    : "#DC2626",
                            },
                          ]}
                        >
                          {item.stats.campaignRoiPercent === null
                            ? "—"
                            : `${item.stats.campaignRoiPercent.toFixed(2)}%`}
                        </Text>
                        <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                          عائد الحملة ROI
                        </Text>
                      </View>
                    </>
                  ) : null}
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

                  {user?.isOwner === true ? (
                    <>
                      <Text style={[styles.hint, { color: colors.foreground }]}>
                        تكلفة البضاعة المعروفة: {moneyMinor(item.stats.completedCogsKnownMinor)}
                      </Text>
                      <Text style={[styles.hint, { color: colors.foreground }]}>
                        الربح الإجمالي قبل أثر التوصيل: {moneyMinor(item.stats.grossProfitMinor)}
                      </Text>
                      <Text style={[styles.hint, { color: colors.foreground }]}>
                        الربح بعد التوصيل: {moneyMinor(item.stats.profitAfterDeliveryMinor)}
                      </Text>
                      <Text style={[styles.hint, { color: colors.foreground }]}>
                        تكلفة الحملة: {moneyMinor(item.campaignCostMinor)}
                      </Text>
                      <Text
                        style={[
                          styles.hint,
                          {
                            color:
                              item.stats.campaignPerformance === "profitable"
                                ? "#16A34A"
                                : item.stats.campaignPerformance === "loss"
                                  ? "#DC2626"
                                  : "#B45309",
                            fontWeight: "900",
                          },
                        ]}
                      >
                        {campaignPerformanceLabel(item.stats.campaignPerformance)}
                        {" — "}
                        صافي الحملة: {moneyMinor(item.stats.campaignNetProfitMinor)}
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
                        تغطية التكلفة: {item.stats.costCoveragePercent ?? 0}%
                        {item.stats.costCoverageComplete
                          ? " — مكتملة"
                          : " — الربح النهائي غير معتمد حتى تكتمل التكلفة"}
                      </Text>
                    </>
                  ) : (
                    <Text
                      style={[
                        styles.hint,
                        {
                          color: colors.mutedForeground,
                          fontWeight: "800",
                        },
                      ]}
                    >
                      بيانات التكلفة والربح متاحة للمالك فقط.
                    </Text>
                  )}
                </View>

                <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                  الفترة: {item.startDate || "بدون بداية"} ← {item.endDate || "بدون نهاية"}
                </Text>

                <Pressable
                  onPress={() => startEditing(item)}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.primary + "70",
                    borderRadius: 10,
                    paddingVertical: 9,
                    paddingHorizontal: 12,
                    alignItems: "center",
                  }}
                >
                  <Text
                    style={{
                      color: colors.primary,
                      fontWeight: "900",
                    }}
                  >
                    تعديل الكود والنسبة والفترة
                    {user?.isOwner === true
                      ? " وتكلفة الحملة"
                      : ""}
                  </Text>
                </Pressable>

                <View style={styles.lifecycleActions}>
                  <Pressable
                    onPress={() =>
                      void patchCode(item, {
                        isActive: !item.isActive,
                      })
                    }
                    disabled={updatingId === item.id}
                    style={[
                      styles.lifecycleButton,
                      {
                        borderColor: item.isActive
                          ? "#B45309"
                          : "#16A34A",
                        opacity:
                          updatingId === item.id
                            ? 0.55
                            : 1,
                      },
                    ]}
                  >
                    <Ionicons
                      name={
                        item.isActive
                          ? "archive-outline"
                          : "refresh-outline"
                      }
                      size={17}
                      color={
                        item.isActive
                          ? "#B45309"
                          : "#16A34A"
                      }
                    />
                    <Text
                      style={[
                        styles.lifecycleButtonText,
                        {
                          color: item.isActive
                            ? "#B45309"
                            : "#16A34A",
                        },
                      ]}
                    >
                      {item.isActive
                        ? "أرشفة الكود"
                        : "إعادة تفعيل"}
                    </Text>
                  </Pressable>

                  {user?.isOwner === true &&
                  item.stats.usageCount === 0 ? (
                    <Pressable
                      onPress={() =>
                        setPendingDeleteId(
                          pendingDeleteId === item.id
                            ? null
                            : item.id,
                        )
                      }
                      disabled={deletingId === item.id}
                      style={[
                        styles.lifecycleButton,
                        {
                          borderColor: "#DC2626",
                          opacity:
                            deletingId === item.id
                              ? 0.55
                              : 1,
                        },
                      ]}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={17}
                        color="#DC2626"
                      />
                      <Text
                        style={[
                          styles.lifecycleButtonText,
                          { color: "#DC2626" },
                        ]}
                      >
                        حذف نهائي
                      </Text>
                    </Pressable>
                  ) : null}
                </View>

                {user?.isOwner === true &&
                item.stats.usageCount > 0 ? (
                  <Text
                    style={[
                      styles.hint,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    هذا الكود استُخدم في {item.stats.usageCount} طلب/طلبات؛ يمكن أرشفته لكن لا يُحذف نهائيًا حتى تبقى التقارير التاريخية محفوظة.
                  </Text>
                ) : null}

                {pendingDeleteId === item.id ? (
                  <View
                    style={[
                      styles.deleteConfirmBox,
                      {
                        backgroundColor: "#FEF2F2",
                        borderColor: "#FCA5A5",
                      },
                    ]}
                  >
                    <Text style={styles.deleteConfirmText}>
                      حذف {item.code} نهائيًا؟ هذا مسموح فقط لأنه لم يُستخدم في أي طلب، ولن يمكن التراجع عنه.
                    </Text>
                    <View style={styles.deleteConfirmActions}>
                      <Pressable
                        onPress={() => setPendingDeleteId(null)}
                        style={[
                          styles.confirmSmallButton,
                          {
                            borderColor: colors.border,
                            backgroundColor: colors.card,
                          },
                        ]}
                      >
                        <Text
                          style={{
                            color: colors.foreground,
                            fontWeight: "800",
                          }}
                        >
                          إلغاء
                        </Text>
                      </Pressable>

                      <Pressable
                        onPress={() => void deleteUnusedCode(item)}
                        disabled={deletingId === item.id}
                        style={[
                          styles.confirmSmallButton,
                          { backgroundColor: "#DC2626" },
                        ]}
                      >
                        {deletingId === item.id ? (
                          <ActivityIndicator
                            size="small"
                            color="#fff"
                          />
                        ) : (
                          <Text
                            style={{
                              color: "#fff",
                              fontWeight: "900",
                            }}
                          >
                            نعم، حذف نهائي
                          </Text>
                        )}
                      </Pressable>
                    </View>
                  </View>
                ) : null}
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
  filterRow: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: 8,
  },
  filterButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  filterButtonText: {
    fontSize: 12,
    fontWeight: "900",
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
  codeTitleRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
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
  lifecycleActions: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: 8,
  },
  lifecycleButton: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexGrow: 1,
  },
  lifecycleButtonText: {
    fontSize: 12,
    fontWeight: "900",
  },
  deleteConfirmBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 11,
    gap: 10,
  },
  deleteConfirmText: {
    color: "#991B1B",
    fontSize: 12,
    lineHeight: 19,
    fontWeight: "800",
    textAlign: "right",
  },
  deleteConfirmActions: {
    flexDirection: "row-reverse",
    gap: 8,
  },
  confirmSmallButton: {
    flex: 1,
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
});
