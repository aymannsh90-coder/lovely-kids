import { router } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Image,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import type { HeroSlide } from "@/context/AppSettingsContext";

type Props = {
  slides: HeroSlide[];
};

function HeroVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
    instance.muted = true;
    instance.play();
  });

  return (
    <VideoView
      player={player}
      style={styles.media}
      contentFit="cover"
      nativeControls={false}
      playsInline
    />
  );
}

export function HeroSlider({ slides }: Props) {
  const activeSlides = useMemo(
    () =>
      [...slides]
        .filter((slide) => slide.active && slide.url)
        .sort((a, b) => a.order - b.order)
        .slice(0, 3),
    [slides],
  );

  const [activeIndex, setActiveIndex] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (activeIndex >= activeSlides.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, activeSlides.length]);

  const changeSlide = (nextIndex: number) => {
    if (
      activeSlides.length <= 1 ||
      nextIndex === activeIndex
    ) {
      return;
    }

    Animated.timing(fade, {
      toValue: 0,
      duration: 160,
      useNativeDriver: true,
    }).start(() => {
      setActiveIndex(nextIndex);

      Animated.timing(fade, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }).start();
    });
  };

  useEffect(() => {
    if (activeSlides.length <= 1) return;

    const current = activeSlides[activeIndex];
    const delay =
      current?.type === "video" ? 8000 : 5000;

    const timer = setTimeout(() => {
      const next =
        (activeIndex + 1) % activeSlides.length;

      changeSlide(next);
    }, delay);

    return () => clearTimeout(timer);
  }, [activeIndex, activeSlides]);

  if (activeSlides.length === 0) {
    return null;
  }

  const current = activeSlides[activeIndex];

  return (
    <View style={styles.outer}>
      <View style={styles.slider}>
        <Animated.View
          style={[
            styles.slide,
            {
              opacity: fade,
            },
          ]}
        >
          <Pressable
            style={styles.pressable}
            onPress={() => router.push("/products")}
          >
            {current.type === "video" ? (
              <HeroVideo
                key={current.id}
                uri={current.url}
              />
            ) : (
              <Image
                source={{ uri: current.url }}
                style={styles.media}
                resizeMode="cover"
              />
            )}
          </Pressable>
        </Animated.View>

        {activeSlides.length > 1 ? (
          <View style={styles.dots}>
            {activeSlides.map((slide, index) => (
              <Pressable
                key={slide.id}
                onPress={() => changeSlide(index)}
                hitSlop={8}
                accessibilityLabel={`الشريحة ${index + 1}`}
                style={[
                  styles.dot,
                  index === activeIndex &&
                    styles.activeDot,
                ]}
              />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    width: "100%",
    paddingHorizontal: 16,
    marginBottom: 20,
    alignItems: "center",
  },
  slider: {
    width: "100%",
    maxWidth: 1200,
    aspectRatio: 2,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#e5e7eb",
    position: "relative",
  },
  slide: {
    width: "100%",
    height: "100%",
  },
  pressable: {
    width: "100%",
    height: "100%",
  },
  media: {
    width: "100%",
    height: "100%",
  },
  dots: {
    position: "absolute",
    bottom: 10,
    alignSelf: "center",
    flexDirection: "row",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.28)",
    borderRadius: 20,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  activeDot: {
    width: 18,
    backgroundColor: "#fff",
  },
});
