import { useSSO } from "@clerk/expo";
import { Ionicons } from "@expo/vector-icons";
import * as AuthSession from "expo-auth-session";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text } from "react-native";
import * as WebBrowser from "expo-web-browser";

import { useColors } from "@/hooks/useColors";

WebBrowser.maybeCompleteAuthSession();

function useWarmUpBrowser() {
  useEffect(() => {
    if (Platform.OS !== "android") return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);
}

export function GoogleSignInButton() {
  useWarmUpBrowser();
  const colors = useColors();
  const { startSSOFlow } = useSSO();
  const [submitting, setSubmitting] = useState(false);

  const onPress = useCallback(async () => {
    setSubmitting(true);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: "oauth_google",
        redirectUrl: AuthSession.makeRedirectUri(),
      });

      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      console.error(JSON.stringify(err, null, 2));
    } finally {
      setSubmitting(false);
    }
  }, [startSSOFlow]);

  return (
    <Pressable
      onPress={onPress}
      disabled={submitting}
      style={[
        styles.button,
        { borderColor: colors.border, backgroundColor: colors.card, opacity: submitting ? 0.7 : 1 },
      ]}
    >
      {submitting ? (
        <ActivityIndicator color={colors.foreground} />
      ) : (
        <>
          <Ionicons name="logo-google" size={18} color={colors.foreground} />
          <Text style={[styles.text, { color: colors.foreground }]}>
            المتابعة عبر جوجل
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingVertical: 13,
  },
  text: { fontSize: 15, fontWeight: "700" },
});
