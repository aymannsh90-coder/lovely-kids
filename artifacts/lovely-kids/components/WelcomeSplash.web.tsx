import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

const VISIBLE_DURATION_MS = 1400;

export function WelcomeSplash({ onFinish }: { onFinish: () => void }) {
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  useEffect(() => {
    const timer = setTimeout(
      () => onFinishRef.current(),
      VISIBLE_DURATION_MS,
    );

    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 9999 }]}>
      <LinearGradient
        colors={["#E91E8C", "#96DFEC"]}
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Image
          source={require("@/assets/images/logo.jpg")}
          style={{
            width: 132,
            height: 132,
            borderRadius: 66,
            marginBottom: 24,
          }}
        />
        <Text
          style={{
            fontSize: 22,
            fontWeight: "700",
            color: "#fff",
            textAlign: "center",
          }}
        >
          {"أهلاً وسهلاً بكم في متجر\nLOVELY KIDS"}
        </Text>
      </LinearGradient>
    </View>
  );
}
