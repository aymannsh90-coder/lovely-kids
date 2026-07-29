import { Alert, Platform } from "react-native";

function browserConfirm(message: string): boolean {
  const confirmFn = (globalThis as { confirm?: (text: string) => boolean }).confirm;
  return typeof confirmFn === "function" ? confirmFn(message) : false;
}

function browserAlert(message: string): void {
  const alertFn = (globalThis as { alert?: (text: string) => void }).alert;
  if (typeof alertFn === "function") alertFn(message);
}

export function confirmDuplicateCartItem(onConfirm: () => void) {
  const message =
    "هذا المنتج بنفس اللون والمقاس موجود في سلتك. هل تريد إضافة قطعة أخرى؟";

  if (Platform.OS === "web") {
    if (browserConfirm(`المنتج موجود في السلة\n\n${message}`)) onConfirm();
    return;
  }

  Alert.alert(
    "المنتج موجود في السلة",
    message,
    [
      { text: "إلغاء", style: "cancel" },
      { text: "إضافة قطعة أخرى", onPress: onConfirm },
    ],
  );
}

export function showStockLimit(available: number | null) {
  let message = "لا توجد كمية إضافية متوفرة من هذا المنتج.";

  if (available === 1) {
    message = "المتوفر من هذا المنتج قطعة واحدة فقط.";
  } else if (available !== null && available > 1) {
    message = `الكمية المتوفرة من هذا المنتج ${available} قطع فقط.`;
  }

  if (Platform.OS === "web") {
    browserAlert(`وصلت للكمية المتوفرة\n\n${message}`);
    return;
  }

  Alert.alert("وصلت للكمية المتوفرة", message);
}

export function confirmRemoveFromCart(onConfirm: () => void) {
  const message = "هل تريد إزالة هذا المنتج من السلة؟";

  if (Platform.OS === "web") {
    if (browserConfirm(`إزالة المنتج؟\n\n${message}`)) onConfirm();
    return;
  }

  Alert.alert(
    "إزالة المنتج؟",
    message,
    [
      { text: "إلغاء", style: "cancel" },
      { text: "حذف", style: "destructive", onPress: onConfirm },
    ],
  );
}
