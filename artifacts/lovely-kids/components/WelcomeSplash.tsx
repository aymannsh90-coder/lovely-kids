import { useAudioPlayer } from "expo-audio";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef } from "react";
import { Image, StyleSheet, Text } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";

// These constants match the native splash screen exactly (app.json backgroundColor).
// Using hardcoded values here — rather than reading from AppSettingsContext — ensures
// the animated splash is always colour-accurate on first open, with no jump as the
// remote settings fetch resolves in the background.
const SPLASH_PRIMARY = "#E91E8C";
const SPLASH_ACCENT = "#96DFEC";

const VISIBLE_DURATION_MS = 3000;
const FADE_OUT_MS = 350;

interface WelcomeSplashProps {
  onFinish: () => void;
}

export function WelcomeSplash({ onFinish }: WelcomeSplashProps) {
  // Keep a stable ref so the timeout callback always has the latest onFinish
  // even if the parent re-renders (guards against stale-closure dismiss).
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  // Audio: load and play the welcome chime. All audio errors are silently
  // swallowed — audio is purely decorative and must never block the splash.
  const player = useAudioPlayer(require("@/assets/sounds/welcome-chime.mp3"));
  useEffect(() => {
    if (!player.isLoaded) return;
    try { player.play(); } catch { /* ignore audio errors */ }
  }, [player.isLoaded]);

  const containerOpacity = useSharedValue(1);
  const logoScale = useSharedValue(0.6);
  const logoOpacity = useSharedValue(0);
  const textOpacity = useSharedValue(0);
  const textTranslateY = useSharedValue(10);

  useEffect(() => {
    // Animations
    logoOpacity.value = withTiming(1, {
      duration: 450,
      easing: Easing.out(Easing.exp),
    });
    logoScale.value = withSequence(
      withTiming(1.08, { duration: 450, easing: Easing.out(Easing.exp) }),
      withTiming(1, { duration: 200, easing: Easing.inOut(Easing.ease) }),
    );
    textOpacity.value = withDelay(400, withTiming(1, { duration: 400 }));
    textTranslateY.value = withDelay(
      400,
      withTiming(0, { duration: 400, easing: Easing.out(Easing.ease) }),
    );
    containerOpacity.value = withDelay(
      VISIBLE_DURATION_MS - FADE_OUT_MS,
      withTiming(0, { duration: FADE_OUT_MS }),
    );

    // Primary dismiss timer — fires after the full visible duration.
    const timer = setTimeout(() => onFinishRef.current(), VISIBLE_DURATION_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
  }));
  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));
  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textTranslateY.value }],
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, containerStyle]}>
      <LinearGradient
        colors={[SPLASH_PRIMARY, SPLASH_ACCENT]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <Animated.View style={[styles.logoWrap, logoStyle]}>
          <Image
            source={require("@/assets/images/logo.jpg")}
            style={styles.logo}
          />
        </Animated.View>
        <Animated.View style={textStyle}>
          <Text style={styles.welcomeText}>أهلاً وسهلاً بعودتك</Text>
        </Animated.View>
      </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    // Solid background prevents any transparency bleed-through while the
    // app renders behind the splash on first launch.
    backgroundColor: SPLASH_PRIMARY,
  },
  gradient: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  logoWrap: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 8,
  },
  logo: {
    width: 132,
    height: 132,
    resizeMode: "cover",
  },
  welcomeText: {
    fontSize: 22,
    fontWeight: "700",
    color: "#FFFFFF",
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.15)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
});
