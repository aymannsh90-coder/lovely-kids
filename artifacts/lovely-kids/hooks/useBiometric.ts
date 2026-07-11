import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";

export const BIOMETRIC_ENABLED_KEY = "@lovely_kids_biometric_enabled";

export function useBiometric() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (Platform.OS === "web") {
      setLoading(false);
      return;
    }
    Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY),
    ]).then(([hasHardware, isEnrolled, storedVal]) => {
      setSupported(hasHardware && isEnrolled);
      setEnabled(storedVal === "true");
      setLoading(false);
    });
  }, []);

  const enable = useCallback(async (): Promise<boolean> => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "تأكيد تفعيل الدخول بالبصمة أو رمز الهاتف",
        cancelLabel: "إلغاء",
        disableDeviceFallback: false,
      });
      if (result.success) {
        await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, "true");
        setEnabled(true);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const disable = useCallback(async () => {
    await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, "false");
    setEnabled(false);
  }, []);

  return { supported, enabled, loading, enable, disable };
}
