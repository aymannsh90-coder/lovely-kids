const fs = require("fs");
const path = require("path");

const {
  normalizeWhatsappLocalNumber,
  buildCustomerWhatsappUrl,
} = require("../utils/whatsappPhone.js");

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

// Actual behavior tests
assert(
  normalizeWhatsappLocalNumber("٠٥٩٥٢٦٦٧٣١") === "595266731",
  "Arabic phone digits normalization failed"
);

assert(
  normalizeWhatsappLocalNumber("۰۵۹۵۲۶۶۷۳۱") === "595266731",
  "Persian phone digits normalization failed"
);

assert(
  normalizeWhatsappLocalNumber("970595266731") === "595266731",
  "Existing +970 normalization failed"
);

assert(
  normalizeWhatsappLocalNumber("972595266731") === "595266731",
  "Existing +972 normalization failed"
);

assert(
  buildCustomerWhatsappUrl("٠٥٩٥٢٦٦٧٣١", "970", 123)
    .startsWith("https://wa.me/970595266731?text="),
  "+970 WhatsApp URL behavior failed"
);

assert(
  buildCustomerWhatsappUrl("٠٥٩٥٢٦٦٧٣١", "972", 123)
    .startsWith("https://wa.me/972595266731?text="),
  "+972 WhatsApp URL behavior failed"
);

// Verify both choices made it into the actual production bundle
const dist = path.resolve(__dirname, "../dist");

function collectJsFiles(dir) {
  const files = [];

  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);

    if (item.isDirectory()) {
      files.push(...collectJsFiles(full));
    } else if (item.isFile() && item.name.endsWith(".js")) {
      files.push(full);
    }
  }

  return files;
}

assert(fs.existsSync(dist), "dist folder not found");

const bundle = collectJsFiles(dist)
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");

assert(bundle.includes("+970"), "+970 selector button missing from production bundle");
assert(bundle.includes("+972"), "+972 selector button missing from production bundle");
assert(bundle.includes("wa.me/"), "WhatsApp URL logic missing from production bundle");

console.log("✅ WhatsApp behavior guard passed: +970 / +972 / Arabic digits");
