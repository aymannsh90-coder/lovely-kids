import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ColorPickerModal } from "@/components/ColorPickerModal";
import { useColors } from "@/hooks/useColors";

interface ColorPickerButtonProps {
  value: string;
  onChange: (hex: string) => void;
  title?: string;
  label?: string;
}

export function ColorPickerButton({
  value,
  onChange,
  title,
  label = "اضغط لاختيار اللون",
}: ColorPickerButtonProps) {
  const colors = useColors();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.button, { backgroundColor: colors.input, borderColor: colors.border }]}
      >
        <View style={styles.left}>
          <View style={[styles.swatch, { backgroundColor: value, borderColor: colors.border }]} />
          <Text style={[styles.hexText, { color: colors.foreground }]}>{value.toUpperCase()}</Text>
        </View>
        <View style={styles.right}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
          <Ionicons name="color-palette-outline" size={18} color={colors.mutedForeground} />
        </View>
      </Pressable>

      <ColorPickerModal
        visible={open}
        initialColor={value}
        title={title}
        onClose={() => setOpen(false)}
        onSelect={onChange}
      />
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  left: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
  },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
  },
  hexText: {
    fontSize: 14,
    fontWeight: "700",
  },
  right: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 6,
  },
  label: {
    fontSize: 12,
  },
});
