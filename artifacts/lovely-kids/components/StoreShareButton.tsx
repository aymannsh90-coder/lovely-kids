import { Ionicons } from "@expo/vector-icons";
import { usePathname } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  Share,
  Text,
  View,
} from "react-native";

const STORE_URL = "https://www.lovelykids.net";

const SHARE_TEXT =
  "شوفوا متجر Lovely Kids 👶💕\nكل ما يحتاجه طفلك في مكان واحد\n" +
  STORE_URL;

export function StoreShareButton() {
  const pathname = usePathname();
  const [showLabel, setShowLabel] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowLabel(false);
    }, 4000);

    return () => clearTimeout(timer);
  }, []);

  if (pathname.startsWith("/admin")) {
    return null;
  }

  const shareStore = async () => {
    try {
      if (Platform.OS === "web") {
        const navigatorWithShare = navigator as Navigator & {
          share?: (data: {
            title?: string;
            text?: string;
            url?: string;
          }) => Promise<void>;
        };

        if (navigatorWithShare.share) {
          await navigatorWithShare.share({
            title: "Lovely Kids",
            text: "شوفوا متجر Lovely Kids 👶💕",
            url: STORE_URL,
          });
          return;
        }

        window.open(
          `https://wa.me/?text=${encodeURIComponent(SHARE_TEXT)}`,
          "_blank",
        );
        return;
      }

      await Share.share({
        title: "Lovely Kids",
        message: SHARE_TEXT,
        url: STORE_URL,
      });
    } catch {
      if (Platform.OS !== "web") {
        Alert.alert(
          "مشاركة المتجر",
          "تعذر فتح خيارات المشاركة حالياً.",
        );
      }
    }
  };

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 10,
        bottom: Platform.OS === "web" ? 72 : 84,
        zIndex: 9999,
      }}
    >
      <Pressable
        onPress={() => void shareStore()}
        accessibilityRole="button"
        accessibilityLabel="مشاركة المتجر مع الأصدقاء"
        style={({ pressed }) => ({
          minWidth: 38,
          height: 38,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: showLabel ? 5 : 0,
          backgroundColor: "rgba(255,255,255,0.97)",
          borderRadius: 19,
          paddingHorizontal: showLabel ? 11 : 0,
          borderWidth: 1,
          borderColor: "rgba(233,30,140,0.30)",
          opacity: pressed ? 0.72 : 1,
          shadowColor: "#000",
          shadowOpacity: 0.12,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 2 },
          elevation: 5,
        })}
      >
        <Ionicons
          name="share-social-outline"
          size={18}
          color="#E91E8C"
        />

        {showLabel ? (
          <Text
            numberOfLines={1}
            style={{
              color: "#E91E8C",
              fontSize: 11,
              fontWeight: "800",
            }}
          >
            مشاركة المتجر مع الأصدقاء
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}
