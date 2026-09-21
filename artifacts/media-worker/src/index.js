const PREFIX = "/media/";
const R2_PREFIX = "r2/";

const SUPABASE_ORIGIN =
  "https://kgpxaifetrkclxfqpuxl.supabase.co/storage/v1/object/public/product-images/";

const CACHE_CONTROL =
  "public, max-age=31536000, immutable";

function decodeFilename(raw) {
  if (!raw || raw.includes("/")) return null;

  try {
    const filename = decodeURIComponent(raw);

    if (
      !filename ||
      filename.includes("/") ||
      filename.includes("\\") ||
      filename.includes("..")
    ) {
      return null;
    }

    return filename;
  } catch {
    return null;
  }
}

function publicHeaders(headers = new Headers()) {
  headers.delete("Set-Cookie");
  headers.delete("set-cookie");

  headers.set("Cache-Control", CACHE_CONTROL);
  headers.set(
    "Cloudflare-CDN-Cache-Control",
    "public, max-age=31536000"
  );
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set(
    "Cross-Origin-Resource-Policy",
    "cross-origin"
  );

  return headers;
}

async function serveR2(request, env, ctx, filename) {
  if (!env.R2_BUCKET) {
    return new Response("R2 unavailable", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (request.method === "HEAD") {
    const object = await env.R2_BUCKET.head(filename);

    if (!object) {
      return new Response(null, {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const headers = publicHeaders();

    if (object.httpMetadata?.contentType) {
      headers.set(
        "Content-Type",
        object.httpMetadata.contentType
      );
    }

    if (object.size !== undefined) {
      headers.set(
        "Content-Length",
        String(object.size)
      );
    }

    if (object.httpEtag) {
      headers.set("ETag", object.httpEtag);
    }

    return new Response(null, {
      status: 200,
      headers,
    });
  }

  const cache = caches.default;

  const cacheKey = new Request(request.url, {
    method: "GET",
    headers: request.headers,
  });

  const cached = await cache.match(cacheKey);

  if (cached) {
    return cached;
  }

  const object = await env.R2_BUCKET.get(filename);

  if (!object) {
    return new Response("Not Found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const headers = new Headers();

  object.writeHttpMetadata(headers);
  publicHeaders(headers);

  if (object.httpEtag) {
    headers.set("ETag", object.httpEtag);
  }

  const response = new Response(object.body, {
    status: 200,
    headers,
  });

  ctx.waitUntil(
    cache.put(cacheKey, response.clone())
  );

  return response;
}

async function serveSupabase(request, filename) {
  const originUrl =
    SUPABASE_ORIGIN + encodeURIComponent(filename);

  const originResponse = await fetch(originUrl, {
    method: request.method,
    cf: {
      cacheEverything: true,
      cacheTtl: 31536000,
    },
  });

  if (!originResponse.ok) {
    return new Response(
      request.method === "HEAD"
        ? null
        : originResponse.body,
      {
        status: originResponse.status,
        headers: {
          "Content-Type":
            originResponse.headers.get("Content-Type") ??
            "application/octet-stream",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  const headers = publicHeaders(
    new Headers(originResponse.headers)
  );

  return new Response(
    request.method === "HEAD"
      ? null
      : originResponse.body,
    {
      status: originResponse.status,
      headers,
    }
  );
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (
      request.method !== "GET" &&
      request.method !== "HEAD"
    ) {
      return new Response("Method Not Allowed", {
        status: 405,
      });
    }

    if (!url.pathname.startsWith(PREFIX)) {
      return new Response("Not Found", {
        status: 404,
      });
    }

    const mediaPath =
      url.pathname.slice(PREFIX.length);

    if (mediaPath.startsWith(R2_PREFIX)) {
      const filename = decodeFilename(
        mediaPath.slice(R2_PREFIX.length)
      );

      if (!filename) {
        return new Response("Bad Request", {
          status: 400,
        });
      }

      return serveR2(
        request,
        env,
        ctx,
        filename
      );
    }

    const filename = decodeFilename(mediaPath);

    if (!filename) {
      return new Response("Bad Request", {
        status: 400,
      });
    }

    return serveSupabase(request, filename);
  },
};
