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
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppSettings } from "@/context/AppSettingsContext";
import { useColors } from "@/hooks/useColors";

export default function HomeSectionsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings, settingsReady, updateSettings } = useAppSettings();

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 20;

  const [specialOffers, setSpecialOffers] = useState(
    settings.homeSpecialOffersSectionEnabled !== false,
  );
  const [ageGroups, setAgeGroups] = useState(
    settings.homeAgeGroupsSectionEnabled !== false,
  );
  const [features, setFeatures] = useState(
    settings.homeFeaturesSectionEnabled !== false,
  );
  const [topBenefits, setTopBenefits] = useState(
    settings.homeTopBenefitsSectionEnabled !== false,
  );

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!settingsReady || initializedRef.current) return;

    initializedRef.current = true;
    setSpecialOffers(settings.homeSpecialOffersSectionEnabled !== false);
    setAgeGroups(settings.homeAgeGroupsSectionEnabled !== false);
    setFeatures(settings.homeFeaturesSectionEnabled !== false);
    setTopBenefits(settings.homeTopBenefitsSectionEnabled !== false);
  }, [settingsReady, settings]);

  const handleSave = async () => {
    setSaving(true);

    const ok = await updateSettings({
      homeSpecialOffersSectionEnabled: specialOffers,
      homeAgeGroupsSectionEnabled: ageGroups,
      homeFeaturesSectionEnabled: features,
      homeTopBenefitsSectionEnabled: topBenefits,
    });

    setSaving(false);

    if (!ok) {
      Alert.alert(
        "فشل الحفظ",
        "تعذّر حفظ إعدادات أقسام الصفحة الرئيسية.",
      );
      return;
    }

    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Success,
    );

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const rows = [
    {
      title: "العروض الخاصة",
      subtitle: "القسم الذي يعرض بطاقات العروض الخاصة",
      value: specialOffers,
      setValue: setSpecialOffers,
      icon: "pricetag-outline" as const,
    },
    {
      title: "تسوقي حسب عمر الطفل",
      subtitle: "الفئات العمرية واختيار عمر الطفل",
      value: ageGroups,
      setValue: setAgeGroups,
      icon: "people-outline" as const,
    },
    {
      title: "ميزات المتجر",
      subtitle: "توصيل سريع · دفع آمن · إمكانية الاستبدال · دعم 24/7",
      value: features,
      setValue: setFeatures,
      icon: "shield-checkmark-outline" as const,
    },
    {
      title: "المزايا العلوية",
      subtitle: "خامات ناعمة ومريحة · تصاميم عصرية وعملية · جودة تدوم",
      value: topBenefits,
      setValue: setTopBenefits,
      icon: "ribbon-outline" as const,
    },
  ];

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: bottomPadding }}
      showsVerticalScrollIndicator={false}
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

        <Text style={styles.headerTitle}>أقسام الصفحة الرئيسية</Text>

        <Ionicons name="eye-outline" size={23} color="#fff" />
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
            إخفاء أي قسم لا يحذف بياناته. يمكنك إظهاره مرة أخرى في أي وقت.
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
          {rows.map((item, index) => (
            <View key={item.title}>
              {index > 0 ? (
                <View
                  style={[
                    styles.divider,
                    { backgroundColor: colors.border },
                  ]}
                />
              ) : null}

              <View style={styles.row}>
                <Switch
                  value={item.value}
                  onValueChange={item.setValue}
                  disabled={saving || !settingsReady}
                />

                <View style={styles.rowText}>
                  <View style={styles.titleRow}>
                    <Ionicons
                      name={item.icon}
                      size={20}
                      color={colors.primary}
                    />
                    <Text
                      style={[
                        styles.rowTitle,
                        { color: colors.foreground },
                      ]}
                    >
                      {item.title}
                    </Text>
                  </View>

                  <Text
                    style={[
                      styles.rowSubtitle,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {item.subtitle}
                  </Text>
                </View>
              </View>
            </View>
          ))}
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
              ? "تم الحفظ ✓"
              : saving
                ? "جاري الحفظ..."
                : "حفظ إعدادات الأقسام"}
          </Text>
        </Pressable>

        <Text
          style={[
            styles.saveHint,
            { color: colors.mutedForeground },
          ]}
        >
          يتم حفظ المفاتيح الثلاثة معاً بضغطة واحدة.
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
    fontSize: 18,
    fontWeight: "800",
  },
  content: {
    padding: 16,
    gap: 16,
  },
  infoCard: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  infoText: {
    flex: 1,
    textAlign: "right",
    fontSize: 13,
    lineHeight: 20,
  },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    paddingVertical: 18,
  },
  rowText: {
    flex: 1,
    alignItems: "flex-end",
  },
  titleRow: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    gap: 7,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: "800",
    textAlign: "right",
  },
  rowSubtitle: {
    fontSize: 12,
    lineHeight: 19,
    textAlign: "right",
    marginTop: 5,
  },
  divider: {
    height: 1,
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
