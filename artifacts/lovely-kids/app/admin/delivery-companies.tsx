import { getResponsiveTopPadding } from "@/utils/webLayout";
import { API_BASE } from "@/constants/api";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
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

type DeliveryCompany = {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  notes: string | null;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
};

export default function DeliveryCompaniesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getAuthToken } = useAuth();

  const [companies, setCompanies] =
    useState<DeliveryCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [editingId, setEditingId] =
    useState<number | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  const topPadding = getResponsiveTopPadding(insets.top);
  const bottomPadding =
    Platform.OS === "web" ? 40 : insets.bottom + 24;

  const loadCompanies = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const token = await getAuthToken();

      if (!token) {
        throw new Error("انتهت جلسة تسجيل الدخول");
      }

      const res = await fetch(
        `${API_BASE}/api/delivery-companies`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const body = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(
          body?.error ?? "تعذر تحميل شركات التوصيل",
        );
      }

      setCompanies(
        Array.isArray(body) ? body : [],
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "تعذر تحميل شركات التوصيل",
      );
    } finally {
      setLoading(false);
    }
  }, [getAuthToken]);

  useEffect(() => {
    void loadCompanies();
  }, [loadCompanies]);

  function resetForm() {
    setEditingId(null);
    setCode("");
    setName("");
    setPhone("");
    setNotes("");
    setError("");
  }

  function beginEdit(company: DeliveryCompany) {
    setEditingId(company.id);
    setCode(company.code);
    setName(company.name);
    setPhone(company.phone ?? "");
    setNotes(company.notes ?? "");
    setError("");
  }

  async function saveCompany() {
    if (saving) return;

    if (!code.trim()) {
      setError("أدخل رمز الشركة");
      return;
    }

    if (!name.trim()) {
      setError("أدخل اسم الشركة");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const token = await getAuthToken();

      if (!token) {
        throw new Error("انتهت جلسة تسجيل الدخول");
      }

      const url = editingId
        ? `${API_BASE}/api/delivery-companies/${editingId}`
        : `${API_BASE}/api/delivery-companies`;

      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          name: name.trim(),
          phone: phone.trim(),
          notes: notes.trim(),
        }),
      });

      const body = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(
          body?.error ?? "تعذر حفظ شركة التوصيل",
        );
      }

      resetForm();
      await loadCompanies();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "تعذر حفظ شركة التوصيل",
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleCompany(
    company: DeliveryCompany,
  ) {
    try {
      const token = await getAuthToken();

      if (!token) {
        throw new Error("انتهت جلسة تسجيل الدخول");
      }

      const status =
        company.status === "active"
          ? "inactive"
          : "active";

      const res = await fetch(
        `${API_BASE}/api/delivery-companies/${company.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ status }),
        },
      );

      const body = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(
          body?.error ?? "تعذر تغيير حالة الشركة",
        );
      }

      setCompanies((current) =>
        current.map((item) =>
          item.id === company.id
            ? body
            : item,
        ),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "تعذر تغيير حالة الشركة",
      );
    }
  }

  return (
    <ScrollView
      style={[
        styles.screen,
        { backgroundColor: colors.background },
      ]}
      contentContainerStyle={{
        paddingBottom: bottomPadding,
      }}
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
        <Pressable onPress={() => router.back()}>
          <Ionicons
            name="arrow-forward"
            size={24}
            color="#fff"
          />
        </Pressable>

        <Text style={styles.headerTitle}>
          شركات التوصيل
        </Text>

        <Pressable onPress={() => void loadCompanies()}>
          <Ionicons
            name="refresh-outline"
            size={23}
            color="#fff"
          />
        </Pressable>
      </View>

      <View style={styles.content}>
        <View
          style={[
            styles.formCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.foreground },
            ]}
          >
            {editingId
              ? "تعديل شركة التوصيل"
              : "إضافة شركة توصيل"}
          </Text>

          <Text
            style={[
              styles.label,
              { color: colors.foreground },
            ]}
          >
            الرمز الداخلي *
          </Text>

          <TextInput
            value={code}
            onChangeText={(value) =>
              setCode(value.toUpperCase())
            }
            placeholder="مثال: WASSEL"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="characters"
            style={[
              styles.input,
              {
                color: colors.foreground,
                backgroundColor: colors.background,
                borderColor: colors.border,
              },
            ]}
            textAlign="right"
          />

          <Text
            style={[
              styles.label,
              { color: colors.foreground },
            ]}
          >
            اسم الشركة *
          </Text>

          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="اسم شركة التوصيل"
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              {
                color: colors.foreground,
                backgroundColor: colors.background,
                borderColor: colors.border,
              },
            ]}
            textAlign="right"
          />

          <Text
            style={[
              styles.label,
              { color: colors.foreground },
            ]}
          >
            رقم الهاتف
          </Text>

          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="رقم الهاتف"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="phone-pad"
            style={[
              styles.input,
              {
                color: colors.foreground,
                backgroundColor: colors.background,
                borderColor: colors.border,
              },
            ]}
            textAlign="right"
          />

          <Text
            style={[
              styles.label,
              { color: colors.foreground },
            ]}
          >
            ملاحظات
          </Text>

          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="ملاحظات اختيارية"
            placeholderTextColor={colors.mutedForeground}
            multiline
            style={[
              styles.input,
              styles.notesInput,
              {
                color: colors.foreground,
                backgroundColor: colors.background,
                borderColor: colors.border,
              },
            ]}
            textAlign="right"
          />

          {error ? (
            <Text style={styles.errorText}>
              {error}
            </Text>
          ) : null}

          <View style={styles.formActions}>
            {editingId ? (
              <Pressable
                onPress={resetForm}
                style={[
                  styles.secondaryButton,
                  { borderColor: colors.border },
                ]}
              >
                <Text
                  style={{
                    color: colors.foreground,
                    fontWeight: "800",
                  }}
                >
                  إلغاء التعديل
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              disabled={saving}
              onPress={() => void saveCompany()}
              style={[
                styles.primaryButton,
                {
                  backgroundColor: colors.primary,
                  opacity: saving ? 0.6 : 1,
                },
              ]}
            >
              {saving ? (
                <ActivityIndicator
                  size="small"
                  color="#fff"
                />
              ) : (
                <Ionicons
                  name={
                    editingId
                      ? "save-outline"
                      : "add-circle-outline"
                  }
                  size={19}
                  color="#fff"
                />
              )}

              <Text style={styles.primaryButtonText}>
                {editingId
                  ? "حفظ التعديل"
                  : "إضافة الشركة"}
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.listHeader}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.foreground },
            ]}
          >
            الشركات المسجلة ({companies.length})
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator
            size="large"
            color={colors.primary}
          />
        ) : companies.length === 0 ? (
          <View
            style={[
              styles.emptyCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <Ionicons
              name="car-outline"
              size={34}
              color={colors.mutedForeground}
            />
            <Text
              style={{
                color: colors.mutedForeground,
                fontWeight: "700",
              }}
            >
              لا توجد شركات توصيل مسجلة
            </Text>
          </View>
        ) : (
          companies.map((company) => (
            <View
              key={company.id}
              style={[
                styles.companyCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  opacity:
                    company.status === "inactive"
                      ? 0.65
                      : 1,
                },
              ]}
            >
              <View style={styles.companyTop}>
                <View style={styles.switchRow}>
                  <Switch
                    value={company.status === "active"}
                    onValueChange={() =>
                      void toggleCompany(company)
                    }
                  />
                  <Text
                    style={{
                      color:
                        company.status === "active"
                          ? "#16A34A"
                          : colors.mutedForeground,
                      fontWeight: "800",
                      fontSize: 12,
                    }}
                  >
                    {company.status === "active"
                      ? "فعّالة"
                      : "موقوفة"}
                  </Text>
                </View>

                <View style={styles.companyTitleBox}>
                  <Text
                    style={[
                      styles.companyName,
                      { color: colors.foreground },
                    ]}
                  >
                    {company.name}
                  </Text>

                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontSize: 12,
                    }}
                  >
                    {company.code}
                  </Text>
                </View>
              </View>

              {company.phone ? (
                <Text
                  style={[
                    styles.detail,
                    { color: colors.foreground },
                  ]}
                >
                  📞 {company.phone}
                </Text>
              ) : null}

              {company.notes ? (
                <Text
                  style={[
                    styles.detail,
                    { color: colors.mutedForeground },
                  ]}
                >
                  📝 {company.notes}
                </Text>
              ) : null}

              <Pressable
                onPress={() => beginEdit(company)}
                style={[
                  styles.editButton,
                  { borderColor: colors.primary },
                ]}
              >
                <Ionicons
                  name="create-outline"
                  size={17}
                  color={colors.primary}
                />
                <Text
                  style={{
                    color: colors.primary,
                    fontWeight: "800",
                  }}
                >
                  تعديل
                </Text>
              </Pressable>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    minHeight: 82,
    paddingHorizontal: 18,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  headerTitle: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 20,
  },
  content: {
    width: "100%",
    maxWidth: 900,
    alignSelf: "center",
    padding: 16,
    gap: 16,
  },
  formCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "900",
    textAlign: "right",
    marginBottom: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: "800",
    textAlign: "right",
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  notesInput: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  errorText: {
    color: "#DC2626",
    fontWeight: "800",
    textAlign: "right",
  },
  formActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
  },
  primaryButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: 14,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 7,
  },
  primaryButtonText: {
    color: "#fff",
    fontWeight: "900",
  },
  secondaryButton: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  listHeader: {
    marginTop: 2,
  },
  emptyCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 28,
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  companyCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  companyTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  companyTitleBox: {
    flex: 1,
    alignItems: "flex-end",
  },
  companyName: {
    fontSize: 16,
    fontWeight: "900",
    textAlign: "right",
  },
  switchRow: {
    alignItems: "center",
    gap: 3,
  },
  detail: {
    fontSize: 13,
    textAlign: "right",
  },
  editButton: {
    alignSelf: "flex-end",
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: "row",
    gap: 5,
    alignItems: "center",
  },
});
