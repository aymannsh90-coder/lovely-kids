export function formatMoney(value: number | string, currencyCode = "ILS") {
  const numericValue = Number(value);

  return new Intl.NumberFormat("ar-PS", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
  }).format(Number.isFinite(numericValue) ? numericValue : 0);
}

export function formatMinor(value: number, currencyCode = "ILS") {
  return formatMoney(value / 100, currencyCode);
}

export function formatBusinessDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return value;
  }

  return new Intl.DateTimeFormat("ar-PS", {
    dateStyle: "medium",
    timeZone: "Asia/Hebron",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ar-PS", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Hebron",
  }).format(new Date(value));
}
