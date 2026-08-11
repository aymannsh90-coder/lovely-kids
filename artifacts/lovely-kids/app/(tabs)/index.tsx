import {
  getResponsiveTopPadding,
  getWebViewport,
} from "@/utils/webLayout";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CartBadge } from "@/components/CartBadge";
import {
  CategoryMenu,
  DesktopCategorySidebar,
  DESKTOP_CATEGORY_SIDEBAR_WIDTH,
} from "@/components/CategoryMenu";
import { HeroSlider } from "@/components/HeroSlider";
import { ProductCard } from "@/components/ProductCard";
import { AGE_GROUP_IDS, DEFAULT_AGE_GROUP_LABELS, AGE_GROUP_ICONS } from "@/data/products";
import { useVisibleProducts } from "@/hooks/useVisibleProducts";
import { enableWebPushNotifications } from "@/hooks/usePushNotifications";
import { useAppSettings } from "@/context/AppSettingsContext";
import { useAuth } from "@/context/AuthContext";
import { useWishlist } from "@/context/WishlistContext";
import { useColors } from "@/hooks/useColors";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type GenderTab = "boys" | "girls" | null;

const { width } = Dimensions.get("window");

function getReadableTextColor(backgroundColor: string) {
  const hex = backgroundColor.replace("#", "").trim();

  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return "#1F2937";
  }

  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  const brightness = (red * 299 + green * 587 + blue * 114) / 1000;

  return brightness > 155 ? "#1F2937" : "#FFFFFF";
}

const AGE_COLORS = [
  "#FFB5C8",
  "#96DFEC",
  "#B5D5FF",
  "#FFD9A0",
  "#B5ECC8",
  "#E8B5FF",
];

const TRUST_BADGES = [
  { icon: "shirt-outline" as const, color: "#E91E8C", title: "خامات ناعمة", subtitle: "ومريحة" },
  { icon: "sparkles-outline" as const, color: "#96DFEC", title: "تصاميم عصرية", subtitle: "وعملية" },
  { icon: "ribbon-outline" as const, color: "#FFB84D", title: "جودة تدوم", subtitle: "طويلاً" },
];

export default function HomeScreen() {
  const colors = useColors();
  const { width: viewportWidth } = useWindowDimensions();

  const webViewport =
    Platform.OS === "web" ? getWebViewport(viewportWidth) : "phone";

  const isTabletWeb =
    Platform.OS === "web" && webViewport === "tablet";

  const isDesktopWeb =
    Platform.OS === "web" && webViewport === "desktop";

  const isWideWeb = isTabletWeb || isDesktopWeb;

  const desktopWorkspaceWidth = isDesktopWeb
    ? Math.max(
        viewportWidth - DESKTOP_CATEGORY_SIDEBAR_WIDTH,
        0,
      )
    : viewportWidth;

  const responsiveShellWidth = Math.min(
    Math.max(desktopWorkspaceWidth - 32, 0),
    1200,
  );

  const homeProductCardWidth = isWideWeb
    ? (responsiveShellWidth - 32 - 24) / 3
    : (width - 48) / 2;

  const homeProductImageHeight =
    isDesktopWeb ? 280 : undefined;

  const newArrivalCardWidth = isDesktopWeb
    ? (responsiveShellWidth - 24) / 3
    : 170;

  const newArrivalImageHeight =
    isDesktopWeb ? 250 : undefined;

  const responsiveShellStyle = isWideWeb
    ? {
        width: responsiveShellWidth,
        alignSelf: "center" as const,
      }
    : null;

  const desktopBannerStyle = isDesktopWeb
    ? {
        width: responsiveShellWidth,
        alignSelf: "center" as const,
        marginHorizontal: 0,
      }
    : null;
  const contactTextColor =
    Platform.OS === "web"
      ? getReadableTextColor(colors.secondary)
      : colors.foreground;
  const contactSubTextColor =
    Platform.OS === "web"
      ? contactTextColor === "#FFFFFF"
        ? "rgba(255,255,255,0.9)"
        : "#374151"
      : colors.mutedForeground;
  const insets = useSafeAreaInsets();
  const { products } = useVisibleProducts();
  const { settings } = useAppSettings();
  const { user, getAuthToken } = useAuth();
  const { count: wishlistCount } = useWishlist();
  const firstName = user?.name?.trim().split(/\s+/)[0] || "";
  const ageGroupLabels = settings.ageGroupLabels ?? DEFAULT_AGE_GROUP_LABELS;
  const ageGroups = AGE_GROUP_IDS.map((id) => ({
    id,
    label: ageGroupLabels[id]?.label ?? DEFAULT_AGE_GROUP_LABELS[id].label,
    sublabel: ageGroupLabels[id]?.sublabel ?? DEFAULT_AGE_GROUP_LABELS[id].sublabel,
  }));
  const activeOffers = settings.offers.filter((o) => o.active);
  const productOffersCount = products.filter((p) => p.showInOffers === true).length;
  const showProductOffersButton =
    settings.productOffersSectionEnabled === true && productOffersCount > 0;
  const [selectedAge, setSelectedAge] = useState<string | null>(null);
  const [genderTab, setGenderTab] = useState<GenderTab>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [webPushEnabled, setWebPushEnabled] = useState(false);

  const ageArrowAnim = useRef(new Animated.Value(0)).current;
  const newArrivalsScrollRef = useRef<ScrollView>(null);
  const newArrivalsScrollX = useRef(0);
  const newArrivalsMaxScrollX = useRef(0);
  const newArrivalsContentWidth = useRef(0);
  const newArrivalsViewportWidth = useRef(0);
  const newArrivalsDirection = useRef<1 | -1>(1);
  const newArrivalsAutoPaused = useRef(false);

  const updateNewArrivalsBounds = () => {
    const maxX = Math.max(
      0,
      newArrivalsContentWidth.current - newArrivalsViewportWidth.current,
    );

    newArrivalsMaxScrollX.current = maxX;

    if (newArrivalsScrollX.current > maxX) {
      newArrivalsScrollX.current = maxX;
      newArrivalsScrollRef.current?.scrollTo({
        x: maxX,
        animated: false,
      });
    }
  };

  const scrollNewArrivals = (direction: "left" | "right") => {
    const step = isDesktopWeb
      ? newArrivalCardWidth + 12
      : Math.max(180, Math.min(width * 0.75, 360));
    const movement = direction === "left" ? step : -step;
    const nextX = Math.min(
      newArrivalsMaxScrollX.current,
      Math.max(0, newArrivalsScrollX.current + movement),
    );

    newArrivalsDirection.current = direction === "left" ? 1 : -1;
    newArrivalsScrollX.current = nextX;

    newArrivalsScrollRef.current?.scrollTo({
      x: nextX,
      animated: true,
    });
  };

  useEffect(() => {
    Animated.timing(ageArrowAnim, {
      toValue: 0.52,
      duration: 700,
      delay: 500,
      useNativeDriver: true,
    }).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;

    const savedPrompt = (window as any).__lovelyInstallPrompt as InstallPromptEvent | null;
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    setIsInstalled(standalone);
    if (!standalone && savedPrompt) setInstallPrompt(savedPrompt);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      (window as any).__lovelyInstallPrompt = e;
      setInstallPrompt(e as InstallPromptEvent);
    };

    const onInstalled = () => setIsInstalled(true);
    setIsIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    setWebPushEnabled(
      typeof Notification !== "undefined" &&
      Notification.permission === "granted",
    );
  }, []);

  const handleEnableWebPush = async () => {
    const result = await enableWebPushNotifications(
      user?.phone,
      getAuthToken,
    );

    if (result.ok) {
      setWebPushEnabled(true);
      window.alert("تم تفعيل الإشعارات بنجاح ✅");
    } else {
      window.alert(result.error ?? "تعذر تفعيل الإشعارات");
    }
  };

  const handleInstall = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setIsInstalled(true);
      setInstallPrompt(null);
      return;
    }

    if (isIos) {
      window.alert("من Safari اضغط زر المشاركة ثم اختر: إضافة إلى الشاشة الرئيسية");
    }
  };

  const regularProducts =
    Platform.OS === "web"
      ? products.filter((p) => p.showInOffers !== true)
      : products;

  const genderFiltered = genderTab
    ? regularProducts.filter((p) => p.gender == null || p.gender === genderTab)
    : regularProducts;

  const newArrivals = genderFiltered.filter((p) => p.isNew);

  useEffect(() => {
    if (Platform.OS !== "web" || newArrivals.length <= 2) return;

    const timer = setInterval(() => {
      if (newArrivalsAutoPaused.current) return;
      if (typeof document !== "undefined" && document.hidden) return;

      const maxX = newArrivalsMaxScrollX.current;
      if (maxX <= 1) return;

      const step = isDesktopWeb
        ? newArrivalCardWidth + 12
        : 182;
      let nextX =
        newArrivalsScrollX.current +
        step * newArrivalsDirection.current;

      if (nextX >= maxX) {
        nextX = maxX;
        newArrivalsDirection.current = -1;
      } else if (nextX <= 0) {
        nextX = 0;
        newArrivalsDirection.current = 1;
      }

      newArrivalsScrollX.current = nextX;
      newArrivalsScrollRef.current?.scrollTo({
        x: nextX,
        animated: true,
      });
    }, 2200);

    return () => clearInterval(timer);
  }, [
    newArrivals.length,
    isDesktopWeb,
    newArrivalCardWidth,
  ]);

  const selectedAgeForProducts =
    settings.homeAgeGroupsSectionEnabled !== false ? selectedAge : null;

  const filteredProducts = selectedAgeForProducts
    ? genderFiltered.filter((p) => p.ageGroup === selectedAgeForProducts)
    : genderFiltered.slice(0, Platform.OS === "web" ? 12 : 6);

  const topPadding = getResponsiveTopPadding(insets.top);

  const renderHomeSectionHeader = (title: string, onPress: () => void) => {
    if (Platform.OS !== "web") {
      return (
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            {title}
          </Text>
          <Pressable onPress={onPress}>
            <Text style={[styles.seeAll, { color: colors.primary }]}>
              عرض الكل
            </Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View
        style={[
          styles.homeBannerHeader,
          responsiveShellStyle,
        ]}
      >
        <View
          style={[
            styles.homeBannerTitleBox,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View
            style={[
              styles.homeBannerAccent,
              { backgroundColor: colors.primary },
            ]}
          />
          <Text style={[styles.homeBannerTitle, { color: colors.foreground }]}>
            {title}
          </Text>
        </View>

        <View
          style={[
            styles.homeBannerLine,
            { backgroundColor: colors.border },
          ]}
        />

        <Pressable onPress={onPress}>
          <Text style={[styles.seeAll, { color: colors.primary }]}>
            عرض الكل
          </Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
      }}
    >
    <ScrollView
      style={[
        styles.scroll,
        { backgroundColor: colors.background },
        isDesktopWeb
          ? {
              width: desktopWorkspaceWidth,
              alignSelf: "flex-start",
            }
          : null,
      ]}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 100 : insets.bottom + 80 }}
    >
      {/* Header — keep existing header on phone/tablet only */}
      {!isDesktopWeb ? (
      <View
        style={[
          styles.header,
          { paddingTop: topPadding + 12, backgroundColor: colors.background },
        ]}
      >
        <View style={styles.headerLeft}>
          <CategoryMenu />

          {Platform.OS !== "web" && (
            <Image
              source={
                settings.logoUrl
                  ? { uri: settings.logoUrl }
                  : require("@/assets/images/logo.jpg")
              }
              style={styles.logoImage}
              resizeMode="contain"
            />
          )}

          {user && (
            <View style={styles.greetingBlock}>
              <Text style={[styles.greetingHi, { color: colors.primary }]}>
                أهلاً وسهلاً
              </Text>
              <Text style={[styles.greetingName, { color: colors.foreground }]}>
                {Platform.OS === "web" ? firstName : user.name}
              </Text>
            </View>
          )}
        </View>

        {Platform.OS === "web" && (
          <Image
            source={require("@/assets/images/lovely-kids-logo-horizontal.png")}
            style={[styles.logoImage, styles.webCenteredLogo]}
            resizeMode="contain"
          />
        )}

        <View style={styles.headerRight}>
          <Pressable
            onPress={() => router.push("/wishlist")}
            style={styles.iconBtn}
          >
            <Ionicons name="heart-outline" size={24} color={colors.foreground} />
            {wishlistCount > 0 && (
              <View style={[styles.wishlistBadge, { backgroundColor: colors.primary }]}>
                <Text style={styles.wishlistBadgeText}>
                  {wishlistCount > 99 ? "99+" : wishlistCount}
                </Text>
              </View>
            )}
          </Pressable>
          <CartBadge />
        </View>
      </View>
      ) : null}

      {Platform.OS !== "web" ? (
        <>
      {/* Gender Tabs */}
      <View style={[styles.genderTabsRow, { borderColor: colors.border }]}>
        <Pressable
          onPress={() => { setGenderTab(null); setSelectedAge(null); }}
          style={[
            styles.genderTab,
            genderTab === null && { backgroundColor: colors.primary },
          ]}
        >
          <Text style={[styles.genderTabText, { color: genderTab === null ? "#fff" : colors.foreground }]}>
            الكل
          </Text>
        </Pressable>
        <Pressable
          onPress={() => { setGenderTab("boys"); setSelectedAge(null); }}
          style={[
            styles.genderTab,
            genderTab === "boys" && { backgroundColor: "#3B82F6" },
          ]}
        >
          <Text style={{ fontSize: 18 }}>👦</Text>
          <Text style={[styles.genderTabText, { color: genderTab === "boys" ? "#fff" : colors.foreground }]}>
            ولادي
          </Text>
        </Pressable>
        <Pressable
          onPress={() => { setGenderTab("girls"); setSelectedAge(null); }}
          style={[
            styles.genderTab,
            genderTab === "girls" && { backgroundColor: "#EC4899" },
          ]}
        >
          <Text style={{ fontSize: 18 }}>👧</Text>
          <Text style={[styles.genderTabText, { color: genderTab === "girls" ? "#fff" : colors.foreground }]}>
            بناتي
          </Text>
        </Pressable>
      </View>
        </>
      ) : null}

      {/* Search Bar */}
      <Pressable
        onPress={() => router.push("/search")}
        style={[
          styles.searchBar,
          { backgroundColor: colors.card, borderColor: colors.border },
          desktopBannerStyle,
        ]}
      >
        <Ionicons name="search-outline" size={20} color={colors.mutedForeground} />
        <Text style={[styles.searchPlaceholder, { color: colors.mutedForeground }]}>
          ابحث عن منتج...
        </Text>
      </Pressable>

      {/* Hero Slider — fall back to the original banner when no active media exists */}
      {(settings.heroSlides ?? []).some(
        (slide) => slide.active && slide.url,
      ) ? (
        <HeroSlider slides={settings.heroSlides ?? []} />
      ) : (
        <Pressable
          onPress={() => router.push("/products")}
          style={[
            styles.heroBanner,
            { backgroundColor: settings.bannerColor },
          ]}
        >
          <View style={styles.heroContent}>
            {settings.bannerBadge ? (
              <View
                style={[
                  styles.heroBadge,
                  { backgroundColor: "#FFD700" },
                ]}
              >
                <Text style={styles.heroBadgeText}>
                  {settings.bannerBadge}
                </Text>
              </View>
            ) : null}

            <Text style={styles.heroTitle}>
              {settings.bannerTitle.replace("\\n", "\n")}
            </Text>

            <Text style={styles.heroSubtitle}>
              {settings.bannerSubtitle}
            </Text>

            <View
              style={[
                styles.heroBtn,
                { backgroundColor: "#fff" },
              ]}
            >
              <Text
                style={[
                  styles.heroBtnText,
                  { color: settings.bannerColor },
                ]}
              >
                تسوقي الآن
              </Text>

              <Ionicons
                name="arrow-back"
                size={16}
                color={settings.bannerColor}
              />
            </View>

            <View style={styles.heroStats}>
              <Ionicons name="star" size={14} color="#FFD700" />
              <Ionicons name="star" size={14} color="#FFD700" />
              <Ionicons name="star" size={14} color="#FFD700" />
              <Ionicons name="star" size={14} color="#FFD700" />
              <Ionicons name="star" size={14} color="#FFD700" />

              <Text style={styles.heroStatText}>
                +٤٨٠٠ عميل
              </Text>
            </View>
          </View>
        </Pressable>
      )}

      {showProductOffersButton ? (
        <Pressable
          onPress={() =>
            router.push("/offers")
          }
          style={[
            styles.installBtn,
            { backgroundColor: "#FFD54F" },
            desktopBannerStyle,
          ]}
        >
          <Text style={[styles.installBtnText, { color: "#3D2B00" }]}>
            🔥قسم العروض🔥
          </Text>
          <Ionicons name="arrow-back" size={18} color="#3D2B00" />
        </Pressable>
      ) : null}

      {Platform.OS === "web" && !isInstalled && (installPrompt || isIos) ? (
        <Pressable
          onPress={() => void handleInstall()}
          style={[
            styles.installBtn,
            { backgroundColor: colors.primary },
            desktopBannerStyle,
          ]}
        >
          <Ionicons name="download-outline" size={20} color="#fff" />
          <Text style={styles.installBtnText}>تثبيت تطبيق Lovely Kids</Text>
        </Pressable>
      ) : null}

      {Platform.OS === "web" && !webPushEnabled ? (
        <Pressable
          onPress={() => void handleEnableWebPush()}
          style={[
            styles.installBtn,
            { backgroundColor: colors.primary },
            desktopBannerStyle,
          ]}
        >
          <Ionicons name="notifications-outline" size={20} color="#fff" />
          <Text style={styles.installBtnText}>تفعيل الإشعارات</Text>
        </Pressable>
      ) : null}

      {/* Trust Badges */}
      {settings.homeTopBenefitsSectionEnabled !== false ? (
        <>
      <View
        style={[
          styles.trustRow,
          isDesktopWeb
            ? {
                width: Math.min(responsiveShellWidth, 920),
                alignSelf: "center",
                paddingHorizontal: 0,
                justifyContent: "center",
                gap: 18,
                marginTop: 20,
                marginBottom: 22,
              }
            : null,
        ]}
      >
        {TRUST_BADGES.map((t) => (
          <View
            key={t.title}
            style={[
              styles.trustItem,
              isDesktopWeb
                ? {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderWidth: 1,
                    borderRadius: 18,
                    paddingVertical: 18,
                    paddingHorizontal: 14,
                  }
                : null,
            ]}
          >
            <View style={[styles.trustIconCircle, { backgroundColor: t.color + "20" }]}>
              <Ionicons name={t.icon} size={24} color={t.color} />
            </View>
            <Text style={[styles.trustTitle, { color: colors.foreground }]}>
              {t.title}
            </Text>
            <Text style={[styles.trustSubtitle, { color: colors.mutedForeground }]}>
              {t.subtitle}
            </Text>
          </View>
        ))}
      </View>

        </>
      ) : null}

      {/* Active Offers */}
      {settings.homeSpecialOffersSectionEnabled !== false &&
        activeOffers.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            🏷️ عروض خاصة
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.offersScroll}
          >
            {activeOffers.map((offer) => (
              <View
                key={offer.id}
                style={[styles.offerCard, { backgroundColor: offer.color }]}
              >
                <View style={styles.offerBadge}>
                  <Text style={styles.offerBadgeText}>{offer.badgeText}</Text>
                </View>
                <Text style={styles.offerTitle} numberOfLines={2}>
                  {offer.title}
                </Text>
                <Text style={styles.offerSub} numberOfLines={1}>
                  {offer.subtitle}
                </Text>
              </View>
            ))}
          </ScrollView>
        </>
      )}

      {settings.homeAgeGroupsSectionEnabled !== false ? (
        <>
      {/* Age Groups */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
        تسوقي حسب عمر الطفل
      </Text>
      <View style={styles.ageScrollWrapper}>
        <Animated.View style={[styles.ageArrowRight, { opacity: ageArrowAnim, pointerEvents: "none" }]}>
          <Ionicons name="chevron-forward" size={13} color={colors.primary} />
        </Animated.View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.ageScroll}
        >
          {ageGroups.map((ag, idx) => (
            <Pressable
              key={ag.id}
              onPress={() => setSelectedAge(selectedAge === ag.id ? null : ag.id)}
              style={[
                styles.ageItem,
                {
                  backgroundColor:
                    selectedAge === ag.id ? colors.primary : colors.card,
                  borderColor:
                    selectedAge === ag.id ? colors.primary : colors.border,
                },
              ]}
            >
              <View
                style={[
                  styles.ageIcon,
                  { backgroundColor: AGE_COLORS[idx] + "40" },
                ]}
              >
                <Ionicons
                  name={(AGE_GROUP_ICONS[ag.id] ?? "person-outline") as keyof typeof Ionicons.glyphMap}
                  size={22}
                  color={AGE_COLORS[idx]}
                />
              </View>
              <Text
                style={[
                  styles.ageLabel,
                  {
                    color:
                      selectedAge === ag.id ? "#fff" : colors.foreground,
                  },
                ]}
              >
                {ag.label}
              </Text>
              <Text
                style={[
                  styles.ageSublabel,
                  {
                    color:
                      selectedAge === ag.id
                        ? "rgba(255,255,255,0.8)"
                        : colors.mutedForeground,
                  },
                ]}
              >
                {ag.sublabel}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <Animated.View style={[styles.ageArrowLeft, { opacity: ageArrowAnim, pointerEvents: "none" }]}>
          <Ionicons name="chevron-back" size={13} color={colors.primary} />
        </Animated.View>
      </View>

        </>
      ) : null}

      {settings.homeFeaturesSectionEnabled !== false ? (
        <>
      {/* Features */}
      <View style={styles.features}>
        {[
          { icon: "rocket-outline" as const, text: "توصيل سريع" },
          { icon: "shield-checkmark-outline" as const, text: "دفع آمن" },
          { icon: "refresh-outline" as const, text: "إمكانية الاستبدال" },
          { icon: "headset-outline" as const, text: "دعم 24/7" },
        ].map((f) => (
          <View
            key={f.text}
            style={[
              styles.featureItem,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Ionicons name={f.icon} size={22} color={colors.primary} />
            <Text style={[styles.featureText, { color: colors.foreground }]}>
              {f.text}
            </Text>
          </View>
        ))}
      </View>

        </>
      ) : null}

      {/* New Arrivals */}
      {newArrivals.length > 0 ? (
        <>
          {renderHomeSectionHeader(
            "وصل حديثاً",
            () => router.push("/new-arrivals"),
          )}

          <View
            style={[
              styles.newArrivalsScrollWrapper,
              isDesktopWeb ? responsiveShellStyle : null,
            ]}
          >
            {newArrivals.length > 2 ? (
              <>
                <Pressable
                  onPress={() => scrollNewArrivals("right")}
                  style={({ pressed }) => [
                    styles.newArrivalsArrow,
                    styles.newArrivalsArrowRight,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      opacity: pressed ? 0.7 : 0.95,
                    },
                  ]}
                  accessibilityLabel="تحريك وصل حديثاً إلى اليمين"
                >
                  <Ionicons
                    name="chevron-forward"
                    size={20}
                    color={colors.primary}
                  />
                </Pressable>

                <Pressable
                  onPress={() => scrollNewArrivals("left")}
                  style={({ pressed }) => [
                    styles.newArrivalsArrow,
                    styles.newArrivalsArrowLeft,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      opacity: pressed ? 0.7 : 0.95,
                    },
                  ]}
                  accessibilityLabel="تحريك وصل حديثاً إلى اليسار"
                >
                  <Ionicons
                    name="chevron-back"
                    size={20}
                    color={colors.primary}
                  />
                </Pressable>
              </>
            ) : null}

            <ScrollView
              ref={newArrivalsScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[
                styles.newArrivalsHorizontalScroll,
                isDesktopWeb ? { paddingHorizontal: 0 } : null,
              ]}
              onLayout={(event) => {
                newArrivalsViewportWidth.current =
                  event.nativeEvent.layout.width;
                updateNewArrivalsBounds();
              }}
              onContentSizeChange={(contentWidth) => {
                newArrivalsContentWidth.current = contentWidth;
                updateNewArrivalsBounds();
              }}
              onScrollBeginDrag={() => {
                newArrivalsAutoPaused.current = true;
              }}
              onScrollEndDrag={() => {
                newArrivalsAutoPaused.current = false;
              }}
              onMomentumScrollEnd={() => {
                newArrivalsAutoPaused.current = false;
              }}
              onScroll={(event) => {
                const currentX = event.nativeEvent.contentOffset.x;
                newArrivalsScrollX.current = currentX;

                if (currentX <= 1) {
                  newArrivalsDirection.current = 1;
                } else if (
                  currentX >= newArrivalsMaxScrollX.current - 1
                ) {
                  newArrivalsDirection.current = -1;
                }
              }}
              scrollEventThrottle={16}
            >
              {newArrivals.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  style={{ width: newArrivalCardWidth }}
                  imageHeight={newArrivalImageHeight}
                />
              ))}
            </ScrollView>
          </View>
        </>
      ) : null}

      {/* Products Grid */}
      {renderHomeSectionHeader(
        selectedAgeForProducts
          ? ageGroups.find((a) => a.id === selectedAgeForProducts)?.label ?? "كل المنتجات"
          : "كل المنتجات",
        () => router.push("/products"),
      )}

      <View
        style={[
          styles.productsGrid,
          responsiveShellStyle,
        ]}
      >
        {filteredProducts.map((product, idx) => (
          <ProductCard
            key={product.id}
            product={product}
            style={{ width: homeProductCardWidth }}
            imageHeight={homeProductImageHeight}
          />
        ))}
      </View>

      {Platform.OS === "web" && (
        <Pressable
          onPress={() => router.push("/products")}
          style={({ pressed }) => [
            styles.bottomViewAllButton,
            desktopBannerStyle,
            {
              backgroundColor: colors.primary,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Text
            style={[
              styles.bottomViewAllText,
              { color: getReadableTextColor(colors.primary) },
            ]}
          >
            عرض جميع المنتجات
          </Text>
          <Ionicons
            name="arrow-back"
            size={20}
            color={getReadableTextColor(colors.primary)}
          />
        </Pressable>
      )}

      {/* Contact Banner */}
      <Pressable
        onPress={() => router.push("/contact")}
        style={[
          styles.contactBanner,
          { backgroundColor: colors.secondary },
          desktopBannerStyle,
        ]}
      >
        <Ionicons
          name="chatbubble-ellipses-outline"
          size={28}
          color={contactTextColor}
        />
        <View style={styles.contactText}>
          <Text
            style={[
              styles.contactTitle,
              { color: contactTextColor },
              Platform.OS === "web" && styles.contactTitleWeb,
            ]}
          >
            للتواصل معنا
          </Text>
          <Text
            style={[
              styles.contactSub,
              { color: contactSubTextColor },
              Platform.OS === "web" && styles.contactSubWeb,
            ]}
          >
            09-237-6808 · واتساب · نابلس
          </Text>
        </View>
        <Ionicons name="arrow-back" size={20} color={contactTextColor} />
      </Pressable>
    </ScrollView>

    {isDesktopWeb ? (
      <DesktopCategorySidebar />
    ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  header: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    position: "relative",
  },
  headerLeft: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    gap: Platform.OS === "web" ? 4 : 8,
    flex: 1,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  logoImage: {
    width: Platform.OS === "web" ? 110 : 110,
    height: Platform.OS === "web" ? 48 : 52,
  },
  webCenteredLogo: {
    position: "absolute",
    left: "50%",
    transform: [{ translateX: -55 }],
    zIndex: 1,
  },
  greetingBlock: {
    alignItems: "flex-end",
    flexShrink: 1,
  },
  greetingHi: {
    fontSize: 15,
    fontWeight: "800",
    textAlign: "right",
    letterSpacing: 0.3,
  },
  greetingName: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "right",
    marginTop: 1,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  wishlistBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  wishlistBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
  },
  searchBar: {
    marginHorizontal: 16,
    marginBottom: 16,
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  searchPlaceholder: { fontSize: 14, flex: 1, textAlign: "right" },
  heroBanner: {
    marginHorizontal: 16,
    borderRadius: 20,
    overflow: "hidden",
    marginBottom: 20,
    padding: 20,
    minHeight: 180,
  },
  heroContent: { alignItems: "flex-end", gap: 8 },
  heroBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    alignSelf: "flex-end",
  },
  heroBadgeText: { fontSize: 12, fontWeight: "700", color: "#333" },
  heroTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#fff",
    textAlign: "right",
    lineHeight: 32,
  },
  heroSubtitle: { fontSize: 13, color: "rgba(255,255,255,0.85)", textAlign: "right" },
  heroBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 30,
    alignSelf: "flex-end",
    marginTop: 4,
  },
  heroBtnText: { fontSize: 14, fontWeight: "700" },
  heroStats: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 4,
  },
  heroStatText: { color: "rgba(255,255,255,0.9)", fontSize: 12, marginRight: 4 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    textAlign: "right",
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  seeAll: { fontSize: 13, fontWeight: "600" },
  offersScroll: { paddingHorizontal: 16, gap: 12, paddingBottom: 4 },
  offerCard: {
    width: 180,
    borderRadius: 16,
    padding: 14,
    gap: 6,
    marginBottom: 16,
  },
  offerBadge: {
    backgroundColor: "rgba(255,255,255,0.3)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignSelf: "flex-end",
  },
  offerBadgeText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  offerTitle: { color: "#fff", fontWeight: "700", fontSize: 14, textAlign: "right" },
  offerSub: { color: "rgba(255,255,255,0.85)", fontSize: 12, textAlign: "right" },
  ageScrollWrapper: {
    position: "relative",
    justifyContent: "center",
  },
  ageArrowRight: {
    position: "absolute",
    right: 4,
    top: 0,
    bottom: 16,
    justifyContent: "center",
    zIndex: 1,
  },
  ageArrowLeft: {
    position: "absolute",
    left: 4,
    top: 0,
    bottom: 16,
    justifyContent: "center",
    zIndex: 1,
  },
  ageScroll: { paddingHorizontal: 22, gap: 10, paddingBottom: 4 },
  ageItem: {
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
    minWidth: 80,
    marginBottom: 16,
  },
  ageIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  ageLabel: { fontSize: 13, fontWeight: "700" },
  ageSublabel: { fontSize: 10 },
  features: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    flexWrap: "wrap",
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 20,
  },
  featureItem: {
    width: (width - 40) / 2,
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  featureText: { fontSize: 12, fontWeight: "600", textAlign: "right" },
  installBtn: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    minHeight: 46,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  installBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  trustRow: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    justifyContent: "space-around",
    paddingHorizontal: 16,
    marginTop: 18,
    marginBottom: 8,
  },
  trustItem: { alignItems: "center", flex: 1, gap: 2 },
  trustIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 6,
  },
  trustTitle: { fontSize: 12, fontWeight: "700", textAlign: "center" },
  trustSubtitle: { fontSize: 10, textAlign: "center" },
  homeBannerHeader: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  homeBannerTitleBox: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  homeBannerAccent: {
    width: 4,
    height: 22,
    borderRadius: 2,
  },
  homeBannerTitle: {
    fontSize: 18,
    fontWeight: "900",
    textAlign: "right",
  },
  homeBannerLine: {
    flex: 1,
    height: 1,
  },
  productsGrid: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    flexWrap: "wrap",
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 20,
  },
  newArrivalsScrollWrapper: {
    position: "relative",
    marginBottom: 20,
  },
  newArrivalsArrow: {
    position: "absolute",
    top: "40%",
    zIndex: 5,
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
  },
  newArrivalsArrowRight: {
    right: 6,
  },
  newArrivalsArrowLeft: {
    left: 6,
  },
  newArrivalsHorizontalScroll: {
    paddingHorizontal: 48,
    gap: 12,
    paddingBottom: 4,
  },
  horizontalScroll: {
    paddingHorizontal: 16,
    gap: 12,
    paddingBottom: 4,
    marginBottom: 20,
  },
  bottomViewAllButton: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 14,
    minHeight: 48,
    borderRadius: 16,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  bottomViewAllText: {
    fontSize: 15,
    fontWeight: "700",
  },
  contactBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 16,
  },
  contactText: { flex: 1, alignItems: Platform.OS === "web" ? "flex-end" : "flex-start" },
  contactTitle: { fontSize: 16, fontWeight: "700" },
  contactTitleWeb: { fontSize: 17, fontWeight: "800" },
  contactSub: { fontSize: 12, marginTop: 2 },
  contactSubWeb: { fontSize: 13, fontWeight: "600", marginTop: 3 },
  genderTabsRow: {
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  genderTab: {
    flex: 1,
    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
  },
  genderTabText: { fontSize: 14, fontWeight: "700" },
});
