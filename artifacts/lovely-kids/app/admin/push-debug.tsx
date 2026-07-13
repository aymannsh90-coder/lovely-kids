import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  maskToken,
  registerForPushNotificationsAsync,
  saveTokenToServer,
} from "@/hooks/usePushNotifications";

export default function PushDebugScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, getAuthToken } = useAuth();

  const [permission, setPermission] = useState<string>("—");
  const [isDevice, setIsDevice] = useState<boolean | null>(null);
  const [projectId, setProjectId] = useState<string>("—");
  const [maskedToken, setMaskedToken] = useState<string>("—");
  const [regStatus, setRegStatus] = useState<string>("—");
  const [lastError, setLastError] = useState<string | null>(null);
  const [localNotifSent, setLocalNotifSent] = useState(false);
  const [running, setRunning] = useState(false);

  const refresh = useCallback(async () => {
    const perm = await Notifications.getPermissionsAsync();
    setPermission(perm.status);
    setIsDevice(Device.isDevice);
    const pid =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId ??
      "MISSING";
    setProjectId(String(pid));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!user?.isAdmin) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <Text>غير مصرح</Text>
      </View>
    );
  }

  const handleRegister = async () => {
    setRunning(true);
    setLastError(null);
    setRegStatus("جارٍ التسجيل…");
    try {
      const token = await registerForPushNotificationsAsync();
      if (!token) {
        setRegStatus("لم يُنشأ توكن (تحقق من الإذن والجهاز)");
        setRunning(false);
        return;
      }
      setMaskedToken(maskToken(token));
      const result = await saveTokenToServer(token, user.phone, getAuthToken);
      if (result.ok) {
        setRegStatus("✅ تم التسجيل بنجاح");
      } else {
        setRegStatus("❌ فشل الإرسال للـ API");
        setLastError(result.error ?? "خطأ غير معروف");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setRegStatus("❌ استثناء أثناء التسجيل");
      setLastError(msg);
    } finally {
      setRunning(false);
    }
  };

  const handleLocalNotif = async () => {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "اختبار محلي 🔔",
        body: "وصل الإشعار بنجاح على هذا الجهاز",
        sound: "default",
      },
      trigger: null,
    });
    setLocalNotifSent(true);
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-forward" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Push Debug (Admin)</Text>
        <Ionicons name="bug-outline" size={22} color="#fff" />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Row label="Platform" value={Platform.OS} />
        <Row label="Device.isDevice" value={isDevice === null ? "—" : String(isDevice)} />
        <Row label="Permission" value={permission} />
        <Row label="projectId" value={projectId} />
        <Row label="Masked token" value={maskedToken} />
        <Row label="Registration" value={regStatus} highlight={regStatus.startsWith("✅")} />

        {lastError ? (
          <View style={[styles.errorBox, { borderColor: colors.destructive }]}>
            <Text style={[styles.errorLabel, { color: colors.destructive }]}>آخر خطأ:</Text>
            <Text style={[styles.errorText, { color: colors.destructive }]}>{lastError}</Text>
          </View>
        ) : null}

        <Pressable
          style={[styles.btn, { backgroundColor: colors.primary }]}
          onPress={handleRegister}
          disabled={running}
        >
          {running ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>🔄 تسجيل التوكن الآن</Text>
          )}
        </Pressable>

        <Pressable
          style={[styles.btn, { backgroundColor: "#10b981", marginTop: 10 }]}
          onPress={handleLocalNotif}
        >
          <Text style={styles.btnText}>
            {localNotifSent ? "✅ تم إرسال الإشعار المحلي" : "🔔 اختبار Local Notification"}
          </Text>
        </Pressable>

        <Pressable
          style={[styles.btn, { backgroundColor: colors.secondary, marginTop: 10 }]}
          onPress={refresh}
        >
          <Text style={[styles.btnText, { color: colors.foreground }]}>↺ تحديث البيانات</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Row({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, highlight && styles.rowValueGreen]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: "#7c3aed",
  },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "700" },
  body: { padding: 16, gap: 8 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.04)",
    marginBottom: 4,
  },
  rowLabel: { fontSize: 14, fontWeight: "600", color: "#555", flexShrink: 0 },
  rowValue: { fontSize: 13, color: "#222", flexShrink: 1, textAlign: "right", marginLeft: 8 },
  rowValueGreen: { color: "#10b981", fontWeight: "700" },
  errorBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  errorLabel: { fontWeight: "700", fontSize: 13, marginBottom: 4 },
  errorText: { fontSize: 12, fontFamily: "monospace" },
  btn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 6,
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
