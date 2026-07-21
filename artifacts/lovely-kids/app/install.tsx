import React, { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
};

export default function InstallPage() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web") return;

    const w = window as Window & { __lovelyInstallPrompt?: InstallPromptEvent | null };

    if (w.__lovelyInstallPrompt) {
      setPromptEvent(w.__lovelyInstallPrompt);
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      const prompt = e as InstallPromptEvent;
      w.__lovelyInstallPrompt = prompt;
      setPromptEvent(prompt);
    };

    setIsIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const handleInstall = async () => {
    if (promptEvent) {
      await promptEvent.prompt();
      setPromptEvent(null);
      return;
    }

    if (isIos) {
      window.alert("من Safari اضغط زر المشاركة ثم اختر: إضافة إلى الشاشة الرئيسية");
      return;
    }

    window.alert("افتح قائمة المتصفح واختر: تثبيت التطبيق");
  };

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#F0FAFE" }}>
      <Text style={{ fontSize: 28, fontWeight: "800", marginBottom: 12 }}>
        Lovely Kids
      </Text>

      <Text style={{ fontSize: 18, textAlign: "center", marginBottom: 28 }}>
        ثبّت تطبيق Lovely Kids على هاتفك
      </Text>

      <Pressable
        onPress={() => void handleInstall()}
        style={{ backgroundColor: "#E91E8C", paddingVertical: 14, paddingHorizontal: 30, borderRadius: 14 }}
      >
        <Text style={{ color: "#fff", fontSize: 17, fontWeight: "700" }}>
          تثبيت التطبيق
        </Text>
      </Pressable>
    </View>
  );
}
