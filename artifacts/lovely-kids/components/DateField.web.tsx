import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { DateFieldProps } from "./DateField";

export function DateField({
  label,
  value,
  onChange,
  colors,
}: DateFieldProps) {
  const input = React.createElement("input", {
    type: "date",
    value,
    onChange: (event: any) => onChange(event.target.value),
    "aria-label": label,
    style: {
      flex: 1,
      width: "100%",
      minHeight: 48,
      boxSizing: "border-box",
      border: `1px solid ${colors.border}`,
      borderRadius: 12,
      padding: "0 14px",
      background: colors.input,
      color: colors.foreground,
      fontSize: 15,
      fontFamily: "inherit",
      direction: "rtl",
      cursor: "pointer",
    },
  });

  return (
    <View style={styles.wrapper}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>
        {label}
      </Text>

      <View style={styles.row}>
        <View style={styles.inputWrapper}>{input}</View>

        {value ? (
          <Pressable
            onPress={() => onChange("")}
            style={[
              styles.clearButton,
              { borderColor: colors.border },
            ]}
          >
            <Text style={{ color: colors.mutedForeground }}>مسح</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    textAlign: "right",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  inputWrapper: {
    flex: 1,
  },
  clearButton: {
    minHeight: 48,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
});
