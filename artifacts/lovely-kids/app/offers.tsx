import ProductsScreen from "@/components/ProductsScreen";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

export default function OffersRoute() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <ProductsScreen offersOnly />

      <View style={styles.floatingButtonContainer} pointerEvents="box-none">
        <Pressable
          onPress={() => router.replace("/(tabs)")}
          accessibilityRole="button"
          accessibilityLabel="العودة إلى المتجر"
          style={({ pressed }) => [
            styles.storeButton,
            pressed && styles.storeButtonPressed,
          ]}
        >
          <Text style={styles.storeButtonText}>🏠 العودة إلى المتجر</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  floatingButtonContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 18,
    alignItems: "center",
    zIndex: 1000,
  },

  storeButton: {
    backgroundColor: "#11195B",
    minWidth: 190,
    paddingHorizontal: 22,
    paddingVertical: 13,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 7,
  },

  storeButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },

  storeButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },
});
