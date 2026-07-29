import { Ionicons } from "@expo/vector-icons";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import React, { useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { DateFieldProps } from "./DateField";

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (match) {
    const date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
    );

    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return new Date();
}

export function DateField({
  label,
  value,
  onChange,
  colors,
}: DateFieldProps) {
  const [showPicker, setShowPicker] = useState(false);

  const handleChange = (
    event: DateTimePickerEvent,
    selectedDate?: Date,
  ) => {
    if (Platform.OS === "android") {
      setShowPicker(false);
    }

    if (event.type === "set" && selectedDate) {
      onChange(formatDate(selectedDate));
    }
  };

  return (
    <View style={styles.wrapper}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>
        {label}
      </Text>

      <View style={styles.row}>
        <Pressable
          onPress={() => setShowPicker(true)}
          style={[
            styles.dateButton,
            {
              backgroundColor: colors.input,
              borderColor: colors.border,
            },
          ]}
        >
          <Ionicons
            name="calendar-outline"
            size={21}
            color={colors.primary}
          />

          <Text
            style={[
              styles.dateText,
              {
                color: value
                  ? colors.foreground
                  : colors.mutedForeground,
              },
            ]}
          >
            {value || "اختر التاريخ"}
          </Text>
        </Pressable>

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

      {showPicker ? (
        <DateTimePicker
          value={parseDate(value)}
          mode="date"
          display={Platform.OS === "android" ? "calendar" : "default"}
          onChange={handleChange}
        />
      ) : null}
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
  dateButton: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  dateText: {
    flex: 1,
    fontSize: 15,
    textAlign: "right",
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
