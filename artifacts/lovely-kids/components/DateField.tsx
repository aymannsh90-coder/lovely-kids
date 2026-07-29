import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

export type DateFieldColors = {
  input: string;
  border: string;
  foreground: string;
  mutedForeground: string;
  primary: string;
};

export type DateFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  colors: DateFieldColors;
};

export function DateField({
  label,
  value,
  onChange,
  colors,
}: DateFieldProps) {
  return (
    <View style={styles.wrapper}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.mutedForeground}
        style={[
          styles.input,
          {
            backgroundColor: colors.input,
            borderColor: colors.border,
            color: colors.foreground,
          },
        ]}
        textAlign="right"
      />
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
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
  },
});
