const fs = require("node:fs");
const path = require("node:path");

const dist = path.resolve(__dirname, "../dist");
const workerSource = path.resolve(__dirname, "product-share-worker.mjs");
const html = path.join(dist, "index.html");

if (!fs.existsSync(html) || !fs.existsSync(workerSource)) {
  throw new Error("Build product preview failed: missing dist/index.html or worker source");
}

fs.copyFileSync(workerSource, path.join(dist, "_worker.js"));
fs.writeFileSync(
  path.join(dist, "_routes.json"),
  JSON.stringify({ version: 1, include: ["/product/*"], exclude: [] }, null, 2) + "\n",
);

console.log("✅ Product share preview enabled for /product/* only");
console.log("✅ Static assets, home and offers pages bypass the preview Worker");
