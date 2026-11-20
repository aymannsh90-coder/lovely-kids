const PRODUCTS_API_URL = "https://api.lovelykids.net/api/products";
const SITE_URL = "https://lovelykids.net";
const DEFAULT_IMAGE = "https://www.lovelykids.net/og-image-v3.jpg?v=20261116-approved";
const MEDIA_HOSTS = new Set([
  "media.lovelykids.net",
  "kgpxaifetrkclxfqpuxl.supabase.co",
]);

function safeText(value, limit = 180) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeMediaUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && MEDIA_HOSTS.has(url.hostname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function primaryImage(product) {
  const images = [
    product.image,
    ...(Array.isArray(product.images) ? product.images : []),
    ...(Array.isArray(product.colorVariants)
      ? product.colorVariants.map((variant) => variant?.image)
      : []),
  ];
  for (const image of images) {
    const url = safeMediaUrl(image);
    if (url) return url;
  }
  return DEFAULT_IMAGE;
}

export function renderProductPreviewHtml(html, product, id) {
  const name = safeText(product.nameAr || product.name, 100) || `منتج رقم ${id}`;
  const title = `${name} | Lovely Kids`;
  const detail = safeText(product.description, 130);
  const price = Number(product.price);
  const priceText = Number.isFinite(price) && price >= 0
    ? `السعر: ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(price)} ₪`
    : "";
  const description = [detail || "اكتشفوا هذا المنتج في متجر Lovely Kids", priceText]
    .filter(Boolean)
    .join(" | ");
  const image = primaryImage(product);
  const url = `${SITE_URL}/product/${id}`;
  const attr = (value) => escapeHtml(value);
  const tags = [
    ["property", "og:title", title],
    ["property", "og:description", description],
    ["property", "og:type", "product"],
    ["property", "og:url", url],
    ["property", "og:site_name", "Lovely Kids"],
    ["property", "og:locale", "ar_PS"],
    ["property", "og:image", image],
    ["property", "og:image:secure_url", image],
    ["property", "og:image:alt", name],
    ["name", "description", description],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", title],
    ["name", "twitter:description", description],
    ["name", "twitter:image", image],
  ].map(([kind, key, value]) =>
    `<meta ${kind}="${key}" content="${attr(value)}">`
  ).join("\n    ");

  return html
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta\b(?=[^>]*\b(?:name|property)\s*=\s*["'](?:description|og:[^"']+|twitter:[^"']+)["'])[^>]*>\s*/gi, "")
    .replace(/<\/head>/i, `    ${tags}\n  </head>`);
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET") return env.ASSETS.fetch(request);
    const path = new URL(request.url).pathname;
    const match = /^\/product\/([1-9]\d{0,9})\/?$/.exec(path);
    if (!match) return env.ASSETS.fetch(request);

    try {
      const apiResponse = await fetch(PRODUCTS_API_URL, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(3500),
      });
      if (!apiResponse.ok) return env.ASSETS.fetch(request);
      const products = await apiResponse.json();
      if (!Array.isArray(products)) return env.ASSETS.fetch(request);
      const product = products.find((item) => item && String(item.id) === match[1]);
      if (!product) return env.ASSETS.fetch(request);

      const htmlResponse = await env.ASSETS.fetch(
        new Request(new URL("/", request.url), { method: "GET" }),
      );
      if (!htmlResponse.ok) return env.ASSETS.fetch(request);
      const html = await htmlResponse.text();
      if (!/<\/head>/i.test(html)) return env.ASSETS.fetch(request);

      return new Response(renderProductPreviewHtml(html, product, match[1]), {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=60",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      console.error("PRODUCT_SHARE_PREVIEW_FALLBACK", String(error));
      return env.ASSETS.fetch(request);
    }
  },
};
