import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import ColorPicker, {
  HueSlider,
  Panel1,
  Preview,
} from "reanimated-color-picker";

import { useColors } from "@/hooks/useColors";

const QUICK_COLORS = [
  "#E91E8C", "#2196F3", "#9C27B0", "#FF5722",
  "#4CAF50", "#F44336", "#00BCD4", "#FFC107",
  "#111827", "#FFFFFF",
];

const HEX_REGEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

interface ColorPickerModalProps {
  visible: boolean;
  initialColor: string;
  title?: string;
  onClose: () => void;
  onSelect: (hex: string) => void;
}

export function ColorPickerModal({
  visible,
  initialColor,
  title = "اختر اللون",
  onClose,
  onSelect,
}: ColorPickerModalProps) {
  const colors = useColors();
  const [pendingColor, setPendingColor] = useState(initialColor);
  const [hexInput, setHexInput] = useState(initialColor);

  React.useEffect(() => {
    if (visible) {
      setPendingColor(initialColor);
      setHexInput(initialColor);
    }
  }, [visible, initialColor]);

  const handleConfirm = () => {
    onSelect(pendingColor);
    onClose();
  };

  const handleHexSubmit = () => {
    let v = hexInput.trim();
    if (v && !v.startsWith("#")) v = `#${v}`;
    if (HEX_REGEX.test(v)) {
      setPendingColor(v);
    } else {
      setHexInput(pendingColor);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.header}>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={colors.mutedForeground} />
            </Pressable>
            <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
            <View style={{ width: 24 }} />
          </View>

          <ColorPicker
            value={pendingColor}
            onChangeJS={({ hex }) => {
              setPendingColor(hex);
              setHexInput(hex);
            }}
            style={styles.picker}
          >
            <Panel1 style={styles.panel} thumbShape="ring" />
            <View style={styles.hueRow}>
              <Preview hideText style={styles.previewCircle} />
              <HueSlider style={styles.hueSlider} />
            </View>
          </ColorPicker>

          <View style={styles.hexRow}>
            <Text style={[styles.hexLabel, { color: colors.mutedForeground }]}>HEX</Text>
            <TextInput
              value={hexInput}
              onChangeText={setHexInput}
              onSubmitEditing={handleHexSubmit}
              onBlur={handleHexSubmit}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="#RRGGBB"
              placeholderTextColor={colors.mutedForeground}
              style={[
                styles.hexInput,
                { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground },
              ]}
            />
          </View>

          <View style={styles.quickRow}>
            {QUICK_COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => {
                  setPendingColor(c);
                  setHexInput(c);
                }}
                style={[
                  styles.quickSwatch,
                  { backgroundColor: c, borderColor: colors.border },
                  pendingColor.toLowerCase() === c.toLowerCase() && {
                    borderColor: colors.primary,
                    borderWidth: 2,
                  },
                ]}
              />
            ))}
          </View>

          <View style={styles.btnRow}>
            <Pressable
              onPress={onClose}
              style={[styles.cancelBtn, { backgroundColor: colors.muted }]}
            >
              <Text style={[styles.cancelBtnText, { color: colors.mutedForeground }]}>إلغاء</Text>
            </Pressable>
            <Pressable
              onPress={handleConfirm}
              style={[styles.confirmBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={styles.confirmBtnText}>تم</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 20,
    padding: 20,
  },
  header: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
  },
  picker: {
    width: "100%",
    gap: 14,
  },
  panel: {
    width: "100%",
    height: 180,
    borderRadius: 12,
  },
  hueRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 12,
  },
  previewCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  hueSlider: {
    flex: 1,
    height: 28,
    borderRadius: 14,
  },
  hexRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
    marginTop: 16,
  },
  hexLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  hexInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    textAlign: "left",
  },
  quickRow: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
  },
  quickSwatch: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
  },
  btnRow: {
    flexDirection: "row-reverse",
    gap: 10,
    marginTop: 20,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: "700",
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  confirmBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
});
