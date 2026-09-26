function normalizeWhatsappLocalNumber(phone) {
  const normalizedPhone = String(phone ?? "")
    .replace(/[٠-٩]/g, (digit) =>
      String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))
    )
    .replace(/[۰-۹]/g, (digit) =>
      String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))
    );

  return normalizedPhone
    .replace(/\D/g, "")
    .replace(/^00/, "")
    .replace(/^970/, "")
    .replace(/^972/, "")
    .replace(/^0/, "");
}

function buildCustomerWhatsappUrl(phone, countryCode, orderId) {
  if (countryCode !== "970" && countryCode !== "972") {
    throw new Error("Unsupported WhatsApp country code");
  }

  const localNumber = normalizeWhatsappLocalNumber(phone);

  const msg = encodeURIComponent(
    `مرحباً! بخصوص طلبك رقم #${orderId} من Lovely Kids 🛍️`
  );

  return `https://wa.me/${countryCode}${localNumber}?text=${msg}`;
}

module.exports = {
  normalizeWhatsappLocalNumber,
  buildCustomerWhatsappUrl,
};
