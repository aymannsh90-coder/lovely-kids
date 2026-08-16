import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";

function cleanExternalMarker() {
  const params = new URLSearchParams(window.location.search);
  params.delete("openedExternal");

  const query = params.toString();
  const cleanUrl =
    window.location.pathname +
    (query ? `?${query}` : "") +
    window.location.hash;

  window.history.replaceState({}, "", cleanUrl);
}

export function OpenInChromePrompt() {
  const [show, setShow] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSHelp, setShowIOSHelp] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      return;
    }

    const ua = navigator.userAgent || "";

    const android = /Android/i.test(ua);

    const ios =
      /iPhone|iPad|iPod/i.test(ua) ||
      (/Macintosh/i.test(ua) &&
        typeof navigator.maxTouchPoints === "number" &&
        navigator.maxTouchPoints > 1);

    setIsIOS(ios);

    const params = new URLSearchParams(window.location.search);
    const openedExternal = params.get("openedExternal") === "1";

    if (android) {
      if (openedExternal) {
        setShow(false);
        cleanExternalMarker();
        return;
      }

      // واتساب ومسنجر على Android قد يستخدمان Custom Tab
      // لا يمكن تمييزه دائماً عن Chrome، لذلك نظهر الزر أولاً.
      setShow(true);
      return;
    }

    if (ios) {
      const explicitInApp =
        /WhatsApp|FBAN|FBAV|MessengerFor|Instagram/i.test(ua);

      const isChromeIOS = /CriOS/i.test(ua);
      const isFirefoxIOS = /FxiOS/i.test(ua);
      const isEdgeIOS = /EdgiOS/i.test(ua);

      const hasSafariToken = /Safari\//i.test(ua);

      const likelyInApp =
        explicitInApp ||
        (!hasSafariToken &&
          !isChromeIOS &&
          !isFirefoxIOS &&
          !isEdgeIOS);

      if (openedExternal) {
        if (likelyInApp) {
          cleanExternalMarker();
          setShow(true);
          setShowIOSHelp(true);
        } else {
          cleanExternalMarker();
          setShow(false);
        }
        return;
      }

      setShow(likelyInApp);
      return;
    }

    setShow(false);
  }, []);

  if (!show || Platform.OS !== "web") {
    return null;
  }

  const openExternal = () => {
    const targetUrl = new URL(window.location.href);
    targetUrl.searchParams.set("openedExternal", "1");

    const externalUrl = targetUrl.toString();

    if (/Android/i.test(navigator.userAgent)) {
      const withoutScheme = externalUrl.replace(/^https?:\/\//i, "");

      window.location.href =
        `intent://${withoutScheme}` +
        `#Intent;scheme=https;package=com.android.chrome;` +
        `S.browser_fallback_url=${encodeURIComponent(externalUrl)};end`;

      return;
    }

    if (isIOS) {
      window.open(externalUrl, "_blank");

      window.setTimeout(() => {
        setShowIOSHelp(true);
      }, 800);

      return;
    }

    window.open(externalUrl, "_blank");
  };

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        right: 12,
        zIndex: 10000,
        alignItems: "center",
      }}
    >
      <Pressable
        onPress={openExternal}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 7,
          backgroundColor: "#FFFFFF",
          borderRadius: 22,
          paddingHorizontal: 15,
          paddingVertical: 9,
          borderWidth: 1,
          borderColor: "#E91E8C",
          opacity: pressed ? 0.8 : 0.97,
          elevation: 6,
          shadowColor: "#000",
          shadowOpacity: 0.15,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 2 },
        })}
      >
        <Ionicons
          name="open-outline"
          size={17}
          color="#E91E8C"
        />

        <Text
          style={{
            color: "#E91E8C",
            fontSize: 12,
            fontWeight: "800",
          }}
        >
          {isIOS
            ? "فتح المتجر بالمتصفح الخارجي"
            : "فتح المتجر في Chrome"}
        </Text>
      </Pressable>

      {isIOS && showIOSHelp ? (
        <View
          style={{
            marginTop: 7,
            backgroundColor: "#FFFFFF",
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderWidth: 1,
            borderColor: "#E5E7EB",
            maxWidth: 310,
          }}
        >
          <Text
            style={{
              color: "#333333",
              fontSize: 11,
              fontWeight: "700",
              textAlign: "center",
            }}
          >
            إذا بقي داخل واتساب أو مسنجر، اضغط ⋯ ثم اختر فتح في Safari
          </Text>
        </View>
      ) : null}
    </View>
  );
}
