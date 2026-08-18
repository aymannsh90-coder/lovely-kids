const PREFIX = "/media/";
const SUPABASE_ORIGIN =
  "https://kgpxaifetrkclxfqpuxl.supabase.co/storage/v1/object/public/product-images/";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    if (!url.pathname.startsWith(PREFIX)) {
      return new Response("Not Found", { status: 404 });
    }

    const raw = url.pathname.slice(PREFIX.length);

    let filename;

    try {
      filename = decodeURIComponent(raw);
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    if (
      !filename ||
      filename.includes("/") ||
      filename.includes("\\") ||
      filename.includes("..")
    ) {
      return new Response("Bad Request", { status: 400 });
    }

    const originUrl =
      SUPABASE_ORIGIN + encodeURIComponent(filename);

    const originResponse = await fetch(originUrl, {
      method: request.method,
      cf: {
        cacheEverything: true,
        cacheTtl: 31536000
      }
    });

    if (!originResponse.ok) {
      return new Response(originResponse.body, {
        status: originResponse.status,
        headers: {
          "Content-Type":
            originResponse.headers.get("Content-Type") ??
            "application/octet-stream",
          "Cache-Control": "no-store"
        }
      });
    }

    const headers = new Headers(originResponse.headers);

    // Never forward origin cookies to public media responses.
    // Set-Cookie makes Cloudflare bypass Workers Cache.
    headers.delete("Set-Cookie");
    headers.delete("set-cookie");

    headers.set(
      "Cache-Control",
      "public, max-age=31536000, immutable"
    );
    headers.set(
      "Cloudflare-CDN-Cache-Control",
      "public, max-age=31536000"
    );
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set(
      "Cross-Origin-Resource-Policy",
      "cross-origin"
    );

    return new Response(
      request.method === "HEAD" ? null : originResponse.body,
      {
        status: originResponse.status,
        headers
      }
    );
  }
};
