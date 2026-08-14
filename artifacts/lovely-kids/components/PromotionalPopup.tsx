import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";

import { useAppSettings } from "@/context/AppSettingsContext";

const SESSION_KEY = "lovely_kids_promo_popup_dismissed";

function getStoreDate(): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Jerusalem",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());

    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );

    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function isValidDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function PromotionalPopup() {
  const { settings, settingsReady } = useAppSettings();
  const pathname = usePathname();
  const { width, height } = useWindowDimensions();
  const [visible, setVisible] = useState(false);
  const [imageAspectRatio, setImageAspectRatio] = useState(1);

  useEffect(() => {
    if (Platform.OS !== "web" || !settingsReady) return;

    if (pathname.startsWith("/admin")) {
      setVisible(false);
      return;
    }

    const imageUrl = settings.promoPopupImageUrl?.trim() ?? "";
    const startDate = settings.promoPopupStartDate?.trim() ?? "";
    const endDate = settings.promoPopupEndDate?.trim() ?? "";

    if (!settings.promoPopupEnabled || !imageUrl) {
      setVisible(false);
      return;
    }

    const today = getStoreDate();

    if (
      (startDate && (!isValidDateOnly(startDate) || today < startDate)) ||
      (endDate && (!isValidDateOnly(endDate) || today > endDate))
    ) {
      setVisible(false);
      return;
    }

    try {
      if (window.sessionStorage.getItem(SESSION_KEY) === "1") {
        setVisible(false);
        return;
      }
    } catch {
      // Continue if sessionStorage is unavailable.
    }

    const timer = window.setTimeout(() => setVisible(true), 250);
    return () => window.clearTimeout(timer);
  }, [
    pathname,
    settingsReady,
    settings.promoPopupEnabled,
    settings.promoPopupImageUrl,
    settings.promoPopupStartDate,
    settings.promoPopupEndDate,
  ]);

  useEffect(() => {
    const url = settings.promoPopupImageUrl?.trim();
    if (!url) return;

    Image.getSize(url, (w, h) => {
      if (w > 0 && h > 0) setImageAspectRatio(w / h);
    });
  }, [settings.promoPopupImageUrl]);

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      // Ignore storage errors.
    }

    setVisible(false);
  };

  const handleImagePress = () => {
    const link = settings.promoPopupLink?.trim();
    if (!link) return;

    dismiss();

    if (link.startsWith("/")) {
      router.push(link as never);
      return;
    }

    Linking.openURL(link).catch(() => {});
  };

  if (Platform.OS !== "web") return null;

  const maxWidth = Math.min(width * 0.9, 560);
  const maxHeight = Math.min(height * 0.82, 760);

  let popupWidth = maxWidth;
  let popupHeight = popupWidth / imageAspectRatio;

  if (popupHeight > maxHeight) {
    popupHeight = maxHeight;
    popupWidth = popupHeight * imageAspectRatio;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={dismiss}
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.popup,
            {
              width: popupWidth,
              height: popupHeight,
            },
          ]}
        >
          <Pressable
            onPress={dismiss}
            style={styles.closeButton}
            accessibilityLabel="إغلاق الإعلان"
          >
            <Ionicons name="close" size={25} color="#111827" />
          </Pressable>

          <Pressable
            onPress={handleImagePress}
            disabled={!settings.promoPopupLink?.trim()}
            style={styles.imagePressable}
          >
            <Image
              source={{ uri: settings.promoPopupImageUrl }}
              style={{
                width: popupWidth,
                height: popupHeight,
              }}
              resizeMode="contain"
            />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.68)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 30,
  },
  popup: {
    position: "relative",
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    overflow: "visible",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 20,
  },
  imagePressable: {
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#FFFFFF",
  },
  closeButton: {
    position: "absolute",
    zIndex: 20,
    top: -15,
    right: -15,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 12,
  },
});
