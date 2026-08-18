import type { Env } from "./db";

const MEDIA_BASE_URL = "https://media.lovelykids.net/media/";
const STORAGE_HOST = "kgpxaifetrkclxfqpuxl.supabase.co";
const STORAGE_PATH = "/storage/v1/object/public/product-images/";

export function getMediaFilename(value: string | undefined | null): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    let encoded: string | null = null;

    if (
      url.hostname === "media.lovelykids.net" &&
      url.pathname.startsWith("/media/")
    ) {
      encoded = url.pathname.slice("/media/".length);
    } else if (
      url.hostname === STORAGE_HOST &&
      url.pathname.startsWith(STORAGE_PATH)
    ) {
      encoded = url.pathname.slice(STORAGE_PATH.length);
    }

    if (!encoded || encoded.includes("/")) return null;

    const filename = decodeURIComponent(encoded);

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

export function toPublicMediaUrl(value: string): string {
  const filename = getMediaFilename(value);

  return filename
    ? `${MEDIA_BASE_URL}${encodeURIComponent(filename)}`
    : value;
}

export function toStorageMediaUrl(
  value: string,
  env: Pick<Env, "SUPABASE_URL">,
): string {
  if (!value.startsWith(MEDIA_BASE_URL)) return value;

  const filename = getMediaFilename(value);
  const supabaseUrl = env.SUPABASE_URL?.replace(/\/+$/, "");

  if (!filename || !supabaseUrl) return value;

  return (
    `${supabaseUrl}${STORAGE_PATH}` +
    encodeURIComponent(filename)
  );
}

function rewriteDeep(
  value: unknown,
  rewrite: (value: string) => string,
): unknown {
  if (typeof value === "string") {
    return rewrite(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => rewriteDeep(item, rewrite));
  }

  if (
    value &&
    typeof value === "object" &&
    !(value instanceof Date)
  ) {
    const proto = Object.getPrototypeOf(value);

    if (proto === Object.prototype || proto === null) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(
          ([key, item]) => [key, rewriteDeep(item, rewrite)],
        ),
      );
    }
  }

  return value;
}

export function rewriteMediaUrlsForPublic<T>(value: T): T {
  return rewriteDeep(value, toPublicMediaUrl) as T;
}

export function rewriteMediaUrlsForStorage<T>(
  value: T,
  env: Pick<Env, "SUPABASE_URL">,
): T {
  return rewriteDeep(
    value,
    (url) => toStorageMediaUrl(url, env),
  ) as T;
}
