import { router, usePathname } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Image,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import type { HeroSlide } from "@/context/AppSettingsContext";

type Props = {
  slides: HeroSlide[];
};

function NativeHeroVideo({ uri }: { uri: string }) {
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

function WebHeroVideo({ uri }: { uri: string }) {
  const pathname = usePathname();
  const videoRef = useRef<any>(null);
  const [muted, setMuted] = useState(true);

  const toggleSound = (event: any) => {
    event?.stopPropagation?.();

    const video = videoRef.current;
    if (!video) return;

    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setMuted(nextMuted);

    if (!nextMuted) {
      void video.play().catch(() => undefined);
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = true;
    setMuted(true);

    if (pathname === "/") {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [pathname, uri]);

  return (
    <View style={[styles.media, { position: "relative" }]}>
      {React.createElement(
        "video",
        {
          ref: (node: any) => {
            videoRef.current = node;
          },
          src: uri,
          autoPlay: true,
          muted,
          loop: true,
          playsInline: true,
          preload: "auto",
          controls: false,
          style: {
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
            backgroundColor: "#e5e7eb",
          },
          onCanPlay: (event: any) => {
            const video = event.currentTarget;
            video.muted = muted;

            void video.play().catch(() => {
              video.muted = true;
              setMuted(true);
              void video.play().catch(() => undefined);
            });
          },
        } as any,
      )}

      {React.createElement(
        "button",
        {
          type: "button",
          onPointerDown: (event: any) => event.stopPropagation(),
          onClick: toggleSound,
          "aria-label": muted ? "تشغيل صوت الفيديو" : "كتم صوت الفيديو",
          style: {
            position: "absolute",
            left: "12px",
            bottom: "12px",
            zIndex: 10,
            border: "none",
            borderRadius: "999px",
            width: "36px",
            height: "36px",
            padding: "0",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.58)",
            color: "#ffffff",
            fontSize: "18px",
            lineHeight: "1",
            cursor: "pointer",
          },
        } as any,
        muted ? "🔇" : "🔊",
      )}
    </View>
  );
}

function HeroVideo({ uri }: { uri: string }) {
  return Platform.OS === "web" ? (
    <WebHeroVideo uri={uri} />
  ) : (
    <NativeHeroVideo uri={uri} />
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
  const swipeJustHappened = useRef(false);

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

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,

        onMoveShouldSetPanResponder: (_, gesture) =>
          activeSlides.length > 1 &&
          Math.abs(gesture.dx) > 12 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,

        onPanResponderRelease: (_, gesture) => {
          const isHorizontalSwipe =
            Math.abs(gesture.dx) >= 45 &&
            Math.abs(gesture.dx) > Math.abs(gesture.dy);

          if (
            activeSlides.length <= 1 ||
            !isHorizontalSwipe
          ) {
            return;
          }

          swipeJustHappened.current = true;

          const nextIndex =
            gesture.dx < 0
              ? (activeIndex + 1) % activeSlides.length
              : (activeIndex - 1 + activeSlides.length) %
                activeSlides.length;

          changeSlide(nextIndex);

          setTimeout(() => {
            swipeJustHappened.current = false;
          }, 300);
        },

        onPanResponderTerminationRequest: () => true,
      }),
    [activeIndex, activeSlides.length],
  );

  useEffect(() => {
    if (activeSlides.length <= 1) return;

    const current = activeSlides[activeIndex];
    const delay =
      current?.type === "video" ? (Platform.OS === "web" ? 30000 : 8000) : 5000;

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
          {...(Platform.OS === "web"
            ? panResponder.panHandlers
            : {})}
          style={[
            styles.slide,
            {
              opacity: fade,
            },
          ]}
        >
          <Pressable
            style={styles.pressable}
            onPress={() => {
              if (swipeJustHappened.current) return;
              router.push("/products");
            }}
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
