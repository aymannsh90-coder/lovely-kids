import type { Env } from "./db";

const MEDIA_BASE_URL = "https://media.lovelykids.net/media/";
const R2_MEDIA_PREFIX = "r2/";
const STORAGE_HOST = "kgpxaifetrkclxfqpuxl.supabase.co";
const STORAGE_PATH = "/storage/v1/object/public/product-images/";

export type MediaObjectProvider = "supabase" | "r2";

export type MediaObjectRef = {
  provider: MediaObjectProvider;
  filename: string;
};

function decodeSafeFilename(encoded: string): string | null {
  if (!encoded || encoded.includes("/")) return null;

  try {
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

export function getMediaObjectRef(
  value: string | undefined | null,
): MediaObjectRef | null {
  if (!value) return null;

  try {
    const url = new URL(value);

    if (
      url.hostname === "media.lovelykids.net" &&
      url.pathname.startsWith("/media/")
    ) {
      const mediaPath = url.pathname.slice("/media/".length);

      if (mediaPath.startsWith(R2_MEDIA_PREFIX)) {
        const filename = decodeSafeFilename(
          mediaPath.slice(R2_MEDIA_PREFIX.length),
        );

        return filename
          ? { provider: "r2", filename }
          : null;
      }

      const filename = decodeSafeFilename(mediaPath);

      return filename
        ? { provider: "supabase", filename }
        : null;
    }

    if (
      url.hostname === STORAGE_HOST &&
      url.pathname.startsWith(STORAGE_PATH)
    ) {
      const filename = decodeSafeFilename(
        url.pathname.slice(STORAGE_PATH.length),
      );

      return filename
        ? { provider: "supabase", filename }
        : null;
    }

    return null;
  } catch {
    return null;
  }
}

export function getMediaFilename(
  value: string | undefined | null,
): string | null {
  return getMediaObjectRef(value)?.filename ?? null;
}

export function toPublicMediaUrl(value: string): string {
  const ref = getMediaObjectRef(value);

  if (!ref) return value;

  const prefix =
    ref.provider === "r2"
      ? R2_MEDIA_PREFIX
      : "";

  return (
    `${MEDIA_BASE_URL}${prefix}` +
    encodeURIComponent(ref.filename)
  );
}

export function toStorageMediaUrl(
  value: string,
  env: Pick<Env, "SUPABASE_URL">,
): string {
  if (!value.startsWith(MEDIA_BASE_URL)) return value;

  const ref = getMediaObjectRef(value);
  if (!ref) return value;

  // R2-backed media keeps its public media URL in the database.
  // This preserves the storage provider explicitly and makes rollback safe.
  if (ref.provider === "r2") {
    return toPublicMediaUrl(value);
  }

  const supabaseUrl =
    env.SUPABASE_URL?.replace(/\/+$/, "");

  if (!supabaseUrl) return value;

  return (
    `${supabaseUrl}${STORAGE_PATH}` +
    encodeURIComponent(ref.filename)
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
    return value.map((item) =>
      rewriteDeep(item, rewrite)
    );
  }

  if (
    value &&
    typeof value === "object" &&
    !(value instanceof Date)
  ) {
    const proto = Object.getPrototypeOf(value);

    if (
      proto === Object.prototype ||
      proto === null
    ) {
      return Object.fromEntries(
        Object.entries(
          value as Record<string, unknown>,
        ).map(([key, item]) => [
          key,
          rewriteDeep(item, rewrite),
        ]),
      );
    }
  }

  return value;
}

export function rewriteMediaUrlsForPublic<T>(
  value: T,
): T {
  return rewriteDeep(
    value,
    toPublicMediaUrl,
  ) as T;
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
