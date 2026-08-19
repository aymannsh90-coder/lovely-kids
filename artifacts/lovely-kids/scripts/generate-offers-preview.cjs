const fs = require("fs");
const path = require("path");

const distDir = path.join(__dirname, "..", "dist");
const sourceFile = path.join(distDir, "index.html");
const offersDir = path.join(distDir, "offers");
const offersFile = path.join(offersDir, "index.html");

if (!fs.existsSync(sourceFile)) {
  console.error("❌ dist/index.html not found");
  process.exit(1);
}

let html = fs.readFileSync(sourceFile, "utf8");

const replace = (regex, value) => {
  if (!regex.test(html)) {
    console.error("❌ Could not find:", regex.toString());
    process.exit(1);
  }
  html = html.replace(regex, value);
};

replace(
  /<title>[\s\S]*?<\/title>/i,
  '<title>قسم العروض | Lovely Kids</title>'
);

replace(
  /<meta name="description" content="[^"]*"\s*\/?>/i,
  '<meta name="description" content="اكتشفوا عروض وخصومات Lovely Kids المميزة على ملابس الأطفال." />'
);

replace(
  /<meta property="og:title" content="[^"]*"\s*\/?>/i,
  '<meta property="og:title" content="🔥 قسم العروض | Lovely Kids">'
);

replace(
  /<meta property="og:description" content="[^"]*"\s*\/?>/i,
  '<meta property="og:description" content="عروض وخصومات مميزة بانتظاركم في Lovely Kids">'
);

replace(
  /<meta property="og:image" content="[^"]*"\s*\/?>/i,
  '<meta property="og:image" content="https://www.lovelykids.net/og-offers.png">'
);

replace(
  /<meta property="og:image:secure_url" content="[^"]*"\s*\/?>/i,
  '<meta property="og:image:secure_url" content="https://www.lovelykids.net/og-offers.png">'
);

replace(
  /<meta property="og:image:alt" content="[^"]*"\s*\/?>/i,
  '<meta property="og:image:alt" content="قسم العروض | Lovely Kids">'
);

replace(
  /<meta property="og:url" content="[^"]*"\s*\/?>/i,
  '<meta property="og:url" content="https://www.lovelykids.net/offers">'
);

replace(
  /<meta name="twitter:title" content="[^"]*"\s*\/?>/i,
  '<meta name="twitter:title" content="🔥 قسم العروض | Lovely Kids">'
);

replace(
  /<meta name="twitter:description" content="[^"]*"\s*\/?>/i,
  '<meta name="twitter:description" content="عروض وخصومات مميزة بانتظاركم في Lovely Kids">'
);

replace(
  /<meta name="twitter:image" content="[^"]*"\s*\/?>/i,
  '<meta name="twitter:image" content="https://www.lovelykids.net/og-offers.png">'
);

fs.mkdirSync(offersDir, { recursive: true });
fs.writeFileSync(offersFile, html);

console.log("✅ Created dist/offers/index.html");
console.log("✅ Main preview untouched");
console.log("✅ Offers preview metadata added");
