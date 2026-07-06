import { useSignUp, useSSO } from "@clerk/expo";
import { Ionicons } from "@expo/vector-icons";
import * as AuthSession from "expo-auth-session";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
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

function snakeToCamel(str: string): string {
  return str.replace(/([-_][a-z])/g, (match) => match.toUpperCase().replace(/-|_/, ""));
}

const FIELD_LABELS: Record<string, string> = {
  username: "اسم المستخدم",
  phone_number: "رقم الهاتف",
  first_name: "الاسم الأول",
  last_name: "الاسم الأخير",
};

type Provider = "google" | "apple";

const PROVIDERS: { key: Provider; strategy: "oauth_google" | "oauth_apple"; label: string; icon: "logo-google" | "logo-apple" }[] = [
  { key: "google", strategy: "oauth_google", label: "المتابعة عبر جوجل", icon: "logo-google" },
  { key: "apple", strategy: "oauth_apple", label: "المتابعة عبر آبل", icon: "logo-apple" },
];

export function SocialSignInButtons() {
  useWarmUpBrowser();
  const colors = useColors();
  const { startSSOFlow } = useSSO();
  const { signUp } = useSignUp();
  const [submittingProvider, setSubmittingProvider] = useState<Provider | null>(null);
  const [error, setError] = useState("");
  const [needsCompletion, setNeedsCompletion] = useState(false);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [completing, setCompleting] = useState(false);

  const handlePress = useCallback(
    async (provider: Provider, strategy: "oauth_google" | "oauth_apple") => {
      setSubmittingProvider(provider);
      setError("");
      try {
        const { createdSessionId, setActive } = await startSSOFlow({
          strategy,
          redirectUrl: AuthSession.makeRedirectUri(),
        });

        if (createdSessionId && setActive) {
          await setActive({ session: createdSessionId });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else if (signUp?.status === "missing_requirements") {
          setNeedsCompletion(true);
        } else if (signUp?.status && signUp.status !== "complete") {
          setError("تعذر إكمال تسجيل الدخول");
        }
      } catch (err) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setError("تعذر تسجيل الدخول، حاول مرة أخرى");
        console.error(JSON.stringify(err, null, 2));
      } finally {
        setSubmittingProvider(null);
      }
    },
    [startSSOFlow, signUp]
  );

  const handleCompleteSignUp = useCallback(async () => {
    if (!signUp) return;
    setCompleting(true);
    setError("");
    try {
      const { error: updateError } = await signUp.update(fieldValues);
      if (updateError) {
        setError("يرجى تعبئة جميع الحقول المطلوبة");
        return;
      }
      if (signUp.status === "complete") {
        await signUp.finalize();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setNeedsCompletion(false);
      } else {
        setError("يرجى تعبئة جميع الحقول المطلوبة");
      }
    } catch (err) {
      setError("تعذر إكمال إنشاء الحساب");
      console.error(JSON.stringify(err, null, 2));
    } finally {
      setCompleting(false);
    }
  }, [signUp, fieldValues]);

  return (
    <>
      <View style={styles.buttonsRow}>
        {PROVIDERS.map((p) => (
          <Pressable
            key={p.key}
            onPress={() => handlePress(p.key, p.strategy)}
            disabled={submittingProvider !== null}
            style={[
              styles.button,
              {
                borderColor: colors.border,
                backgroundColor: colors.card,
                opacity: submittingProvider !== null && submittingProvider !== p.key ? 0.5 : 1,
              },
            ]}
          >
            {submittingProvider === p.key ? (
              <ActivityIndicator color={colors.foreground} />
            ) : (
              <>
                <Ionicons name={p.icon} size={18} color={colors.foreground} />
                <Text style={[styles.text, { color: colors.foreground }]}>{p.label}</Text>
              </>
            )}
          </Pressable>
        ))}
      </View>
      {error ? (
        <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
      ) : null}

      <Modal
        visible={needsCompletion}
        transparent
        animationType="fade"
        onRequestClose={() => setNeedsCompletion(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              إكمال إنشاء الحساب
            </Text>
            {(signUp?.missingFields ?? []).map((field) => (
              <TextInput
                key={field}
                value={fieldValues[snakeToCamel(field)] ?? ""}
                onChangeText={(text) =>
                  setFieldValues((prev) => ({ ...prev, [snakeToCamel(field)]: text }))
                }
                placeholder={FIELD_LABELS[field] ?? field}
                placeholderTextColor={colors.mutedForeground}
                style={[
                  styles.input,
                  { color: colors.foreground, borderColor: colors.border, width: "100%" },
                ]}
                textAlign="right"
              />
            ))}
            {error ? (
              <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
            ) : null}
            <Pressable
              onPress={handleCompleteSignUp}
              disabled={completing}
              style={[styles.authSubmitBtn, { backgroundColor: colors.primary, width: "100%" }]}
            >
              {completing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.authSubmitText}>تأكيد</Text>
              )}
            </Pressable>
            <Pressable onPress={() => setNeedsCompletion(false)}>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>إلغاء</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  buttonsRow: {
    flexDirection: "row",
    gap: 10,
  },
  button: {
    flex: 1,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingVertical: 13,
  },
  text: { fontSize: 14, fontWeight: "700" },
  errorText: { fontSize: 13, fontWeight: "600", textAlign: "right", marginTop: 6 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    gap: 12,
  },
  modalTitle: { fontSize: 17, fontWeight: "800" },
  input: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  authSubmitBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  authSubmitText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
